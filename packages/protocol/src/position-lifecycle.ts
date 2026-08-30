//
// One reading of "where is this position in its life", for every venue.
//
// Markets, Launch and Houses each answer a different question and return a different action union,
// so each surface grew its own spelling of the same three facts — is there a door open, is it
// waiting on something, is it over. Three spellings is how one position comes to read two ways on
// two screens. This is the single map, and it is a leaf: it imports the action types and nothing
// else, so a cross-venue list can use it without pulling three venues' reads.
//
// ACCENT SCARCITY. Only `ready` is an accent tone. A list where everything is coloured says nothing
// — the point of the colour is that a row you can act on is rare enough to find at a glance.
//
import type { GovernancePositionAction, LaunchPositionAction, MarketPositionAction } from './position-actions.js'

export type AnyPositionAction = MarketPositionAction | LaunchPositionAction | GovernancePositionAction

/** `ready` is actionable now; `waiting` is on someone else's clock; `settled` is over. */
export type PositionTone = 'ready' | 'waiting' | 'settled'

export interface PositionLifecycle {
  readonly tone: PositionTone
  /** A chip word. Never a sentence — the sentence is `detail`. */
  readonly label: string
  /** The standing explanation, when the action carries one. */
  readonly detail: string | null
  /** What the open door pays, when it pays. */
  readonly amount: bigint | null
}

const READY: Record<string, string> = {
  claim: 'Claim',
  cashout: 'Sell back',
  redeem: 'Redeem',
  refund: 'Refund',
  reclaim: 'Reclaim',
  revoke: 'Revoke',
}

/**
 * A position's lifecycle, from whichever venue's action describes it.
 *
 * `null` means the chain has not answered yet, which is deliberately NOT `settled` — an unread
 * position rendered as finished is the one mistake here that loses money, because the row that
 * would have offered a claim silently stops offering it.
 */
export function positionLifecycle(action: AnyPositionAction | null): PositionLifecycle {
  if (action === null) return { tone: 'waiting', label: 'Reading', detail: null, amount: null }
  const ready = READY[action.kind]
  if (ready !== undefined && 'amount' in action) {
    return { tone: 'ready', label: ready, detail: null, amount: action.amount }
  }
  switch (action.kind) {
    case 'waiting':
      return { tone: 'waiting', label: 'Waiting', detail: action.because, amount: null }
    case 'blocked':
      return { tone: 'waiting', label: 'Locked', detail: action.because, amount: null }
    case 'lost':
      return { tone: 'settled', label: 'Lost', detail: 'This ticket lost. There is no payout to claim.', amount: null }
    case 'complete':
      return { tone: 'settled', label: 'Settled', detail: 'Already settled on chain.', amount: null }
    default:
      // A door kind with no amount: readable, but nothing to offer.
      return { tone: 'waiting', label: 'Waiting', detail: null, amount: null }
  }
}

/** Ready first, then what is still running, then what is over — the order you want to read them in. */
export const TONE_ORDER: readonly PositionTone[] = ['ready', 'waiting', 'settled']

export const TONE_HEADING: Record<PositionTone, string> = {
  ready: 'Ready to settle',
  waiting: 'Still running',
  settled: 'Finished',
}
