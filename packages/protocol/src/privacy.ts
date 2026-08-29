//
// The privacy severity spine: one vocabulary for "how loud is this claim", as data. A leaf that
// imports nothing, so a component can ask without pulling a chain client into the browser.
//
// The ladder is gap-numbered (`None=0, Low=1, Medium=5, High=10, Blocked=11`) so a level inserted
// later takes a free number and every comparison stays a plain numeric one. `blocked` — the most
// severe — renders GREY, not red: red is spent once, on what cannot be undone, and a state the user
// reaches by pressing a button they were not allowed to press is not that.
//

export const PRIVACY_SEVERITY = {
  none: 0,
  low: 1,
  medium: 5,
  high: 10,
  blocked: 11,
} as const

export type PrivacySeverity = keyof typeof PRIVACY_SEVERITY

/** The semantic family a severity paints in. `quiet` is deliberately not a colour; `neutral` spends nothing. */
export type PrivacyColor = 'neutral' | 'exposed' | 'irreversible' | 'quiet'

// An exhaustive record rather than a `switch`, so a sixth level is a compile error here.
const COLOR: Readonly<Record<PrivacySeverity, PrivacyColor>> = {
  none: 'neutral',
  low: 'neutral',
  medium: 'exposed',
  high: 'irreversible',
  blocked: 'quiet',
}

/** THE ONE MAPPING: panel severity = max severity of its lines, so two shades of "bad" never coexist. */
export function getPrivacyColor(level: PrivacySeverity): PrivacyColor {
  return COLOR[level]
}

/**
 * A level's rank, REFUSING one the ladder does not name. A bare `PRIVACY_SEVERITY[level]` indexes
 * `undefined` for an undeclared level, and every comparison with `undefined` is `false` — which
 * silently treated it as the calmest value on the scale.
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

/** The loudest level in a set. Empty is `none` (a panel with no lines is a real state); an unknown member throws. */
export function maxSeverity(levels: readonly PrivacySeverity[]): PrivacySeverity {
  let worst: PrivacySeverity = 'none'
  for (const level of levels) {
    if (severityRank(level) > severityRank(worst)) worst = level
  }
  return worst
}
