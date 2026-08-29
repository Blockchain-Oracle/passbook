import type { SendFailure, SendKind } from '@strk20/protocol/send'
import type { ShieldFailure } from '@strk20/protocol/shield'

// One sentence per failure kind. Arms that already carry authored copy (`notice`, `door.message`)
// are used verbatim — a second sentence for the same fact is a second sentence to keep in step.

export function describeSendFailure(failure: SendFailure): string {
  switch (failure.kind) {
    case 'unregistered-recipient':
      return failure.door.message
    case 'insufficient-balance':
    case 'insufficient-fee-balance':
      return failure.notice
    case 'bad-input':
      return failure.reason
    case 'blocked-rpc-unknown':
      return `The chain could not be read, so nothing was sent: ${failure.reason}`
    case 'lock-unavailable':
      return 'Another strk20.run tab holds the right to sign. Press "Use this tab" in the banner above, or close the other tab, then try again.'
    case 'pool-paused':
      return 'The pool is paused, so nothing can move right now. Nothing was spent.'
    case 'pool-upgraded':
      return 'The pool contract changed since this app was built, so nothing was submitted.'
    default:
      return (failure as { reason?: string }).reason ?? `The send stopped at \`${failure.kind}\`.`
  }
}

export function describeShieldFailure(failure: ShieldFailure): string {
  switch (failure.kind) {
    case 'bad-input':
    case 'blocked-rpc-unknown':
    case 'prover-failed':
    case 'submit-failed':
    case 'confirmation-unknown':
      // The pipeline's own sentence: it may have landed. Never "your funds are untouched".
      return failure.reason
    case 'pool-paused':
      return 'The shielded pool is paused, so nothing was submitted.'
    case 'pool-upgraded':
      return 'The pool class changed. This build will not prove against an unverified contract.'
    case 'insufficient-public-token':
      return `Not enough public ${failure.symbol} at the embedded strk20.run address.`
    case 'insufficient-public-strk':
      return 'Not enough public STRK at the embedded strk20.run address for the pool fee.'
    case 'proof-expired':
      return 'The proof expired before submission. Refresh the balances and try again.'
    case 'reverted':
      return `The shield transaction reverted: ${failure.message}`
  }
}

export function describeRegisterFailure(failure: { kind: string; reason?: string }): string {
  switch (failure.kind) {
    case 'backup-not-confirmed':
      return 'The recovery file has not been saved yet, so registration is still closed.'
    case 'already-registered':
      return 'This account is already registered with the pool. Nothing was submitted.'
    case 'collision':
      return 'The pool already holds a different viewing key for this address, and it cannot be replaced.'
    case 'blocked-rpc-unknown':
      return `The chain could not be read, so nothing was submitted: ${failure.reason ?? 'no reason given'}`
    case 'bad-input':
      return `Registration was refused before anything was spent: ${failure.reason ?? 'no reason given'}`
    default:
      return failure.reason ?? `Registration stopped at \`${failure.kind}\`.`
  }
}

export function labelFor(kind: SendKind, symbol: string): string {
  switch (kind) {
    case 'transfer': return `Send ${symbol}`
    case 'withdraw': return `Withdraw ${symbol}`
    case 'swap': return `Swap ${symbol}`
    case 'bridge': return `Bridge ${symbol}`
    case 'market-create': return 'Create market'
    case 'market-bet': return `Place ${symbol} bet`
    case 'market-claim': return 'Claim market winnings'
    case 'market-cashout': return 'Cash out market position'
    case 'launch-buy': return `Buy launch with ${symbol}`
    case 'launch-redeem': return 'Redeem launch position'
    case 'launch-refund': return 'Refund launch position'
    case 'gov-ballot': return 'Cast sealed ballot'
    case 'gov-join': return 'Join House'
    case 'gov-delegate': return 'Delegate House vote'
    case 'gov-fund': return `Fund House with ${symbol}`
    case 'gov-reclaim': return 'Reclaim House escrow'
    case 'gov-revoke': return 'Revoke House delegation'
  }
}

export function failureTransactionHash(failure: { kind: string; transactionHash?: string }): string | null {
  return typeof failure.transactionHash === 'string' && failure.transactionHash.trim() ? failure.transactionHash : null
}
