// Protocol action-list invariants (FR-060 / AD-3) — the non-negotiable rules the DEPLOYED pool
// (tag CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08 / commit 74841caf, never `main`) enforces. Every
// value surface builds its transaction through this module so a list the pool would reject or
// silently revert is caught BEFORE it costs a fee. Variant→phase mapping mirrors the pool's own
// `actions.cairo` enum order (the enum index IS the serde discriminant, see message-book.ts).

import { CLIENT_ACTION } from './message-book.js'

/** The fixed 8-phase order. A list must be non-decreasing in this scale (else ACTIONS_OUT_OF_ORDER). */
export const PHASE = {
  ACCOUNT: 0,     // SetViewingKey
  CHANNEL: 1,     // OpenChannel
  SUBCHANNEL: 2,  // OpenSubchannel
  DEPOSIT: 3,     // Deposit
  USE_NOTES: 4,   // UseNote
  CREATE_NOTES: 5,// CreateEncNote / CreateOpenNote
  WITHDRAW: 6,    // Withdraw
  INVOKE: 7,      // InvokeExternal / ComputeAndInvoke
} as const

const VARIANT_PHASE: Record<number, number> = {
  [CLIENT_ACTION.SetViewingKey]: PHASE.ACCOUNT,
  [CLIENT_ACTION.OpenChannel]: PHASE.CHANNEL,
  [CLIENT_ACTION.OpenSubchannel]: PHASE.SUBCHANNEL,
  [CLIENT_ACTION.Deposit]: PHASE.DEPOSIT,
  [CLIENT_ACTION.UseNote]: PHASE.USE_NOTES,
  [CLIENT_ACTION.CreateEncNote]: PHASE.CREATE_NOTES,
  [CLIENT_ACTION.CreateOpenNote]: PHASE.CREATE_NOTES,
  [CLIENT_ACTION.Withdraw]: PHASE.WITHDRAW,
  [CLIENT_ACTION.InvokeExternal]: PHASE.INVOKE,
  [CLIENT_ACTION.ComputeAndInvoke]: PHASE.INVOKE,
}

/** Minimal action shape the validator needs — carries only the fields the invariants read. */
export type ValidatableAction =
  | { type: 'SetViewingKey' }
  | { type: 'OpenChannel'; index: number }
  | { type: 'OpenSubchannel' }
  | { type: 'Deposit'; amount: bigint }
  | { type: 'UseNote' }
  | { type: 'CreateEncNote' }
  | { type: 'CreateOpenNote'; amount: bigint }
  | { type: 'Withdraw' }
  | { type: 'InvokeExternal' }
  | { type: 'ComputeAndInvoke' }

const isInvoke = (t: string) => t === 'InvokeExternal' || t === 'ComputeAndInvoke'
const isWriteOnceCompanion = (t: string) =>
  t === 'SetViewingKey' || t === 'OpenChannel' || t === 'OpenSubchannel'

/**
 * Throws unless the action list satisfies every FR-060 invariant. Ordered so the message names
 * the first real problem. Each thrown error name matches the pool's own revert class where one
 * exists, so a caught error can be shown with the exact sponsor vocabulary.
 */
export function assertActionListValid(actions: readonly ValidatableAction[]): void {
  if (actions.length === 0) throw new Error('EMPTY_ACTION_LIST')

  // 1. Phases non-decreasing (ACTIONS_OUT_OF_ORDER).
  let lastPhase = -1
  for (const a of actions) {
    const phase = VARIANT_PHASE[CLIENT_ACTION[a.type as keyof typeof CLIENT_ACTION]]
    if (phase < lastPhase) throw new Error(`ACTIONS_OUT_OF_ORDER at ${a.type}`)
    lastPhase = phase
  }

  // 2. At most one invoke-phase action per transaction.
  const invokes = actions.filter((a) => isInvoke(a.type))
  if (invokes.length > 1) throw new Error('MULTIPLE_INVOKE_ACTIONS')

  // 3. Every invoke-bearing tx carries a WriteOnce companion (replay protection).
  if (invokes.length === 1 && !actions.some((a) => isWriteOnceCompanion(a.type))) {
    throw new Error('NO_REPLAY_PROTECTION')
  }

  // 4. No zero-amount deposit or open-note (a zero-amount deposit reverts on the deployed class).
  for (const a of actions) {
    if ((a.type === 'Deposit' || a.type === 'CreateOpenNote') && a.amount <= 0n) {
      throw new Error(`ZERO_AMOUNT_DEPOSIT at ${a.type}`)
    }
  }

  // 5. Shield + invoke in one transaction is unpinned/unsafe (val-coverage F10): a Deposit that
  //    is a fresh shield must not ride the same tx as an invoke. Withdraw→invoke is the sanctioned
  //    fund-a-helper pattern; Deposit→invoke is not.
  if (invokes.length === 1 && actions.some((a) => a.type === 'Deposit')) {
    throw new Error('SHIELD_WITH_INVOKE')
  }

  // 6. Channels open in strict sequential index order (INDEX_NOT_SEQUENTIAL): the OpenChannel
  //    indices in this list must be contiguous and ascending by exactly 1.
  const chanIndices = actions.filter((a) => a.type === 'OpenChannel').map((a) => (a as { index: number }).index)
  for (let i = 1; i < chanIndices.length; i++) {
    if (chanIndices[i]! !== chanIndices[i - 1]! + 1) throw new Error('INDEX_NOT_SEQUENTIAL')
  }
}

export interface OpenNoteDeposit {
  noteId: bigint
  token: string
  amount: bigint
}

/**
 * Decodes a helper's return value as a **bare `Span<OpenNoteDeposit>`** — `[len, (note_id, token,
 * amount)×len]`, 3 felts per item (AD-3: the HEAD tuple signature reverts on the deployed class,
 * so the return is a bare span, not `(Span<..>, ..)`). Throws if the length prefix disagrees with
 * the felts that follow — the same mis-parse guard `buildInvokeCalldata` applies on the way out.
 */
export function decodeOpenNoteDeposits(felts: readonly string[]): OpenNoteDeposit[] {
  if (felts.length === 0) throw new Error('EMPTY_RETURN')
  const len = Number(BigInt(felts[0]!))
  const body = felts.slice(1)
  if (body.length !== len * 3) {
    throw new Error(`span length ${len} does not match ${body.length} felts (expected ${len * 3})`)
  }
  const out: OpenNoteDeposit[] = []
  for (let i = 0; i < len; i++) {
    out.push({
      noteId: BigInt(body[i * 3]!),
      token: body[i * 3 + 1]!,
      amount: BigInt(body[i * 3 + 2]!),
    })
  }
  return out
}
