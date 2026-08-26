//
// The note lifecycle, as one closed state machine with its copy attached (story 6.4, DESIGN §7.2/§7.9).
//
// A note is not a balance. It is a specific commitment with a specific position in a pipeline, and
// the six positions below are the whole of it. They render as the §7.9 chip — 1px border in the
// status solid, status tint behind, and the LABEL ALWAYS AT FULL TEXT CONTRAST, never in the status
// colour, which is what makes the recipe pass contrast in both themes for free.
//
// ── WHY THE LABEL AND THE COLOUR COME OUT OF ONE TABLE ────────────────────────────────────
//
// They are one fact about the note. Split across a `switch` in a component and a class map in a
// stylesheet, the two drift the first time a state is added — and the drift is silent, because a
// chip with the wrong tint still renders. One entry per state, one place to edit.
//
// ── WHY EVERY STATE CARRIES A NEXT ACTION ─────────────────────────────────────────────────
//
// A status word on its own makes the reader do the work of deciding what it means for them.
// `expiring` is only alarming if you know a proof can be regenerated; `spent` is only calm if you
// know the row is kept deliberately rather than left behind. Each sentence says what to do, or says
// plainly that there is nothing to do — which is itself an answer.
//
// SIX STATES, NOT SEVEN. The design authority and the epic both list exactly these six. A seventh
// is an invention and needs a human, not a guess.
//

/** The whole lifecycle, in order. A seventh member is a decision, not a change. */
export const NOTE_LIFECYCLE_STATES = [
  'pending-proof',
  'maturing',
  'spendable',
  'spent',
  'expiring',
  'expired',
] as const

export type NoteLifecycle = (typeof NOTE_LIFECYCLE_STATES)[number]

/**
 * Which semantic family the chip paints in.
 *
 * `quiet` is deliberately not a colour. The most severe state renders calmest (§7.9) — an expired
 * proof is an administrative stop, not a danger, and painting it red would spend the one colour
 * this product reserves for the genuinely irreversible on something a user can simply redo.
 */
export type ChipStatus = 'neutral' | 'settled' | 'exposed' | 'quiet'

export interface LifecycleChip {
  label: string
  status: ChipStatus
  /** One sentence. What to do, or that there is nothing to do. */
  nextAction: string
  /**
   * Whether this state is "not yet real" and must carry the dotted underline (`tokens.yaml`
   * `notYetReal`). Grey alone may never be the sole carrier of that meaning — `neutral3` measures
   * 2.12–2.18:1 on light surfaces and cannot be fixed without collapsing the text ladder.
   */
  notYetReal: boolean
}

/** How far a maturing note has come. Blocks are COUNTED, never expressed as a percentage. */
export interface MaturationProgress {
  confirmed: number
  required: number
}

const TABLE: Readonly<Record<NoteLifecycle, LifecycleChip>> = {
  'pending-proof': {
    label: 'Pending proof',
    status: 'neutral',
    nextAction: 'Nothing to do — the proof is still being built.',
    notYetReal: true,
  },
  maturing: {
    label: 'Maturing',
    status: 'neutral',
    nextAction: 'This note can be spent once enough blocks have confirmed it.',
    notYetReal: true,
  },
  spendable: {
    label: 'Spendable',
    status: 'settled',
    nextAction: 'Ready to spend.',
    notYetReal: false,
  },
  spent: {
    label: 'Spent',
    status: 'quiet',
    // History is never rewritten (EXPERIENCE): a spent note stays in the list on purpose, and the
    // sentence has to say so or the row reads like a bug.
    nextAction: 'Already spent. Kept here for the record.',
    notYetReal: false,
  },
  expiring: {
    // The ONLY amber state in the set. A proof that is about to lapse is the one moment in the
    // lifecycle where doing nothing costs the user something.
    label: 'Expiring',
    status: 'exposed',
    nextAction: 'Regenerate the proof before it lapses.',
    notYetReal: false,
  },
  expired: {
    label: 'Expired',
    status: 'quiet',
    // "Nothing was charged" is the failure grammar (§7.10): every abort names what did NOT happen,
    // because the reader's first question is always whether it cost them.
    nextAction: 'The proof expired. Start again — nothing was charged.',
    notYetReal: false,
  },
}

/**
 * The chip for a note in `state`.
 *
 * `progress` is only consulted for `maturing`, where it becomes the counter in the label
 * (`Maturing 6/10 blocks`). Absent, the label stays bare rather than inventing a denominator — the
 * maturation depth is a chain read, and a hardcoded one would be exactly the runtime-truth
 * violation this project fails builds over.
 */
export function lifecycleChip(state: NoteLifecycle, progress?: MaturationProgress): LifecycleChip {
  const entry = TABLE[state]
  if (state !== 'maturing' || !progress) return { ...entry }

  const { confirmed, required } = progress
  return {
    ...entry,
    label: `Maturing ${confirmed}/${required} blocks`,
    nextAction: `This note can be spent once ${required} blocks have confirmed it.`,
  }
}
