//
// Proves the design system is IN THE BUILT ARTIFACT — by reading the artifact.
//
// THE HOLE THIS CLOSES, measured rather than imagined. Delete `import './index.css'` from
// `src/main.tsx` and: `npm run lint` is green, `npm run build:web` is green — warning gate, eager
// budget, the route tree intact — and `apps/web/dist/assets/` then contains NO `.css` file at all.
// The entire design system disappears and every other gate in the repository reports success.
//
// HOW THIS USED TO WORK, AND WHY IT NO LONGER DOES. The first version launched headless Chromium,
// loaded the page, toggled `data-theme` and read `getComputedStyle`. That bought one thing a text
// read cannot give — proof the browser AGREED — at the cost of a 130 MB binary download, a
// postinstall step `npm ci` does not perform, and a gate that fails with a Playwright stack trace on
// any machine that has not run `playwright-core install`. Abu's ruling (2026-08-26): read the
// artifact like an engineer instead of driving a browser to find out what is already written down.
//
// WHAT THE TEXT READ ACTUALLY PROVES. The emitted stylesheet is not minified past legibility — the
// tokens survive as literal custom-property declarations, and the theme is delivered through three
// selectors that are all greppable. So every assertion the probe made survives, and ONE GETS
// STRONGER: the probe could only observe whichever dark path `data-theme` selected, while the text
// read verifies BOTH the `prefers-color-scheme` path and the `[data-theme=dark]` path are present.
// A dark sheet that reaches only one of them is a real shipped bug the browser version could not
// see.
//
// The verdict stays a pure function over (assets, read, expected) so the failures can be driven
// with fabricated inputs rather than by breaking the working tree.
//
import { readFileSync } from 'node:fs'

import YAML from 'yaml'

/** `#FCFAF6` and `#fcfaf6` are the same colour; the emitter lowercases. */
const sameHex = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase()

/**
 * The three theme-carrying regions of the emitted sheet.
 *
 * `:root` appears several times (the framework emits its own), so the LIGHT region is the one that
 * declares `--color-ground` outside any dark context, and the dark regions are the two blocks that
 * redeclare it. Splitting on the two dark markers is enough to tell them apart without parsing CSS:
 * a declaration cannot cross a block boundary, so whichever region a `--color-ground:` lands in is
 * the region that owns it.
 */
function themeRegions(css) {
  const media = css.indexOf('prefers-color-scheme:dark')
  const attr = css.indexOf('[data-theme=dark]')
  return {
    // Everything before the first dark marker is light-only territory.
    light: css.slice(0, Math.min(...[media, attr].filter((i) => i >= 0).concat([css.length]))),
    media: media >= 0 ? css.slice(media, attr > media ? attr : undefined) : '',
    attr: attr >= 0 ? css.slice(attr) : '',
  }
}

/** Last wins, as in the cascade — a token redeclared later in a region is the effective one. */
function decl(region, prop) {
  const hits = [...region.matchAll(new RegExp(`${prop}\\s*:\\s*([^;}]+)`, 'g'))]
  return hits.length ? hits[hits.length - 1][1].trim() : ''
}

/**
 * Reads the shipped design system out of the emitted bytes.
 *
 * @param {object} o
 * @param {string} o.css   contents of the emitted stylesheet
 * @param {string} o.html  contents of the emitted `index.html`
 */
export function readDesign({ css, html }) {
  const r = themeRegions(css)
  return {
    linked: /<link[^>]+rel=["']?stylesheet["']?[^>]*>/i.test(html),
    light: {
      ground: decl(r.light, '--color-ground'),
      colorScheme: decl(r.light, 'color-scheme'),
      shadow: decl(r.light, '--sh-short'),
    },
    // Both dark delivery paths, read independently.
    dark: {
      ground: decl(r.attr, '--color-ground'),
      colorScheme: decl(r.attr, 'color-scheme'),
      shadow: decl(r.attr, '--sh-short'),
    },
    darkMediaGround: decl(r.media, '--color-ground'),
    // The token has to be USED, not merely defined — a sheet full of correct tokens that nothing
    // applies paints exactly like no sheet at all.
    bodyAppliesGround: /body\s*\{[^}]*background-color:\s*var\(--color-ground\)/.test(css),
    fontSans: decl(css, '--font-sans'),
  }
}

/** The two ground colours and the typeface, read from the design authority's own committed copy. */
export function expectedGrounds(yamlPath) {
  const d = YAML.parse(readFileSync(yamlPath, 'utf8'))
  return { light: d.colors.light.ground, dark: d.colors.dark.ground, family: d.typography.family }
}

/**
 * The verdict. PURE — no filesystem, no browser — so the suite can drive every failure.
 *
 * @param {object} o
 * @param {string[]} o.cssAssets  emitted `.css` files, repo-relative
 * @param {object} o.read         what `readDesign()` returned
 * @param {object} o.expected     from `expectedGrounds()`
 * @returns {string[]} problems, empty when the design system shipped
 */
export function designProblems({ cssAssets, read, expected }) {
  const problems = []

  if (!cssAssets.length) {
    problems.push(
      'the build emitted NO stylesheet at all. The app imports its only CSS entry point from ' +
        '`src/main.tsx`; if that import is gone, every other gate in this repository still passes ' +
        'and the entire design system is simply absent from the artifact.',
    )
  }

  if (!read) {
    problems.push('the emitted stylesheet could not be read, so nothing was verified')
    return problems
  }

  if (!read.linked) {
    problems.push(
      '`index.html` links no stylesheet — a CSS file was emitted but nothing loads it, which paints ' +
        'exactly like shipping no design system.',
    )
  }

  if (!sameHex(read.light.ground, expected.light)) {
    problems.push(
      `light: --color-ground is ${JSON.stringify(read.light.ground) || '(absent)'}, expected ` +
        `${expected.light}. The token sheet is not reaching the artifact.`,
    )
  }

  if (!sameHex(read.dark.ground, expected.dark)) {
    problems.push(
      `dark: --color-ground under [data-theme=dark] is ${JSON.stringify(read.dark.ground) || '(absent)'}, ` +
        `expected ${expected.dark}. An explicit theme pin would paint light — this is the ` +
        `permanently-light failure, and it produces no error anywhere.`,
    )
  }

  if (!sameHex(read.darkMediaGround, expected.dark)) {
    problems.push(
      `dark: --color-ground under prefers-color-scheme:dark is ` +
        `${JSON.stringify(read.darkMediaGround) || '(absent)'}, expected ${expected.dark}. ` +
        `OS-followers would get the light sheet.`,
    )
  }

  if (read.light.colorScheme !== 'light' || read.dark.colorScheme !== 'dark') {
    problems.push(
      `color-scheme is ${JSON.stringify(read.light.colorScheme)} light / ` +
        `${JSON.stringify(read.dark.colorScheme)} dark. It is the only thing that flips native ` +
        `scrollbars and form controls, and nothing else will.`,
    )
  }

  // Geometry, not just ink: dark shadows change blur, spread and offset, and whole-value
  // indirection is the only shape that carries that across a theme flip. `--shadow-*` values are
  // inlined at compile time, so a dark redefinition that looks right in source is a silent no-op.
  if (!read.light.shadow || read.light.shadow === read.dark.shadow) {
    problems.push(
      `--sh-short is ${read.light.shadow ? 'identical in both themes' : 'absent'} ` +
        `(${read.light.shadow || '(empty)'}). Shadow values are inlined at compile time, so this is ` +
        `what a silently un-themed shadow looks like.`,
    )
  }

  if (!read.bodyAppliesGround) {
    problems.push(
      'no `body` rule applies `background-color: var(--color-ground)`. The tokens can all be ' +
        'correct and the page still paint the user-agent default if nothing consumes them.',
    )
  }

  if (!read.fontSans.includes(expected.family)) {
    problems.push(
      `--font-sans is ${JSON.stringify(read.fontSans) || '(absent)'}, which does not name ` +
        `"${expected.family}". The typeface is part of the sheet, not a separate concern.`,
    )
  }

  return problems
}
