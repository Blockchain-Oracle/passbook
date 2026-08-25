//
// Renders `apps/web/design/tokens.css` from `apps/web/design/tokens.yaml`, so the app's entire
// design vocabulary has exactly one source and that source is the UX design authority's own
// frontmatter.
//
// WHAT THIS OWNS. The whole of tokens.css. It is generated, committed, and never hand-edited —
// `scripts/lint-tokens.mjs` re-renders on every `npm run lint` and fails when the committed sheet
// and the yaml disagree. To change a value you edit `tokens.yaml`, which is the verbatim copy of
// `DESIGN.md`'s frontmatter (`npm run tokens:verbatim` byte-compares the two locally).
//
// This is a clone of the `render-topology.mjs` / `lint-topology.mjs` pair — the repository's
// already-built answer to "generated artifact + freshness diff" — with `build-web.mjs`'s
// realpath-both-sides entry guard, and deliberately NOT shaped like
// `scripts/verify-mainnet-guard.mjs` (431 lines, four write sites, module-top-level mutation on
// import, no path parameters, no tests). The core is pure, every reader and writer takes a path
// override, and importing this module writes nothing and reads nothing.
//
//   node scripts/render-design-tokens.mjs            # rewrite apps/web/design/tokens.css
//   node scripts/render-design-tokens.mjs --check    # exit 1 if the committed sheet is stale
//
// ---------------------------------------------------------------------------------------------
// THREE MECHANICS THAT LOOK FINE AND SILENTLY ARE NOT. Each was executed and measured before this
// file was written; the shapes below are the ones that survived.
//
//   1. CASCADE-LAYER LAW. `@theme` lands in `@layer theme`. An UNLAYERED rule beats a layered one
//      whatever the specificity, so if the light sheet were left unlayered while the dark sheets
//      were layered, the app would be permanently light with no error anywhere. The light colours
//      therefore live in `@theme` and BOTH dark sheets are unlayered, and `darkSheet()` below is
//      called twice so there is no code path that can emit the mixed shape. `assertShape()`
//      re-checks the rendered string for it.
//
//   2. SHADOWS ARE INLINED AT COMPILE TIME. `--shadow-*` never reaches `:root`, so redefining one
//      under a dark selector is a silent no-op. The fix is whole-value indirection: the theme entry
//      is `var(--sh-short, <literal>)` and the dark sheets redefine `--sh-short`. Per-colour
//      indirection is not enough — Passbook's dark shadows change blur/spread/offset geometry, not
//      just ink. The literal fallback is mandatory hygiene: a typo'd inner var name yields
//      `box-shadow: none` app-wide, and there is no error for that either.
//
//   3. MOTION IS PLAIN `@theme`. There is no `--duration-*` namespace — wiping one is silently
//      accepted and does nothing, and `duration-200` survives every wipe. The real keys are
//      `--transition-duration-*`, `--transition-delay-*` and `--ease-*`, and the whole palette
//      compiles from plain `@theme` with zero `@utility` rules. Closing the BARE-VALUE motion
//      vocabulary is therefore a source-level lint problem, which is `lint-tokens.mjs`'s job.
//
// ---------------------------------------------------------------------------------------------
// DECISIONS THIS FILE RECORDS, because they had no other home:
//
//   px, not rem. DESIGN.md:312 says "Scale (rem @16px …)", which states the base the designer
//   worked at rather than the unit to emit. Every value on the sheet divides losslessly by 16, so
//   rem remains available at zero cost later. px is emitted because the story's own acceptance
//   check is "read tokens.css and confirm no value appears that is not in tokens.yaml", and a rem
//   conversion puts 3.25rem on the sheet where the authority says 52. Revisit deliberately if the
//   root-font-size accessibility setting is ever ruled in scope; it is one function.
//
//   Breakpoint names (the 360 and 380 steps had none). `2xs`/`xs` extend Tailwind's own ladder
//   downward and keep the eight steps monotonic in one naming scheme; `popover` is grounded in
//   `components.modal.popoverSheetBelow: 450`; the remaining five are Tailwind's defaults verbatim,
//   redeclared because the wipe removes them.
//
//   Weight names. `typography.weights` gives values and no names, and a utility needs a name.
//   `book` (485) and `medium` (535) follow the type-industry convention and the verified-pillars
//   sheet. Nothing else here invents a name: every other token name is its yaml key VERBATIM, with
//   no case transformation, so "every name on the sheet is a key in tokens.yaml" stays literally
//   true and is asserted by the test suite.
//
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import YAML from 'yaml'

export const TOKENS_YAML = fileURLToPath(new URL('../apps/web/design/tokens.yaml', import.meta.url))
export const TOKENS_CSS = fileURLToPath(new URL('../apps/web/design/tokens.css', import.meta.url))

//
// The shipped face's true weight axis, and why it is a constant rather than a read.
//
// Plex's `wght` axis CLAMPS above 700 in silence — 800 and 900 render exactly the 700 width with no
// error — so a weight token above it is a token that does not exist. This range is the one
// `@fontsource-variable/ibm-plex-sans@5.3.0` declares in its own `wght.css` `@font-face`; keeping it
// here keeps `render()` pure, and `render-design-tokens.test.mjs` reads that stylesheet and fails if
// the two ever disagree, so the number cannot drift away from the binary that ships.
//
export const FACE_WGHT_RANGE = [100, 700]

//
// fontsource publishes the variable cut under the family name plus " Variable", and that suffixed
// name is what its `@font-face` declares — so it is the name `--font-sans` must reference or the
// face never applies. It is the one derivation the sheet makes from a yaml value; the test suite
// pins it to the family string in the shipped `wght.css` rather than to this comment.
//
const VARIABLE_FAMILY_SUFFIX = ' Variable'

/** The 360 and 380 steps had no names anywhere; the other six did. See the header. */
const BREAKPOINT_NAMES = {
  360: '2xs',
  380: 'xs',
  450: 'popover',
  640: 'sm',
  768: 'md',
  1024: 'lg',
  1280: 'xl',
  1536: '2xl',
}

/** `typography.weights` carries values only, and a utility cannot be named after a number here. */
const WEIGHT_NAMES = { 485: 'book', 535: 'medium' }

//
// The 21 default theme namespaces, wiped so an off-sheet utility generates NO RULE AT ALL rather
// than a plausible wrong one. `--color-*: initial` alone removes 288 keys.
//
// Two of these are easy to get wrong. `--spacing` is the multiplier and `--spacing-*` the explicit
// steps: both must go, or `p-4` keeps compiling. `--breakpoint-*` kills every responsive variant,
// so it is only safe to wipe alongside redeclaring all eight steps, which this file does.
//
// What the wipe does NOT close, and why this is not the whole mechanism: 80 utilities carry
// hardcoded design values with no theme key to remove (`duration-300`, `opacity-45`, `rotate-33`,
// `border-2`, `p-px`, `rounded-full`), arbitrary values bypass the theme entirely (`bg-[#f00]`),
// and `bg-ground/50` mints a hundred off-sheet colours out of an on-sheet token. `lint-tokens.mjs`
// is the half of the mechanism that closes those.
//
const WIPE = [
  ['--color-*', '--spacing', '--spacing-*'],
  ['--font-*', '--font-weight-*', '--text-*'],
  ['--tracking-*', '--leading-*', '--breakpoint-*'],
  ['--container-*', '--radius-*', '--shadow-*'],
  ['--inset-shadow-*', '--drop-shadow-*', '--text-shadow-*'],
  ['--ease-*', '--animate-*', '--blur-*'],
  ['--perspective-*', '--aspect-*', '--default-*'],
]

/** The six surfaces every foreground token is contrast-tested against, in ladder order. */
export const SURFACES = ['ground', 'raised', 'raisedHovered', 'inset', 'insetHovered', 'surface3Solid']

/** `52/56 -0.02em` · `16/24` · `18/24 @535`. Anchored: a trailing `px` or a third number fails. */
const TYPE_STEP = /^(\d+)\/(\d+)(?: (-?[\d.]+em))?(?: @(\d+))?$/

class TokenSourceError extends Error {}

/** Every failure in here is "the yaml says something that cannot become CSS", named by key. */
function fail(key, message) {
  throw new TokenSourceError(`tokens.yaml: ${key} — ${message}`)
}

/**
 * Emits a px length, refusing anything that would need rounding.
 *
 * A silently rounded token is a design value the sheet claims to carry and does not; the whole
 * point of a closed vocabulary is that what the authority wrote is what ships.
 */
function px(value, key) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(key, `expected a number, got ${JSON.stringify(value)}`)
  if (!Number.isInteger(value)) fail(key, `${value} is not a whole number of pixels — this sheet emits px and will not round`)
  return `${value}px`
}

function ms(value, key) {
  if (!Number.isInteger(value) || value < 0) fail(key, `expected a whole number of milliseconds, got ${JSON.stringify(value)}`)
  return `${value}ms`
}

const decl = (name, value) => `  ${name}: ${value};`

// ── Validations ───────────────────────────────────────────────────────────────────────────────
// Six named gates, each with a test that proves it fires. A validation nobody has watched go red
// is not a validation — the repository's own standing rule.

/** V1 — a colour present in one mode only paints as an inherited or missing value in the other. */
function validateModeParity(colors) {
  if (!colors?.light || !colors?.dark) fail('colors', 'both `light:` and `dark:` blocks are required')
  const light = Object.keys(colors.light)
  const dark = Object.keys(colors.dark)
  const onlyLight = light.filter((k) => !dark.includes(k))
  const onlyDark = dark.filter((k) => !light.includes(k))
  if (onlyLight.length || onlyDark.length) {
    fail(
      'colors',
      `every colour must exist in BOTH modes; light-only: [${onlyLight.join(', ') || 'none'}], ` +
        `dark-only: [${onlyDark.join(', ') || 'none'}]. A one-mode colour renders as whatever the ` +
        `other mode last set, which is a wrong colour rather than a missing one.`,
    )
  }
  return light
}

/** V2 + V3 — the type-step grammar, and line heights on the 4px grid. */
function validateTypeScale(scale) {
  if (!scale || !Object.keys(scale).length) fail('typography.scale', 'the type scale is empty')
  const steps = {}
  for (const [key, raw] of Object.entries(scale)) {
    const where = `typography.scale.${key}`
    if (typeof raw !== 'string') fail(where, `expected a string like "16/24 -0.01em @535", got ${JSON.stringify(raw)}`)
    const m = TYPE_STEP.exec(raw)
    if (!m) {
      fail(
        where,
        `"${raw}" is not a type step. The grammar is <size>/<leading>[ <tracking>em][ @<weight>] ` +
          `— sizes and leadings are bare numbers of px, tracking carries its em unit, weight is ` +
          `prefixed with @.`,
      )
    }
    const [, size, leading, tracking, weight] = m
    if (Number(leading) % 4 !== 0) {
      // V3. Only leading is grid-bound: the authority's own sizes include 14 and 18.
      fail(where, `line height ${leading}px is off the 4px grid (${Number(leading) / 4} steps)`)
    }
    steps[key] = {
      size: Number(size),
      leading: Number(leading),
      tracking: tracking ?? null,
      weight: weight ? Number(weight) : null,
    }
  }
  return steps
}

/** V4 — an unnamed breakpoint would be silently dropped, taking its responsive variants with it. */
function validateBreakpoints(breakpoints) {
  if (!Array.isArray(breakpoints) || !breakpoints.length) fail('spacing.breakpoints', 'expected a non-empty list')
  for (const value of breakpoints) {
    if (!BREAKPOINT_NAMES[value]) {
      fail(
        'spacing.breakpoints',
        `${value} has no name in render-design-tokens.mjs. The whole --breakpoint-* namespace is ` +
          `wiped, so an unnamed step is not a step with a default name — it is a step that does ` +
          `not exist, and every \`${value}px\` variant silently generates nothing.`,
      )
    }
  }
  const declared = Object.keys(BREAKPOINT_NAMES).map(Number)
  const stale = declared.filter((v) => !breakpoints.includes(v))
  if (stale.length) {
    fail(
      'spacing.breakpoints',
      `render-design-tokens.mjs names breakpoint(s) [${stale.join(', ')}] that the authority no ` +
        `longer declares. A name with no value emits a breakpoint nothing designed.`,
    )
  }
  return breakpoints
}

/** V5 — the shadows block lived only in prose for a while. Refuse rather than invent. */
function validateShadows(shadows) {
  const names = ['short', 'medium', 'large']
  for (const mode of ['light', 'dark']) {
    if (!shadows?.[mode]) {
      fail(
        'shadows',
        `the \`shadows.${mode}:\` block is missing. Its six values are the design authority's, ` +
          `lifted verbatim from its own §5 prose — this generator refuses rather than inventing a ` +
          `shadow, and dark is NOT a tint of light here (dark changes blur, spread and offset).`,
      )
    }
    for (const name of names) {
      const value = shadows[mode][name]
      if (typeof value !== 'string' || !value.trim()) fail(`shadows.${mode}.${name}`, 'expected a non-empty box-shadow value')
    }
  }
  return names
}

/**
 * V6 — `same` resolution.
 *
 * The source text this frontmatter was lifted from wrote the literal word `same` for a curve
 * repeated from the line above. Emitted literally that is `--ease-quick: same`, an invalid value
 * the browser drops in silence, leaving every transition on that token at the UA default. The
 * authority now resolves them, so this gate should never fire in the happy path — which is exactly
 * why it is here: it is the thing standing between a future re-lift of the prose and a whole
 * motion palette that quietly stops easing.
 */
function validateMotion(motion, easings) {
  if (!easings || !Object.keys(easings).length) fail('easings', 'the `easings:` block is missing — component code must never write a bezier')
  const entries = []
  let previous = null
  for (const [key, raw] of Object.entries(motion ?? {})) {
    if (key === 'stagger' || key === 'properties') continue
    const where = `motion.${key}`
    if (typeof raw !== 'object' || raw === null) fail(where, `expected { duration, easing }, got ${JSON.stringify(raw)}`)
    let easing = raw.easing
    if (easing === 'same') {
      if (!previous) {
        fail(
          where,
          `"same" refers to the entry above it, and this is the FIRST entry — there is nothing to ` +
            `resolve it against. Name the curve.`,
        )
      }
      easing = previous
    }
    if (!(easing in easings)) {
      fail(where, `easing "${easing}" is not declared in the \`easings:\` block (have: ${Object.keys(easings).join(', ')})`)
    }
    previous = easing
    entries.push({ key, duration: raw.duration, easing })
  }
  if (!entries.length) fail('motion', 'no motion entries')
  if (!Number.isInteger(motion.stagger)) fail('motion.stagger', `expected a whole number of milliseconds, got ${JSON.stringify(motion.stagger)}`)
  return entries
}

/**
 * V7 — the weight guard.
 *
 * Plex clamps above 700 in silence, so `font-weight: 800` is not a bold token, it is a 700 that
 * lies about itself. Every weight the sheet can express is checked: the two named positions and
 * every `@nnn` inside the type scale.
 */
function validateWeights(weights, steps) {
  const [min, max] = FACE_WGHT_RANGE
  const seen = []
  for (const w of weights ?? []) seen.push(['typography.weights', w])
  for (const [key, step] of Object.entries(steps)) if (step.weight) seen.push([`typography.scale.${key}`, step.weight])
  for (const [where, w] of seen) {
    if (!Number.isInteger(w) || w < min || w > max) {
      fail(
        where,
        `weight ${w} is outside the shipped face's axis (${min}–${max}). The axis CLAMPS rather ` +
          `than errors, so this renders as ${w < min ? min : max} with no warning anywhere.`,
      )
    }
  }
  if (!weights?.length) fail('typography.weights', 'no weights declared')
  for (const w of weights) {
    if (!WEIGHT_NAMES[w]) fail('typography.weights', `weight ${w} has no name in render-design-tokens.mjs, so no \`font-*\` utility can exist for it`)
  }
  return weights
}

/** V8 — a padding or gap value the scale does not carry is a step with no token to reach it. */
function validateSpacing(spacing) {
  const scale = spacing?.scale
  if (!Array.isArray(scale) || !scale.length) fail('spacing.scale', 'expected a non-empty list')
  for (const field of ['padding', 'gap', 'hairlineOnly']) {
    for (const value of spacing[field] ?? []) {
      if (!scale.includes(value)) {
        fail(
          `spacing.${field}`,
          `${value} is not on \`spacing.scale\`, so no step token exists for it and every use ` +
            `would have to be an arbitrary value — which the lint forbids.`,
        )
      }
    }
  }
  return scale
}

// ── Sections ──────────────────────────────────────────────────────────────────────────────────

function themeBlock(d, steps, motionEntries, colorKeys, spacingScale) {
  const lines = []
  const section = (title) => lines.push('', `  /* ${title} */`)

  lines.push(
    '  /* Close the default vocabulary. 21 namespaces, ~419 keys, of which 288 are colours.',
    '     After this an off-sheet utility generates NO RULE — `bg-red-500` is absent rather than',
    '     empty. `bg-white`, `bg-black` and `text-white` die with it: any white or black this app',
    '     needs is a named token. What survives the wipe is closed by scripts/lint-tokens.mjs. */',
  )
  for (const row of WIPE) lines.push(`  ${row.map((n) => `${n}: initial;`).join('  ')}`)

  section(`colours — ${colorKeys.length} light values; the dark sheets below redeclare all ${colorKeys.length}`)
  for (const key of colorKeys) lines.push(decl(`--color-${key}`, d.colors.light[key]))

  section('typeface')
  const family = `${d.typography.family}${VARIABLE_FAMILY_SUFFIX}`
  const fallback = d.typography.familyFallback
  lines.push(decl('--font-sans', `'${family}', '${fallback}', system-ui, sans-serif`))
  lines.push(decl('--font-mono', d.typography.mono))
  for (const w of d.typography.weights) lines.push(decl(`--font-weight-${WEIGHT_NAMES[w]}`, String(w)))

  section('type scale — a compound key emits size, leading, tracking and weight in ONE utility')
  for (const [key, step] of Object.entries(steps)) {
    lines.push(decl(`--text-${key}`, px(step.size, `typography.scale.${key}`)))
    lines.push(decl(`--text-${key}--line-height`, px(step.leading, `typography.scale.${key}`)))
    if (step.tracking) lines.push(decl(`--text-${key}--letter-spacing`, step.tracking))
    if (step.weight) lines.push(decl(`--text-${key}--font-weight`, String(step.weight)))
  }

  section('radii')
  for (const [key, value] of Object.entries(d.rounded)) lines.push(decl(`--radius-${key}`, px(value, `rounded.${key}`)))

  section('breakpoints — all eight, because the wipe above removed Tailwind\'s five defaults too')
  for (const value of d.spacing.breakpoints) lines.push(decl(`--breakpoint-${BREAKPOINT_NAMES[value]}`, px(value, 'spacing.breakpoints')))

  section('spacing — NAMED steps, never numeric')
  lines.push(
    '  /* `--spacing` and `--spacing-*` are wiped above and the steps are named `s<N>`, so `p-4`',
    '     generates nothing at all. With the numeric form it would compile to 4px — four times off',
    '     every human and codegen prior, lint-clean and invisible to the eye. A loud no-op beats a',
    '     quiet 4x error. Fraction modifiers do not work on named steps (`p-s4/2` → no rule),',
    '     which is the point: no hidden half-step vocabulary. */',
  )
  for (const value of spacingScale) lines.push(decl(`--spacing-s${value}`, px(value, 'spacing.scale')))

  section('motion — plain @theme keys, var()-referenced and theme-reactive; zero @utility rules')
  for (const { key, duration } of motionEntries) lines.push(decl(`--transition-duration-${key}`, ms(duration, `motion.${key}.duration`)))
  lines.push(decl('--transition-delay-stagger', ms(d.motion.stagger, 'motion.stagger')))
  for (const [key, value] of Object.entries(d.easings)) lines.push(decl(`--ease-${key}`, value))

  section('shadows — whole-value indirection; the literal fallback is load-bearing, not belt-and-braces')
  for (const name of ['short', 'medium', 'large']) {
    lines.push(decl(`--shadow-${name}`, `var(--sh-${name}, ${d.shadows.light[name]})`))
  }

  return ['@theme static {', ...lines, '}'].join('\n')
}

/**
 * One dark sheet, rendered for one selector — and the ONLY place a dark value is written.
 *
 * Called twice, so the media arm and the pinned arm cannot drift apart, and emitted UNLAYERED by
 * both callers because there is no other caller. See mechanic 1 in the header.
 */
function darkSheet(selector, d, colorKeys) {
  const lines = [`${selector} {`, '  color-scheme: dark;']
  for (const key of colorKeys) lines.push(decl(`--color-${key}`, d.colors.dark[key]))
  for (const name of ['short', 'medium', 'large']) lines.push(decl(`--sh-${name}`, d.shadows.dark[name]))
  lines.push('}')
  return lines.join('\n')
}

function lightRoot(d) {
  const lines = [
    ':root {',
    '  /* `color-scheme` is the only thing that flips native scrollbars, form controls and the',
    '     default canvas. No colour token does it, and nothing else will. */',
    '  color-scheme: light;',
  ]
  for (const name of ['short', 'medium', 'large']) lines.push(decl(`--sh-${name}`, d.shadows.light[name]))
  lines.push('}')
  return lines.join('\n')
}

/**
 * The two-arm dark variant, replacing Tailwind's built-in.
 *
 * The built-in `dark` variant is media-only (`@media (prefers-color-scheme: dark)` and nothing
 * else), so it can never reach a user who has pinned a theme. This one follows the OS unless the
 * user pinned light, and always obeys a pinned dark.
 */
function darkVariant() {
  return [
    '@custom-variant dark {',
    '  @media (prefers-color-scheme: dark) {',
    '    &:where(:root:not([data-theme="light"]), :root:not([data-theme="light"]) *) { @slot; }',
    '  }',
    '  &:where(:root[data-theme="dark"], :root[data-theme="dark"] *) { @slot; }',
    '}',
  ].join('\n')
}

const OS_DARK_SELECTOR = ':root:not([data-theme="light"])'
const PINNED_DARK_SELECTOR = ':root[data-theme="dark"]'

/** Indents a block by one level so the media wrapper reads as CSS rather than as a diff artifact. */
const indent = (block) => block.split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')

/**
 * Last line of defence for the two failures that produce no error anywhere.
 *
 * The code above cannot emit either shape today. This re-reads the finished string anyway, because
 * "the code path makes it impossible" is a claim about code that is about to be edited by someone
 * who has not read the header.
 */
function assertShape(css) {
  if (/@layer\b/.test(css)) {
    throw new Error(
      'render-design-tokens.mjs emitted an `@layer` rule. The light sheet is layered (via @theme) ' +
        'and both dark sheets MUST stay unlayered: an unlayered rule beats a layered one at any ' +
        'specificity, so layering dark yields a permanently-light app with no error at all.',
    )
  }
  for (const selector of [OS_DARK_SELECTOR, PINNED_DARK_SELECTOR]) {
    const count = css.split(`${selector} {`).length - 1
    if (count !== 1) throw new Error(`expected exactly one \`${selector}\` block, found ${count}`)
  }
  if (css.includes('\r')) throw new Error('render-design-tokens.mjs emitted a CR byte; the sheet is LF-only so the freshness diff cannot be defeated by line endings')
  if (!css.endsWith('\n') || css.endsWith('\n\n')) throw new Error('the sheet must end with exactly one newline')
}

// ── Render ────────────────────────────────────────────────────────────────────────────────────

/**
 * PURE: yaml text in, stylesheet out. No clock, no filesystem, no environment.
 *
 * The banner carries the SHA-256 of the source, never a timestamp — a timestamp turns the freshness
 * gate into "who ran it last" and makes every regeneration a diff.
 */
export function render(yamlSource) {
  if (typeof yamlSource !== 'string') throw new TypeError('render(yamlSource) takes the yaml TEXT, so the hash in the banner is of the bytes on disk')
  const d = YAML.parse(yamlSource)
  if (!d || typeof d !== 'object') fail('(document)', 'parsed to nothing — is this the frontmatter?')

  const colorKeys = validateModeParity(d.colors)
  const steps = validateTypeScale(d.typography?.scale)
  validateBreakpoints(d.spacing?.breakpoints)
  validateShadows(d.shadows)
  const motionEntries = validateMotion(d.motion, d.easings)
  validateWeights(d.typography?.weights, steps)
  const spacingScale = validateSpacing(d.spacing)

  const sha = createHash('sha256').update(yamlSource, 'utf8').digest('hex')

  const css = [
    '/*',
    ' * GENERATED FILE — DO NOT EDIT.',
    ' *',
    ` * source: apps/web/design/tokens.yaml  sha256 ${sha}`,
    ' *',
    ' * Regenerate with `npm run render:tokens`. `npm run lint` re-renders and fails when this file',
    ' * and the yaml disagree, so a hand-edit here is caught rather than shipped. tokens.yaml is the',
    " * verbatim frontmatter of the UX design authority; `npm run tokens:verbatim` proves that",
    ' * locally. The banner carries the SOURCE HASH and no timestamp, so regenerating an unchanged',
    ' * sheet produces a byte-identical file and the gate stays about drift.',
    ' */',
    '',
    darkVariant(),
    '',
    themeBlock(d, steps, motionEntries, colorKeys, spacingScale),
    '',
    '/* Unlayered from here down — see the cascade-layer law in render-design-tokens.mjs. */',
    lightRoot(d),
    '',
    '@media (prefers-color-scheme: dark) {',
    indent(darkSheet(OS_DARK_SELECTOR, d, colorKeys)),
    '}',
    '',
    '/* Byte-identical to the block above, for the user who pinned dark against a light OS. */',
    darkSheet(PINNED_DARK_SELECTOR, d, colorKeys),
    '',
  ].join('\n')

  assertShape(css)
  return css
}

/**
 * Every token NAME the sheet defines, grouped by the utility family that consumes it.
 *
 * This is what makes `lint-tokens.mjs` an allowlist rather than a second hand-maintained list: the
 * vocabulary the lint permits and the vocabulary the sheet defines are computed from the same yaml
 * by the same code, so they cannot drift. Same validations, so a source that cannot render also
 * cannot quietly widen the lint.
 */
export function tokenNames(yamlSource) {
  const d = YAML.parse(yamlSource)
  const colors = validateModeParity(d.colors)
  const steps = validateTypeScale(d.typography?.scale)
  validateBreakpoints(d.spacing?.breakpoints)
  validateShadows(d.shadows)
  const motionEntries = validateMotion(d.motion, d.easings)
  validateWeights(d.typography?.weights, steps)
  const spacingScale = validateSpacing(d.spacing)
  return {
    colors,
    text: Object.keys(steps),
    fonts: ['sans', 'mono'],
    weights: d.typography.weights.map((w) => WEIGHT_NAMES[w]),
    radii: Object.keys(d.rounded),
    spacing: spacingScale.map((v) => `s${v}`),
    breakpoints: d.spacing.breakpoints.map((v) => BREAKPOINT_NAMES[v]),
    durations: motionEntries.map((m) => m.key),
    delays: ['stagger'],
    easings: Object.keys(d.easings),
    shadows: ['short', 'medium', 'large'],
  }
}

export function currentYaml(yamlPath = TOKENS_YAML) {
  return readFileSync(yamlPath, 'utf8')
}

export function currentCss(cssPath = TOKENS_CSS) {
  return readFileSync(cssPath, 'utf8')
}

/** The banner line the diff reports separately: a source-hash change is not "line 5 differs". */
const BANNER_LINE = /^ \* source: apps\/web\/design\/tokens\.yaml {2}sha256 /

/**
 * @returns {{fresh: boolean, expected: string, actual: string, firstDiffLine: number|null,
 *            hashOnly: boolean}}
 */
export function checkFreshness({ yamlPath = TOKENS_YAML, cssPath = TOKENS_CSS } = {}) {
  const expected = render(currentYaml(yamlPath))
  const actual = currentCss(cssPath)
  if (expected === actual) return { fresh: true, expected, actual, firstDiffLine: null, hashOnly: false }

  const a = actual.split('\n')
  const b = expected.split('\n')
  let firstDiffLine = null
  let hashOnly = true
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    if (a[i] === b[i]) continue
    // Reporting the banner as "line 5 differs" is useless: the hash differs because something
    // BELOW it does. Skip it for the line number, and say what actually happened.
    if (BANNER_LINE.test(b[i] ?? '') && BANNER_LINE.test(a[i] ?? '')) continue
    hashOnly = false
    firstDiffLine = i + 1
    break
  }
  return { fresh: false, expected, actual, firstDiffLine, hashOnly }
}

/** The house sentences. They are load-bearing: they tell the reader which file to edit. */
export function staleMessage({ firstDiffLine, hashOnly }) {
  const where = hashOnly
    ? 'the source hash changed, so tokens.yaml was edited and the sheet was not regenerated'
    : `first difference at line ${firstDiffLine}`
  return (
    `\`apps/web/design/tokens.css\` is STALE: it does not match what tokens.yaml renders to ` +
    `(${where}). Run \`npm run render:tokens\` and commit the result. Do not hand-edit tokens.css; ` +
    `edit tokens.yaml — it is the verbatim frontmatter of the UX DESIGN.md.`
  )
}

export function write({ yamlPath = TOKENS_YAML, cssPath = TOKENS_CSS } = {}) {
  const css = render(currentYaml(yamlPath))
  writeFileSync(cssPath, css)
  return css
}

//
// REALPATH BOTH SIDES. `resolve(process.argv[1])` does not follow symlinks, so under a worktree, a
// `/tmp` checkout on macOS, or a CI cache mount, a plain comparison silently fails and this script
// EXITS 0 having rendered nothing and checked nothing. Silent success is the worst failure a gate
// has; `render-topology.mjs` still carries the plain comparison and this is the fixed shape.
//
const entrypoint = process.argv[1] ? realpathSync(resolve(process.argv[1])) : null
if (entrypoint && entrypoint === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    if (process.argv.includes('--check')) {
      const result = checkFreshness()
      if (!result.fresh) {
        console.error(staleMessage(result))
        process.exit(1)
      }
      console.log('design tokens: apps/web/design/tokens.css matches apps/web/design/tokens.yaml')
    } else {
      const css = write()
      console.log(`rendered ${css.split('\n').length - 1} lines into apps/web/design/tokens.css`)
    }
  } catch (e) {
    console.error(e instanceof TokenSourceError ? e.message : e)
    process.exit(1)
  }
}
