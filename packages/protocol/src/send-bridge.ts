//
// Bridge: the swap sandwich with the return leg removed. Withdraw USDC to the sponsor's
// OutboundAnonymizer and invoke it; it burns through CCTP, so nothing comes back into the pool
// and no open note is minted. Every felt is computable before proving, and every one is checked
// — a wrong crossing is a burn.
//

import { BRIDGE_USDC, DESTINATIONS, FAST_FINALITY_THRESHOLD, buyParamsCalldata } from './bridge.js'
import { OK, bad, feltOrNull, sameFelt, type BridgeLeg, type SendLeg, type SendRequest } from './send-plan.js'

/** The helper's eight-felt `BuyParams`, or the sentence saying why not. */
export function bridgeCalldata(leg: BridgeLeg, amount: bigint): { state: 'ready'; calldata: string[] } | { state: 'refused'; because: string } {
  const built = buyParamsCalldata({
    mintRecipient: leg.mintRecipient,
    amount,
    maxFeeWei: leg.maxFeeWei,
    minFinalityThreshold: leg.minFinalityThreshold,
    destinationDomain: leg.destinationDomain,
  })
  return built.state === 'ready' ? { state: 'ready', calldata: [...built.calldata] } : built
}

function validateBridge(request: SendRequest): ReturnType<SendLeg['validate']> {
  const leg = request.bridge
  if (!leg) return bad('a crossing needs a helper, a destination and a fee, and carried none')
  const helper = feltOrNull(leg.helper)
  if (helper === null || helper === 0n) return bad(`the bridge helper ${JSON.stringify(leg.helper)} is not a usable contract address`)
  if (!sameFelt(leg.helper, request.recipient)) {
    return bad(
      `this crossing withdraws to ${request.recipient} and invokes ${leg.helper}. Those must be the same ` +
        'contract — anything left sitting in the helper is burnable by whoever calls it next.',
    )
  }
  if (!sameFelt(request.token, BRIDGE_USDC)) {
    return bad(
      `this crossing sends ${request.symbol} at ${request.token}, and the helper can only burn the USDC at ` +
        `${BRIDGE_USDC}. Sending any other token to it does nothing this app can undo.`,
    )
  }
  if (leg.maxFeeWei < 0n) return bad(`this crossing carries a negative fee of ${leg.maxFeeWei}`)
  if (leg.maxFeeWei >= request.amount) {
    return bad(`this crossing sends ${request.amount} and ${leg.maxFeeWei} of it is fee, so nothing would arrive`)
  }
  if (leg.minFinalityThreshold !== FAST_FINALITY_THRESHOLD) {
    return bad(`this crossing declares finality tier ${leg.minFinalityThreshold}, and the fee was quoted for ${FAST_FINALITY_THRESHOLD}`)
  }
  if (!DESTINATIONS.some((d) => d.domain === leg.destinationDomain)) {
    return bad(`this crossing targets CCTP domain ${leg.destinationDomain}, which this app has not verified`)
  }
  const built = bridgeCalldata(leg, request.amount)
  if (built.state === 'refused') return bad(built.because)
  return OK
}

export const bridgeLeg: SendLeg = {
  validate: validateBridge,
  compose(builder, request) {
    const leg = request.bridge!
    const built = bridgeCalldata(leg, request.amount)
    if (built.state === 'refused') throw new Error(built.because)
    builder
      .with(request.token, (t) => {
        t.withdraw({ recipient: leg.helper, amount: request.amount })
      })
      // No open note: the helper burns, it does not deposit. `openNotes` is deliberately ignored.
      .invoke(() => ({ contractAddress: leg.helper, calldata: built.calldata }))
  },
}
