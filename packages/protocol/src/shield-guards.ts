//
// The shield's compiled-span and proven-call guards: what the prover is allowed to have
// composed for a public deposit, and what the proof must carry for the pinned pool's mode.
//

import type { BigNumberish, Call } from 'starknet'
import type { Proof } from '@starkware-libs/starknet-privacy-sdk'
import { NET } from './constants.js'
import { CLIENT_ACTION } from './message-book.js'

export type ShieldPoolMode = 'compatibility' | 'screening'

// Mirrors the SDK's pinned pre-screening pools (internal/pool-mode, not exported); the pinned
// mainnet class is screening, so an unknown hash means "carry the attestation".
const COMPATIBILITY_POOL_CLASS_HASHES = new Set([
  BigInt('0x715b22abfb60815623f4127ba64bd2f93613d8a5c1e519841eaab444659d2af'),
  BigInt('0x30b8c540cf04d8ef0f4db2a9098d9cc0e35e83af1cb3325f5a4f40144b4b30b'),
])

export function shieldPoolModeForClassHash(classHash: string): ShieldPoolMode {
  return COMPATIBILITY_POOL_CLASS_HASHES.has(BigInt(classHash)) ? 'compatibility' : 'screening'
}

export interface ShieldSpanSubject {
  account: { address: BigNumberish }
  token: string
  amount: bigint
}

/** Only the self-channel setup prefix, then exactly `Deposit + CreateEncNote` for the reviewed amount. */
export function assertShieldActionSpan(span: readonly bigint[], request: ShieldSpanSubject): void {
  const count = Number(span[0] ?? -1n)
  if (!Number.isInteger(count) || count < 2 || count > 4) throw new Error(`refusing a shield span declaring ${span[0] ?? 'no'} actions`)

  const widths: Record<number, number> = {
    [CLIENT_ACTION.OpenChannel]: 5,
    [CLIENT_ACTION.OpenSubchannel]: 7,
    [CLIENT_ACTION.Deposit]: 3,
    [CLIENT_ACTION.CreateEncNote]: 7,
  }
  const actions: { variant: number; fields: readonly bigint[] }[] = []
  let at = 1
  for (let index = 0; index < count; index++) {
    const variant = Number(span[at])
    const width = widths[variant]
    if (width === undefined || at + width > span.length) throw new Error(`refusing unsupported or truncated shield action ${variant} at ${index}`)
    actions.push({ variant, fields: span.slice(at + 1, at + width) })
    at += width
  }
  if (at !== span.length) throw new Error(`${span.length - at} shield calldata felts went uninspected`)

  const tail = actions.slice(-2)
  if (tail[0]?.variant !== CLIENT_ACTION.Deposit || tail[1]?.variant !== CLIENT_ACTION.CreateEncNote) {
    throw new Error('A shield must end with exactly Deposit + CreateEncNote.')
  }
  const prefix = actions.slice(0, -2).map((a) => a.variant)
  const legalPrefix =
    prefix.length === 0 ||
    (prefix.length === 1 && prefix[0] === CLIENT_ACTION.OpenSubchannel) ||
    (prefix.length === 2 && prefix[0] === CLIENT_ACTION.OpenChannel && prefix[1] === CLIENT_ACTION.OpenSubchannel)
  if (!legalPrefix) throw new Error('A shield carried actions outside the permitted self-channel setup prefix.')

  const self = BigInt(String(request.account.address))
  const token = BigInt(request.token)
  for (const action of actions.slice(0, -2)) {
    if (action.fields[0] !== self) throw new Error('Shield setup was compiled for a different recipient.')
    if (action.variant === CLIENT_ACTION.OpenSubchannel && action.fields[4] !== token) throw new Error('Shield setup was compiled for a different token.')
  }
  const [deposit, note] = [tail[0]!, tail[1]!]
  if (deposit.fields[0] !== token || deposit.fields[1] !== request.amount) {
    throw new Error('The compiled Deposit does not match the reviewed token and amount.')
  }
  if (note.fields[0] !== self || note.fields[2] !== token || note.fields[3] !== request.amount) {
    throw new Error('The compiled encrypted note is not the reviewed note to self.')
  }
}

/** Compatibility ⇒ no suffix; screening ⇒ `Option::Some(attestation)` = `[0, r, s, issued_at]`, all non-zero. */
export function assertProvenShieldCall(call: Call, proof: Proof, mode: ShieldPoolMode): void {
  if (BigInt(call.contractAddress) !== BigInt(NET.pool) || call.entrypoint !== 'apply_actions' || !Array.isArray(call.calldata)) {
    throw new Error('The shield proof did not produce apply_actions on the pinned pool.')
  }
  const classHash = proof.output?.[0]
  if (classHash === undefined || BigInt(classHash) !== BigInt(NET.poolClassHash)) {
    throw new Error(`The prover compiled against pool class ${classHash}, not ${NET.poolClassHash}.`)
  }
  const suffix = (call.calldata as string[]).slice(proof.output.length - 1).map((f) => BigInt(f))
  if (mode === 'compatibility') {
    if (suffix.length !== 0) throw new Error('A compatibility pool shield carried an unexpected suffix.')
    return
  }
  if (suffix.length !== 4 || suffix[0] !== 0n || suffix.slice(1).some((f) => f === 0n)) {
    throw new Error('A screening pool shield did not carry the SDK screening attestation.')
  }
}
