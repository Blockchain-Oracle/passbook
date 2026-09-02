// Checking a shared position against the chain: the named opening transaction must have
// succeeded and carry a `BetPlaced` from the named contract with the named commitment; a named
// closing transaction must carry the matching `Claimed`/`CashedOut`. Matching evidence proves
// the bet happened — never who placed it. A read that fails is `unavailable`, not a verdict.
import { queryOptions } from '@tanstack/react-query'
import { defaultTransport } from '@strk20/protocol/app-reads'
import * as events from '@strk20/protocol/market-events'
import type { PositionShare } from '@strk20/protocol/position-share'

export type ShareVerdict = 'verified' | 'mismatch' | 'unavailable'

const VERIFY_MS = 5 * 60_000

export function shareVerifyQuery(share: PositionShare) {
  return queryOptions({
    queryKey: ['share', 'verify', share.contract, share.commitment, share.openingTxHash, share.terminal?.txHash ?? null],
    queryFn: () => verify(share),
    staleTime: VERIFY_MS,
    retry: 1,
  })
}

async function verify(share: PositionShare): Promise<ShareVerdict> {
  let opening: unknown
  try {
    opening = await defaultTransport('starknet_getTransactionReceipt', [share.openingTxHash])
  } catch {
    return 'unavailable'
  }
  if (events.receiptOutcome(opening) !== 'succeeded') return 'mismatch'
  const placed = events
    .receiptEvents(opening)
    .map((e) => events.decodeBetPlaced(e, share.contract))
    .find((bet) => bet !== null && events.sameFelt(bet.commitment, share.commitment) && bet.marketId === share.marketId && bet.side === share.side)
  if (!placed || BigInt(placed.amount) !== BigInt(share.cashIn)) return 'mismatch'
  if (!share.terminal?.txHash) return 'verified'
  let closing: unknown
  try {
    closing = await defaultTransport('starknet_getTransactionReceipt', [share.terminal.txHash])
  } catch {
    return 'unavailable'
  }
  if (events.receiptOutcome(closing) !== 'succeeded') return 'mismatch'
  const ended = events
    .receiptEvents(closing)
    .map((e) => events.decodeTerminal(e, share.contract, share.commitment))
    .find((t) => t !== null)
  if (!ended) return 'mismatch'
  if (share.terminal.amount !== null && BigInt(ended.amount) !== BigInt(share.terminal.amount)) return 'mismatch'
  return 'verified'
}
