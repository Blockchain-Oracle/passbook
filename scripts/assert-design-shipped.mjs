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
      // The progress machine's constant row and the ring's honesty — see `progressProblems`.
      stepRowMinHeight: lengthPx(css, ruleBody(css, '.step-row'), 'min-height'),
      stepRowHeight: lengthPx(css, ruleBody(css, '.step-row'), 'height'),
      stepRingEasing: resolved(css, ruleBody(css, '.step-ring'), 'animation-timing-function'),
      stepRingDuration: resolved(css, ruleBody(css, '.step-ring'), 'animation-duration'),
      stepRingIterations: prop(ruleBody(css, '.step-ring'), 'animation-iteration-count'),
      stepConnectorBorder: prop(ruleBody(css, '.step-connector'), 'border-inline-start'),
      stepConnectorHeight: lengthPx(css, ruleBody(css, '.step-connector'), 'height'),
      // The reduced-motion override, read out of the media block rather than the base rule — see
      // `progressProblems`. Anchored on the query text so the base `.step-ring` cannot answer for
      // it: `ruleBody` returns the FIRST match, so without this anchor the two rules are
      // indistinguishable and whichever the emitter happens to put first is what gets measured.
      ringReducedMotion:
        css.match(/prefers-reduced-motion[^{]*\{[\s\S]*?\.step-ring\s*\{([^}]*)\}/)?.[1] ?? '',
      reconsentMinHeight: lengthPx(css, ruleBody(css, '.reconsent-row'), 'min-height'),
      pipelineRowMinHeight: lengthPx(css, ruleBody(css, '.pipeline-row'), 'min-height'),
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
 * A declaration resolved through one `var()` hop, as a STRING.
 *
 * The sibling of `lengthPx` for values that are not lengths — a timing function, a duration. Same
 * reason it exists: `animation-timing-function: var(--ease-snap)` and `var(--ease-linear)` are
 * indistinguishable to any check that only asks whether the declaration is spelled, and they are
 * the difference between an honest indeterminate ring and one that appears to report progress.
 */
function resolved(css, body, name) {
  const raw = prop(body, name)
  if (!raw) return ''
  const hit = raw.match(/var\((--[\w-]+)\)/)
  return hit ? String(decl(css, hit[1])).trim() : raw
}

/**
 * A CSS time in milliseconds, in whichever unit the artifact happens to carry it.
 *
 * The minifier rewrites `750ms` as `.75s`, so a check written against the authored spelling passes
 * only on input the build never emits. Both units, and a leading-dot fraction, are the same value.
 * Returns `null` when the string is not a time at all — which callers treat as a failure.
 */
function timeMs(value) {
  const hit = String(value || '').trim().match(/^(\d*\.?\d+)(ms|s)$/)
  if (!hit) return null
  return hit[2] === 's' ? Number(hit[1]) * 1000 : Number(hit[1])
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

/**
 * The progress machine's construction rules, resolved to numbers (story 6.5).
 *
 * A THIRD VERDICT RATHER THAN A WIDER SECOND ONE, for the same reason `reservedHeightProblems` is
 * not part of `designProblems`: "the token sheet shipped", "the value spine reserves its space" and
 * "the progress machine cannot reflow or overclaim" are three separate findings, and a caller that
 * merges them learns only that something is wrong.
 *
 * @param {object} o
 * @param {object|null} o.read  what `readDesign()` returned
 * @returns {string[]} problems, empty when the machine is built the way §7.7 requires
 */
export function progressProblems({ read }) {
  const problems = []
  if (!read) return ['the emitted stylesheet could not be read, so no progress rule was verified']

  const r = read.reserved ?? {}

  //
  // §7.7: "total row height constant at 40px — any reflow reads as instability".
  //
  // BOTH ENDS ARE ASSERTED. A `min-height` alone reserves a floor and lets the row GROW when the
  // slot goes 24→40 or a label wraps; a `height` alone can be undercut by a taller child in some
  // layout modes. The row is constant only when the floor and the ceiling are the same number, and
  // "constant" is the entire claim this component makes.
  //
  const STEP_ROW_PX = 40

  for (const [name, value] of [
    ['min-height', r.stepRowMinHeight],
    ['height', r.stepRowHeight],
  ]) {
    if (value === null || value !== STEP_ROW_PX) {
      problems.push(
        `\`.step-row\` declares ${name} ${value === null ? '(none readable)' : `${value}px`}, ` +
          `and §7.7 requires exactly ${STEP_ROW_PX}px on both. A row that can change height as the ` +
          'pipeline advances moves every row below it at the moment the user is watching them.',
      )
    }
  }

  //
  // THE RING MUST BE LINEAR, AND THIS IS AN HONESTY CHECK RATHER THAN A STYLE ONE.
  //
  // An eased revolution accelerates and decelerates once per turn. On an INDETERMINATE spinner —
  // one that exists precisely because we cannot observe the hosted prover's progress — that cadence
  // reads as progress events, which is the claim the indeterminate mode exists to avoid making.
  // Any of the five authored curves would pass a "does it declare a timing function" check.
  //
  if (r.stepRingEasing !== 'linear') {
    problems.push(
      `\`.step-ring\` resolves its timing function to ${r.stepRingEasing ? JSON.stringify(r.stepRingEasing) : '(nothing)'}, ` +
        'and it must be `linear`. A ring on a curve speeds up and slows down once per turn, and on ' +
        'a spinner that exists BECAUSE we cannot see the prover\'s progress, that cadence is a ' +
        'claim about progress we do not have.',
    )
  }

  //
  // READ IN EITHER UNIT, because the artifact is MINIFIED. The sheet declares `750ms` and the
  // minifier ships `.75s` — an earlier version of this check tested for `ms` and failed a
  // correctly-built ring. A gate that only recognises the unminified spelling is a gate that only
  // works on input the build never produces.
  //
  const ringMs = timeMs(r.stepRingDuration)
  if (ringMs === null || ringMs <= 0) {
    problems.push(
      `\`.step-ring\` resolves its duration to ${r.stepRingDuration ? JSON.stringify(r.stepRingDuration) : '(nothing)'}. ` +
        'It must resolve to a positive time from the motion sheet — an unresolved var() leaves the ' +
        'animation at the UA default of 0s, which is a ring that never turns and no error anywhere.',
    )
  }

  if (!/infinite/.test(r.stepRingIterations || '')) {
    problems.push(
      '`.step-ring` does not iterate infinitely. A ring that stops after one turn looks like a ' +
        'hung process, which is the single thing an indeterminate spinner must never imply.',
    )
  }

  // Channel 5 of the five redundant channels, and the one that survives greyscale, reduced motion
  // and a screenshot all at once. `dotted` is load-bearing: dots read as path-not-yet-travelled.
  if (!/dotted/.test(r.stepConnectorBorder || '')) {
    problems.push(
      `\`.step-connector\` declares ${r.stepConnectorBorder || '(no inline-start border)'}, ` +
        'and it must be dotted. It is one of the five redundant channels §7.7 requires so state ' +
        'reads with colour and motion both stripped.',
    )
  }

  //
  // AND IT MUST OCCUPY SPACE. Checking only that the border is spelled `dotted` is the exact
  // failure story 6.4 recorded — a declaration verified for its wording rather than its effect —
  // and it happened again here: the connector shipped as an empty block with a border and no
  // height, resolved to 0px, and this gate reported "connector dotted" over a channel that
  // rendered nothing. A border on a zero-height box is not a channel.
  //
  if (r.stepConnectorHeight === null || r.stepConnectorHeight <= 0) {
    problems.push(
      `\`.step-connector\` resolves to ${r.stepConnectorHeight === null ? 'no readable height' : `${r.stepConnectorHeight}px`} tall. ` +
        'It is a child of the list item, not a flex item of the list, so `align-self: stretch` ' +
        'does nothing for it — without an explicit height it collapses and the channel disappears ' +
        'while every wording check still passes.',
    )
  }

  //
  // REDUCED MOTION IS A PROMISE THE STYLESHEET MAKES AND NOTHING WAS CHECKING.
  //
  // Deleting the override ships an infinite spinner to a reader who asked their OS for stillness,
  // with a green build and no other symptom. It is asserted here rather than trusted because the
  // blanket `*` rule cannot cover it: `*` has specificity 0,0,0 and `.step-ring` has 0,1,0, so the
  // base rule's own `animation-name` wins unless something overrides it by name.
  //
  if (!/animation-name\s*:\s*none/.test(r.ringReducedMotion || '')) {
    problems.push(
      'the `prefers-reduced-motion` block does not stop `.step-ring`. The blanket `*` rule cannot ' +
        'reach it — a class selector outranks the universal one — so without a named override the ' +
        'ring keeps spinning for a reader who asked the OS to stop motion.',
    )
  }

  //
  // §5's proof-expired row: "inline re-consent row in the fee row's slot, IDENTICAL HEIGHT".
  //
  // Same number as the step row, deliberately — both are the app's one row height. If the row that
  // appears when a proof expires is shorter or taller than the row it replaces, the CTA below it
  // moves at the exact moment the user is reaching for it.
  //
  for (const [selector, value] of [
    ['.reconsent-row', r.reconsentMinHeight],
    ['.pipeline-row', r.pipelineRowMinHeight],
  ]) {
    if (value === null || value < STEP_ROW_PX) {
      problems.push(
        `\`${selector}\` reserves ${value === null ? 'no readable min-height' : `${value}px`}, ` +
          `and it must reserve at least ${STEP_ROW_PX}px so it swaps into a slot rather than ` +
          'pushing what is underneath it down the page.',
      )
    }
  }

  return problems
}
