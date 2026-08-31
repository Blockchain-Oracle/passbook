//
// The prove leg of registration: the lone `SetViewingKey`, the span guards that keep it lone,
// and the fee approve that rides with it. Shared with the relayer.
//

import { hash, type Call } from 'starknet'
import {
  createEmptyRegistry,
  type DiscoveryProviderInterface,
  type PrivateTransfersUser,
} from '@starkware-libs/starknet-privacy-sdk'
import { NET, STRK_TOKEN } from './constants.js'
import { createPoolClient } from './client.js'
import { contractDiscoveryFor, poolContractFor } from './discovery.js'
import { getProvider } from './rpc.js'
import { approveCall } from './submit.js'
import { approveCeiling } from './fee-ceiling.js'
import { CLIENT_ACTION } from './message-book.js'

/** The SDK takes addresses as felt strings; a bigint would serialise as a decimal it rejects. */
const toFelt = (v: bigint) => `0x${v.toString(16)}`

export interface ProvedRegistration {
  call: Call
  proofFacts: string[]
  /** The proof blob. Rides NEXT TO the facts — the sequencer takes both or neither. */
  proof: string
  provingBlockId: number
}

export interface ProveRegistrationInput {
  accountKey: string
  account: PrivateTransfersUser
  provingBlockId: number
  /**
   * The starter deposit to fold in, in wei, or absent for a bare registration.
   *
   * PAID BY WHOEVER SUBMITS, which for a sponsored registration is the relayer. It rides inside the
   * proof rather than as a second transaction so it costs one `collect_fee` instead of two — the
   * fee is charged per submission, not per action, which is what makes batching worth 6 STRK here.
   */
  starterWei?: bigint
}

// Registration compiles without discovery (proved by a free probe). A silent stub would hide the
// day that stops being true, so every method throws.
const REFUSING_DISCOVERY: DiscoveryProviderInterface = {
  discoverNotes: async () => {
    throw new Error('registration must not reach discovery: discoverNotes was called')
  },
  discoverChannels: async () => {
    throw new Error('registration must not reach discovery: discoverChannels was called')
  },
  discoverRequirement: async () => {
    throw new Error('registration must not reach discovery: discoverRequirement was called')
  },
}

const COMPILE_ACTIONS_SELECTOR = hash.getSelectorFromName('compile_actions')

/**
 * Pulls the `Span<ClientAction>` out of a proof invocation's `__execute__` calldata:
 * `[array_len=1, to, selector, inner_len, ...inner]`, `inner = [sender, viewingKey, ...span]`.
 * Target and selector are checked so the assertion is about what the prover works on.
 */
export function extractClientActionSpan(executeCalldata: readonly string[]): bigint[] {
  if (executeCalldata.length < 4) {
    throw new Error(`proof invocation calldata is too short to be an __execute__: ${executeCalldata.length} felts`)
  }
  if (BigInt(executeCalldata[0]!) !== 1n) {
    throw new Error(`refusing a proof invocation carrying ${executeCalldata[0]} calls: registration is exactly one compile_actions`)
  }
  if (BigInt(executeCalldata[1]!) !== BigInt(NET.pool)) {
    throw new Error(`refusing a proof invocation aimed at ${executeCalldata[1]}: expected the pool ${NET.pool}`)
  }
  if (BigInt(executeCalldata[2]!) !== BigInt(COMPILE_ACTIONS_SELECTOR)) {
    throw new Error(`refusing a proof invocation of selector ${executeCalldata[2]}: expected compile_actions`)
  }
  const innerLength = Number(BigInt(executeCalldata[3]!))
  const inner = executeCalldata.slice(4)
  if (inner.length !== innerLength) {
    throw new Error(
      `compile_actions calldata declares ${innerLength} felts but ${inner.length} follow it — ` +
        'a mismatch means part of this invocation went uninspected',
    )
  }
  if (innerLength < 2) {
    throw new Error(`compile_actions calldata carries ${innerLength} felts: too few for even (sender, viewingKey)`)
  }
  return inner.slice(2).map((f) => BigInt(f))
}

/** Exactly `[1, SetViewingKey, random]` — an `autoSetup`/`autoRegister` extra lands a fourth felt here. */
export function assertLoneSetViewingKey(span: readonly bigint[]): void {
  if (span.length !== 3 || span[0] !== 1n) {
    throw new Error(
      `refusing to prove ${span[0] ?? 0} compiled action(s) (${span.length} felts): ` +
        'sponsored registration is a lone SetViewingKey and nothing else',
    )
  }
  assertSetViewingKeyAt(span, 1)
}

/** The `SetViewingKey` at `at`: right variant, and randomness the pool will not reject. */
function assertSetViewingKeyAt(span: readonly bigint[], at: number): void {
  if (span[at] !== BigInt(CLIENT_ACTION.SetViewingKey)) {
    throw new Error(`refusing to prove client action variant ${span[at]}: expected SetViewingKey`)
  }
  if (span[at + 1] === 0n) {
    throw new Error('refusing to prove a registration whose encryption randomness is zero — the pool rejects it as ZERO_RANDOM')
  }
}

/**
 * Felts each `ClientAction` occupies INCLUDING its variant tag. Shared shape with
 * `shield-guards.ts`, which reads the same span for the deposit half of a shield.
 */
export const ACTION_WIDTHS: Record<number, number> = {
  [CLIENT_ACTION.SetViewingKey]: 2,
  [CLIENT_ACTION.OpenChannel]: 5,
  [CLIENT_ACTION.OpenSubchannel]: 7,
  [CLIENT_ACTION.Deposit]: 3,
  [CLIENT_ACTION.CreateEncNote]: 7,
}

/** One decoded `ClientAction`: its variant tag and the felts that follow it. */
export interface DecodedAction {
  variant: number
  fields: readonly bigint[]
}

/**
 * Walks a `Span<ClientAction>` into its actions, refusing anything it cannot account for.
 *
 * Shared by the registration guard and the starter drip's, because a walker that exists twice is a
 * walker that gets fixed once. It reads the declared count, advances by each variant's width, and
 * insists the span ends exactly where the last action does — an unconsumed tail is calldata nobody
 * inspected, which on a batch our own key pays for is the whole thing worth refusing.
 */
export function decodeClientActions(span: readonly bigint[], what: string): DecodedAction[] {
  const count = Number(span[0] ?? -1n)
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`refusing a ${what} span declaring ${span[0] ?? 'no'} actions`)
  }
  const actions: DecodedAction[] = []
  let at = 1
  for (let index = 0; index < count; index++) {
    const variant = Number(span[at])
    const width = ACTION_WIDTHS[variant]
    if (width === undefined || at + width > span.length) {
      throw new Error(`refusing unsupported or truncated ${what} action ${variant} at ${index}`)
    }
    actions.push({ variant, fields: span.slice(at + 1, at + width) })
    at += width
  }
  if (at !== span.length) throw new Error(`${span.length - at} ${what} calldata felts went uninspected`)
  return actions
}

/**
 * The span of a registration that also carries its starter deposit.
 *
 * ── WHY THIS IS CHECKED FELT BY FELT, AND NOT LOOSENED TO "STARTS WITH SetViewingKey" ─────
 *
 * The relayer submits this batch, so `collect_fee` AND the deposit's `transferFrom` both pull from
 * the RELAYER's wallet — the user names an amount, and our key pays it. The approve ceiling bounds
 * the loss to one fee's headroom, but a bound is not a reason to stop reading: this guard is what
 * makes the amount the one the caller asked us for, and the recipient the account being registered,
 * rather than whatever the prover happened to compile.
 *
 * Shape, in order: `SetViewingKey`, an optional self-channel setup prefix, then `Deposit` and
 * `CreateEncNote` — the same tail a shield ends with, because it is the same operation with someone
 * else's STRK. `evidence/probe-bare-deposit.json` is this shape, proven on mainnet.
 */
export function assertRegistrationWithStarter(
  span: readonly bigint[],
  expect: { self: bigint; token: bigint; amount: bigint },
): void {
  const actions = decodeClientActions(span, 'registration')
  // SetViewingKey + Deposit + CreateEncNote is the floor; the two channel-setup actions are the ceiling.
  if (actions.length < 3 || actions.length > 5) {
    throw new Error(`refusing a registration span declaring ${actions.length} actions`)
  }

  assertSetViewingKeyAt(span, 1)
  if (actions[0]!.variant !== CLIENT_ACTION.SetViewingKey) {
    throw new Error('a registration must open with SetViewingKey')
  }
  const tail = actions.slice(-2)
  if (tail[0]?.variant !== CLIENT_ACTION.Deposit || tail[1]?.variant !== CLIENT_ACTION.CreateEncNote) {
    throw new Error('a registration with a starter must end with exactly Deposit + CreateEncNote')
  }
  // Between them, only the self-channel setup — the same prefix a shield permits, nothing else.
  const middle = actions.slice(1, -2).map((a) => a.variant)
  const legalMiddle =
    middle.length === 0 ||
    (middle.length === 1 && middle[0] === CLIENT_ACTION.OpenSubchannel) ||
    (middle.length === 2 && middle[0] === CLIENT_ACTION.OpenChannel && middle[1] === CLIENT_ACTION.OpenSubchannel)
  if (!legalMiddle) throw new Error('a registration carried actions outside the permitted self-channel setup prefix')

  for (const action of actions.slice(1, -2)) {
    if (action.fields[0] !== expect.self) throw new Error('registration setup was compiled for a different recipient')
    if (action.variant === CLIENT_ACTION.OpenSubchannel && action.fields[4] !== expect.token) {
      throw new Error('registration setup was compiled for a different token')
    }
  }
  const [deposit, note] = [tail[0]!, tail[1]!]
  if (deposit.fields[0] !== expect.token || deposit.fields[1] !== expect.amount) {
    throw new Error('the compiled starter Deposit does not match the token and amount this registration asked for')
  }
  if (note.fields[0] !== expect.self || note.fields[2] !== expect.token || note.fields[3] !== expect.amount) {
    throw new Error('the compiled starter note is not a note to the account being registered')
  }
}

/** `proof.data` must be a non-empty string: facts without the blob are not a submittable transaction. */
export function proofBlobFrom(proof: unknown): string {
  const data = (proof as { data?: unknown } | undefined)?.data
  if (typeof data !== 'string' || data.length === 0) {
    throw new Error('the prover returned no proof blob alongside its facts; the sequencer rejects proof_facts without proof')
  }
  return data
}

const FELT = /^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/

/**
 * Channel discovery and NOTHING else — the starter path's provider.
 *
 * A deposit has to resolve the self-channel it lands in, so `discoverChannels` has to work. Notes
 * and recipient requirements must not: a registration selecting notes would compile `UseNote`
 * actions into a span the guard reads as tampering, and a brand-new account has no notes to select
 * anyway. Same split `shield.ts` makes for the same reason, and the throws are what would tell us
 * if that ever stopped being true.
 */
export function starterDiscovery(): DiscoveryProviderInterface {
  const channels = contractDiscoveryFor(poolContractFor(getProvider()))
  return {
    discoverNotes: async () => {
      throw new Error('a registration starter must not discover notes: it spends none')
    },
    discoverChannels: (...args) => channels.discoverChannels(...args),
    discoverRequirement: async () => {
      throw new Error('a registration starter does not discover recipient requirements')
    },
  }
}

/**
 * Builds and proves the registration — the lone `SetViewingKey`, or that plus a starter deposit.
 *
 * ── THE TWO PATHS TAKE DIFFERENT OPTIONS, AND THAT IS THE WHOLE CARE HERE ─────────────────
 *
 * A bare registration passes NO build options: each one changes the span, and the span is what
 * `assertLoneSetViewingKey` reads. It keeps `REFUSING_DISCOVERY` too — a registration that cannot
 * reach discovery cannot quietly grow a note lookup.
 *
 * A starter needs the opposite, and needs it precisely. `autoSetup` is what makes the compiler
 * open the self-channel: it fires only on `actions.setViewingKey && options.autoSetup`
 * (SDK `internal/compiler.js`), so WITHOUT IT the deposit resolves against a channel that does not
 * exist yet on an account being registered this very transaction. `autoDiscover.channels` is what
 * looks first. `autoSelectNotes` is deliberately absent — it would compile `UseNote` actions for
 * notes a new account does not have and cannot spend.
 *
 * This is `proveShield`'s recipe, because it is the same operation with someone else's STRK.
 */
export async function proveRegistration(input: ProveRegistrationInput): Promise<ProvedRegistration> {
  const starter = input.starterWei
  if (starter !== undefined && starter <= 0n) {
    throw new Error(`refusing a starter deposit of ${starter} wei: it must be positive or absent`)
  }
  const self = BigInt(String(input.account.address))
  const withStarter = starter !== undefined
  const { transfers } = createPoolClient(
    { accountKey: input.accountKey, account: input.account },
    { discovery: withStarter ? starterDiscovery() : REFUSING_DISCOVERY },
  )
  const builder = transfers
    .build(
      withStarter
        ? { registry: createEmptyRegistry(), autoDiscover: { channels: 'refresh' }, autoSetup: true, provingBlockId: input.provingBlockId }
        : {},
    )
    .register()
  if (withStarter) {
    builder.with(STRK_TOKEN, (t) => {
      t.deposit({ recipient: toFelt(self), amount: starter })
    })
  }
  const invocation = await builder.createProofInvocation({ provingBlockId: input.provingBlockId })
  const span = extractClientActionSpan(invocation.invocation.calldata)
  if (!withStarter) assertLoneSetViewingKey(span)
  else assertRegistrationWithStarter(span, { self, token: BigInt(STRK_TOKEN), amount: starter })

  const { call, proof } = (await transfers.executeWithInvocation(invocation, input.provingBlockId)).callAndProof
  if (BigInt(call.contractAddress) !== BigInt(NET.pool) || call.entrypoint !== 'apply_actions') {
    throw new Error(`refusing a proven ${call.entrypoint} on ${call.contractAddress}: expected apply_actions on the pool`)
  }
  const proofFacts = [...proof.proofFacts]
  if (proofFacts.length === 0) throw new Error('the prover returned no proof facts; the pool will not accept the transaction')
  const bad = proofFacts.findIndex((f) => typeof f !== 'string' || !FELT.test(f))
  if (bad !== -1) throw new Error(`the prover returned a proof fact that is not a felt at index ${bad}: ${String(proofFacts[bad])}`)

  return { call, proofFacts, proof: proofBlobFrom(proof), provingBlockId: input.provingBlockId }
}

/**
 * `[STRK.approve(pool, ceiling), apply_actions]` — `collect_fee` pulls from the caller, same batch.
 *
 * With a starter, the pool pulls the DEPOSIT from the caller too, so the approve has to cover both.
 * `approveCeiling` is twice the live fee, and the excess over one fee is the only headroom a
 * starter can be paid out of — so a starter that does not fit is refused here rather than sent to
 * revert on chain at our expense. Raising `approveCeiling` to make a bigger starter fit is the
 * wrong fix: that number is the blast radius of every sponsored submission, not a budget line.
 */
export function assembleRegistrationCalls(applyActions: Call, feeWei: bigint, starterWei = 0n): Call[] {
  if (feeWei <= 0n) throw new Error(`refusing to approve a fee of ${feeWei} wei`)
  if (starterWei < 0n) throw new Error(`refusing a starter of ${starterWei} wei`)
  const ceiling = approveCeiling(feeWei)
  if (feeWei + starterWei > ceiling) {
    throw new Error(
      `refusing a ${starterWei} wei starter: with the ${feeWei} wei fee it needs ${feeWei + starterWei} ` +
        `of approve and the ceiling is ${ceiling}. Lower the starter; do not raise the ceiling.`,
    )
  }
  return [approveCall(STRK_TOKEN, NET.pool, ceiling), applyActions]
}
