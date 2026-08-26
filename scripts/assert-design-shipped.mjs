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
      // Every `@keyframes` block the sheet defines. An `animation-name` that names one of these is
      // an animation; one that names anything else is a rule the browser accepts and drops.
      keyframeNames: [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((m) => m[1]),
      stepRingAnimationName: prop(ruleBody(css, '.step-ring'), 'animation-name'),
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
      // The activity feed's slot swap and its two rings — see `activityProblems`.
      activityRightMinWidth: lengthPx(css, ruleBody(css, '.activity-right'), 'min-width'),
      // The selected tab, read through the attribute the COMPONENT LIBRARY emits. Its own contract
      // (`tabs/tab/TabsTabDataAttributes.d.ts`) is `data-active`; there is no `data-selected`, and
      // the plausible guess produces a rule that selects nothing while compiling perfectly.
      activityTabActiveFill: resolved(
        css,
        ruleBody(css, '.activity-tab[data-active]'),
        'background-color',
      ),
      activityTabActiveWeight: prop(ruleBody(css, '.activity-tab[data-active]'), 'font-weight'),
      activityStaticRingBorderPx: lengthPx(css, ruleBody(css, '.activity-ring-static'), 'border'),
      // BOTH SPELLINGS. `animation-name: pb-ring-spin` and `animation: pb-ring-spin 750ms linear`
      // do the same thing, and a check that reads only the longhand passes a spinning "static" ring
      // written the other way.
      activityStaticRingAnimation: [
        prop(ruleBody(css, '.activity-ring-static'), 'animation-name'),
        prop(ruleBody(css, '.activity-ring-static'), 'animation'),
      ]
        .filter(Boolean)
        .join(' '),
      attentionAnimationName: prop(
        ruleBody(css, '.attention-highlight .option-row-inner'),
        'animation-name',
      ),
      // What the cue actually animates. §4.8's claim is "background only — the row must not move",
      // and that is the one assertion of the seven this gate makes about the highlight that cannot
      // be read off the rule: it is inside the keyframes.
      attentionKeyframeBody: keyframeBody(
        css,
        prop(ruleBody(css, '.attention-highlight .option-row-inner'), 'animation-name'),
      ),
      // The colour the cue actually reaches, resolved through its token. See `activityProblems` —
      // this is the "is it visible" question 6.5's review found nothing had been asked.
      attentionPeakColor: peakBackground(
        css,
        keyframeBody(
          css,
          prop(ruleBody(css, '.attention-highlight .option-row-inner'), 'animation-name'),
        ),
      ),
      attentionIterations: prop(
        ruleBody(css, '.attention-highlight .option-row-inner'),
        'animation-iteration-count',
      ),
      attentionDuration: resolved(
        css,
        ruleBody(css, '.attention-highlight .option-row-inner'),
        'animation-duration',
      ),
      // Anchored on the query text for the same reason `ringReducedMotion` is: `ruleBody` returns
      // the FIRST match, so without the anchor the base rule and the override are indistinguishable
      // and whichever the emitter happens to put first is what gets measured.
      attentionReducedMotion:
        css.match(
          /prefers-reduced-motion[^{]*\{[\s\S]*?\.attention-highlight\s+\.option-row-inner\s*\{([^}]*)\}/,
        )?.[1] ?? '',

      // ── The disclosure panel and the visibility matrix — see `disclosureProblems` ────────
      //
      // The container recipe, RESOLVED TO NUMBERS, so the check is about the shipped geometry and
      // not about which words are spelled. `padding: var(--spacing-s0)` passes a presence check
      // while padding nothing at all.
      disclosureFill: resolved(css, ruleBody(css, '.disclosure-panel'), 'background-color'),
      disclosureRadiusPx: lengthPx(css, ruleBody(css, '.disclosure-panel'), 'border-radius'),
      disclosurePaddingPx: lengthPx(css, ruleBody(css, '.disclosure-panel'), 'padding'),
      disclosureGapPx: lengthPx(css, ruleBody(css, '.disclosure-panel'), 'gap'),
      disclosureTransition: [
        prop(ruleBody(css, '.disclosure-panel'), 'transition-property'),
        prop(ruleBody(css, '.disclosure-panel'), 'transition'),
      ]
        .filter(Boolean)
        .join(' '),
      // BOTH SPELLINGS, for `.activity-ring-static`'s reason: `animation-name: x` and
      // `animation: x 1s` do the same thing, and a check reading only the longhand passes a panel
      // that pulses written the other way. "Disclosure never animates on polls, never pulses."
      disclosureAnimation: [
        prop(ruleBody(css, '.disclosure-panel'), 'animation-name'),
        prop(ruleBody(css, '.disclosure-panel'), 'animation'),
      ]
        .filter(Boolean)
        .join(' '),
      //
      // THE APPEARANCE, WHICH HAS TO BE ABLE TO FIRE. §4.3 authors "appears at {motion.quick}
      // opacity and then holds still", and the first version of this sheet declared the transition
      // with no starting value and nothing toggling it — a transition that could never run, which
      // this gate then reported as proof the behaviour held. `@starting-style` supplies the value
      // the panel transitions FROM on its first style resolution, and it is read out of the at-rule
      // rather than the base rule because that is the only place it can live.
      //
      disclosureStartingOpacity: prop(
        css.match(/@starting-style[^{]*\{\s*\.disclosure-panel\s*\{([^}]*)\}/)?.[1] ?? '',
        'opacity',
      ),
      disclosureRestOpacity: prop(ruleBody(css, '.disclosure-panel'), 'opacity'),
      disclosureBodyColor: resolved(css, ruleBody(css, '.disclosure-body'), 'color'),
      disclosureBodySize: resolved(css, ruleBody(css, '.disclosure-body'), 'font-size'),
      // The MARKER, held to the same neutral as the body. Without a colour of its own it inherits
      // the panel's severity, and a `high` panel then paints every ↗ on every muted line
      // irreversible red beside neutral2 text — colour spent on punctuation.
      disclosureMarkerColor: resolved(css, ruleBody(css, '.disclosure-marker'), 'color'),
      // The two tokens the body is held to, read from the same sheet so the comparison is between
      // the rule and the token rather than between the rule and a colour retyped in this file.
      neutral2: decl(css, '--color-neutral2'),
      body3: decl(css, '--text-body3'),
      //
      // EVERY COLOUR TOKEN THE SHEET DECLARES, keyed by its bare name.
      //
      // The recipe in `tokens.yaml` names its fill as a TOKEN (`fill: inset`), not as a hex, so the
      // gate has to resolve whatever the authority happens to name — writing `--color-inset` into
      // this file would put the recipe in two places again, which is the whole defect
      // `expectedDisclosure` exists to fix. Last declaration wins, matching `decl`'s cascade
      // semantics, so a dark redeclaration is what a token resolves to on both sides of every
      // comparison.
      //
      colorTokens: Object.fromEntries(
        [...css.matchAll(/--color-([\w-]+)\s*:\s*([^;}]+)/g)].map((m) => [m[1], m[2].trim()]),
      ),
      // One entry per `PrivacyColor`. An absent rule resolves to '' and a duplicated one resolves
      // to the same string as its twin — both are failures, for different reasons.
      severityColors: Object.fromEntries(
        PRIVACY_COLORS.map((name) => [
          name,
          resolved(css, attrRuleBody(css, `.disclosure-panel[data-severity='${name}']`), 'color'),
        ]),
      ),
      // BOTH AXES. `width: 10px; height: 24px` is a lozenge, not a dot, and a check that reads only
      // the width returns clean on it — the shape channel broken by the one property nobody looked at.
      dotWidthPx: lengthPx(css, ruleBody(css, '.visibility-dot'), 'width'),
      dotHeightPx: lengthPx(css, ruleBody(css, '.visibility-dot'), 'height'),
      dotBorderPx: lengthPx(css, ruleBody(css, '.visibility-dot'), 'border'),
      dotSeesFill: resolved(css, attrRuleBody(css, ".visibility-dot[data-state='sees']"), 'background-color'),
      dotHiddenFill: prop(attrRuleBody(css, ".visibility-dot[data-state='hidden']"), 'background-color'),
      // The half and the dash. Read as `background-image` AND `background` for the same reason the
      // animation is read twice — a shorthand carries the same meaning and answers a different key.
      dotConditionalShape: backgroundShape(attrRuleBody(css, ".visibility-dot[data-state='conditional']")),
      dotAbsentShape: backgroundShape(attrRuleBody(css, ".visibility-dot[data-state='absent']")),
      //
      // SOURCE POSITIONS, not rule bodies. Both selectors are specificity 0,2,0, so order is the
      // only thing deciding which wins on a button that is blocked AND carries severity.
      //
      // `lastIndexOf`, AND THAT IS THE WHOLE POINT OF THE CHECK. With `indexOf`, adding a SECOND
      // `.cta[data-severity=…]` rule below the blocked one keeps the first index where it was, so
      // the comparison stayed green while the rule that actually wins the cascade had moved. The
      // question being asked is "which of these two comes last", and only the last occurrence of
      // each can answer it.
      //
      ctaSeverityAt: css.lastIndexOf('.cta[data-severity'),
      ctaBlockedAt: css.lastIndexOf('.cta[aria-disabled'),
      // Per level, by name. One rule existing proved nothing about the other: delete the `exposed`
      // rule and `ctaSeverity('medium')` still returns a channel with no paint behind it.
      ctaSeverityColors: Object.fromEntries(
        CTA_SEVERITIES.map((name) => [
          name,
          resolved(css, attrRuleBody(css, `.cta[data-severity='${name}']`), 'background-color'),
        ]),
      ),
    },
  }
}

/** The four `PrivacyColor` values. Pinned against the union itself in `disclosure-gate.test.ts`. */
export const PRIVACY_COLORS = ['neutral', 'exposed', 'irreversible', 'quiet']

/**
 * The two levels `ctaSeverity()` can return — the CTA's channel is narrower than the panel's.
 *
 * Pinned against that function in `disclosure-gate.test.ts` for `PRIVACY_COLORS`' reason: a
 * hand-transcribed list in a `.mjs` gate is a list that silently stops covering the union it copies.
 */
export const CTA_SEVERITIES = ['exposed', 'irreversible']

/**
 * `ruleBody` for a selector carrying a QUOTED attribute value.
 *
 * The emitted artifact strips those quotes — `[data-theme=dark]` and `[aria-disabled=true]` are
 * both in the shipped sheet unquoted — so a check written against the authored spelling matches
 * nothing and reports every declaration absent, which is a gate that fails a correct build. Tries
 * the authored form first so a fabricated stylesheet in the test suite can use either.
 */
function attrRuleBody(css, selector) {
  return ruleBody(css, selector) || ruleBody(css, selector.replace(/'/g, ''))
}

/** Whatever gives a dot a shape rather than a colour, in either the longhand or the shorthand. */
function backgroundShape(body) {
  return [prop(body, 'background-image'), prop(body, 'background')].filter(Boolean).join(' ')
}

/**
 * Every spelling of "no fill" a stylesheet or a minifier can produce.
 *
 * FOUR SHAPES, because a check that recognises three reports a transparent dot as filled and passes
 * the exact failure it exists to catch. `transparent` is the authored word; `#0000` is what esbuild
 * writes for it (measured in the emitted artifact); `rgba(0,0,0,0)` is the legacy comma form; and
 * `rgb(0 0 0 / 0)` is the modern space-separated form a different minifier or a hand-edit can
 * produce, which the comma-only pattern missed entirely.
 */
function isTransparent(value) {
  const v = String(value || '').trim().toLowerCase()
  if (v === 'transparent' || v === 'none') return true
  if (/^#0{4,8}$/.test(v)) return true
  // Comma form: the alpha is the last of four. Slash form: the alpha follows the `/`.
  if (/^rgba?\([^)]*,\s*0*(?:\.0+)?\s*\)$/.test(v)) return true
  if (/^rgba?\([^)/]*\/\s*0*(?:\.0+)?%?\s*\)$/.test(v)) return true
  return false
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
/**
 * Everything inside one `@keyframes` block.
 *
 * The inner alternation is what handles the one level of nesting keyframes have — percentage
 * selectors with their own braces — which a plain `[^}]*` would stop at the first of.
 */
function keyframeBody(css, name) {
  if (!name) return ''
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const hit = css.match(new RegExp(`@keyframes\\s+${escaped}\\s*\\{((?:[^{}]|\\{[^{}]*\\})*)\\}`))
  return hit ? hit[1] : ''
}

/**
 * The strongest background colour a keyframes block reaches, resolved through one `var()` hop.
 *
 * "Strongest" is the one that is not transparent: an attention cue runs from nothing to something
 * and back, so the value worth measuring is the something. Returns `''` when the block declares no
 * background at all, which callers treat as a failure.
 */
function peakBackground(css, body) {
  const values = [...String(body || '').matchAll(/background-color\s*:\s*([^;}]+)/g)].map((m) => m[1].trim())
  for (const raw of values) {
    const hit = raw.match(/var\((--[\w-]+)\)/)
    const value = hit ? String(decl(css, hit[1])).trim() : raw
    // `#0000` is what the minifier writes for `transparent`; both mean the resting end of the cue.
    if (value && value !== 'transparent' && !/^#0{4,8}$/i.test(value)) return value
  }
  return ''
}

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
 * The disclosure panel's recipe, READ FROM THE AUTHORITY rather than retyped in this file.
 *
 * ── WHY THIS EXISTS AT ALL, AND IT IS THE MOST IMPORTANT FIX IN THIS GATE ─────────────────
 *
 * The first version hardcoded `{ radius: 16, padding: 12, gap: 12 }` and `DOT_PX = 10` as constants
 * here, and `build-web.mjs` then printed "container measured against the yaml recipe". That message
 * was FALSE: editing `components.disclosure.padding` to 16 in `tokens.yaml` changed nothing and
 * broke nothing, because the gate was comparing the stylesheet against a second copy of the recipe
 * rather than against the recipe. A build line asserting a measurement nobody performed is the exact
 * class of defect this repository fails builds over, and it was in the sentence claiming otherwise.
 *
 * `expectedGrounds` above already had the right shape; this is the same move for the same reason.
 * The yaml is the design authority, so the yaml is what the artifact is held to.
 *
 * THROWS on a missing block rather than defaulting. A recipe silently defaulting to nothing checks
 * nothing, and there is no honest value to fall back to.
 */
export function expectedDisclosure(yamlPath) {
  const d = YAML.parse(readFileSync(yamlPath, 'utf8'))
  const panel = d.components?.disclosure
  const dot = d.components?.visibilityDot
  if (!panel || !dot) {
    throw new Error(
      `${yamlPath} has no \`components.disclosure\` / \`components.visibilityDot\` block, so the ` +
        'disclosure gate has nothing to hold the stylesheet to. The recipe lives in the design ' +
        'authority; deleting it there does not make the panel unconstrained, it makes it unchecked.',
    )
  }
  for (const [name, value] of [
    ['disclosure.radius', panel.radius],
    ['disclosure.padding', panel.padding],
    ['disclosure.gap', panel.gap],
    ['visibilityDot.size', dot.size],
  ]) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`\`components.${name}\` in ${yamlPath} is ${JSON.stringify(value)}, not a number`)
    }
  }
  if (typeof panel.fill !== 'string' || !panel.fill) {
    throw new Error(`\`components.disclosure.fill\` in ${yamlPath} must name a colour token`)
  }
  return {
    /** A token NAME (`inset`), which the gate resolves against the sheet's own declaration. */
    fill: panel.fill,
    radius: panel.radius,
    padding: panel.padding,
    gap: panel.gap,
    dotSize: dot.size,
  }
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

  //
  // AND IT MUST NAME AN ANIMATION THAT EXISTS. The hole one property over from the two checks
  // above: delete `animation-name`, or rename the `@keyframes` block without renaming the
  // reference, and the ring stops turning while the curve, the duration and the iteration count
  // all still read correctly. Same failure the duration check describes — "a ring that never turns
  // and no error anywhere" — reached by a different route.
  //
  problems.push(...animationProblems(r, '.step-ring', r.stepRingAnimationName))

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

/**
 * An `animation-name` that names a `@keyframes` block the sheet actually defines.
 *
 * SHARED BY BOTH RINGS AND THE HIGHLIGHT, because the hole is identical in all three and was open
 * in two of them: a rule can declare a correct curve, a real duration and the right iteration count
 * while naming an animation that does not exist. The browser accepts it, plays nothing, and every
 * other assertion still reads green.
 *
 * @param {object} r      the `reserved` block
 * @param {string} label  the selector, for the message
 * @param {string} name   the declared `animation-name`
 */
function animationProblems(r, label, name) {
  const declared = String(name || '').trim()
  if (!declared || declared === 'none') {
    return [
      `\`${label}\` declares ${declared === 'none' ? '`animation-name: none`' : 'no animation-name'}. ` +
        'The duration and the iteration count describe an animation that is not running — every ' +
        'other check on this rule still passes and nothing moves.',
    ]
  }
  if (!(r.keyframeNames || []).includes(declared)) {
    return [
      `\`${label}\` names the animation \`${declared}\`, and the stylesheet defines no ` +
        `\`@keyframes ${declared}\`. Renaming the keyframes block without renaming the reference ` +
        'is silent: the browser drops the rule and plays nothing.',
    ]
  }
  return []
}

/**
 * The activity feed's construction rules, resolved to numbers (story 6.6).
 *
 * A FOURTH VERDICT, for the reason `progressProblems` is a third one: "the token sheet shipped",
 * "the value spine reserves its space", "the progress machine cannot reflow or overclaim" and "the
 * feed's slot swaps rather than appears" are four separate findings, and a caller that merges them
 * learns only that something is wrong.
 *
 * @param {object} o
 * @param {object|null} o.read  what `readDesign()` returned
 * @returns {string[]} problems, empty when the feed is built the way §2.3/§4.8 require
 */
export function activityProblems({ read }) {
  const problems = []
  if (!read) return ['the emitted stylesheet could not be read, so no activity rule was verified']

  const r = read.reserved ?? {}

  //
  // THE RIGHT EDGE IS A SLOT, WHICH MEANS IT IS RESERVED.
  //
  // §4.8: "pending/confirmed is a slot-swap at the right edge (timestamp ↔ spinner ↔ static ring)".
  // A block label, a 24px ring and an inline Retry are three different widths; without a floor the
  // row's title re-wraps every time the state changes, and a list the user is reading reflows under
  // them. Same number as `.step-right`, because it is the same reserve for the same reason.
  //
  const SLOT_MIN_PX = 60

  if (r.activityRightMinWidth === null || r.activityRightMinWidth < SLOT_MIN_PX) {
    problems.push(
      `\`.activity-right\` reserves ${r.activityRightMinWidth === null ? 'no readable min-width' : `${r.activityRightMinWidth}px`}, ` +
        `and it must reserve at least ${SLOT_MIN_PX}px. Without it the right edge is not a slot at ` +
        'all — the block label, the ring and the inline Retry are three different widths, and the ' +
        'row re-wraps every time the state changes.',
    )
  }

  //
  // THE SELECTED TAB HAS TO LOOK SELECTED, AND THE ATTRIBUTE HAS TO BE THE ONE THE LIBRARY EMITS.
  //
  // `data-selected` is the obvious guess and it is wrong — the component library's contract is
  // `data-active` — so the naive rule compiles, ships, and matches nothing, leaving both tabs
  // identical. Reading the rule BY THAT SELECTOR is what makes this a check rather than a hope: a
  // sheet written against the guess has no `.activity-tab[data-active]` rule at all and both
  // declarations below come back empty.
  //
  // TWO CHANNELS ASSERTED, because a tab distinguished by fill alone vanishes in greyscale and
  // these accents are eight-percent washes — the same measured failure that made the progress
  // ring invisible in 6.5.
  //
  if (!r.activityTabActiveFill || /^transparent$|^none$/.test(r.activityTabActiveFill.trim())) {
    problems.push(
      `the selected activity tab resolves its background to ${r.activityTabActiveFill ? JSON.stringify(r.activityTabActiveFill) : '(nothing)'}. ` +
        'Either the rule is missing or it is keyed on `data-selected`, which the component library ' +
        'does not emit — its attribute is `data-active`, and the wrong one is valid CSS that ' +
        'selects nothing and leaves both tabs looking the same.',
    )
  }

  if (!/\S/.test(r.activityTabActiveWeight || '')) {
    problems.push(
      'the selected activity tab declares no font-weight. Fill alone is one channel, and a ' +
        'reader in greyscale or with the eight-percent accent washes cannot see which tab they ' +
        'are on from a tint.',
    )
  }

  //
  // THE MATURING RING MUST NOT TURN, AND THIS IS THE EXACT INVERSE OF THE `.step-ring` CHECK.
  //
  // §4.8 specifies the queued/maturing marker as a STATIC ring: "a still ring means the clock runs,
  // nothing is stuck". The spinner in the progress machine exists precisely because we cannot
  // observe a hosted prover's progress — and nothing is being observed while a note ages, so a
  // turning ring here claims a watch that is not happening. The likely regression is somebody
  // reusing `.step-ring` or adding an `animation-name` because a still circle looked unfinished.
  //
  if (/\S/.test(r.activityStaticRingAnimation || '') && !/^none\b/.test(r.activityStaticRingAnimation)) {
    problems.push(
      `\`.activity-ring-static\` declares \`animation-name: ${r.activityStaticRingAnimation}\`, and it ` +
        'must declare none at all. A turning ring on a maturing note says we are watching a ' +
        'computation; nothing is being watched while a note ages, which is why §4.8 specifies a ' +
        'still one.',
    )
  }

  //
  // AND IT HAS TO BE VISIBLE TO BE A RING. The 6.4 lesson, applied before it can be repeated: a
  // border checked for its wording rather than its effect. A ring with no readable border width is
  // an empty 24px box, and every check above it still passes.
  //
  if (r.activityStaticRingBorderPx === null || r.activityStaticRingBorderPx <= 0) {
    problems.push(
      `\`.activity-ring-static\` has a border of ${r.activityStaticRingBorderPx === null ? 'no readable width' : `${r.activityStaticRingBorderPx}px`}. ` +
        'The ring is nothing but its border — at zero width the maturing state renders an empty ' +
        'box, which reads as a row that failed to load rather than one that is waiting.',
    )
  }

  //
  // ONCE. NOT INFINITE, NOT ABSENT.
  //
  // §4.8: a matured row "plays the 1.2s attention highlight once — never a toast". An omitted
  // iteration count is `1` by CSS default and would pass a presence check while telling a reader
  // nothing; `infinite` is a row that pulses forever, which is the toast this product bans wearing
  // a different shape. The declaration must be there AND it must be exactly one.
  //
  // The same hole the two rings have, on the one cue whose absence is hardest to notice: nobody
  // misses a highlight they have never seen play.
  problems.push(...animationProblems(r, 'the attention highlight', r.attentionAnimationName))

  if (!/^1(?![\d.])/.test((r.attentionIterations || '').trim())) {
    problems.push(
      `the attention highlight declares \`animation-iteration-count: ${r.attentionIterations || '(nothing)'}\`, ` +
        'and §4.8 allows exactly one play. A repeating highlight on a settled row is the toast this ' +
        'product does not ship, and an absent declaration means nobody decided.',
    )
  }

  //
  // AND IT MAY NOT MOVE THE ROW. The seventh §4.8 claim, and the only one that lives inside the
  // keyframes rather than on the rule: a highlight is a background cue, and a row that jumps is a
  // reflow in the list the reader is in the middle of reading. `transform` is the one that looks
  // harmless — it does not reflow the page, but it does move the row under the eye, which is the
  // thing being forbidden.
  //
  const moves = ['transform', 'translate', 'margin', 'padding', 'width', 'height', 'inset', 'top', 'left']
    .filter((p) => new RegExp(`(?:^|[;{\\s])${p}\\s*:`).test(r.attentionKeyframeBody || ''))
  if (moves.length) {
    problems.push(
      `the attention highlight's keyframes animate ${moves.join(', ')}. §4.8 makes it a background ` +
        'cue on purpose — a row that moves is a reflow in a list somebody is reading, at the exact ' +
        'moment it is trying to draw their eye to one entry.',
    )
  }

  //
  // AND IT HAS TO BE VISIBLE. This is the question 6.5's review found nobody had asked: its gate
  // proved the ring's curve was linear, its duration real and its iteration infinite, over a
  // spinner painted in an eight-percent tint that composited to a three-value RGB delta and read as
  // a static circle. "A gate can only check what it was pointed at."
  //
  // So the cue's peak colour is resolved through its token and held to a floor. `transparent` at
  // both ends of an animation is a cue that plays and shows nothing; a token that resolves to
  // nothing is the same failure by another route; and a wash under five percent is the exact
  // mistake that shipped last time.
  //
  const peak = String(r.attentionPeakColor || '').trim()
  const alpha = peak.match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)/)
  if (!peak) {
    problems.push(
      'the attention highlight animates no background colour that is not transparent. A cue that ' +
        'runs from nothing to nothing plays for 1.2 seconds and shows the reader nothing at all, ' +
        'while the duration, the curve and the iteration count all read correctly.',
    )
  } else if (alpha && Number(alpha[1]) < 0.05) {
    problems.push(
      `the attention highlight peaks at ${peak}, whose alpha is under 5%. That is the 6.5 defect: ` +
        'a tint that low composites to a few RGB values and is a cue nobody can see, proved honest ' +
        'by every other check on this rule.',
    )
  }

  const attentionMs = timeMs(r.attentionDuration)
  if (attentionMs === null || attentionMs <= 0) {
    problems.push(
      `the attention highlight resolves its duration to ${r.attentionDuration ? JSON.stringify(r.attentionDuration) : '(nothing)'}. ` +
        'It must resolve to a positive time from the motion sheet — an unresolved var() leaves the ' +
        'animation at the UA default of 0s, which is a cue that never plays and no error anywhere.',
    )
  }

  //
  // REDUCED MOTION, BY NAME. The blanket `*` rule is specificity 0,0,0 and this selector is 0,2,0,
  // so the base rule's own `animation-name` wins unless something overrides it explicitly. That is
  // 6.5's recorded finding; asserting it here is what stops it being rediscovered a third time.
  //
  if (!/animation-name\s*:\s*none/.test(r.attentionReducedMotion || '')) {
    problems.push(
      'the `prefers-reduced-motion` block does not stop the attention highlight. A class selector ' +
        'outranks the universal one, so without a named override a 1.2s colour pulse still plays ' +
        'for a reader who asked the OS to stop motion.',
    )
  }

  return problems
}


/**
 * The disclosure panel's construction rules, resolved to numbers (story 6.7).
 *
 * A FIFTH VERDICT, for the reason there is a fourth: "the token sheet shipped", "the value spine
 * reserves its space", "the progress machine cannot reflow or overclaim", "the feed's slot swaps
 * rather than appears" and "the panel is furniture and its matrix is legible without colour" are
 * five separate findings. A caller that merges any two of them learns only that something is wrong.
 *
 * ── WHY THIS IS A STYLESHEET READ AND NOT A TEST ──────────────────────────────────────────
 *
 * Two of the criteria this covers were written as behaviours: "re-render with poll ticks and assert
 * no animation fires", and "remove colour and check every cell is still legible". Neither can run
 * here — there is no layout engine in jsdom and no browser driver in this repository — and both
 * restate as CONSTRUCTION RULES that are stronger than the samples they replace. A rule that says
 * the panel declares no animation holds for every poll, including the ones nobody thought to fire;
 * a rule that says the hidden dot is a hollow ring and the seen dot is filled holds for every
 * reader, including the one looking at a greyscale screenshot.
 *
 * ── IT TAKES THE RECIPE RATHER THAN CARRYING ONE ──────────────────────────────────────────
 *
 * `expected` comes from `expectedDisclosure(tokens.yaml)`. The first version hardcoded the numbers
 * here and `build-web.mjs` printed "measured against the yaml recipe" over a comparison against a
 * second copy of it — editing the authority changed nothing. See `expectedDisclosure` for the full
 * account; the short version is that a build line asserting a measurement nobody performed is worse
 * than no line at all.
 *
 * ── AND IT NEVER THROWS ───────────────────────────────────────────────────────────────────
 *
 * Every `r.*` read is guarded. The first version promised tolerance with `read.reserved ?? {}` and
 * then dereferenced `.trim()` on three of the values it had just admitted might be missing, so
 * `disclosureProblems({ read: {} })` died with a TypeError instead of returning findings — a gate
 * that crashes reports nothing, and the four verdicts beside this one all get this right.
 *
 * @param {object} o
 * @param {object|null} o.read      what `readDesign()` returned
 * @param {object|null} o.expected  what `expectedDisclosure()` returned
 * @returns {string[]} problems, empty when the panel is built the way §7.5 requires
 */
export function disclosureProblems({ read, expected }) {
  const problems = []
  if (!read) return ['the emitted stylesheet could not be read, so no disclosure rule was verified']
  if (!expected) {
    return [
      'no recipe was supplied, so nothing was compared. `disclosureProblems` is held to ' +
        '`components.disclosure` / `components.visibilityDot` in tokens.yaml (see ' +
        '`expectedDisclosure`), and a verdict with no expectation is a verdict that passes ' +
        'everything.',
    ]
  }

  const r = read.reserved ?? {}
  const tokens = r.colorTokens ?? {}
  // Guarded readers. Every value below can legitimately be absent — that is the failure being
  // reported — so nothing is dereferenced before it has been turned into a string or a number.
  const text = (value) => String(value ?? '').trim()
  const px = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

  //
  // THE CONTAINER RECIPE, resolved to numbers and compared to the design authority's own line.
  //
  for (const [name, want, got] of [
    ['border-radius', expected.radius, px(r.disclosureRadiusPx)],
    ['padding', expected.padding, px(r.disclosurePaddingPx)],
    ['gap', expected.gap, px(r.disclosureGapPx)],
  ]) {
    if (got === null || got !== want) {
      problems.push(
        `\`.disclosure-panel\` resolves ${name} to ${got === null ? '(nothing readable)' : `${got}px`}, ` +
          `and \`components.disclosure\` in tokens.yaml says ${want}. The recipe is the design ` +
          "authority's; a panel that stops matching it has quietly become a different component.",
      )
    }
  }

  //
  // THE FILL IS COMPARED TO THE TOKEN THE RECIPE NAMES, not merely found to be present.
  //
  // `background-color: var(--color-raised)` is a real colour, resolves fine, and is the wrong one —
  // it paints the panel as a card instead of a well, and every "is it non-empty" check passes while
  // the build prints "inset fill".
  //
  const wantFill = text(tokens[expected.fill])
  const gotFill = text(r.disclosureFill)
  if (!wantFill) {
    problems.push(
      `the sheet declares no \`--color-${expected.fill}\`, which is the fill ` +
        '`components.disclosure` names. The recipe points at a token that does not exist, so ' +
        'nothing can be held to it.',
    )
  } else if (!gotFill || gotFill !== wantFill) {
    problems.push(
      `\`.disclosure-panel\` resolves its background to ${gotFill ? JSON.stringify(gotFill) : '(nothing)'} ` +
        `and \`components.disclosure.fill\` names \`${expected.fill}\` (${wantFill}). A different ` +
        'colour is not a near miss: the panel is a well on a raised surface, and painting it as ' +
        'another card leaves the one loud element on a review screen with no edge at all.',
    )
  }

  //
  // "APPEARS AT {motion.quick} OPACITY AND THEN HOLDS STILL" (EXPERIENCE §4.3). THREE assertions,
  // and the third is the one that was missing: a transition that cannot fire is not an appearance.
  //
  if (text(r.disclosureAnimation) && !/^none\b/.test(text(r.disclosureAnimation))) {
    problems.push(
      `\`.disclosure-panel\` declares \`animation: ${text(r.disclosureAnimation)}\`, and it must ` +
        'declare none at all. Disclosure is furniture, not alarm: it appears once and holds still, ' +
        'and a panel that animates re-fires on every poll of the screen it sits on.',
    )
  }

  if (text(r.disclosureTransition) !== 'opacity') {
    problems.push(
      `\`.disclosure-panel\` transitions ${text(r.disclosureTransition) ? JSON.stringify(text(r.disclosureTransition)) : '(nothing)'}, ` +
        'and §4.3 allows opacity and only opacity. Anything else — a colour, a height, a transform ' +
        '— is movement on a block whose whole job is to state facts calmly.',
    )
  }

  //
  // THE TRANSITION HAS TO HAVE SOMEWHERE TO COME FROM.
  //
  // Declaring `transition-property: opacity` with no starting value and nothing toggling one is a
  // transition that can never run — §4.3's authored appearance simply not implemented, with this
  // gate reporting the declaration as proof the behaviour held. `@starting-style` is what supplies
  // the value the panel transitions FROM on first paint; without it the two checks above are
  // assertions about three words.
  //
  const startOpacity = text(r.disclosureStartingOpacity)
  const restOpacity = text(r.disclosureRestOpacity)
  if (!/^0(?![.\d])/.test(startOpacity)) {
    problems.push(
      `\`@starting-style { .disclosure-panel }\` declares opacity ${startOpacity ? JSON.stringify(startOpacity) : '(nothing)'}, ` +
        'and it must declare 0. Without a starting value the opacity transition has nothing to ' +
        'travel from, so §4.3\'s "appears at {motion.quick} opacity" never happens — and every ' +
        'other check on this rule still reads green over a declaration that cannot fire.',
    )
  }
  if (!/^1(?![.\d])/.test(restOpacity)) {
    problems.push(
      `\`.disclosure-panel\` declares a resting opacity of ${restOpacity ? JSON.stringify(restOpacity) : '(nothing)'}, ` +
        'and it must declare 1. The starting value is only half of a transition; without an ' +
        'explicit destination on the base rule the panel has no authored end state to arrive at.',
    )
  }

  //
  // "HEADLINE TAKES THE SEMANTIC COLOUR, BODY FORCED NEUTRAL2 BODY3" (§7.5). THREE rules, because
  // the marker is part of the body and was not: with no colour of its own `.disclosure-marker`
  // INHERITS the panel's severity, so a `high` panel painted every ↗ on every muted line
  // irreversible red beside neutral2 text — the one colour reserved for what cannot be undone,
  // spent on punctuation, down the whole left edge of the block.
  //
  const neutral2 = text(r.neutral2)
  for (const [selector, got] of [
    ['.disclosure-body', text(r.disclosureBodyColor)],
    ['.disclosure-marker', text(r.disclosureMarkerColor)],
  ]) {
    if (!got || !neutral2 || got !== neutral2) {
      problems.push(
        `\`${selector}\` resolves its colour to ${got ? JSON.stringify(got) : '(nothing)'} and ` +
          `\`--color-neutral2\` is ${neutral2 ? JSON.stringify(neutral2) : '(absent)'}. §7.5 forces ` +
          'both to neutral2 so the coloured claim is the headline alone; anything else inherits the ' +
          'panel severity and there is no hierarchy left to read.',
      )
    }
  }

  const body3 = text(r.body3)
  if (!text(r.disclosureBodySize) || !body3 || text(r.disclosureBodySize) !== body3) {
    problems.push(
      `\`.disclosure-body\` resolves its font-size to ${text(r.disclosureBodySize) ? JSON.stringify(text(r.disclosureBodySize)) : '(nothing)'} ` +
        `and \`--text-body3\` is ${body3 ? JSON.stringify(body3) : '(absent)'}. The body step is part of the ` +
        'recipe, not a preference — an explanation set at the headline size competes with it.',
    )
  }

  //
  // FOUR SEVERITY RULES, AND THEY MUST BE FOUR DIFFERENT COLOURS.
  //
  // Presence is not enough. The failure this catches is the one that looks correct in a diff: a
  // fourth rule added by copying the third, so `quiet` and `irreversible` resolve to the same red
  // and the most severe level stops rendering calmest — the ruling `blocked → quiet` exists to make.
  //
  problems.push(
    ...distinctValues({
      values: r.severityColors ?? {},
      names: PRIVACY_COLORS,
      missing: (name) =>
        `\`.disclosure-panel[data-severity=${name}]\` resolves its colour to nothing. Either the ` +
        'rule is missing or its token does not resolve, and a panel whose severity paints no ' +
        'colour reads as the level below it.',
      duplicate: (name, twin, value) =>
        `\`${name}\` and \`${twin}\` both resolve to ${value}. The four privacy colours have to be ` +
        'four colours: with two of them identical, one severity level is invisible — and if the ' +
        'pair is `quiet` and `irreversible`, the most severe state has started rendering as red, ' +
        'which is the one thing §2.3 rules out.',
    }),
  )

  //
  // THE NON-COLOUR CHANNEL, PROVED RATHER THAN ASSERTED.
  //
  // §2.3's ratified measurement is that `settled` and `irreversible` collapse toward each other
  // under red-green colour vision deficiency, which makes the icon-and-word rule "load-bearing and
  // must be enforced in code with a test". Twenty cells separated by hue alone is the densest place
  // to break it. So: the seen dot is FILLED, the hidden dot is HOLLOW with a border that actually
  // occupies space, the two qualified states carry a shape of their own, and NO TWO of those shapes
  // are the same string. A dot set that differs only in colour fails every one of these.
  //
  for (const [axis, got] of [
    ['width', px(r.dotWidthPx)],
    ['height', px(r.dotHeightPx)],
  ]) {
    if (got === null || got !== expected.dotSize) {
      problems.push(
        `\`.visibility-dot\` resolves its ${axis} to ${got === null ? '(nothing readable)' : `${got}px`}, ` +
          `and \`components.visibilityDot.size\` in tokens.yaml says ${expected.dotSize}. BOTH axes ` +
          'are pinned: a dot that is 10 wide and 24 tall is a lozenge, and a check reading one axis ' +
          'returns clean on it.',
      )
    }
  }

  if (px(r.dotBorderPx) === null || px(r.dotBorderPx) <= 0) {
    problems.push(
      `\`.visibility-dot\` has a border of ${px(r.dotBorderPx) === null ? 'no readable width' : `${r.dotBorderPx}px`}. ` +
        'The hollow state is nothing but its border — at zero width a hidden cell renders as empty ' +
        'space, which reads as a cell that failed to load rather than as a fact.',
    )
  }

  if (!text(r.dotSeesFill) || isTransparent(r.dotSeesFill)) {
    problems.push(
      `\`.visibility-dot[data-state=sees]\` resolves its background to ${text(r.dotSeesFill) ? JSON.stringify(text(r.dotSeesFill)) : '(nothing)'}. ` +
        'Fill is the channel that separates "sees" from "hidden" without colour; an unfilled seen ' +
        'dot and a hidden dot are the same picture, and only the hue tells them apart.',
    )
  }

  if (!text(r.dotHiddenFill) || !isTransparent(r.dotHiddenFill)) {
    problems.push(
      `\`.visibility-dot[data-state=hidden]\` declares \`background-color: ${text(r.dotHiddenFill) || '(nothing)'}\` ` +
        'and it must be transparent. A filled "hidden" dot differs from a "sees" dot by colour ' +
        'alone, which is exactly the failure the shape channel exists to prevent.',
    )
  }

  for (const [state, shape] of [
    ['conditional', text(r.dotConditionalShape)],
    ['absent', text(r.dotAbsentShape)],
  ]) {
    if (!shape) {
      problems.push(
        `\`.visibility-dot[data-state=${state}]\` carries no background-image, so it has no shape ` +
          'of its own and differs from the other states by colour alone. `conditional` is the ' +
          'riskiest cell in the matrix — a claim that is USUALLY hidden — and rendering it as an ' +
          'ordinary hidden dot is a false guarantee no copy check can see.',
      )
    }
  }

  //
  // AND THE TWO SHAPES MUST NOT BE THE SAME SHAPE. The colours got a distinctness scan and the
  // shapes did not, so pasting the `absent` declaration into `[data-state=conditional]` returned
  // clean — two identical dashes, the shape channel collapsed, every presence check green.
  //
  problems.push(
    ...distinctValues({
      values: { conditional: text(r.dotConditionalShape), absent: text(r.dotAbsentShape) },
      names: ['conditional', 'absent'],
      // Absence is already reported above; this scan only speaks about collisions.
      missing: null,
      duplicate: (name, twin, value) =>
        `\`${name}\` and \`${twin}\` draw the same shape (${value}). Fill · hollow · half · dash is ` +
        'four distinct marks or it is not a channel — two states sharing one leaves the hue as the ' +
        'only thing between them, which is the rule §2.3 makes load-bearing.',
    }),
  )

  //
  // SEVERITY REACHES THE CTA, AT BOTH LEVELS, AND THE BLOCKED DOWNGRADE STILL WINS.
  //
  // Checking that ONE `.cta[data-severity=…]` rule exists proved nothing about the other: delete
  // the `exposed` rule and `ctaSeverity('medium')` still returns a channel with no paint behind it,
  // so a medium-severity review ships an ink button while the panel headline goes amber.
  //
  const ctaColors = r.ctaSeverityColors ?? {}
  for (const level of CTA_SEVERITIES) {
    if (!text(ctaColors[level])) {
      problems.push(
        `\`.cta[data-severity=${level}]\` resolves its background to nothing. \`ctaSeverity()\` ` +
          `returns \`${level}\` for one of the two levels §7.5 colours, so the attribute reaches the ` +
          'button and no rule answers it — the thumb stays ink while the panel headline is not.',
      )
    }
  }

  //
  // Both `.cta` selectors are specificity 0,2,0, so nothing but source order decides a button that
  // is blocked AND carries privacy severity. §7.10 rules that blocked is an emphasis downgrade
  // which does not take the irreversible colour — swap these two and a user who typed too large a
  // number gets a red button, silently. LAST occurrence of each, because "which one comes last" is
  // the question, and a second severity rule added below the blocked one is exactly how a
  // first-occurrence comparison stays green while the cascade flips.
  //
  const severityAt = typeof r.ctaSeverityAt === 'number' ? r.ctaSeverityAt : -1
  const blockedAt = typeof r.ctaBlockedAt === 'number' ? r.ctaBlockedAt : -1
  if (severityAt < 0) {
    problems.push(
      'the stylesheet has no `.cta[data-severity=…]` rule, so severity never reaches the CTA. ' +
        '§7.5 routes it there on purpose — the thumb carries the risk — and a panel that colours ' +
        'its headline over an ink button is telling the reader two things at once.',
    )
  } else if (blockedAt < 0) {
    problems.push('the stylesheet has no `.cta[aria-disabled=true]` rule, so blocked buttons never downgrade.')
  } else if (blockedAt < severityAt) {
    problems.push(
      '`.cta[aria-disabled=true]` appears BEFORE the last `.cta[data-severity=…]` rule in the ' +
        'emitted sheet. Both are specificity 0,2,0, so the later one wins: in this order a blocked ' +
        'button that also carries `high` severity paints irreversible red, which §7.10 rules out ' +
        'for a state the user fixes by typing a smaller number.',
    )
  }

  return problems
}

/**
 * Reports values that are missing, and values that are the SAME as one of their siblings.
 *
 * Shared because the failure is identical wherever a set of states is meant to be distinguishable:
 * four severity colours, two dot shapes. Presence checks pass a set whose members were produced by
 * copying one of them, and a copied member is a state the reader cannot see.
 *
 * @param {object} o
 * @param {Record<string,string>} o.values
 * @param {string[]} o.names               the members to check, in report order
 * @param {((name: string) => string)|null} o.missing  message for an empty value, or null to skip
 * @param {(name: string, twin: string, value: string) => string} o.duplicate
 */
function distinctValues({ values, names, missing, duplicate }) {
  const problems = []
  const seen = new Map()
  for (const name of names) {
    const value = String(values?.[name] ?? '').trim()
    if (!value) {
      if (missing) problems.push(missing(name))
      continue
    }
    const twin = seen.get(value)
    if (twin) {
      problems.push(duplicate(name, twin, value))
      continue
    }
    seen.set(value, name)
  }
  return problems
}
