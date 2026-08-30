//
// One reading of "where is this proposal in its life", so a row never spells it two ways.
//
// The row used to put the COUNTDOWN inside the state badge — `closes in 2d 4h` where a state word
// belongs — so the two facts a proposal has (what it is, and when it decides) shared one slot and
// neither read clearly. They are separate here, the way `position-lifecycle.ts` separates a
// position's tone from its clock.
//
// ACCENT SCARCITY. `open` is the only tone that carries the brand colour: it is the only state you
// can do anything about. A board where every row is coloured has told you nothing.
//
// NOT A LEAF, deliberately: it needs `OnChainProposal` and `timeLeft`, and every surface that
// renders a proposal already loads both. A third copy of "is this still open" is the cost of
// avoiding that import, and it is a worse cost.
//
import { timeLeft } from './app-reads.js'
import { PROPOSAL_STATE, type OnChainProposal } from './governance-reads.js'

export type ProposalTone = 'open' | 'counting' | 'passed' | 'refused' | 'voided'

/**
 * The one timing line. `live` is a running clock; everything else is a moment that has passed, and
 * the caller formats the date because a locale is not the protocol's business.
 */
export type ProposalTiming =
  | { readonly live: true; readonly text: string }
  | { readonly live: false; readonly label: string; readonly at: number }

export interface ProposalLifecycle {
  readonly tone: ProposalTone
  /** A chip word. Never a sentence — the sentence is `detail`. */
  readonly label: string
  /** The standing explanation, when the state has one. */
  readonly detail: string | null
  /** Never invented: `null` when this state has no clock anyone can read. */
  readonly timing: ProposalTiming | null
}

const DETAIL = {
  counting: 'The box is closed. The Teller publishes when the sums verify.',
  passed: 'The chain accepted this tally — a wrong one is unpublishable.',
  refused: 'The chain accepted this tally. It did not reach the bar.',
  voided: 'Voided — every escrow reopens. No vote can strand tokens.',
} as const

export function proposalLifecycle(proposal: OnChainProposal, nowMs: number): ProposalLifecycle {
  const closedAt = proposal.deadline * 1000

  if (proposal.state === PROPOSAL_STATE.active) {
    // Past its deadline but not yet tallied is its own state, and the row used to render it as if
    // voting were still open — the one reading here that could cost somebody a ballot.
    if (closedAt <= nowMs) {
      return { tone: 'counting', label: 'Counting', detail: DETAIL.counting, timing: { live: false, label: 'Closed', at: closedAt } }
    }
    return { tone: 'open', label: 'Open', detail: null, timing: { live: true, text: `closes in ${timeLeft(proposal.deadline, nowMs)}` } }
  }

  const closed = { live: false as const, label: 'Closed', at: closedAt }
  switch (proposal.state) {
    case PROPOSAL_STATE.succeeded:
      return { tone: 'passed', label: 'Passed', detail: DETAIL.passed, timing: closed }
    case PROPOSAL_STATE.executed:
      return { tone: 'passed', label: 'Executed', detail: DETAIL.passed, timing: closed }
    case PROPOSAL_STATE.defeated:
      return { tone: 'refused', label: 'Defeated', detail: DETAIL.refused, timing: closed }
    case PROPOSAL_STATE.voided:
      return { tone: 'voided', label: 'Voided', detail: DETAIL.voided, timing: { live: false, label: 'Voided', at: closedAt } }
    default:
      // `none` — a proposal id the chain does not know. It has no clock, so it is given none.
      return { tone: 'counting', label: 'Unknown', detail: null, timing: null }
  }
}

/** Open first: the only rows anybody can act on lead the list. */
export const PROPOSAL_TONE_ORDER: readonly ProposalTone[] = ['open', 'counting', 'passed', 'refused', 'voided']
