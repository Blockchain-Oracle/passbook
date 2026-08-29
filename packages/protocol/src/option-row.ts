//
// One row anatomy, for every list in the app. Tokens, notes, contacts, markets, launches and
// routes are picked from a list in exactly the same way; `image | title (+suffix, +badge) |
// subtitle | tag | right` covers all of them, and the ones that do not need a slot leave it empty.
//

import type { Valued } from './amount.js'
import type { ChipStatus } from './note-lifecycle.js'

/**
 * One row, as plain data. Nothing here is a React node: a row model that can hold markup is a row
 * model that can be filtered wrongly. `image` is a source; `right` is a value with its confidence.
 */
export interface OptionRow {
  readonly id: string
  /** A real asset source. Absent means the slot collapses — never a generated placeholder glyph. */
  readonly image?: string
  readonly title: string
  /** Trails the title at the same size — a token's name beside its symbol, say. */
  readonly titleSuffix?: string
  /**
   * The badge slot. A note's lifecycle chip lives here with its status AND its `notYetReal` flag:
   * the shape of `LifecycleChip` and the shape of this slot have to match or the rule is
   * unenforceable.
   */
  readonly badge?: { readonly label: string; readonly status: ChipStatus; readonly notYetReal?: boolean }
  readonly subtitle?: string
  /** True when the subtitle is a hash or an address and must render in the mono face. */
  readonly subtitleIsMono?: boolean
  readonly tag?: string
  /** The right-hand value, carrying its own confidence. */
  readonly right?: Valued<string>
  /** Rendered at 0.5 opacity, skipped by keyboard navigation, still readable. */
  readonly disabled?: boolean
}

/** Turns a lifecycle chip into a badge, carrying every channel it encodes — written once so `notYetReal` is never dropped. */
export function badgeFromChip(chip: {
  label: string
  status: ChipStatus
  notYetReal: boolean
}): NonNullable<OptionRow['badge']> {
  return { label: chip.label, status: chip.status, notYetReal: chip.notYetReal }
}
