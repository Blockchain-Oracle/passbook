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
  | { type: 'InvokeExternal'; contractAddress: string; calldata: readonly string[] }

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
 * Builds the complete client action list for one gate transaction.
 *
 * THE COMPANION ACTION IS `SetViewingKey`, NOT A 1-WEI SELF-NOTE. This contradicts the
 * plan and the contradiction is load-bearing, so here is the evidence rather than an
 * assertion: on mainnet, `[Deposit(STRK, 1), InvokeExternal]` is rejected
 * `NO_REPLAY_PROTECTION`, and so is `[InvokeExternal]` alone. `[SetViewingKey,
 * InvokeExternal]` compiles cleanly to four server actions. A transaction carrying only
 * an invoke is illegal on this protocol, exactly as the plan said — but the thing that
 * makes it legal is the viewing-key write, because that is what supplies the replay
 * nonce.
 *
 * ORDER IS NOT FREE. `[InvokeExternal, SetViewingKey]` is rejected
 * `ACTIONS_OUT_OF_ORDER`, as is any list with two invoke-phase actions. Actions execute
 * in a fixed phase order and the invoke is last, so `SetViewingKey` must be first.
 *
 * SIDE EFFECT, FLAGGED DELIBERATELY: `SetViewingKey` rotates the caller's viewing key.
 * That is a real state change on the user's account, not an inert nonce, and running
 * this three times rotates it three times. It is the pool's own replay primitive and the
 * registration flow uses it, so it is legitimate — but it is not free of consequences
 * and whoever runs this should know that before they do.
 */
export function buildGateActionList(input: {
  messageBookAddress: string
  mode: bigint
  tag: bigint
  payload: readonly bigint[]
  viewingKeyRandom: bigint
}): ClientAction[] {
  return [
    { type: 'SetViewingKey', random: input.viewingKeyRandom },
    {
      type: 'InvokeExternal',
      contractAddress: input.messageBookAddress,
      calldata: buildInvokeCalldata(input.mode, input.tag, input.payload),
    },
  ]
}

/**
 * Probe results from the deployed mainnet pool, 21 Aug 2026, block ~13654117. Each row
 * is a real `compile_actions` call. Kept in the source because the next person to touch
 * the action list will otherwise re-derive it by spending money.
 */
export const ACTION_LIST_EVIDENCE = [
  ['[InvokeExternal]', 'ERR NO_REPLAY_PROTECTION'],
  ['[Deposit(STRK,1), InvokeExternal]', 'ERR NO_REPLAY_PROTECTION'],
  ['[Withdraw(STRK,0)]', 'ERR ZERO_AMOUNT'],
  ['[CreateOpenNote, InvokeExternal]', 'ERR ZERO_RECIPIENT_PUBLIC_KEY (needs a registered user)'],
  ['[InvokeExternal, SetViewingKey]', 'ERR ACTIONS_OUT_OF_ORDER'],
  ['[SetViewingKey, InvokeExternal, InvokeExternal]', 'ERR ACTIONS_OUT_OF_ORDER'],
  ['[SetViewingKey]', 'OK  3 server actions'],
  ['[SetViewingKey, InvokeExternal]', 'OK  4 server actions — calldata returned verbatim'],
  ['[SetViewingKey, InvokeExternal(empty payload)]', 'OK  — pool does NOT catch EMPTY_PAYLOAD'],
  ['[SetViewingKey, InvokeExternal(bad len prefix)]', 'OK  — pool does NOT catch a wrong prefix'],
  ['[SetViewingKey, InvokeExternal(mode 3)]', 'OK  — pool does NOT catch UNKNOWN_MODE'],
] as const
