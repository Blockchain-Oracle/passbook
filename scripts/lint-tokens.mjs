//
// The half of the token mechanism the namespace wipe cannot provide.
//
// `tokens.css` wipes 21 theme namespaces, so `bg-red-500` generates no rule at all. That is the
// working core and it is nowhere near sufficient — measured against the real compiler, all of these
// still compile under the full wipe:
//
//   bg-[#f00]  bg-(--smuggled)  [background-color:red]     three arbitrary-value bypass syntaxes
//   duration-300  delay-150  hover:duration-700            bare values need no theme key at all
//   duration-[0.35s]                                       seconds, so an `ms` regex sees nothing
//   opacity-45  rotate-33  scale-125  border-2  ring-2     no bracket, no hex, no unit
//   w-1/2  from-10%  z-50  brightness-125  decoration-2
//   rounded-full  p-px  m-px  ease-linear  container       hardcoded values with no theme key
//   bg-ground/50                                           101 off-sheet colours from ONE token
//   bg-ground/[var(--o)]                                   and that one is chosen at RUNTIME
//
// So this gate is ALLOWLIST-MODEL: a class passes only if every part of it names something the
// token sheet defines. A deny-pattern provably cannot work here — no list of patterns enumerates
// `opacity-45`, `rotate-33`, `ring-2` and their kin, and the moment one is missed it ships silently.
//
// The vocabulary is not written down twice: `tokenNames()` derives it from the same
// `apps/web/design/tokens.yaml` the stylesheet is rendered from, so widening the sheet widens the
// lint and nothing else does.
//
// WHAT IT SCANS, and why it is not just class strings. A raw hex in an authored `.css`, in a JSX
// `style=` prop, in an SVG `fill=`, or inside `@apply` never appears in a class attribute at all,
// and passes straight through the framework to the browser. So the scan covers CSS, HTML, SVG
// presentation attributes and style props as well — this is the lint-claims scan
// shape, not a framework feature.
//
//   node scripts/lint-tokens.mjs                     # the real tree, plus the freshness gate
//   node scripts/lint-tokens.mjs --scan <path>       # only that file or directory, no freshness
//
// Run by `npm run lint`, beside lint-claims and lint-topology.
//
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkFreshness, currentYaml, staleMessage, tokenNames, TOKENS_CSS } from './render-design-tokens.mjs'

export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

//
// The scan root is `apps/web` — the WHOLE of it, deliberately, because that is exactly what the
// framework itself scans (its scan root is the nearest package.json to the stylesheet). Anything it
// scans can put a utility in the shipped CSS, so anything it scans has to be gated. Narrowing this
// to `src` would leave `smoke/` and `vite.config.ts` inside the framework's reach and outside this
// gate's, which is the precise shape of hole that gets found later rather than now.
//
// The mirror-image rule: a class written in `packages/*` is OUTSIDE the framework's scan root and
// generates ZERO rules — it renders unstyled with a green build. Hence "all components live under
// apps/web/src" until an explicit `@source` and a planted-class test ship with them.
//
// `apps/web/design/tokens.css` is excluded by name: it is the generated sheet and the one file that
// is supposed to be full of raw hexes. Its integrity is covered by the freshness gate instead,
// which is strictly stronger than a content scan — any hand-edit fails, hex or not. Build outputs
// are excluded in `walk()` for the same reason the framework ignores them.
//
const SCAN_ROOTS = ['apps/web']
const SCANNED_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.css', '.html', '.svg'])

// ── The vocabulary ────────────────────────────────────────────────────────────────────────────

/**
 * Utilities that carry NO design value, and are therefore not the token sheet's business.
 *
 * Every entry here is a layout, display or accessibility primitive whose CSS is a keyword — there
 * is no colour, length, duration or weight hiding in any of them, so allowing them cannot open a
 * hole in the sheet. Anything with a NUMBER or a COLOUR in it belongs to a token family below, not
 * here: `w-full` is a keyword, `w-1/2` is a value.
 *
 * This list grows one deliberate line at a time as surfaces get built. That friction is the point.
 */
const STATIC_ALLOW = new Set([
  // display / box
  'block', 'inline', 'inline-block', 'flex', 'inline-flex', 'grid', 'inline-grid', 'contents',
  'hidden', 'table', 'table-cell', 'table-row',
  // position
  'static', 'fixed', 'absolute', 'relative', 'sticky',
  // flex / grid composition
  'flex-row', 'flex-row-reverse', 'flex-col', 'flex-col-reverse', 'flex-wrap', 'flex-nowrap',
  'flex-1', 'flex-auto', 'flex-initial', 'flex-none', 'grow', 'grow-0', 'shrink', 'shrink-0',
  'items-start', 'items-end', 'items-center', 'items-baseline', 'items-stretch',
  'justify-start', 'justify-end', 'justify-center', 'justify-between', 'justify-around',
  'justify-evenly', 'self-start', 'self-end', 'self-center', 'self-stretch', 'self-auto',
  'content-start', 'content-end', 'content-center', 'content-between',
  // sizing keywords
  'w-full', 'w-auto', 'w-fit', 'w-min', 'w-max', 'w-screen',
  'h-full', 'h-auto', 'h-fit', 'h-min', 'h-max', 'h-screen',
  'min-w-0', 'min-w-full', 'min-w-fit', 'min-h-0', 'min-h-full', 'min-h-screen',
  'max-w-full', 'max-w-fit', 'max-w-none', 'max-h-full', 'max-h-none',
  'size-full', 'size-auto', 'size-fit',
  // overflow / box model keywords
  'overflow-hidden', 'overflow-auto', 'overflow-visible', 'overflow-scroll', 'overflow-clip',
  'overflow-x-auto', 'overflow-y-auto', 'overflow-x-hidden', 'overflow-y-hidden',
  'box-border', 'box-content', 'isolate', 'inset-0', 'inset-auto',
  // typography keywords (no size, no weight, no colour)
  'text-left', 'text-center', 'text-right', 'text-start', 'text-end', 'text-justify',
  'truncate', 'text-wrap', 'text-nowrap', 'text-balance', 'text-pretty',
  'uppercase', 'lowercase', 'capitalize', 'normal-case', 'italic', 'not-italic',
  'underline', 'line-through', 'no-underline', 'overline',
  'whitespace-normal', 'whitespace-nowrap', 'whitespace-pre', 'whitespace-pre-wrap',
  'break-words', 'break-all', 'break-keep', 'tabular-nums', 'antialiased', 'subpixel-antialiased',
  // interaction / a11y
  'cursor-pointer', 'cursor-default', 'cursor-not-allowed', 'cursor-text', 'cursor-wait',
  'select-none', 'select-text', 'select-all', 'select-auto',
  'pointer-events-none', 'pointer-events-auto', 'sr-only', 'not-sr-only',
  'appearance-none', 'outline-none', 'resize-none', 'touch-none', 'touch-manipulation',
  //
  // THE HAIRLINE. Bare `border` emits `border-width: 1px`, and 1px is not an off-sheet invention
  // here — it is the design authority's own hairline (`spacing.hairlineOnly: [1, 2]`), and every
  // card, modal, chip and input in the document is specified as "1px surface3". Without these the
  // bordered surface, which is most of the app, is literally unbuildable.
  //
  // `border-2` stays BANNED: the 2px hairline appears only on the focus ring and the step connector,
  // which are different properties, so a bare `border-2` is a guess rather than a specification.
  'border', 'border-t', 'border-r', 'border-b', 'border-l', 'border-x', 'border-y',
  'border-s', 'border-e',
  'border-solid', 'border-dashed', 'border-dotted', 'border-none',
  //
  // The `notYetReal` encoding Abu ratified: a dotted underline, carried by structure rather than by
  // grey. These set `text-decoration-style` and carry no value at all. `decoration-2` (thickness)
  // stays banned.
  'decoration-dotted', 'decoration-solid', 'decoration-dashed', 'decoration-double', 'decoration-wavy',
  //
  // Marker classes. They generate NO rule — they exist only so `group-hover:` and `peer-checked:`
  // have something to select against, and those variants are already on the allowlist. Banning the
  // marker while allowing its variants is an incoherence that makes both unusable.
  'group', 'peer',
  //
  // The transition utilities are value-free IN THEMSELVES — they set `transition-property` and
  // nothing else — so they belong here. What they are NOT is complete: see TRANSITION_UTILITIES
  // below, which requires a named duration and a named curve beside them. That is a co-occurrence
  // rule, and no amount of looking at one class alone can enforce it.
  //
  'transition', 'transition-colors', 'transition-opacity', 'transition-transform',
  'transition-shadow', 'transition-all',
  // misc keyword-only
  'transition-none',
  'shadow-none', 'rounded-none', 'bg-transparent', 'bg-current', 'bg-inherit',
  'text-transparent', 'text-current', 'text-inherit', 'border-transparent', 'border-current',
  'fill-current', 'fill-none', 'stroke-current', 'stroke-none',
  'object-contain', 'object-cover', 'object-center', 'list-none', 'align-middle', 'align-baseline',
])

//
// `transition`, `transition-colors` and their kin are allowed ONLY beside a named duration and a
// named curve, which is why they are not in the set above.
//
// On their own they emit `transition-duration: var(--tw-duration, 0s)` and
// `transition-timing-function: var(--tw-ease, ease)`. The wipe removed `--default-transition-*`, so
// both fall back to the literals: an INSTANT transition on a curve (`ease`) that is not one of the
// five the design authority ratified. It compiles, it looks deliberate, and it animates nothing.
//
// The authority's `motion:` block is a list of `{duration, easing}` PAIRS — there is no such thing
// as a duration without a curve in this design — so the gate asks for both.
//
const TRANSITION_UTILITIES = new Set([
  'transition', 'transition-colors', 'transition-opacity', 'transition-transform',
  'transition-shadow', 'transition-all',
])

/** The app's own hand-written stylesheet, and the only place it may define a class. */
const APP_STYLESHEET = join(REPO_ROOT, 'apps/web/src/index.css')

/**
 * The base-layer classes `index.css` defines, READ FROM IT rather than listed here.
 *
 * `.numeric` and `.dotted-grid` generate no framework rule — they are hand-authored primitives that
 * express a token — so an allowlist that did not know about them would reject the two classes the
 * stylesheet exists to provide. Hardcoding their names would work today and drift the first time
 * one is renamed, so the names come from the file itself and the two cannot disagree.
 */
export function appBaseClasses(stylesheetPath = APP_STYLESHEET) {
  if (!existsSync(stylesheetPath)) return new Set()
  const source = blankComments(readFileSync(stylesheetPath, 'utf8'), { lineComments: false })
  return new Set([...source.matchAll(/^\s*\.([a-zA-Z][\w-]*)\s*(?:,|\{)/gm)].map((m) => m[1]))
}

/**
 * Variants that may prefix a utility. Everything else — including `min-[500px]:` and
 * `supports-[display:grid]:` — is rejected, because an arbitrary variant is an arbitrary value in
 * the one position the utility grammar does not look like one.
 */
const STATIC_VARIANTS = new Set([
  'hover', 'focus', 'focus-visible', 'focus-within', 'active', 'visited', 'target',
  'disabled', 'enabled', 'checked', 'indeterminate', 'required', 'invalid', 'placeholder-shown',
  'read-only', 'open', 'first', 'last', 'only', 'odd', 'even', 'empty',
  'first-of-type', 'last-of-type', 'before', 'after', 'placeholder', 'selection', 'marker',
  'file', 'backdrop', 'dark', 'print', 'rtl', 'ltr',
  'motion-safe', 'motion-reduce', 'contrast-more', 'contrast-less', 'forced-colors',
  'group-hover', 'group-focus', 'group-focus-visible', 'group-active', 'group-disabled',
  'group-open', 'peer-hover', 'peer-focus', 'peer-checked', 'peer-disabled', 'peer-invalid',
  'not-first', 'not-last', 'max-sm', 'max-md', 'max-lg', 'max-xl',
])

/**
 * Prefix families that consume a token, and which token family each one consumes.
 *
 * Order matters: the LONGEST matching prefix wins, so `min-w-` is tried before `w-` and
 * `underline-offset-` before `underline`. Anything not covered here fails by construction — that is
 * what makes this an allowlist.
 */
function utilityFamilies(names) {
  const colors = new Set(names.colors)
  const spacing = new Set(names.spacing)
  const radii = new Set(names.radii)

  /** `text-` is the one dual-purpose prefix: a colour token OR a type-scale step. */
  const textValues = new Set([...names.colors, ...names.text])

  const families = []
  const add = (prefixes, values, what) => {
    for (const p of prefixes) families.push({ prefix: `${p}-`, values, what })
  }

  add(['bg', 'border', 'ring', 'outline', 'divide', 'fill', 'stroke', 'decoration', 'accent',
    'caret', 'from', 'via', 'to', 'placeholder', 'border-t', 'border-r', 'border-b', 'border-l',
    'border-x', 'border-y', 'border-s', 'border-e'], colors, 'a colour token')
  add(['text'], textValues, 'a colour token or a type-scale step')
  add(['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe',
    'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml', 'ms', 'me',
    'gap', 'gap-x', 'gap-y', 'space-x', 'space-y', 'w', 'h', 'size',
    'min-w', 'min-h', 'max-w', 'max-h', 'basis', 'indent',
    'inset', 'inset-x', 'inset-y', 'top', 'right', 'bottom', 'left', 'start', 'end',
    'translate-x', 'translate-y', 'scroll-m', 'scroll-p'], spacing, 'a named spacing step')
  add(['rounded', 'rounded-t', 'rounded-r', 'rounded-b', 'rounded-l', 'rounded-tl', 'rounded-tr',
    'rounded-br', 'rounded-bl', 'rounded-s', 'rounded-e', 'rounded-ss', 'rounded-se', 'rounded-es',
    'rounded-ee'], radii, 'a radius token')
  add(['shadow'], new Set(names.shadows), 'a shadow token')
  add(['duration'], new Set(names.durations), 'a named duration')
  add(['delay'], new Set(names.delays), 'a named delay')
  add(['ease'], new Set(names.easings), 'a named easing curve')
  add(['font'], new Set([...names.fonts, ...names.weights]), 'a font family or weight token')

  //
  // There is deliberately NO `leading-` family. The sheet wipes `--leading-*` and carries every line
  // height on its type step (`--text-body3--line-height`), so `leading-body3` compiles to NO RULE AT
  // ALL — and an allowlist that blesses a class which silently does nothing is the exact failure the
  // whole gate exists to prevent. `render-design-tokens.test.mjs` compiles one utility per family
  // below and fails on any that produces no rule, which is what keeps this honest.
  //

  // Longest prefix first, so `min-w-` is never shadowed by `w-` and `border-t-` never by `border-`.
  families.sort((a, b) => b.prefix.length - a.prefix.length)
  return families
}

// ── Candidate grammar ─────────────────────────────────────────────────────────────────────────

/** The three arbitrary-value bypass syntaxes, each measured to compile under the full wipe. */
const ARBITRARY = [
  { pattern: /-\[/, what: 'an arbitrary value `-[…]`' },
  { pattern: /-\(--/, what: 'a smuggled custom property `-(--…)`' },
  { pattern: /^\[[^\]]*:[^\]]*\]$/, what: 'an arbitrary property `[prop:value]`' },
]

/**
 * Roots that mark a string literal as a class list.
 *
 * Used only to decide whether a bare string literal (a variants map, a `cn()` argument) is worth
 * checking at all — `className=` attributes are checked unconditionally. Without it, `"UTF-8"` and
 * `"e-mail"` are class-shaped and would fail the lint on sight.
 */
const CLASS_ROOTS = new Set([
  'bg', 'text', 'font', 'leading', 'tracking', 'border', 'ring', 'outline', 'divide', 'decoration',
  'underline', 'shadow', 'rounded', 'opacity', 'duration', 'delay', 'ease', 'transition', 'animate',
  'translate', 'rotate', 'scale', 'skew', 'blur', 'brightness', 'contrast', 'saturate', 'grayscale',
  'p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'ps', 'pe', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml',
  'gap', 'space', 'w', 'h', 'size', 'min', 'max', 'basis', 'inset', 'top', 'right', 'bottom',
  'left', 'z', 'flex', 'grid', 'col', 'row', 'items', 'justify', 'self', 'content', 'place',
  'overflow', 'object', 'fill', 'stroke', 'from', 'via', 'to', 'cursor', 'select', 'pointer',
  'whitespace', 'break', 'truncate', 'uppercase', 'lowercase', 'italic', 'hidden', 'block',
  'inline', 'absolute', 'relative', 'fixed', 'sticky', 'static', 'sr', 'container', 'accent',
  'caret', 'placeholder', 'appearance', 'resize', 'touch', 'list', 'align', 'isolate', 'box',
])

const root = (word) => word.replace(/^-/, '').split('-')[0]

/** A word that could be a utility at all: no spaces, no quotes, starts sanely. */
const CLASS_WORD = /^-?[a-zA-Z0-9[][^\s"'`<>]*$/

/**
 * Splits `hover:sm:p-s4` into variants and utility, WITHOUT splitting inside brackets or parens.
 *
 * A naive `split(':')` tears `[transition-duration:0.42s]` and `data-[state=open]:p-s4` in half and
 * then reports the wreckage as a bad variant, which sends the reader looking in the wrong place for
 * a real finding.
 */
function splitVariants(candidate) {
  const parts = []
  let depth = 0
  let current = ''
  for (const ch of candidate) {
    if (ch === '[' || ch === '(') depth += 1
    else if (ch === ']' || ch === ')') depth -= 1
    else if (ch === ':' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += ch
  }
  return { variants: parts, utility: current }
}

/**
 * @returns {null|string} null if the candidate is on the sheet, otherwise why it is not.
 */
export function checkCandidate(candidate, names, families, allow = STATIC_ALLOW) {
  // Tailwind 4 marks importance with a trailing `!`. It carries no design value.
  const withoutBang = candidate.replace(/!$/, '')

  // Checked before the variant split: `[transition-duration:0.42s]` IS the whole utility, and a
  // split on its inner colon would report it as an unknown variant instead of what it is.
  if (/^\[[^\]]*:[^\]]*\]$/.test(withoutBang)) {
    return 'an arbitrary property `[prop:value]` — it writes CSS directly and never consults the theme at all'
  }

  const { variants: parts, utility } = splitVariants(withoutBang)
  for (const variant of parts) {
    if (STATIC_VARIANTS.has(variant)) continue
    if (names.breakpoints.includes(variant)) continue
    if (variant.startsWith('group-') || variant.startsWith('peer-')) {
      // `group-[.foo]:` and friends smuggle a selector; the named ones are in STATIC_VARIANTS.
      return `variant \`${variant}:\` is not on the sheet — arbitrary and data/aria variants are not part of the closed vocabulary`
    }
    if (/^(data|aria|supports|min|max|has|not|nth)[-[]/.test(variant)) {
      return `variant \`${variant}:\` is arbitrary — a breakpoint or state written as a value rather than a name`
    }
    return `variant \`${variant}:\` is not a known variant or breakpoint name (breakpoints: ${names.breakpoints.join(', ')})`
  }

  for (const { pattern, what } of ARBITRARY) {
    if (pattern.test(utility)) {
      return `${what} — it bypasses the theme entirely and compiles to whatever is inside the brackets`
    }
  }

  if (allow.has(utility)) return null

  const negative = utility.startsWith('-')
  const bare = negative ? utility.slice(1) : utility

  //
  // `/` is two different bugs wearing one syntax, and they need two different sentences.
  //
  // On a colour or a shadow it is the opacity modifier: 101 off-sheet values per token, and its
  // `/[var(--x)]` form picks one at RUNTIME where no static gate can see it. Anywhere else it is a
  // fraction — `w-1/2` — which is just an off-sheet length.
  //
  const slash = bare.indexOf('/')
  const head = slash === -1 ? bare : bare.slice(0, slash)
  const family = families.find((f) => head.startsWith(f.prefix))

  if (slash !== -1) {
    const modifiable = family && (family.what.includes('colour') || family.what.includes('shadow'))
    return modifiable
      ? `the \`/\` modifier on \`${head}\` is banned — it mints off-sheet values from an on-sheet ` +
          `token, and \`/[var(--x)]\` picks one at runtime where no static gate can see it. Name ` +
          `the translucent value as a token instead`
      : `\`${bare}\` is not on the sheet — a \`/\` fraction is an off-sheet length however it is written`
  }

  if (family) {
    const value = bare.slice(family.prefix.length)
    if (family.values.has(value)) return null
    return (
      `\`${family.prefix}${value}\` is not on the sheet — \`${family.prefix}\` takes ${family.what} ` +
      `(have: ${[...family.values].join(', ')})`
    )
  }

  return (
    `\`${utility}\` is not on the sheet. Utilities carrying a hardcoded design value ` +
    `(\`opacity-45\`, \`rotate-33\`, \`border-2\`, \`p-px\`, \`rounded-full\`, \`duration-300\`) ` +
    `survive the theme wipe and compile fine — the value has to become a token, or the utility has ` +
    `to be added to STATIC_ALLOW in scripts/lint-tokens.mjs as a deliberate, value-free exception`
  )
}

// ── Extraction ────────────────────────────────────────────────────────────────────────────────

/**
 * Blanks comment bodies, preserving length and newlines so every offset stays valid.
 *
 * Comments are prose, not code: a stylesheet that EXPLAINS why `@source inline(` is banned must not
 * be reported for banning it, and the file you are reading is the first example. Blanking rather
 * than deleting keeps the reported line numbers pointing at the real source.
 *
 * String and template literals are tracked, so `'https://…'` is never mistaken for a comment.
 *
 * QUOTES DO NOT CROSS A NEWLINE, and that bound is the whole reason this is safe on real code. JSX
 * prose is full of apostrophes — "Don't", "it's" — and an unpaired one used to open a string that
 * ran to end of file, leaving every comment below it unblanked and reporting the classes those
 * comments were WARNING about as findings. (An even number of apostrophes hides it, so `Don't
 * worry, it's fine` looks fine and `It's here` does not.) A JavaScript string literal cannot span an
 * unescaped newline, so refusing to cross one turns a file-wide desync into, at worst, one confused
 * line. Template literals genuinely are multi-line and are the one exception.
 *
 * The one construct still unmodelled is a regular expression with a literal `//` inside a character
 * class (`/[//]/`), which would blank the rest of that line; no such regex exists in the scanned
 * tree, and adding one shows up as findings disappearing, not appearing.
 */
function blankComments(source, { lineComments }) {
  const out = source.split('')
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) if (out[i] !== '\n') out[i] = ' '
  }
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const multiline = ch === '`'
      let j = i + 1
      while (j < source.length && source[j] !== ch) {
        if (!multiline && source[j] === '\n') break
        j += source[j] === '\\' ? 2 : 1
      }
      // No closer before the line ended: this was an apostrophe in prose, not a string. Step over
      // the quote alone and keep scanning from the next character.
      i = !multiline && source[j] !== ch ? i + 1 : j + 1
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? source.length : end + 2
      blank(i, stop)
      i = stop
      continue
    }
    if (lineComments && ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? source.length : end
      blank(i, stop)
      i = stop
      continue
    }
    if (ch === '<' && source.startsWith('<!--', i)) {
      const end = source.indexOf('-->', i)
      const stop = end === -1 ? source.length : end + 3
      blank(i, stop)
      i = stop
      continue
    }
    i += 1
  }
  return out.join('')
}

//
// EVERY GROUP'S `offset` IS THE ABSOLUTE POSITION OF ITS `text[0]` IN THE SOURCE, and every
// transformation below preserves length so that stays true.
//
// It is what lets a finding be reported at the line the class is actually written on. A `className`
// attribute is routinely wrapped across five lines, and attributing all five lines' classes to the
// line the attribute OPENS sends the reader to the wrong place — worse, it made two occurrences of
// the same class on different lines look like one and silently dropped the second.
//

/** Same-length blanking, so replacing a span never shifts anything after it. */
const spaces = (n) => ' '.repeat(n)

/** Every `class=` / `className=` value, however it is written. */
function classAttributeValues(source) {
  const out = []
  const attr = /\b(?:className|class)\s*=\s*/g
  let m
  while ((m = attr.exec(source))) {
    const rest = source.slice(m.index + m[0].length)
    const quote = rest[0]
    if (quote === '"' || quote === "'") {
      const end = rest.indexOf(quote, 1)
      if (end !== -1) out.push({ text: rest.slice(1, end), offset: m.index + m[0].length + 1 })
      continue
    }
    if (quote !== '{') continue
    // A JSX expression: take every string literal inside the balanced braces. Template literals
    // contribute their static text only — a `${…}` span is not something a static gate can read,
    // and pretending otherwise would be the fail-open this file exists to prevent. It is blanked to
    // its own width rather than removed, so the offsets of everything after it stay correct.
    let depth = 0
    let end = -1
    for (let i = 0; i < rest.length; i += 1) {
      if (rest[i] === '{') depth += 1
      else if (rest[i] === '}') {
        depth -= 1
        if (depth === 0) { end = i; break }
      }
    }
    if (end === -1) continue
    const expr = rest.slice(1, end)
    const base = m.index + m[0].length + 1
    for (const lit of expr.matchAll(/"([^"]*)"|'([^']*)'|`([^`]*)`/g)) {
      const text = lit[1] ?? lit[2] ?? lit[3] ?? ''
      out.push({
        text: text.replace(/\$\{[^}]*\}/g, (span) => spaces(span.length)),
        offset: base + lit.index + 1,
      })
    }
  }
  return out
}

/** Bare string literals that read as class lists — variants maps, `cn()` arguments, arrays. */
function classShapedLiterals(source) {
  const out = []
  for (const lit of source.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`/g)) {
    const text = lit[1] ?? lit[2] ?? lit[3]
    if (!text || !text.trim()) continue
    const words = text.trim().split(/\s+/)
    if (!words.every((w) => CLASS_WORD.test(w))) continue
    // At least one word must look like a utility, or `"UTF-8"` and `"e-mail"` become findings.
    if (!words.some((w) => CLASS_ROOTS.has(root(w.split(':').pop())))) continue
    // `+ 1` steps over the opening quote, so this offset and `classAttributeValues`' offset for the
    // same literal are the SAME number — which is what lets the two extractors deduplicate.
    out.push({ text, offset: lit.index + 1 })
  }
  return out
}

/** `@apply bg-[#ff0000] duration-300;` — a hex living in CSS, where no class scan would see it. */
function applyDirectives(source) {
  return [...source.matchAll(/@apply(\s+)([^;{}]+);/g)].map((m) => ({
    text: m[2],
    offset: m.index + '@apply'.length + m[1].length,
  }))
}

/** Each whitespace-separated word with its OWN absolute offset, not the group's. */
function* wordsWithOffsets(group) {
  for (const m of group.text.matchAll(/\S+/g)) {
    yield { word: m[0], offset: group.offset + m.index }
  }
}

const lineOf = (source, offset) => source.slice(0, offset).split('\n').length

//
// Raw values, wherever they are written. None of these is a class, so none is reachable by any
// amount of class scanning — and every one of them passes through to the browser verbatim.
//
// COLOURS ARE NOT THE ONLY OFF-SHEET VALUE. A hand-written stylesheet with `padding: 13px`,
// `transition-duration: 0.42s` or `font-weight: 900` breaks the closed vocabulary exactly as
// completely as a hex does, and is exactly as invisible to a class-string scan. A `0` with no unit
// is not a value in this sense and is not matched.
//
const RAW_VALUES = [
  {
    pattern: /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|light-dark)\s*\(/g,
    what:
      'a raw colour value. Every colour in this app is a token — this one is invisible to the ' +
      'theme, so it will not flip in dark mode and nothing will report that it did not',
  },
  {
    pattern: /(?<![\w#-])\d*\.?\d+(?:px|rem|em|ch|vh|vw|vmin|vmax)\b/g,
    what:
      'a raw length. Lengths come from `--spacing-*`, `--radius-*` or a type step — a literal here ' +
      'is a size nobody designed and nothing can re-theme',
  },
  {
    pattern: /(?<![\w.-])\d*\.?\d+m?s\b/g,
    what:
      'a raw duration. Every duration is a named token (`--transition-duration-quick`); the design ' +
      'authority pairs each one with a curve, and a literal has neither',
  },
  {
    pattern: /font-weight:\s*\d+/g,
    what:
      'a raw font weight. The face has exactly two ratified positions (485 book, 535 medium) and ' +
      'its axis CLAMPS silently outside 100-700, so a literal weight can render as a different one',
  },
]

//
// Values in hand-authored CSS that are deliberately exempt, and why.
//
// Printed on every run for the same reason the contrast exemptions are: a silent carve-out is how a
// closed vocabulary quietly stops being closed. Keep this list at zero if you can.
//
const CSS_VALUE_EXCEPTIONS = [
  {
    file: 'apps/web/src/index.css',
    value: '0.5px',
    why:
      'the dotted grid\'s dot RADIUS (design authority §1.2, "0.5px"). It is a sub-pixel painting ' +
      'detail rather than a layout step, and `spacing.scale` starts at 0 then jumps to 1 — there is ' +
      'no token that could carry it. A `dottedGrid` entry in the authority\'s frontmatter would ' +
      'retire this exception.',
  },
]

/** SVG presentation attributes that take a paint value. */
const PAINT_ATTR = /\b(fill|stroke|stop-color|flood-color|lighting-color|color)\s*=\s*["']([^"']*)["']/g

/**
 * Lints one file's source.
 *
 * @returns {{line: number, what: string, detail: string}[]}
 */
export function lintSource(path, rawSource, names, families, allow = STATIC_ALLOW) {
  const findings = []
  const ext = extname(path)
  const isStyleSheet = ext === '.css'
  // CSS and SVG have no `//` line comments, and blanking one would eat `url(//host/…)`.
  const source = blankComments(rawSource, { lineComments: !isStyleSheet && ext !== '.svg' })
  const report = (offset, what, detail) => findings.push({ line: lineOf(source, offset), what, detail })

  //
  // Three extractors, deliberately overlapping — a class list can be an attribute value, a bare
  // literal in a variants map, or the body of an `@apply`. The overlap is why findings are
  // deduplicated by absolute OFFSET below: the same class reached by two extractors is one finding,
  // and two occurrences of the same class at two different offsets are two.
  //
  const candidateGroups = [
    ...classAttributeValues(source),
    ...classShapedLiterals(source),
    ...(isStyleSheet ? applyDirectives(source) : []),
  ]

  const seen = new Set()
  const seenTransition = new Set()
  for (const group of candidateGroups) {
    // Co-occurrence, not per-word: `transition` is only meaningful beside a named duration and a
    // named curve, and no amount of looking at it alone can tell you whether one is present.
    const words = [...wordsWithOffsets(group)]
    const utilities = words.map((w) => splitVariants(w.word.replace(/!$/, '')).utility)
    const transition = words.find((_, i) => TRANSITION_UTILITIES.has(utilities[i]))
    // Deduplicated by offset like the word findings are: the same class list reaches this loop from
    // both the attribute extractor and the literal extractor.
    if (transition && !seenTransition.has(transition.offset)) {
      seenTransition.add(transition.offset)
      const missing = []
      if (!utilities.some((u) => u.startsWith('duration-') && names.durations.includes(u.slice(9)))) missing.push('a named duration (`duration-quick`)')
      if (!utilities.some((u) => u.startsWith('ease-') && names.easings.includes(u.slice(5)))) missing.push('a named curve (`ease-snap`)')
      if (missing.length) {
        report(
          transition.offset,
          transition.word,
          `\`${transition.word}\` needs ${missing.join(' and ')} beside it. On its own it emits ` +
            `\`transition-duration: var(--tw-duration, 0s)\` and \`transition-timing-function: ` +
            `var(--tw-ease, ease)\` — the wipe removed both defaults, so it animates INSTANTLY on a ` +
            `curve the design authority never ratified, while looking entirely deliberate. The ` +
            `authority's motion block is a list of {duration, easing} pairs; there is no duration ` +
            `without a curve in this design`,
        )
      }
    }

    for (const { word, offset } of words) {
      if (!CLASS_WORD.test(word)) continue
      if (seen.has(offset)) continue
      seen.add(offset)
      const problem = checkCandidate(word, names, families, allow)
      if (problem) report(offset, word, problem)
    }
  }

  // `@source inline(…)` generates utilities with ZERO occurrences anywhere in the source, which
  // defeats every scan in this file by construction.
  for (const m of source.matchAll(/@source\s+(?:not\s+)?inline\s*\(/g)) {
    report(m.index, '@source inline(', 'generates utilities with no source occurrence at all, which no source-level gate can see')
  }

  //
  // Raw values. Scanned in authored CSS anywhere; in JSX only inside a `style=` prop or an SVG
  // paint attribute, because a hex in a comment or in an unrelated string is not a painted value.
  //
  const rawScopes = []
  if (isStyleSheet || ext === '.svg') {
    rawScopes.push({ text: source, offset: 0 })
  } else {
    for (const m of source.matchAll(/\bstyle\s*=\s*(\{[^}]*\}\}?|"[^"]*"|'[^']*')/g)) {
      rawScopes.push({ text: m[1], offset: m.index })
    }
    for (const m of source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      rawScopes.push({ text: m[1], offset: m.index })
    }
    for (const m of source.matchAll(PAINT_ATTR)) {
      rawScopes.push({ text: m[2], offset: m.index })
    }
  }
  const exceptions = new Set(CSS_VALUE_EXCEPTIONS.filter((e) => path.endsWith(e.file)).map((e) => e.value))
  for (const scope of rawScopes) {
    for (const { pattern, what } of RAW_VALUES) {
      for (const m of scope.text.matchAll(pattern)) {
        if (exceptions.has(m[0])) continue
        report(scope.offset + m.index, m[0], what)
      }
    }
  }

  return findings
}

// ── Walk + report ─────────────────────────────────────────────────────────────────────────────

function walk(target, out = []) {
  const stat = statSync(target)
  if (stat.isDirectory()) {
    for (const name of readdirSync(target)) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('dist-')) continue
      walk(join(target, name), out)
    }
    return out
  }
  if (SCANNED_EXTS.has(extname(target)) && realpathSync(target) !== realpathSync(TOKENS_CSS)) out.push(target)
  return out
}

export function lintPaths(paths, { yamlSource, stylesheetPath } = {}) {
  const names = tokenNames(yamlSource ?? currentYaml())
  const families = utilityFamilies(names)
  // The app's own base-layer classes join the allowlist, read from the stylesheet that defines them.
  const allow = new Set([...STATIC_ALLOW, ...appBaseClasses(stylesheetPath)])
  const findings = []
  for (const file of paths) {
    for (const f of lintSource(file, readFileSync(file, 'utf8'), names, families, allow)) {
      findings.push({ ...f, file })
    }
  }
  return findings
}

/**
 * Every file this gate covers — exported so a test can assert its scope equals the framework's
 * rather than assert it by planting a file in the working tree and hoping nothing else reads it.
 */
export function filesToScan() {
  return SCAN_ROOTS.flatMap((r) => {
    const p = join(REPO_ROOT, r)
    // A directory root that does not exist yet is fine. A FILE root that does not is a check that
    // has silently stopped running, which is the failure this whole script is one level up from —
    // the lint-claims precedent.
    if (existsSync(p)) return walk(p)
    if (extname(r)) {
      throw new Error(`${r} is named as a scan root but does not exist — this gate has silently stopped covering it.`)
    }
    return []
  })
}

function main() {
  const scanIndex = process.argv.indexOf('--scan')
  const explicit = scanIndex !== -1 ? process.argv.slice(scanIndex + 1).filter((a) => !a.startsWith('--')) : null

  const files = explicit?.length ? explicit.flatMap((p) => walk(resolve(p))) : filesToScan()

  // A scan that matched NOTHING is not a clean scan. Exiting 0 on an empty target is how a typo'd
  // path, a moved directory or a renamed extension turns this gate off while it keeps printing a
  // pass — the failure mode the whole file exists one level above.
  if (!files.length) {
    console.error(
      `nothing to scan: ${explicit?.length ? explicit.join(', ') : SCAN_ROOTS.join(', ')} matched no ` +
        `file with a scannable extension (${[...SCANNED_EXTS].join(', ')}). Refusing to report a ` +
        `clean run for a scan that covered nothing.`,
    )
    process.exit(1)
  }

  const findings = lintPaths(files)

  // The freshness gate. Skipped for an explicit --scan, which is for fixtures rather than the tree.
  let stale = null
  let freshnessChecked = false
  if (!explicit?.length) {
    freshnessChecked = true
    const result = checkFreshness()
    if (!result.fresh) stale = staleMessage(result)
  }

  if (findings.length) {
    // EVERY finding, in one run. Reporting one at a time turns a ten-line fix into ten runs, and a
    // reader who fixes the first and stops never learns the other nine exist.
    for (const f of findings) {
      // A repo-relative path for the tree, an absolute one for anything outside it — `--scan` on a
      // temp directory otherwise prints five levels of `../`, which is not a path anyone can click.
      const rel = relative(REPO_ROOT, f.file)
      const where = !rel || rel.startsWith('..') ? f.file : rel
      console.error(`${where}:${f.line}  ${f.what}\n    ${f.detail}`)
    }
    console.error(
      `\n${findings.length} off-sheet value(s). The design vocabulary is CLOSED: a colour, length, ` +
        `duration or weight that is not in apps/web/design/tokens.yaml must not exist. Add the ` +
        `token to the design authority and re-render, or use the token that already says this.`,
    )
  }
  if (stale) console.error(`\n${stale}`)

  if (findings.length || stale) process.exit(1)

  // Report ONLY what was computed. Printing "tokens.css matches tokens.yaml" after a `--scan` run
  // that never opened tokens.css is a verdict on a check that did not happen.
  const used = CSS_VALUE_EXCEPTIONS.filter((e) => files.some((f) => f.endsWith(e.file)))
  if (used.length) {
    console.log(
      `\n${used.length} authored-CSS value exception(s), each read and re-checked:\n` +
        used.map((e) => `  ${e.file}: ${e.value}\n      ${e.why}`).join('\n'),
    )
  }
  console.log(
    `token lint: ${files.length} file(s) clean` +
      (freshnessChecked ? ' · tokens.css matches tokens.yaml' : ' (--scan: freshness not checked)'),
  )
}

const entrypoint = process.argv[1] ? realpathSync(resolve(process.argv[1])) : null
if (entrypoint && entrypoint === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    main()
  } catch (e) {
    console.error(e.message ?? e)
    process.exit(1)
  }
}
