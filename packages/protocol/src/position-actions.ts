//
// Which terminal door a bearer position may show, decided from chain state rather than labels.
//
// A stored position proves only that this browser holds a secret. It does not prove the position
// is still open or that a payout exists. These functions take the contract reads and return the
// one action currently valid, including the no-action states a record must explain.
//

export type MarketPositionAction =
  | { readonly kind: 'cashout'; readonly amount: bigint }
  | { readonly kind: 'claim'; readonly amount: bigint }
  | { readonly kind: 'lost' }
  | { readonly kind: 'waiting'; readonly because: string }
  | { readonly kind: 'complete' }

export function marketPositionAction(input: {
  positionOpen: boolean
  marketState: 'active' | 'resolved' | 'voided'
  beforeDeadline: boolean
  cashoutQuote: bigint
  claimPreview: bigint
}): MarketPositionAction {
  if (!input.positionOpen) return { kind: 'complete' }
  if (input.marketState === 'active') {
    if (!input.beforeDeadline) {
      return { kind: 'waiting', because: 'The market is closed and waiting for settlement.' }
    }
    return input.cashoutQuote > 0n
      ? { kind: 'cashout', amount: input.cashoutQuote }
      : { kind: 'waiting', because: 'This position cannot be sold back.' }
  }
  if (input.claimPreview > 0n) return { kind: 'claim', amount: input.claimPreview }
  return input.marketState === 'resolved'
    ? { kind: 'lost' }
    : { kind: 'waiting', because: 'The void refund could not be read.' }
}

export type LaunchPositionAction =
  | { readonly kind: 'redeem'; readonly amount: bigint }
  | { readonly kind: 'refund'; readonly amount: bigint }
  | { readonly kind: 'waiting'; readonly because: string }
  | { readonly kind: 'complete' }

export function launchPositionAction(input: {
  positionOpen: boolean
  launchState: 'active' | 'graduated' | 'failed'
  deadlinePassed: boolean
  redeemPreview: bigint
  refundPreview: bigint
}): LaunchPositionAction {
  if (!input.positionOpen) return { kind: 'complete' }
  if (input.launchState === 'graduated') {
    return input.redeemPreview > 0n
      ? { kind: 'redeem', amount: input.redeemPreview }
      : { kind: 'waiting', because: 'The token payout could not be read.' }
  }
  if (input.launchState === 'failed' || input.deadlinePassed) {
    return input.refundPreview > 0n
      ? { kind: 'refund', amount: input.refundPreview }
      : { kind: 'waiting', because: 'The refund could not be read.' }
  }
  return { kind: 'waiting', because: 'This purchase settles when the launch graduates or fails.' }
}

export type GovernancePositionAction =
  | { readonly kind: 'reclaim' | 'revoke'; readonly amount: bigint }
  | { readonly kind: 'blocked'; readonly because: string }
  | { readonly kind: 'waiting'; readonly because: string }
  | { readonly kind: 'complete' }

export function governancePositionAction(input: {
  escrowOpen: boolean
  kind: 'ballot' | 'delegation'
  amount: bigint
  proposalActive: boolean
  writesEnabled: boolean
  writeBlocker?: string
}): GovernancePositionAction {
  if (!input.escrowOpen) return { kind: 'complete' }
  if (!input.writesEnabled) {
    return { kind: 'blocked', because: input.writeBlocker ?? 'Governance writes are disabled.' }
  }
  if (input.kind === 'delegation') return { kind: 'revoke', amount: input.amount }
  if (input.proposalActive) {
    return { kind: 'waiting', because: 'Ballot escrow stays locked while the proposal is active.' }
  }
  return { kind: 'reclaim', amount: input.amount }
}
