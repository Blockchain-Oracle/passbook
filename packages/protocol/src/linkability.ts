//
// The linkability meter, as data (story 6.7b, DESIGN §7.6, EXPERIENCE §4.4).
//
// Three parts that can each be true on their own: A COUNT, A SENTENCE, AND A PICTURE. Anything
// beyond those three is a privacy claim FR-051 bans — no 0–100 score, no gauge, no invented scale.
//
// ── NO REACT IN THIS FILE ─────────────────────────────────────────────────────────────────
//
// `option-row.ts:29-36`'s rule, and `vitest.config.ts` is the reason it bites: the runner collects
// `packages/*/test/**` only, so a decision written into a `.tsx` is a decision nothing executes.
// Every choice the meter makes — which tier, which sentence, where each node sits — is made here.
//
// ── THE TIER CAN BE `null`, AND THAT IS A FOURTH ANSWER, NOT A MISSING ONE ────────────────
//
// A reading can be MEASURED and still not JUDGEABLE. If the sample that arrived is too small to
// support a quartile, `boundaryFor` returns `null`, and there is genuinely no boundary to compare
// the count against. Calling that Tier 0 would be the invented claim: "healthy" is a verdict, and
// we would be delivering it without the measurement that backs it.
//
// So the count still renders — it was measured, it is true — and no verdict does. Only the amount
// axis can still speak in that state, because Tier 2 needs `largestEverWei` and not the
// distribution: an exit larger than every crossing ever read is unique on evidence we do have.
//
// ── SEVERITY ROUTES THROUGH `privacy.ts` AND THE METER OWNS NO BUTTON ─────────────────────
//
// Severity leaves as a value; the surface applies it to the CTA it already has. A meter rendering
// its own primary action would put a second CTA on a review screen, and the never-disable rule
// lives on `BlockedButton`, which is where the thumb is.
//

import { formatTokenAmount, type RenderedAmount } from './amount.js'
import { boundaryFor, type CrowdReading } from './crowd.js'
import {
  ALONE_SENTENCE,
  EXIT_ANYWAY,
  LARGEST_EVER_SENTENCE,
  SPLIT_THE_AMOUNT,
  WAIT_FOR_DEPOSITS,
  amountAxisSentence,
  fingerprintSentence,
  healthySentence,
  provenanceCaption,
  timeAxisSentence,
  verdictSentence,
} from './linkability-copy.js'
import type { PrivacySeverity } from './privacy.js'
import { caretDeltaOf } from './odometer.js'

export type LinkabilityTier = 0 | 1 | 2

/**
 * How many nodes the field will draw before it downsamples.
 *
 * `C10:101` requires the field be designed at 142 points AND at 10,000, so 10,000 must render in
 * full — the ceiling is where the requirement ends, not below it.
 *
 * DELIBERATELY NOT IN `tokens.yaml`. The design authority carries recipes the STYLESHEET writes
 * (durations, sizes, radii) so the build gate can resolve the emitted CSS against them. This number
 * never reaches CSS — it governs how many items a model contains — so recording it there would put
 * it somewhere the gate cannot check, which is how a number drifts.
 */
export const FIELD_DENSITY_CEILING = 10_000

/** One dot. Coordinates are proportions of the field's box, so the renderer owns the pixels. */
export interface FieldNode {
  readonly x: number
  readonly y: number
  /** Exactly one node carries this, and it is the one at the centre. */
  readonly mine: boolean
}

export interface NoteFieldModel {
  readonly nodes: readonly FieldNode[]
  /** The real candidate count, which is what the sentence quotes — never `nodes.length`. */
  readonly total: number
  /** True when `nodes` is a sample of `total`. The renderer must SAY SO when this is set. */
  readonly downsampled: boolean
}

export type LinkabilityModel =
  | {
      readonly state: 'unmeasurable'
      /** A sourced sentence. No count, no verdict, and deliberately no warning. */
      readonly because: string
    }
  | {
      readonly state: 'measured'
      /** `null` when the reading could not support a verdict — see the header. */
      readonly tier: LinkabilityTier | null
      /** `null` alongside a `null` tier: no verdict means no colour to spend. */
      readonly severity: PrivacySeverity | null
      readonly candidates: number
      /** `null` on a first paint and on any non-increase (DESIGN:421 authors only the rising form). */
      readonly caretDelta: number | null
      readonly headline: string
      readonly lines: readonly string[]
      /** Labels only. A caller supplying no action renders them as words (`Disclosure.tsx:88`). */
      readonly alternatives: readonly string[]
      /** `Exit anyway` at Tier 2, `null` everywhere else — the CTA keeps its own label. */
      readonly ctaLabel: string | null
      readonly field: NoteFieldModel
      readonly provenance: string
    }

/**
 * Which tier a reading and an amount land on, or `null` when no verdict is supportable.
 *
 * ORDER MATTERS. The amount axis is tested FIRST because it needs only `largestEverWei`, so it can
 * still deliver a verdict when the distribution cannot. The louder axis winning is the I/O matrix's
 * "two axes disagree" row resolved structurally rather than by a later `max`.
 */
export function tierFor(reading: CrowdReading, amountWei: bigint | null): LinkabilityTier | null {
  if (reading.state === 'unmeasurable') return null

  if (amountWei !== null && reading.largestEverWei !== null && amountWei > reading.largestEverWei) {
    return 2
  }

  const boundary = boundaryFor(reading.distribution)
  // `null` IS NOT ZERO. Treating it as one would put every count above it and report every crowd
  // healthy — the stale-claim failure inverted, and silent.
  if (boundary === null) return null

  return reading.candidates <= boundary ? 1 : 0
}

/**
 * The tier's place on the existing ladder. No second ladder, no second colour function.
 *
 * Tier 0 is `low` rather than `none` so that a surface combining this with a disclosure panel via
 * `maxSeverity` can never come out CALMER than the panel alone — `swap`'s panel is already `low`.
 */
export function severityOf(tier: LinkabilityTier): PrivacySeverity {
  if (tier === 2) return 'high'
  if (tier === 1) return 'medium'
  return 'low'
}

/**
 * Where the dots go: a phyllotaxis spiral, which is deterministic and evenly packed at every count.
 *
 * DETERMINISTIC ON PURPOSE. A random scatter would re-scatter on every poll — motion standing for a
 * change that did not happen, next to a step list whose whole discipline is that it never animates
 * on a poll. It also makes the layout testable, which a random one is not.
 *
 * THE USER IS AT THE CENTRE, which is the "position" half of "fill and position, not hue alone".
 * Index 0 of a phyllotaxis is the origin, so this falls out of the layout rather than being a case.
 */
export function noteField(total: number, ceiling: number = FIELD_DENSITY_CEILING): NoteFieldModel {
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`a field needs a whole count of candidates, received ${String(total)}`)
  }
  const drawn = Math.min(total, ceiling)
  const nodes: FieldNode[] = []
  // The golden angle. Successive nodes land in the largest remaining gap, which is why sunflowers
  // use it and why the field stays evenly dense from 142 points to 10,000 with no retuning.
  const goldenAngle = Math.PI * (3 - Math.sqrt(5))
  for (let index = 0; index < drawn; index += 1) {
    const radius = drawn === 1 ? 0 : Math.sqrt(index / (drawn - 1)) * 0.48
    const angle = index * goldenAngle
    nodes.push({
      x: 0.5 + radius * Math.cos(angle),
      y: 0.5 + radius * Math.sin(angle),
      mine: index === 0,
    })
  }
  return { nodes, total, downsampled: drawn < total }
}

/** Flattens a rendered amount for PROSE. Components use the structured form; sentences cannot. */
function plainAmount(rendered: RenderedAmount): string {
  if (rendered.kind === 'raw-units') return `${rendered.sign}${rendered.units}`
  if (rendered.fraction === '') return `${rendered.sign}${rendered.whole}`
  // `hiddenZeros` is documented as ambiguous at zero; at zero the fraction renders plainly, which
  // is the branch every USDC figure this meter shows will take.
  const zeros = rendered.hiddenZeros === 0 ? '' : '0'.repeat(rendered.hiddenZeros + 1)
  return `${rendered.sign}${rendered.whole}.${zeros}${rendered.fraction}`
}

export interface MeterInput {
  readonly reading: CrowdReading
  /** The exit being reviewed, or `null` when no amount has been entered yet. */
  readonly amountWei: bigint | null
  /** Token decimals for display. `null` renders raw units, per `formatTokenAmount`. */
  readonly decimals: number | null
  /** The count when this screen opened, for the caret. `null` on first paint. */
  readonly previousCandidates?: number | null
}

/**
 * The whole meter, as one value.
 *
 * THE UNMEASURABLE ARM RETURNS NO COUNT AND NO WARNING. A warning with no measurement behind it is
 * the invented claim FR-051 bans, and it is the tempting mistake here — a failed read feels like
 * bad news, so it is easy to render it as one. It is not news at all. It is silence.
 */
export function meterFor(input: MeterInput): LinkabilityModel {
  const { reading, amountWei, decimals, previousCandidates = null } = input

  if (reading.state === 'unmeasurable') {
    return { state: 'unmeasurable', because: reading.because }
  }

  const tier = tierFor(reading, amountWei)
  // BOTH ZERO AND ONE ARE "ALONE", and both are reachable from a live read. Zero possible sources
  // means nothing in the window could account for an exit; one means only your own. Written as two
  // equalities rather than `<= 1` on purpose: a relational comparison against a literal is the
  // shape of a hardcoded tier boundary, `no-tier-constant.test.ts` bans it, and this is a grammar
  // guard rather than a threshold. Being explicit costs a few characters and keeps the ban total.
  const alone = reading.candidates === 0 || reading.candidates === 1

  const largestEver =
    reading.largestEverWei === null
      ? null
      : plainAmount(formatTokenAmount(reading.largestEverWei, decimals))

  let headline: string
  if (tier === 2) headline = LARGEST_EVER_SENTENCE
  else if (alone) headline = ALONE_SENTENCE
  else if (tier === 1) headline = verdictSentence(reading.candidates)
  else headline = healthySentence(reading.candidates)

  const lines: string[] = [timeAxisSentence(reading.candidates, reading.window)]
  // Stated even when it is not the headline: at Tier 2 with a crowd of one, both facts are true and
  // dropping either would leave the louder one standing alone as if it were the only problem.
  if (alone && headline !== ALONE_SENTENCE) lines.push(ALONE_SENTENCE)
  if (largestEver !== null) {
    lines.push(amountAxisSentence(largestEver))
    // The fingerprint qualifies the amount axis, so it only appears where that axis is warning.
    if (tier === 1 || tier === 2) lines.push(fingerprintSentence(largestEver))
  }

  return {
    state: 'measured',
    tier,
    severity: tier === null ? null : severityOf(tier),
    candidates: reading.candidates,
    caretDelta: caretDeltaOf(previousCandidates, reading.candidates),
    headline,
    lines,
    // NAMED IN WORDS UNTIL SOMEONE CAN FULFIL THEM. `Split the amount`'s mechanics are an explicit
    // GAP (EXPERIENCE:800) — tranche sizes and spacing in time, when timing correlation is the
    // named attack — so it ships as a label and the caller decides whether it is ever a button.
    alternatives: tier === 1 || tier === 2 ? [WAIT_FOR_DEPOSITS, SPLIT_THE_AMOUNT] : [],
    ctaLabel: tier === 2 ? EXIT_ANYWAY : null,
    field: noteField(reading.candidates),
    provenance: provenanceCaption(reading.blockNumber),
  }
}
