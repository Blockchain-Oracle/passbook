import type { CalldataResult } from '@strk20/protocol/governance-calldata'
import type { AppInvokeLeg, SendResult } from '@strk20/protocol/send'

/**
 * The `app` leg for a governance op. `compute` is the ComputeAndInvoke ride where the POOL injects
 * the per-contract voter handle — ballots, joins and delegations need it; bearer settlements and
 * gifts do not. Settlements (`reclaim`/`revoke`) mint one payout note, so they carry its slots.
 */
export function govLeg(
  contract: string,
  op: number,
  payload: Extract<CalldataResult, { state: 'ready' }>,
  options: { via?: 'invoke' | 'compute'; payoutToken?: string } = {},
): AppInvokeLeg {
  const settles = payload.noteIdSlots.length > 0
  return {
    contract,
    op,
    calldata: [...payload.calldata],
    noteIdSlots: [...payload.noteIdSlots],
    openNoteCount: settles ? 1 : 0,
    ...(options.via ? { via: options.via } : {}),
    ...(options.payoutToken ? { payoutToken: options.payoutToken } : {}),
  }
}

/** A hash or an unknown confirmation means the send may have landed, so a stored secret stays. */
export function mayHaveLanded(result: SendResult): boolean {
  return !result.ok && (result.failure.kind === 'confirmation-unknown' || 'transactionHash' in result.failure)
}

export function proposalTitle(p: { id: number; metadata: string }): string {
  return p.metadata || `Proposal ${p.id}`
}

export function houseTitle(h: { id: number; metadata: string }): string {
  return h.metadata || `DAO ${h.id}`
}
