//
// Proves the design system is IN THE BUILT ARTIFACT and actually paints.
//
// THE HOLE THIS CLOSES, measured rather than imagined. Delete `import './index.css'` from
// `src/main.tsx` and: `npm run lint` is green, `npm run build:web` is green — warning gate, eager
// budget, every route evaluating, `window.__PASSBOOK__.network === 'mainnet'` — and the font and
// theme tests are 13/13 green. `apps/web/dist/assets/` then contains NO `.css` file at all. The
// entire design system disappears and every gate in the repository reports success.
//
// That is the precise failure class this story exists to end, so the assertion is made where it
// cannot be fooled: against the emitted bytes, and against what the browser COMPUTES from them.
// A stylesheet that is emitted but never linked, linked but overridden, or linked and empty all
// fail here, because the check is "what colour is the body", not "does a file exist".
//
// Split out of `build-web.mjs` so the verdict logic is a pure function over
// (assets, probe result) and can be driven RED from the test suite with fabricated inputs, instead
// of being reachable only by breaking the working tree and running a full build.
//
import { readFileSync } from 'node:fs'

import YAML from 'yaml'

/**
 * Runs INSIDE the page. Reads what the browser computed, in both theme states.
 *
 * Toggling `data-theme` and reading again is the whole trick: it proves the dark sheet reached the
 * artifact UNLAYERED and still wins, which is the one failure mode that produces a permanently-light
 * app with no error anywhere. The prior value is restored so the probe cannot disturb anything that
 * runs after it.
 */
export function designProbe() {
  const root = document.documentElement
  const read = () => ({
    background: getComputedStyle(document.body).backgroundColor,
    colorScheme: getComputedStyle(root).colorScheme,
    ground: getComputedStyle(root).getPropertyValue('--color-ground').trim(),
    fontFamily: getComputedStyle(document.body).fontFamily,
    shadow: getComputedStyle(root).getPropertyValue('--sh-short').trim(),
  })

  const previous = root.getAttribute('data-theme')
  root.setAttribute('data-theme', 'light')
  const light = read()
  root.setAttribute('data-theme', 'dark')
  const dark = read()
  if (previous === null) root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', previous)

  return { light, dark, styleSheetCount: document.styleSheets.length }
}

/** `#FCFAF6` -> `rgb(252, 250, 246)`, the shape `getComputedStyle` returns. */
export function toRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}

/** The two ground colours, read from the design authority's own committed copy. */
export function expectedGrounds(yamlPath) {
  const d = YAML.parse(readFileSync(yamlPath, 'utf8'))
  return { light: d.colors.light.ground, dark: d.colors.dark.ground, family: d.typography.family }
}

/**
 * The verdict. PURE — no filesystem, no browser — so the suite can drive every failure.
 *
 * @param {object} o
 * @param {string[]} o.cssAssets      emitted `.css` files, repo-relative
 * @param {object} o.probed           what `designProbe()` returned
 * @param {object} o.expected         from `expectedGrounds()`
 * @returns {string[]} problems, empty when the design system shipped
 */
export function designProblems({ cssAssets, probed, expected }) {
  const problems = []

  if (!cssAssets.length) {
    problems.push(
      'the build emitted NO stylesheet at all. The app imports its only CSS entry point from ' +
        '`src/main.tsx`; if that import is gone, every other gate in this repository still passes ' +
        'and the entire design system is simply absent from the artifact.',
    )
  }

  if (!probed) {
    problems.push('the design probe did not run in the page, so nothing was measured')
    return problems
  }

  if (!probed.styleSheetCount) {
    problems.push('the loaded document has zero stylesheets — a CSS file was emitted but nothing links it')
  }

  for (const mode of ['light', 'dark']) {
    const seen = probed[mode]
    const wantGround = expected[mode]
    const wantRgb = toRgb(wantGround)

    if (seen.ground.toUpperCase() !== wantGround.toUpperCase()) {
      problems.push(
        `${mode}: --color-ground computed to ${JSON.stringify(seen.ground) || '(empty)'}, expected ` +
          `${wantGround}. The token sheet is not reaching the document.`,
      )
    }
    if (seen.background !== wantRgb) {
      problems.push(
        `${mode}: the body painted ${seen.background}, expected ${wantRgb} (${wantGround}). The ` +
          `token exists but nothing applies it — a base layer that never landed.`,
      )
    }
    if (seen.colorScheme !== mode) {
      problems.push(
        `${mode}: color-scheme computed to ${JSON.stringify(seen.colorScheme)}. It is the only ` +
          `thing that flips native scrollbars and form controls, and nothing else will.`,
      )
    }
  }

  // Geometry, not just ink: dark shadows change blur, spread and offset, and whole-value
  // indirection is the only shape that carries that across a theme flip.
  if (probed.light.shadow === probed.dark.shadow) {
    problems.push(
      `--sh-short is identical in both themes (${probed.light.shadow || '(empty)'}). Shadow values ` +
        `are inlined at compile time, so this is what a silently un-themed shadow looks like.`,
    )
  }

  const family = probed.light.fontFamily ?? ''
  if (!family.includes(expected.family)) {
    problems.push(
      `the body resolved font-family to ${JSON.stringify(family)}, which does not name ` +
        `"${expected.family}". The typeface is part of the sheet, not a separate concern.`,
    )
  }

  return problems
}
