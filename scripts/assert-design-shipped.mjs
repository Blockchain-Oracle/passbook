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
    // The value spine's reserved geometry, RESOLVED TO NUMBERS — see `reservedHeightProblems`
    // below for what each of these is load-bearing for, and why the numbers matter.
    reserved: {
      amountRowMinHeight: lengthPx(css, ruleBody(css, '.amount-row'), 'min-height'),
      amountBalanceMinHeight: lengthPx(css, ruleBody(css, '.amount-balance'), 'min-height'),
      amountBalanceOpacity: prop(ruleBody(css, '.amount-balance'), 'opacity'),
      amountFieldBorder: prop(ruleBody(css, '.amount-field'), 'border'),
      amountFieldBorderPx: lengthPx(css, ruleBody(css, '.amount-field'), 'border'),
      amountValueBasis: lengthPx(css, ruleBody(css, '.amount-value'), 'flex-basis'),
      amountValueMinWidth: prop(ruleBody(css, '.amount-value'), 'min-width'),
    },
  }
}

/**
 * The declarations inside ONE rule, by exact selector.
 *
 * Anchored on a boundary so `.pb-x .amount-row {` cannot masquerade as `.amount-row {` — a
 * descendant rule declares nothing about the bare class, and matching one would report a reserve
 * that the element in question does not have. `\{` immediately after the selector is what keeps
 * `.amount-balance` from matching `.amount-balance[data-shown]`, which declares `opacity: 1` and
 * would report the reserved `opacity: 0` as present when it is the very thing that got deleted.
 */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hit = css.match(new RegExp(`(?:^|[,{};])\\s*${escaped}\\s*\\{([^}]*)\\}`))
  return hit ? hit[1] : ''
}

/** One declaration's raw value out of a rule body. */
function prop(body, name) {
  const hit = (body || '').match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`))
  return hit ? hit[1].trim() : ''
}

/**
 * A declaration resolved to a NUMBER OF PIXELS, following one `var()` hop into the token sheet.
 *
 * This is the difference between a gate and a spell-check. Testing that `min-height: var(…)` is
 * present proves only that the words are there — `min-height: var(--spacing-s0)` passes such a
 * check while reserving nothing at all, and `build:web` then prints "the value spine reserves its
 * space" over a row that does not. The token's own declaration is in the same emitted stylesheet,
 * so resolving it costs one more lookup and turns the check into an assertion about the layout.
 *
 * Returns `null` when there is no such declaration or the value cannot be resolved to a length —
 * callers treat that as a failure, never as a pass.
 */
function lengthPx(css, body, name) {
  const raw = prop(body, name)
  if (!raw) return null
  // `border: 1px solid transparent` — the width is the first length-shaped token in the shorthand.
  const candidates = raw.match(/var\(--[\w-]+\)|-?[\d.]+px|\b0\b/g) || []
  for (const candidate of candidates) {
    const value = candidate.startsWith('var(')
      ? decl(css, candidate.slice(4, -1).trim())
      : candidate
    const px = String(value).trim().match(/^(-?[\d.]+)px$|^(0)$/)
    if (px) return Number(px[1] ?? px[2])
  }
  return null
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

/**
 * Proves the value spine still RESERVES its space, by reading the artifact (story 6.4).
 *
 * ── WHY THIS IS A STYLESHEET READ AND NOT A TEST ──────────────────────────────────────────
 *
 * The acceptance criterion was originally a measurement: take the container box across empty,
 * typed, error and focus, and assert it never changed. That cannot run in jsdom — there is no
 * layout engine, so the assertion is `0 === 0` and it passes on a component that shifts wildly —
 * and there is no browser driver in this repository any more.
 *
 * Restated as a construction rule it is STRONGER than the measurement it replaces. Four sampled
 * states prove four states; a reserved height in the stylesheet holds for every state, including
 * the ones nobody thought to sample. What it cannot prove is that a browser agrees — but each of
 * these declarations is the single thing whose deletion causes the shift, so its absence is the
 * defect, not a proxy for it.
 *
 * Kept SEPARATE from `designProblems` deliberately. That function answers "did the token sheet
 * reach the artifact"; this one answers "is the layout still constructed the way it has to be".
 * Merging them would give one verdict two meanings and hide both.
 *
 * @param {object} o
 * @param {object|null} o.read  what `readDesign()` returned
 * @returns {string[]} problems, empty when the spine still reserves its space
 */
export function reservedHeightProblems({ read }) {
  const problems = []
  if (!read) return ['the emitted stylesheet could not be read, so no layout rule was verified']

  const r = read.reserved ?? {}

  //
  // THE TALLEST LINE THE FIELD CAN PRODUCE, in pixels: the 36px ceiling at line-height 1.2.
  //
  // Duplicated from `AMOUNT_MAX_PX * AMOUNT_LINE_RATIO` in `packages/protocol/src/amount.ts`
  // because this is a `.mjs` gate and those are TypeScript, so there is no import. The two are
  // pinned from opposite ends: the unit test asserts the product stays UNDER the 60px reserve, and
  // this asserts the shipped reserve stays OVER the product. Moving either endpoint without the
  // other fails one of them.
  //
  const TALLEST_LINE_PX = 43.2

  if (r.amountRowMinHeight === null || r.amountRowMinHeight < TALLEST_LINE_PX) {
    problems.push(
      `\`.amount-row\` reserves ${r.amountRowMinHeight === null ? 'no readable min-height' : `${r.amountRowMinHeight}px`}, ` +
        `and the tallest line it can hold is ${TALLEST_LINE_PX}px (the ${36}px ceiling at line-height 1.2). ` +
        'That reserve is the ONLY thing making the amount row constant-height, so a value under it ' +
        'means the row grows under the caret the moment someone types at full size.',
    )
  }

  if (!/^0(?![.\d])/.test(r.amountBalanceOpacity || '')) {
    problems.push(
      '`.amount-balance` does not declare `opacity: 0` at rest. The balance line has to be MOUNTED ' +
        'and invisible rather than conditionally rendered — mounting it when a balance arrives ' +
        'adds its height to the box at the exact moment the user is reading the number above it.',
    )
  }

  if (r.amountBalanceMinHeight === null || r.amountBalanceMinHeight <= 0) {
    problems.push(
      `\`.amount-balance\` reserves ${r.amountBalanceMinHeight === null ? 'no readable min-height' : `${r.amountBalanceMinHeight}px`}. ` +
        'At `opacity: 0` with no text it collapses to zero height, which reintroduces the shift ' +
        'that mounting it early was meant to prevent.',
    )
  }

  if (!/transparent|#0000\b|rgba?\([^)]*,\s*0\s*\)/.test(r.amountFieldBorder || '')) {
    problems.push(
      '`.amount-field` has no transparent border at rest. Focus inverts the container and adds a ' +
        '1px surface3 border; if the border does not already exist, focusing the field grows it by ' +
        '2px in both axes and moves everything below it down the page.',
    )
  }

  if (r.amountFieldBorderPx === null || r.amountFieldBorderPx <= 0) {
    problems.push(
      `\`.amount-field\`'s rest border is ${r.amountFieldBorderPx === null ? 'not a readable width' : `${r.amountFieldBorderPx}px`} wide. ` +
        'A transparent border of zero width reserves nothing — it reads as correct and still lets ' +
        'the focus border push the layout.',
    )
  }

  //
  // The one declaration in the spine that is not about height, and it is here because it is the
  // subtlest. `.amount-value`'s basis is what stops the width-measuring `ResizeObserver` from
  // feeding back into the width it measures. At `flex-basis: auto` the basis becomes the content
  // width, the font size is computed from that width, the new size changes the content width, and
  // the observer fires again.
  //
  if (r.amountValueBasis === null || r.amountValueBasis !== 0 || r.amountValueMinWidth !== '0') {
    problems.push(
      "`.amount-value` must declare `flex-basis: 0` and `min-width: 0` (found " +
        `${r.amountValueBasis === null ? 'no basis' : `${r.amountValueBasis}px`} / ` +
        `min-width ${JSON.stringify(r.amountValueMinWidth) || '(absent)'}). ` +
        'Anything else makes the input as wide as its own content, and the font size is computed ' +
        'FROM that width — which closes the loop the two declarations exist to break.',
    )
  }

  return problems
}
