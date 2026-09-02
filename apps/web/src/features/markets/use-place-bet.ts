// The one `market-bet` send, with the two records written around it. The secret IS the position,
// so it is stored first — a landed bet must never outrun its record. The receipt is written beside
// it and then told what happened: landed with its hash, reverted (and the dead secret retired),
// or unknown, with the hash kept on BOTH records so a later read can settle the question.
import { useMutation } from '@tanstack/react-query'
import type { OnChainMarket } from '@strk20/protocol/app-reads'
import { MARKET_OP, betPayload } from '@strk20/protocol/market-calldata'

import { sendProblem, sendTransactionHash, useSend } from '@/mutations'
import { addStoredPosition, patchStoredPosition, removeStoredPosition } from '@/queries/positions'
import { recordIntent, recordLanded, recordReverted, recordUnknown, removeReceipt } from '@/queries/position-history'

export interface PlaceBetAsk {
  contract: string
  market: OnChainMarket
  side: number
  amount: bigint
  symbol: string
  decimals: number | null
  label: string
  sponsored: boolean
}

export type PlaceBetOutcome = { ok: true; transactionHash: string } | { ok: false; problem: string; hash: string | null }

export function usePlaceBet() {
  const send = useSend()
  const run = useMutation({
    mutationKey: ['markets', 'place-bet'],
    mutationFn: async (ask: PlaceBetAsk): Promise<PlaceBetOutcome> => {
      const { mintPositionSecret } = await import('@strk20/protocol/commitment')
      const minted = mintPositionSecret()
      const payload = betPayload([{ marketId: ask.market.id, side: ask.side, amount: ask.amount, commitment: minted.commitment }])
      if (payload.state === 'refused') return { ok: false, problem: payload.because, hash: null }
      await addStoredPosition({
        venue: 'market',
        kind: 'market-bet',
        id: ask.market.id,
        secret: minted.secret,
        commitment: minted.commitment,
        createdAt: Date.now(),
        label: ask.label,
      })
      await recordIntent({ commitment: minted.commitment, contract: ask.contract, market: ask.market, side: ask.side, cashIn: ask.amount, symbol: ask.symbol, decimals: ask.decimals })
      const result = await send.mutateAsync({
        kind: 'market-bet',
        sponsored: ask.sponsored,
        recipient: ask.contract,
        token: ask.market.token,
        symbol: ask.symbol,
        amount: ask.amount,
        surface: 'markets',
        app: { contract: ask.contract, op: MARKET_OP.bet, calldata: [...payload.calldata], noteIdSlots: [...payload.noteIdSlots], openNoteCount: 0 },
      })
      if (result.ok) {
        await patchStoredPosition(minted.commitment, { txHash: result.transactionHash })
        await recordLanded(minted.commitment, result.transactionHash, result.sendBlock)
        return { ok: true, transactionHash: result.transactionHash }
      }
      const hash = sendTransactionHash(result)
      const problem = sendProblem(result) ?? 'The bet could not be placed.'
      if (result.failure.kind === 'reverted') {
        // The chain said no: nothing is on it, the secret names nothing, the story keeps the verdict.
        await recordReverted(minted.commitment, result.failure.transactionHash)
        await removeStoredPosition(minted.commitment)
        return { ok: false, problem, hash }
      }
      if (result.failure.kind === 'confirmation-unknown' || hash) {
        // It may have landed. Both records keep the hash; the reconciler settles it later.
        if (hash) await patchStoredPosition(minted.commitment, { txHash: hash })
        await recordUnknown(minted.commitment, hash)
        return { ok: false, problem, hash }
      }
      // Nothing reached the chain: the record names a position that never existed.
      await removeStoredPosition(minted.commitment)
      await removeReceipt(minted.commitment)
      return { ok: false, problem, hash }
    },
  })
  return { placeBet: run.mutateAsync, busy: run.isPending || send.isPending }
}
