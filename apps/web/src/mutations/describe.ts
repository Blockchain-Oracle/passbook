import type { SendFailure, SendKind, SendResult } from '@strk20/protocol/send'
import type { ShieldFailure } from '@strk20/protocol/shield'

// One sentence per failure kind. Arms that already carry authored copy (`notice`, `door.message`)
// are used verbatim — a second sentence for the same fact is a second sentence to keep in step.

// A thrown RPC error arrives as `String(e)`: the method name, then the ENTIRE signed transaction
// echoed back as `with params {…}` — hundreds of felts of calldata. Toasting that raw was showing
// people a wall of hex instead of a reason. Nothing below invents a cause; it names the ones the
// sequencer states in words, and otherwise says less rather than dumping the payload.

/** The sequencer's own phrasings for "this account cannot pay", across node implementations. */
const CANNOT_PAY =
  /balance is smaller|smaller than.*fee|exceed.*balance|insufficient.*(balance|funds)|max.*fee.*(exceed|too low)|InsufficientAccountBalance|InsufficientResourcesForValidate/i

/**
 * `refused` marks a rejection the sequencer made BEFORE execution — the transaction never entered a
 * block, so no gas was charged for it. That distinction decides whether the caller may append
 * `SELF_SUBMIT_GAS_LOSS`; telling someone they paid gas for a transaction that never ran is a lie
 * about their money, and it is the exact case a short balance produces.
 */
function sequencerReason(raw: string): { sentence: string; refused: boolean } {
  // The params blob is the payload we were signing, never the reason. Drop it — along with the
  // `RpcError: RPC: <method>` prefix, which is our call, not the node's explanation — before
  // matching, so neither can be mistaken for a cause.
  const text = raw
    .replace(/\s*with params[\s\S]*/i, '')
    .replace(/^\s*\w*Error:\s*RPC:\s*\S+/i, '')
    .trim()
  if (CANNOT_PAY.test(raw)) {
    return {
      sentence:
        'This address does not hold enough public STRK to cover the pool fee and the gas the network reserves for a proven transaction. Nothing was submitted.',
      refused: true,
    }
  }
  if (/nonce/i.test(text)) {
    return { sentence: 'The account nonce moved — another transaction from this address is still settling. Wait for it to land, then try again.', refused: true }
  }
  if (/validate|signature/i.test(text)) {
    return { sentence: 'The account refused to sign this transaction. Nothing was submitted.', refused: true }
  }
  // Unrecognised: one clause of the node's own words, never the calldata. Whether it ran is unknown,
  // so `refused` stays false and the caller keeps its own gas sentence.
  const clause = text.split(/[:\n]/).map((s) => s.trim()).filter(Boolean).pop() ?? ''
  const short = clause.length > 160 ? `${clause.slice(0, 157)}…` : clause
  return { sentence: short ? `The network refused the transaction: ${short}` : 'The network refused the transaction, without saying why.', refused: false }
}

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
    case 'self-submit-failed': {
      // The one arm that carries a raw sequencer throw. `gasLine` is authored copy, but it only
      // holds when the transaction actually ran — a pre-execution refusal costs nothing.
      const { sentence, refused } = sequencerReason(failure.reason)
      return refused ? sentence : `${sentence} ${failure.gasLine}`.trim()
    }
    default: {
      // Sanitised, not raw: any kind that carries a `reason` gets it cleaned, so a new failure
      // kind added later cannot reintroduce the calldata dump this function exists to prevent.
      const reason = (failure as { reason?: string }).reason
      return reason ? sequencerReason(reason).sentence : `The send stopped at \`${failure.kind}\`.`
    }
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
    case 'gov-join': return 'Join DAO'
    case 'gov-delegate': return 'Delegate DAO vote'
    case 'gov-fund': return `Fund DAO with ${symbol}`
    case 'gov-reclaim': return 'Reclaim DAO escrow'
    case 'gov-revoke': return 'Revoke DAO delegation'
  }
}

export function failureTransactionHash(failure: { kind: string; transactionHash?: string }): string | null {
  return typeof failure.transactionHash === 'string' && failure.transactionHash.trim() ? failure.transactionHash : null
}

/**
 * The transaction a result can name, whichever way it went.
 *
 * A REFUSAL HAS ONE TOO, and that is the case this exists for: `confirmation-unknown` means the
 * transaction may have landed, and the hash is the only thing that settles it. Notifications used
 * to format a sentence and drop the hash, so the one fact worth checking was the one fact thrown
 * away.
 */
export function sendTransactionHash(result: SendResult): string | null {
  return result.ok ? result.transactionHash : failureTransactionHash(result.failure)
}
