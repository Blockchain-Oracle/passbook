//
// Earn: withdraw the input token to our helper, mint an OPEN note for the output token, and invoke
// the helper with the pair, the amount and that note's id. One transaction; the value never sits
// anywhere the user does not control.
//
// Structurally this is `send-swap.ts` with a different executor, and it is written to look like it
// on purpose — the two share the shape the pool calls an invoke sandwich, and a reader who knows
// one should recognise the other. What differs is the direction pair:
//
//   supply  USDC   → helper → vToken note   (`request.token` is USDC, `amount` is underlying)
//   redeem  vToken → helper → USDC note     (`request.token` is the vToken, `amount` is SHARES)
//
// The redeem case is the reason `request.token` is the vToken rather than USDC: `shieldedShortfall`
// weighs `request.amount` of `request.token` against the walk, so naming USDC there would check
// the wrong balance entirely and let a redeem be composed against shares the account does not hold.
//

import { Open } from '@starkware-libs/starknet-privacy-sdk'

import { earnInvokeCalldata, earnTokens, type EarnDirection } from './earn-calldata.js'
import { marketById } from './earn-markets.js'
import { OK, bad, feltOrNull, sameFelt, type SendLeg, type SendRequest } from './send-plan.js'

/** The lending leg. `marketId` indexes the pinned registry; the helper is the deployed contract. */
export interface EarnLeg {
  readonly direction: EarnDirection
  readonly marketId: string
  /** Our deployed `VesuEarn`. Absent from the build means Earn cannot compose at all. */
  readonly helper: string
  /** The token the open note is minted for — the vToken on a supply, USDC on a redeem. */
  readonly outToken: string
  readonly outSymbol: string
  /** What the review said would come back. Carried for copy; the chain decides the real figure. */
  readonly expectedOutWei: bigint
}

function validateEarn(request: SendRequest): ReturnType<SendLeg['validate']> {
  const leg = request.earn
  if (!leg) return bad('an Earn transaction needs a market, a helper and a direction, and carried none')

  const market = marketById(leg.marketId)
  if (!market) return bad(`there is no Earn market called ${JSON.stringify(leg.marketId)}`)

  const helper = feltOrNull(leg.helper)
  if (helper === null) return bad(`the Earn helper ${JSON.stringify(leg.helper)} is not a felt address`)
  if (helper === 0n) return bad('the Earn helper is address 0, which would burn the amount')

  // The withdraw reads `recipient`, the invoke reads `helper`: withdrawing to one contract and
  // instructing another strands the amount. Same trap as the swap executor.
  if (!sameFelt(leg.helper, request.recipient)) {
    return bad(
      `this Earn transaction withdraws to ${request.recipient} and invokes ${leg.helper}. Those must be the same ` +
        'contract — withdrawing to one and instructing another strands the amount.',
    )
  }

  const { inToken, outToken } = earnTokens({ direction: leg.direction, market })
  // `request.token` is what the pool is asked to spend, and the balance check upstream is about
  // exactly that token. A mismatch here is the difference between spending USDC and spending shares.
  if (!sameFelt(request.token, inToken)) {
    return bad(`an Earn ${leg.direction} spends ${inToken} and this one names ${request.token}`)
  }
  if (!sameFelt(leg.outToken, outToken)) {
    return bad(`an Earn ${leg.direction} returns ${outToken} and this one opens a note for ${leg.outToken}`)
  }

  // Serialised now, so an unbuildable calldata is refused before any proof rather than after a fee.
  const dry = earnInvokeCalldata({ direction: leg.direction, market, amount: request.amount, openNoteId: 1n })
  if (dry.state === 'refused') return bad(dry.because)
  return OK
}

/** The helper's calldata, with the open note the compiler just minted. */
export function earnInvokeFor(leg: EarnLeg, amount: bigint, openNoteId: bigint): string[] {
  const market = marketById(leg.marketId)
  if (!market) throw new Error(`there is no Earn market called ${leg.marketId}`)
  const built = earnInvokeCalldata({ direction: leg.direction, market, amount, openNoteId })
  if (built.state === 'refused') throw new Error(built.because)
  return [...built.calldata]
}

export const earnLeg: SendLeg = {
  validate: validateEarn,
  compose(builder, request, self) {
    const leg = request.earn!
    builder
      .with(request.token, (t) => {
        t.withdraw({ recipient: leg.helper, amount: request.amount })
      })
      // `Open` is a symbol, so it cannot be confused with an amount of 0. The helper decides what
      // actually lands here — a lending vault's output is not knowable until it executes.
      .with(leg.outToken, (t) => {
        t.transfer({ recipient: self, amount: Open })
      })
      .invoke(({ openNotes }) => {
        const note = openNotes[0]
        if (!note) {
          throw new Error(
            'the compiler minted no open note for the output token, so the helper would have nowhere to deposit — refusing to invoke.',
          )
        }
        return { contractAddress: leg.helper, calldata: earnInvokeFor(leg, request.amount, BigInt(note.noteId)) }
      })
  },
}
