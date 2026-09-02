// What a finished bet says about itself. A chip word per ending, never a sentence in a chip.
import type { MarketReceipt, TerminalKind } from '@strk20/protocol/position-history'

export const FINISHED_TITLE = 'Finished'
export const FINISHED_BODY = 'Every Markets bet that reached the chain, kept after it settled — with the transactions that opened and closed it.'
export const FINISHED_EMPTY = 'No finished bets yet. A bet lands here once it is claimed, sold back, lost or refunded.'
export const HISTORY_CORRUPT = 'This browser’s position history could not be read, so it is not shown. Nothing claimable lives in it.'
export const HISTORY_LOCKED = 'Unlock to see finished bets.'

export const OUTCOME_LABEL: Record<TerminalKind | 'reverted', string> = {
  claimed: 'Won',
  residual: 'Residual',
  refunded: 'Refunded',
  'cashed-out': 'Sold back',
  lost: 'Lost',
  'spent-elsewhere': 'Settled elsewhere',
  reverted: 'Reverted',
}

export const OUTCOME_DETAIL: Record<TerminalKind | 'reverted', string> = {
  claimed: 'The payout matured into your shielded balance as a fresh note.',
  residual: 'The seed’s residual matured into your shielded balance as a fresh note.',
  refunded: 'The market was voided and the stake came back as a fresh note.',
  'cashed-out': 'Sold back to the market before the deadline.',
  lost: 'This ticket lost. There is no payout to claim.',
  'spent-elsewhere': 'The chain shows this position claimed, but not from this browser.',
  reverted: 'The chain refused the bet. Nothing was placed and nothing was spent.',
}

export const OPENING_UNKNOWN = 'The bet was sent but the chain has not confirmed it yet.'
export const CLEAR_ACTION = 'Clear from history'
export const CLEAR_BODY = 'Removes this receipt, and the retired claim secret with it. The transactions stay on chain.'
export const SHARE_ACTION = 'Share'
export const SHARE_UNAVAILABLE = 'Share opens once the chain has confirmed both ends of this bet.'

/** The ending this receipt shows, or `null` while it is still open. */
export function outcomeOf(r: MarketReceipt): TerminalKind | 'reverted' | null {
  if (r.opening.state === 'reverted') return 'reverted'
  return r.terminal?.kind ?? null
}

/** Only a story the chain has told both ends of, with a snapshot to describe it, can be shared. */
export function shareable(r: MarketReceipt): boolean {
  if (r.contract === null || r.snapshot === null) return false
  if (r.opening.state !== 'landed' || r.opening.txHash === null) return false
  if (r.terminal === null) return true
  return r.terminal.kind === 'lost' || r.terminal.txHash !== null
}
