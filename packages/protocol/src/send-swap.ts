//
// Swap: withdraw the sell token to the venue's executor, mint an OPEN note for the buy token,
// and invoke the executor with the route and that note's id. One transaction; the value never
// sits anywhere the user does not control.
//
// The executor (`0x426dcd1a…dbe5e`, ABI read from mainnet) declares exactly one entrypoint,
// `privacy_invoke(buy_token, calls: Span<Call>, note_id)`. The SDK's own swap recipe targets a
// different four-felt executor; `swap-calldata.ts` builds the layout this contract declares.
//

import { Open } from '@starkware-libs/starknet-privacy-sdk'

import { OK, bad, feltOrNull, sameFelt, type SendLeg, type SendRequest, type SwapLeg } from './send-plan.js'
import { invokeCalldata } from './swap-calldata.js'

function validateSwap(request: SendRequest): ReturnType<SendLeg['validate']> {
  const leg = request.swap
  if (!leg) return bad('a swap needs an executor, a buy token and a route, and carried none')
  const executor = feltOrNull(leg.executor)
  if (executor === null) return bad(`the swap executor ${JSON.stringify(leg.executor)} is not a felt address`)
  if (executor === 0n) return bad('the swap executor is address 0, which would burn the sell amount')
  // The withdraw reads `recipient`, the invoke reads `executor`: withdrawing to one contract and
  // instructing another strands the sell amount.
  if (!sameFelt(leg.executor, request.recipient)) {
    return bad(
      `this swap withdraws to ${request.recipient} and invokes ${leg.executor}. Those must be the same ` +
        'contract — withdrawing to one and instructing another strands the sell amount.',
    )
  }
  const buy = feltOrNull(leg.buyToken)
  if (buy === null || buy === 0n) return bad(`the buy token ${JSON.stringify(leg.buyToken)} is not a usable token address`)
  if (sameFelt(leg.buyToken, request.token)) {
    return bad(`this swap sells ${request.symbol} for ${leg.buySymbol}, which does nothing`)
  }
  if (leg.minOutWei <= 0n) return bad(`this swap accepts a minimum of ${leg.minOutWei}, which is no floor at all`)
  // The route is serialised now too, so an unverified entrypoint is refused before any proof.
  const dry = invokeCalldata({ buyToken: leg.buyToken, calls: leg.calls, openNoteId: '0x1' })
  if (dry.state === 'refused') return bad(dry.because)
  return OK
}

/** The executor's calldata, with the open note the compiler just minted. */
export function swapInvokeCalldata(leg: SwapLeg, openNoteId: bigint): string[] {
  const built = invokeCalldata({ buyToken: leg.buyToken, calls: leg.calls, openNoteId: `0x${openNoteId.toString(16)}` })
  if (built.state === 'refused') throw new Error(built.because)
  return [...built.calldata]
}

export const swapLeg: SendLeg = {
  validate: validateSwap,
  compose(builder, request, self) {
    const leg = request.swap!
    builder
      .with(request.token, (t) => {
        t.withdraw({ recipient: leg.executor, amount: request.amount })
      })
      // `Open` is a symbol, so it cannot be confused with an amount of 0.
      .with(leg.buyToken, (t) => {
        t.transfer({ recipient: self, amount: Open })
      })
      .invoke(({ openNotes }) => {
        const note = openNotes[0]
        if (!note) {
          throw new Error('the compiler minted no open note for the buy token, so the executor would have nowhere to deposit — refusing to invoke.')
        }
        return { contractAddress: leg.executor, calldata: swapInvokeCalldata(leg, BigInt(note.noteId)) }
      })
  },
}
