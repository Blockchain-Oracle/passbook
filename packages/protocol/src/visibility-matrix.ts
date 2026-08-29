//
// The visibility matrix: columns You / Relayer / Everyone / Auditor, rows amount / sender /
// recipient / timing / IP.
//
// One table, three consumers (the `<Disclosure>` panel, the receipt, and the docs), and no fourth
// place where a privacy claim can be typed. The cells live in `visibility-matrix-data.ts`; this
// file is the axes, the cell vocabulary, and how a cell reaches a reader.
//

import {
  MATRICES,
  type AuthoredMatrix,
  type VisibilityContext,
  type VisibilityMatrix,
} from './visibility-matrix-data.js'

export * from './visibility-matrix-data.js'

// ── The two axes, ordered ─────────────────────────────────────────────────────────────────

/** The four columns. ORDER IS PART OF THE CONTRACT — every renderer iterates it. */
export const VISIBILITY_ACTORS = ['you', 'relayer', 'everyone', 'auditor'] as const

export type VisibilityActor = (typeof VISIBILITY_ACTORS)[number]

/** The five rows. Same contract as the columns. */
export const VISIBILITY_FACTS = ['amount', 'sender', 'recipient', 'timing', 'ip'] as const

export type VisibilityFact = (typeof VISIBILITY_FACTS)[number]

export const ACTOR_LABELS = {
  you: 'You',
  relayer: 'Relayer',
  everyone: 'Everyone',
  auditor: 'Auditor',
} as const satisfies Record<VisibilityActor, string>

export const FACT_LABELS = {
  amount: 'Amount',
  sender: 'Sender',
  recipient: 'Recipient',
  timing: 'Timing',
  ip: 'Network address',
} as const satisfies Record<VisibilityFact, string>

// ── One cell ──────────────────────────────────────────────────────────────────────────────

/**
 * What one party can learn about one fact. Four states: "nothing here" (`absent`) and "something
 * here and it is hidden" are opposite claims, and `conditional` cannot be spelled without its note.
 */
export type VisibilityCell =
  | { readonly state: 'sees' }
  | { readonly state: 'hidden' }
  | { readonly state: 'conditional'; readonly note: string }
  | { readonly state: 'absent' }

export type VisibilityCellState = VisibilityCell['state']

/** The word each state carries — a channel for assistive technology, not a tooltip. */
export const CELL_LABEL = {
  sees: 'Sees',
  hidden: 'Hidden',
  conditional: 'Conditional',
  absent: 'Not applicable',
} as const satisfies Record<VisibilityCellState, string>

// ── Lookup ────────────────────────────────────────────────────────────────────────────────

/** The matrix for one context. NEVER `undefined` — the `satisfies` on `MATRICES` guarantees it. */
export function matrixFor(context: VisibilityContext): VisibilityMatrix {
  return MATRICES[context]
}

// ── How a cell reaches a reader ───────────────────────────────────────────────────────────

/** What a cell says out loud — the word, plus the qualifier when it has one. Never drop the note. */
export function cellAnnouncement(cell: VisibilityCell): string {
  const word = CELL_LABEL[cell.state]
  return cell.state === 'conditional' ? `${word} — ${cell.note}` : word
}

/** Every distinct qualifier in a matrix, in row-then-column order. ONE numbering for every renderer. */
export function matrixNotes(matrix: AuthoredMatrix): readonly string[] {
  const notes: string[] = []
  for (const fact of VISIBILITY_FACTS) {
    for (const actor of VISIBILITY_ACTORS) {
      const cell = matrix.cells[fact][actor]
      if (cell.state === 'conditional' && !notes.includes(cell.note)) notes.push(cell.note)
    }
  }
  return notes
}

/** The 1-based footnote number for a qualifier, or `null` when the cell carries none. */
export function noteNumber(notes: readonly string[], cell: VisibilityCell): number | null {
  if (cell.state !== 'conditional') return null
  const at = notes.indexOf(cell.note)
  return at < 0 ? null : at + 1
}
