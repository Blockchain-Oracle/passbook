//
// The app-contract leg: markets, launches and Houses. A FUNDING kind withdraws value to the
// contract and mints nothing; a SETTLING kind carries no withdrawal and mints `openNoteCount`
// open notes the contract's deposits fill; `gov-join` moves nothing at all. `via: 'compute'` rides
// the pool's ComputeAndInvoke pair, where the pool injects the per-contract identity handle.
//
// `openNoteCount` is the field the pool cannot check for free: an open note nothing deposits
// into reverts AFTER the fee is taken, so the count is refused here and re-checked in the callback.
//

import { Open, type InvokeCalldataBuilderArgs } from '@starkware-libs/starknet-privacy-sdk'

import {
  OK,
  bad,
  feltOrNull,
  isComputeKind,
  isFundingKind,
  isSettlingKind,
  sameFelt,
  type AppInvokeLeg,
  type SendLeg,
  type SendRequest,
} from './send-plan.js'

function validateApp(request: SendRequest): ReturnType<SendLeg['validate']> {
  const app = request.app
  if (!app) return bad(`a ${request.kind} needs a contract, an op and a payload, and carried none`)
  const contract = feltOrNull(app.contract)
  if (contract === null) return bad(`the contract ${JSON.stringify(app.contract)} is not a felt address`)
  // Before a deploy lands the address is absent; an absent address reaching here would withdraw to nowhere.
  if (contract === 0n) return bad('this app contract has no deployed address yet, so there is nothing to invoke')
  // The withdraw reads `recipient`, the invoke reads `contract`: two contracts strand the stake.
  if (!sameFelt(app.contract, request.recipient)) {
    return bad(`this ${request.kind} withdraws to ${request.recipient} and invokes ${app.contract}. Those must be the same contract.`)
  }
  if (!Number.isInteger(app.op) || app.op <= 0) return bad(`${JSON.stringify(app.op)} is not an operation code`)
  if (app.calldata.length < 2) return bad('the operation carried no calldata, which every op refuses')
  for (const [i, f] of app.calldata.entries()) {
    if (feltOrNull(f) === null) return bad(`calldata felt ${i} is not a felt: ${JSON.stringify(f)}`)
  }
  if (feltOrNull(app.calldata[0]!) !== BigInt(app.op)) {
    return bad(`this leg declares op ${app.op} and its calldata opens with ${app.calldata[0]}. Those must be the same operation.`)
  }
  for (const slot of app.noteIdSlots) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= app.calldata.length) {
      return bad(`note-id slot ${slot} is outside the ${app.calldata.length}-felt calldata`)
    }
  }
  if (!Number.isInteger(app.openNoteCount) || app.openNoteCount < 0) {
    return bad(`${JSON.stringify(app.openNoteCount)} is not a count of open notes`)
  }
  // One slot per open note: a payload with fewer slots than notes carries a stale id somewhere.
  if (app.noteIdSlots.length !== app.openNoteCount) {
    return bad(
      `this operation mints ${app.openNoteCount} open notes and leaves ${app.noteIdSlots.length} note-id slots to be filled. Those must be the same number.`,
    )
  }
  if ((isFundingKind(request.kind) || request.kind === 'gov-join') && app.openNoteCount !== 0) {
    return bad(
      `a ${request.kind} is paid nothing back, so it must create no open notes, and this one asked for ${app.openNoteCount}. ` +
        'An open note nothing deposits into reverts the whole transaction after the fee is taken.',
    )
  }
  const via = app.via ?? 'invoke'
  if (isComputeKind(request.kind) && via !== 'compute') {
    return bad(`a ${request.kind} travels as ComputeAndInvoke, and this leg says '${via}'`)
  }
  if (!isComputeKind(request.kind) && via === 'compute') {
    return bad(`a ${request.kind} travels as a plain invoke, and this leg says 'compute'`)
  }
  if (isSettlingKind(request.kind)) {
    if (app.openNoteCount === 0) return bad(`a ${request.kind} with no open notes has nowhere for its payout to land`)
    const payout = feltOrNull(app.payoutToken ?? '')
    if (payout === null || payout === 0n) return bad('a payout needs a token to arrive in, and this one named none')
    if (payout !== feltOrNull(request.token)) {
      return bad(`this ${request.kind} is paid in ${app.payoutToken} and names ${request.token} as its token. Those must be the same token.`)
    }
  }
  return OK
}

/** The payload with the compiler's open-note ids dropped into the reserved slots, in payload order. */
export function fillNoteIdSlots(leg: AppInvokeLeg, openNotes: InvokeCalldataBuilderArgs['openNotes']): string[] {
  if (openNotes.length !== leg.openNoteCount) {
    throw new Error(
      `the compiler minted ${openNotes.length} open notes and this operation deposits into ${leg.openNoteCount}. ` +
        'Every open note must be deposited into or the pool reverts the transaction after taking the fee — refusing to invoke.',
    )
  }
  const calldata = [...leg.calldata]
  leg.noteIdSlots.forEach((slot, i) => {
    const note = openNotes[i]
    if (note === undefined) throw new Error(`no open note was minted for payout ${i + 1}`)
    calldata[slot] = `0x${BigInt(note.noteId).toString(16)}`
  })
  return calldata
}

export const appLeg: SendLeg = {
  validate: validateApp,
  compose(builder, request, self) {
    const leg = request.app!
    // The stake, for a funding kind. A value-less ballot (fee token = house token) withdraws nothing.
    if (!isSettlingKind(request.kind) && request.amount > 0n) {
      builder.with(request.token, (t) => {
        t.withdraw({ recipient: leg.contract, amount: request.amount })
      })
    }
    // `Open` is a symbol: a note whose amount a later deposit writes, never an amount of 0.
    if (leg.payoutToken && leg.openNoteCount > 0) {
      builder.with(leg.payoutToken, (t) => {
        for (let i = 0; i < leg.openNoteCount; i++) t.transfer({ recipient: self, amount: Open })
      })
    }
    if ((leg.via ?? 'invoke') === 'compute') {
      // One payload, both halves: `privacy_compute` (after the identity key) and
      // `privacy_invoke_with_computation` (after the compute result) — the Governor's wire.
      builder.computeAndInvoke(({ openNotes }) => {
        const calldata = fillNoteIdSlots(leg, openNotes)
        return { contractAddress: leg.contract, computeAdditionalData: calldata, invokeAdditionalData: calldata }
      })
    } else {
      builder.invoke(({ openNotes }) => ({ contractAddress: leg.contract, calldata: fillNoteIdSlots(leg, openNotes) }))
    }
  },
}
