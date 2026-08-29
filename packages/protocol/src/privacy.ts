//
// The privacy severity spine (story 6.7, DESIGN §2.3 / §7.5, EXPERIENCE §4.3).
//
// Three planning documents name a severity model, one `getPrivacyColor()`, and severity escalating
// the CTA. Nothing implemented any of them, so every surface that wanted to say "this one is worse"
// had to invent a colour on the spot. This module is that vocabulary, once, as data.
//
// A leaf that imports nothing: a component that wants to know how loud a claim is must not have
// to pull a chain client into the browser to find out.
//
// ── WHY THE LADDER IS GAP-NUMBERED ────────────────────────────────────────────────────────
//
// DESIGN §2.3 writes it out: `None=0, Low=1, Medium=5, High=10, Blocked=11`. The gaps are not
// decoration — a level inserted between Low and Medium later takes a free number instead of
// renumbering everything above it, and every comparison in this file stays a plain numeric one.
// `maxSeverity` is therefore an ordinary `>` and not a hand-written precedence table.
//
// ── THE MOST SEVERE STATE RENDERS CALMEST, AND THAT IS NOT A STYLE NOTE ───────────────────
//
// `blocked` is the top of the ladder and it maps to `quiet` — grey — not to red. DESIGN §2.3:
// "`Blocked` — the most severe — renders grey (neutral1 on surface3), not red." The reason is the
// same one `note-lifecycle.ts:38-44` records for an expired proof: red is spent once, on what
// cannot be undone, and a state the user reaches by pressing a button they were not allowed to
// press is not that. `ChipStatus` is NOT reused here even though it also carries `quiet`: it has a
// `settled` member that means nothing about a privacy claim, and this enum has an `irreversible`
// one that a note chip must never take.
//

/**
 * The five levels, gap-numbered, as DESIGN §2.3 writes them.
 *
 * The numbers are the whole point — they are what makes `maxSeverity` a comparison rather than a
 * lookup table, and what lets a sixth level be inserted without touching the five that exist.
 */
export const PRIVACY_SEVERITY = {
  none: 0,
  low: 1,
  medium: 5,
  high: 10,
  blocked: 11,
} as const

export type PrivacySeverity = keyof typeof PRIVACY_SEVERITY

/**
 * The semantic family a severity paints in. Four, closed.
 *
 * `quiet` is deliberately not a colour, for `note-lifecycle.ts`'s reason. `neutral` is the ordinary
 * case and it is the one most claims take: DESIGN §2.3's severity discipline is "five levels, only
 * two ever coloured", so anything routine renders in the text ladder and spends nothing.
 */
export type PrivacyColor = 'neutral' | 'exposed' | 'irreversible' | 'quiet'

/**
 * THE ONE MAPPING. DESIGN §7.5: "Panel severity = max severity of its lines via one
 * `getPrivacyColor()` so two shades of 'bad' never coexist."
 *
 * Written as an exhaustive record rather than a `switch` so a sixth level added to the ladder is a
 * compile error here instead of a silent fall-through to whatever the `default` branch happened to
 * return. That is the shape `note-lifecycle.ts` uses for the same reason.
 */
const COLOR: Readonly<Record<PrivacySeverity, PrivacyColor>> = {
  none: 'neutral',
  low: 'neutral',
  medium: 'exposed',
  high: 'irreversible',
  // NOT RED. See the file header — this is the ruling, not an oversight.
  blocked: 'quiet',
}

export function getPrivacyColor(level: PrivacySeverity): PrivacyColor {
  return COLOR[level]
}

/**
 * A level's rank, REFUSING one the ladder does not name.
 *
 * ── THE HOLE THIS CLOSES, AND IT IS THE WORST SHAPE A GUARD CAN HAVE ──────────────────────
 *
 * Every comparison in this module used to be a bare `PRIVACY_SEVERITY[level] > …`. For a level
 * nobody declared that indexes to `undefined`, and EVERY comparison with `undefined` is `false` —
 * so an unknown severity did not throw, did not fail a check, and did not win a `max`. It was
 * silently treated as the calmest possible value by every consumer at once: `maxSeverity` skipped
 * it, so a panel carrying one rendered neutral; `contradicts` reported it honest, so the one input
 * that reaches that guard from outside the compiler was the one input it waved through.
 *
 * The ladder is closed. A level that is not on it is a bug in the caller, and the honest answer is
 * to say so rather than to answer "calm".
 */
export function severityRank(level: PrivacySeverity): number {
  const rank = PRIVACY_SEVERITY[level]
  if (typeof rank !== 'number') {
    throw new Error(
      `unknown privacy severity \`${String(level)}\`: the ladder is closed (${Object.keys(
        PRIVACY_SEVERITY,
      ).join(', ')}). Comparing against a level nobody declared yields \`false\` every time, which ` +
        'reports it as the calmest value on the scale.',
    )
  }
  return rank
}

/**
 * The loudest level in a set, or `none` for an empty one.
 *
 * EMPTY IS `none`, NOT A THROW. A panel with no lines is a real state — a surface that has nothing
 * to disclose renders the matrix and no claims — and `Math.max()` over nothing is `-Infinity`,
 * which would resolve to no level at all and crash the colour lookup one call later.
 *
 * AN UNKNOWN MEMBER IS A THROW, which is the opposite case and the opposite answer: an empty set is
 * a fact about the panel, and a level nobody declared is a fact about the code.
 */
export function maxSeverity(levels: readonly PrivacySeverity[]): PrivacySeverity {
  let worst: PrivacySeverity = 'none'
  for (const level of levels) {
    if (severityRank(level) > severityRank(worst)) worst = level
  }
  return worst
}
