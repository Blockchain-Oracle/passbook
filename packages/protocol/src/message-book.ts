//
// Action-list construction for a MessageBook invoke, and the client-side validation
// that has to happen before one is paid for.
//
// EVERY STRUCTURAL CLAIM IN THIS FILE WAS VERIFIED AGAINST THE DEPLOYED MAINNET POOL
// on 21 Aug 2026, by calling `compile_actions` — a free `view` — at class hash
// 0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d. Nothing here is
// transcribed from documentation and nothing here is inferred. Where a rule was
// established by observing the pool reject something, the rejection string is quoted.
//
// See ACTION_LIST_EVIDENCE at the bottom for the probe results these encode.
//

/** Modes accepted by `MessageBook::privacy_invoke`. Anything else panics `UNKNOWN_MODE`. */
export const MODE_APPEND = 1n
export const MODE_SEAL = 2n

/**
 * The pool implementation every finding in this file was established against.
 *
 * The pool is upgradeable with a ZERO delay and pausable, so "it matched when we tested"
 * says nothing about now — it can change mid-run, including during judging. If the
 * deployed class hash has moved, `ACTION_LIST_EVIDENCE` below describes a contract that
 * is no longer running and none of it can be relied on. Spec §10.5 requires re-checking
 * this immediately before spending; both scripts do.
 */
export const EXPECTED_POOL_CLASS_HASH =
  '0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d'

/**
 * `ClientAction` variant indices, read from the deployed pool's own ABI (enum member
 * order IS the serde discriminant). We only build two of these; the rest are listed so
 * that the ordering rule below is checkable by eye.
 */
export const CLIENT_ACTION = {
  SetViewingKey: 0,
  OpenChannel: 1,
  OpenSubchannel: 2,
  CreateEncNote: 3,
  CreateOpenNote: 4,
  Deposit: 5,
  UseNote: 6,
  Withdraw: 7,
  InvokeExternal: 8,
  ComputeAndInvoke: 9,
} as const

export type ClientAction =
  | { type: 'SetViewingKey'; random: bigint }
  | { type: 'OpenChannel'; recipientAddr: string; index: number; random: bigint; salt: bigint }
  | { type: 'InvokeExternal'; contractAddress: string; calldata: readonly string[] }
  | {
      /**
       * `ComputeAndInvokeInput { contract_address, compute_additional_data, invoke_additional_data }`
       * — the pool derives the caller's per-helper identity key, calls the target's
       * `privacy_compute` with `[identity_key, ...compute]`, and forwards the result plus
       * `invoke` into `privacy_invoke_with_computation`. The governance wire (§2.1).
       */
      type: 'ComputeAndInvoke'
      contractAddress: string
      compute: readonly string[]
      invoke: readonly string[]
    }

const toFelt = (v: bigint | number | string): string =>
  typeof v === 'string' ? (v.startsWith('0x') ? v : `0x${BigInt(v).toString(16)}`) : `0x${BigInt(v).toString(16)}`

/**
 * Serialises `Span<ClientAction>` exactly as the pool's serde expects:
 * `[len, ...items]`, each item `[variant_index, ...fields]`, each `Span<felt252>`
 * field inlined as `[len, ...values]`.
 *
 * Confirmed by round-trip: a span built by this function was accepted by
 * `compile_actions` on mainnet and the resulting `ServerAction::Invoke` carried our
 * calldata back byte-for-byte.
 */
export function encodeClientActions(actions: readonly ClientAction[]): string[] {
  const out: string[] = [toFelt(actions.length)]
  for (const a of actions) {
    if (a.type === 'SetViewingKey') {
      out.push(toFelt(CLIENT_ACTION.SetViewingKey), toFelt(a.random))
    } else if (a.type === 'OpenChannel') {
      // OpenChannelInput { recipient_addr, index: u32, random, salt }
      out.push(
        toFelt(CLIENT_ACTION.OpenChannel),
        toFelt(a.recipientAddr),
        toFelt(a.index),
        toFelt(a.random),
        toFelt(a.salt),
      )
    } else if (a.type === 'ComputeAndInvoke') {
      out.push(
        toFelt(CLIENT_ACTION.ComputeAndInvoke),
        toFelt(a.contractAddress),
        toFelt(a.compute.length),
        ...a.compute.map(toFelt),
        toFelt(a.invoke.length),
        ...a.invoke.map(toFelt),
      )
    } else {
      out.push(
        toFelt(CLIENT_ACTION.InvokeExternal),
        toFelt(a.contractAddress),
        toFelt(a.calldata.length),
        ...a.calldata.map(toFelt),
      )
    }
  }
  return out
}

/**
 * The calldata the pool forwards, unexamined, to `MessageBook::privacy_invoke`.
 *
 * `[mode, tag, payload_len, ...payload]` — the length prefix is the serde header of the
 * `Span<felt252>` parameter, so a prefix that disagrees with the actual payload length
 * mis-parses the call. `invoke_external` performs NO ABI inspection: it copies this
 * array into `InvokeInput.calldata` verbatim, so a mistake here is not caught until the
 * transaction executes, which is after the 6 STRK fee has been collected.
 */
export function buildInvokeCalldata(
  mode: bigint,
  tag: bigint,
  payload: readonly bigint[],
): string[] {
  const calldata = [toFelt(mode), toFelt(tag), toFelt(payload.length), ...payload.map(toFelt)]
  // Belt and braces: assert the prefix we just wrote agrees with what follows it. This
  // cannot fail as written, and that is the point — it fails if someone edits the line
  // above and forgets the header.
  const declared = BigInt(calldata[2]!)
  if (declared !== BigInt(calldata.length - 3)) {
    throw new Error(
      `length prefix ${declared} does not match the ${calldata.length - 3} payload felts that follow it`,
    )
  }
  return calldata
}

/**
 * `MessageBook::privacy_invoke` has exactly three caller-triggerable panics, and every
 * one of them is avoidable by the sender. This reproduces all three so they are caught
 * for free instead of on-chain.
 *
 * THIS IS NOT REDUNDANT WITH `compile_actions`. Verified on mainnet: the pool's compiler
 * accepts an empty payload, a wrong length prefix AND an unknown mode without complaint,
 * because it never executes the invoke — it only lays out the action list. All three
 * reach `apply_actions`, revert there, and cost the full fee. The pool cannot protect us
 * from our own contract's asserts; only this function can.
 *
 * Returns the assert string that WOULD be raised, or null when the call is safe.
 */
export function predictMessageBookRevert(
  mode: bigint,
  payload: readonly bigint[],
): 'EMPTY_PAYLOAD' | 'SEAL_NEEDS_ONE_FELT' | 'UNKNOWN_MODE' | null {
  // Order matters: it mirrors the contract, where the payload assert precedes the mode
  // branch. A zero-length payload panics EMPTY_PAYLOAD even for an unknown mode.
  if (payload.length === 0) return 'EMPTY_PAYLOAD'
  if (mode === MODE_APPEND) return null
  if (mode === MODE_SEAL) return payload.length === 1 ? null : 'SEAL_NEEDS_ONE_FELT'
  return 'UNKNOWN_MODE'
}

/** A felt252 is a field element, not a 256-bit integer. Payload entries must fit. */
export const FELT_PRIME =
  0x800000000000011000000000000000000000000000000000000000000000001n

/**
 * Packs UTF-8 into felts, 31 bytes each — the largest chunk that always fits under the
 * field prime regardless of content.
 *
 * NOTE FOR THE CALLER, AND IT IS THE WHOLE REASON THIS COMMENT EXISTS: the result of
 * this function is PLAINTEXT. `MessageBook` emits its payload in a public event, so
 * anything packed here is world-readable forever. The contract's event field is named
 * `ciphertext` because that is what the product will eventually put there; this helper
 * does not encrypt and must never be described as if it does.
 */
export function packUtf8ToFelts(text: string): bigint[] {
  const bytes = new TextEncoder().encode(text)
  const felts: bigint[] = []
  for (let i = 0; i < bytes.length; i += 31) {
    let acc = 0n
    for (const b of bytes.subarray(i, i + 31)) acc = (acc << 8n) | BigInt(b)
    felts.push(acc)
  }
  return felts
}

/**
 * THE REPLAY-PROTECTION RULE, and why each transaction gets a DIFFERENT companion.
 *
 * A transaction carrying only an invoke is illegal: `[InvokeExternal]` is rejected
 * `NO_REPLAY_PROTECTION`. So is `[Deposit(STRK, 1), InvokeExternal]` — which kills the
 * plan's "1-wei self-note" companion outright.
 *
 * What actually satisfies the rule is **an action that compiles to a `WriteOnce`**.
 * Three independent observations agree:
 *   - `SetViewingKey` compiles to two `WriteOnce`s and is accepted.
 *   - `Deposit` compiles to a `TransferFrom` with no `WriteOnce`, and is rejected.
 *   - A real successful mainnet invoke transaction
 *     (0x3ba71e9b1893d7d9bf60845a3619fb293827885ddab063b09db168de1c4004c) carries NO
 *     registration at all: its action list begins `WriteOnce(1 felt)` + `EmitNoteUsed`
 *     — a `UseNote` nullifier — and then the `Invoke`. That is proof the rule is
 *     "some WriteOnce", not "SetViewingKey specifically".
 *
 * `SetViewingKey` IS SINGLE-USE PER ADDRESS AND CANNOT BE THE COMPANION TWICE. Its
 * `WriteOnce` targets the user's key slot, and `_apply_write_once` asserts the slot
 * currently reads zero. Verified directly: `compile_actions` for an already-registered
 * mainnet address rejects `[SetViewingKey]` with `NON_ZERO_VALUE`. Using it on all
 * three transactions would land transaction 1 and burn the fee on 2 and 3.
 *
 * The repeatable companion is `OpenChannel` AT A FRESH INDEX. Its own `WriteOnce`
 * targets a per-index slot, so successive indices do not collide, and a real mainnet
 * user was observed holding **2 channels** — proof that a second `OpenChannel` succeeds
 * in a later transaction. Two constraints, both verified:
 *   - indices must be strictly sequential from 0 (`INDEX_NOT_SEQUENTIAL` otherwise), and
 *   - the sender must already be registered (`SENDER_NOT_REGISTERED` otherwise), which
 *     is why transaction 1 is the one that registers.
 *
 * ORDER IS NOT FREE. `[InvokeExternal, SetViewingKey]` is `ACTIONS_OUT_OF_ORDER`, as is
 * any list with two invoke-phase actions. The invoke executes last, so the companion
 * always comes first.
 */
export type GateCompanion =
  | { kind: 'SetViewingKey'; reason: string }
  | { kind: 'OpenChannel'; index: number; reason: string }

/**
 * The ordered companion plan for `count` gate transactions.
 *
 * Transaction 1 registers, because it must happen once anyway and `OpenChannel` refuses
 * to run before it. Every later transaction opens the next channel. Nothing in this plan
 * repeats a single-use action.
 */
export function planGateCompanions(count: number): GateCompanion[] {
  const plan: GateCompanion[] = [
    {
      kind: 'SetViewingKey',
      reason:
        'registers the sender (single-use: a second one reverts NON_ZERO_VALUE) and ' +
        'supplies this transaction WriteOnce for replay protection',
    },
  ]
  for (let i = 1; i < count; i++) {
    plan.push({
      kind: 'OpenChannel',
      index: i - 1,
      reason:
        `opens channel ${i - 1} — repeatable because each index gets its own WriteOnce slot; ` +
        'indices must be sequential from 0 and the sender must already be registered',
    })
  }
  return plan
}

/** Builds the complete client action list for one gate transaction. */
export function buildGateActionList(input: {
  messageBookAddress: string
  senderAddress: string
  companion: GateCompanion
  mode: bigint
  tag: bigint
  payload: readonly bigint[]
  random: bigint
  salt: bigint
}): ClientAction[] {
  const companion: ClientAction =
    input.companion.kind === 'SetViewingKey'
      ? { type: 'SetViewingKey', random: input.random }
      : {
          type: 'OpenChannel',
          // Self-addressed. `open_channel` requires a REGISTERED recipient, and after
          // transaction 1 the sender is the one address we know satisfies that.
          recipientAddr: input.senderAddress,
          index: input.companion.index,
          random: input.random,
          salt: input.salt,
        }

  return [
    companion,
    {
      type: 'InvokeExternal',
      contractAddress: input.messageBookAddress,
      calldata: buildInvokeCalldata(input.mode, input.tag, input.payload),
    },
  ]
}

/**
 * Probe results from the deployed mainnet pool. Every row is a real `compile_actions`
 * call — a free view — kept in the source because the next person to touch the action
 * list will otherwise re-derive it by spending money.
 *
 * WHEN EACH GROUP WAS ESTABLISHED, and against what. The first two groups were probed on
 * 21 Aug 2026 around block 13654117; the sponsored-registration group on 24 Aug 2026 at
 * block 13763801, when the deployed class hash was still
 * 0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d. The class-hash claim
 * is scoped to that last run because it is the only one whose hash was recorded at the
 * time — the older rows were taken against what was then deployed, which is believed to
 * be the same class but is not evidenced here. The pool is upgradeable at ZERO delay, so
 * re-probe `compile_actions` live rather than trusting any of it
 * across an upgrade.
 */
export const ACTION_LIST_EVIDENCE = [
  {
    group: 'action-list shape',
    rows: [
      ['[InvokeExternal]', 'ERR NO_REPLAY_PROTECTION'],
      ['[Deposit(STRK,1), InvokeExternal]', 'ERR NO_REPLAY_PROTECTION — kills the 1-wei-note plan'],
      ['[Withdraw(STRK,1), InvokeExternal]', 'ERR NEGATIVE_INTERMEDIATE_BALANCE'],
      ['[InvokeExternal, SetViewingKey]', 'ERR ACTIONS_OUT_OF_ORDER'],
      ['[SetViewingKey, InvokeExternal, InvokeExternal]', 'ERR ACTIONS_OUT_OF_ORDER'],
      ['[SetViewingKey, InvokeExternal]', 'OK  4 server actions — calldata returned verbatim'],
      ['[SetViewingKey, InvokeExternal(empty payload)]', 'OK  — pool does NOT catch EMPTY_PAYLOAD'],
      ['[SetViewingKey, InvokeExternal(bad len prefix)]', 'OK  — pool does NOT catch a wrong prefix'],
      ['[SetViewingKey, InvokeExternal(mode 3)]', 'OK  — pool does NOT catch UNKNOWN_MODE'],
    ],
  },
  {
    group: 'single-use vs repeatable',
    rows: [
      ['[SetViewingKey] on an ALREADY-REGISTERED addr', 'ERR NON_ZERO_VALUE — single-use, proven'],
      ['[OpenChannel(0), InvokeExternal] unregistered', 'ERR SENDER_NOT_REGISTERED — needs tx 1 first'],
      ['[SetViewingKey, OpenChannel(0), InvokeExternal]', 'OK  7 server actions'],
      ['[SetViewingKey, OpenChannel(1), InvokeExternal]', 'ERR INDEX_NOT_SEQUENTIAL — must start at 0'],
      ['[SetViewingKey, OpenChannel(0), OpenChannel(1)]', 'ERR NON_ZERO_VALUE — one channel per tx'],
      ['a real mainnet user holds 2 channels', 'so OpenChannel DOES repeat across transactions'],
    ],
  },
  {
    // WHAT IS AND IS NOT HERE. These two rows are `compile_actions` evidence: the pool's
    // compiler accepts the lone registration and rejects a doubled one. They say nothing
    // about the relay and confirm legs, because proving that end of the pipeline costs
    // STRK on mainnet — deliberately deferred to story 1.13's banked-transaction gate,
    // which is where a paid submission is authorised. Do not read a green row here as
    // evidence that a registration has ever actually been submitted.
    group: 'sponsored registration (story 1.12)',
    rows: [
      ['[SetViewingKey] alone on an UNREGISTERED addr', 'OK  3 server actions — the sponsored registration compiles'],
      ['[SetViewingKey, SetViewingKey] in one tx', 'ERR NON_ZERO_VALUE — the write-once slot closes within the tx'],
    ],
  },
  {
    // Probed 24 Aug 2026 at block 13789403, class hash still
    // 0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d. Re-run
    // `compile_actions` live rather than trusting any of it across an upgrade.
    //
    // WHAT THESE ROWS DO AND DO NOT SAY. Every one is a free `compile_actions` view, so they are
    // evidence about what the pool's COMPILER accepts and nothing more — no send has been paid
    // for or submitted. Where a row sources value from a `Deposit` it is standing in for the
    // `UseNote` a funded sender would use: the probe address holds no notes, so a real UseNote
    // stops at NOTE_NOT_FOUND (its own row below) before the rule under test is reached. The
    // balance rules the pool applies are the same either way — `deposit` and `use_note` both
    // call `add_balance` (privacy.cairo:493, :618).
    group: 'send: transfer / withdraw with a relayer fee leg (story 1.16)',
    rows: [
      ['[SVK, OpenChannel(0), OpenSubchannel(0), Deposit(3), CreateEncNote(3)]', 'OK  12 server actions — the send shape compiles'],
      ['… Deposit(3), CreateEncNote(1), Withdraw(1→self), Withdraw(1→relayer)', 'OK  16 server actions — THE DOUBLE-WITHDRAW FEE FOLD COMPILES'],
      ['… Deposit(3), CreateEncNote(1), Withdraw(2→relayer)', 'OK  14 server actions — a fee leg may name a third party'],
      ['… Deposit(3), CreateEncNote(1) — outputs short of inputs', 'ERR FINAL_BALANCE_MUST_BE_ZERO — surplus is as fatal as shortfall'],
      ['… Deposit(1), CreateEncNote(2) — overspend', 'ERR NEGATIVE_INTERMEDIATE_BALANCE'],
      ['… Deposit(3), CreateEncNote(0) — zero-amount note', 'ERR FINAL_BALANCE_MUST_BE_ZERO — a zero note banks nothing'],
      ['[Deposit(1), Withdraw(1)] — balanced, NO invoke, no write-once action', 'ERR NO_REPLAY_PROTECTION — the rule is NOT invoke-gated'],
      ['[SVK, OpenChannel(0), Deposit(1), Withdraw(1)] — companion added', 'OK  10 server actions — one write-once action is enough'],
      ['[SVK, OpenChannel(1)] — a first channel at a non-zero index', 'ERR INDEX_NOT_SEQUENTIAL — the index IS the live channel count'],
      ['[SVK, OpenChannel(0 → an UNREGISTERED recipient)]', 'ERR RECIPIENT_NOT_REGISTERED — what the send pre-flight routes on'],
      ['… OpenSubchannel(0), UseNote — a note this sender does not hold', 'ERR NOTE_NOT_FOUND — the compiler reads real note storage'],
      ['… OpenSubchannel(0), OpenSubchannel(1) — same token twice in one tx', 'ERR NON_ZERO_VALUE — one subchannel per token per tx'],
      ['[OpenChannel(0), …] with no SetViewingKey on an unregistered sender', 'ERR SENDER_NOT_REGISTERED'],
    ],
  },
] as const
