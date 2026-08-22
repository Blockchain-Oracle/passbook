//
// The MessageBook call rules, in a form a browser can run with no build step.
//
// SOURCE OF TRUTH IS `packages/protocol/src/message-book.ts`. Every rule below was
// established there by probing the deployed mainnet pool, not by reading docs. This
// file is a port, and a port drifts: `web/message-book.test.js` imports BOTH modules
// and asserts they agree on the same inputs, so a change made to one and not the other
// fails the suite instead of failing on-chain.
//
// It is a plain ES module with no imports on purpose — it must load from a static file
// server and it must also load under vitest, and anything it imported would have to do
// both too.
//

/** Modes accepted by `MessageBook::privacy_invoke`. Anything else panics `UNKNOWN_MODE`. */
export const MODE_APPEND = 1n
export const MODE_SEAL = 2n

/** A felt252 is a field element, not a 256-bit integer. Every calldata entry must fit. */
export const FELT_PRIME =
  0x800000000000011000000000000000000000000000000000000000000000001n

/** Mirrors the TypeScript `toFelt` exactly, including its pass-through of `0x` strings. */
export function toFelt(v) {
  return typeof v === 'string'
    ? v.startsWith('0x')
      ? v
      : `0x${BigInt(v).toString(16)}`
    : `0x${BigInt(v).toString(16)}`
}

/**
 * The calldata the pool forwards, unexamined, to `MessageBook::privacy_invoke`.
 *
 * `[mode, tag, payload_len, ...payload]` — the length prefix is the serde header of the
 * `Span<felt252>` parameter, so a prefix that disagrees with what follows it mis-parses
 * the call. `invoke_external` performs NO ABI inspection: it copies this array into
 * `InvokeInput.calldata` verbatim, so a mistake here is not caught until the transaction
 * executes, which is after the pool fee has been collected.
 */
export function buildInvokeCalldata(mode, tag, payload) {
  const calldata = [toFelt(mode), toFelt(tag), toFelt(payload.length), ...payload.map(toFelt)]
  const declared = BigInt(calldata[2])
  if (declared !== BigInt(calldata.length - 3)) {
    throw new Error(
      `length prefix ${declared} does not match the ${calldata.length - 3} payload felts that follow it`,
    )
  }
  return calldata
}

/**
 * `MessageBook::privacy_invoke` has exactly three caller-triggerable panics and every
 * one of them is avoidable by the sender.
 *
 * THIS IS NOT REDUNDANT WITH THE POOL'S OWN `compile_actions`. Verified on mainnet: the
 * pool's compiler accepts an empty payload, a wrong length prefix AND an unknown mode
 * without complaint, because it never executes the invoke — it only lays out the action
 * list. All three reach `apply_actions`, revert there, and cost the full fee.
 *
 * Returns the assert string that WOULD be raised, or null when the call is safe.
 */
export function predictMessageBookRevert(mode, payload) {
  // Order matters: it mirrors the contract, where the payload assert precedes the mode
  // branch. A zero-length payload panics EMPTY_PAYLOAD even for an unknown mode.
  if (payload.length === 0) return 'EMPTY_PAYLOAD'
  if (mode === MODE_APPEND) return null
  if (mode === MODE_SEAL) return payload.length === 1 ? null : 'SEAL_NEEDS_ONE_FELT'
  return 'UNKNOWN_MODE'
}

/**
 * Packs UTF-8 into felts, 31 bytes each — the largest chunk that always fits under the
 * field prime regardless of content.
 *
 * THE RESULT IS PLAINTEXT. `MessageBook` emits its payload in a public event, so
 * anything packed here is world-readable forever. The contract's event field is named
 * `ciphertext` because that is what the product will eventually put there; this helper
 * does not encrypt and must never be described as if it does.
 */
export function packUtf8ToFelts(text) {
  const bytes = new TextEncoder().encode(text)
  const felts = []
  for (let i = 0; i < bytes.length; i += 31) {
    let acc = 0n
    for (const b of bytes.subarray(i, i + 31)) acc = (acc << 8n) | BigInt(b)
    felts.push(acc)
  }
  return felts
}

/**
 * Re-derives every rule from the calldata array that is ABOUT TO BE HANDED TO THE
 * WALLET, rather than from the inputs it was built out of.
 *
 * That distinction is the whole point. Checking the inputs proves the inputs were fine;
 * checking the array proves the thing being paid for is fine. If a future edit builds
 * calldata some other way, or a UI field is read twice and changes in between, this
 * still catches it — the array is parsed back into `[mode, tag, len, ...payload]` and
 * judged on its own.
 *
 * Returns a list of failures, empty when the call is safe to submit. Never throws:
 * callers render these, and a validator that throws on bad input is a validator that
 * stops validating at the first problem.
 */
export function checkInvokeCalldata(calldata) {
  const failures = []
  const fail = (rule, detail) => failures.push({ rule, detail })

  if (!Array.isArray(calldata) || calldata.length < 3) {
    fail(
      'MALFORMED_CALLDATA',
      `privacy_invoke calldata is [mode, tag, payload_len, ...payload] and needs at least 3 ` +
        `felts; got ${Array.isArray(calldata) ? calldata.length : typeof calldata}`,
    )
    return failures
  }

  // Parse every entry before judging any of it: a non-felt anywhere makes the whole
  // array meaningless, and reporting "bad mode" for what is really a bad hex string
  // sends the reader to the wrong place.
  const parsed = []
  calldata.forEach((item, i) => {
    let v
    try {
      v = BigInt(item)
    } catch {
      fail('NOT_A_FELT', `calldata[${i}] is not a number: ${JSON.stringify(item)}`)
      return
    }
    if (v < 0n || v >= FELT_PRIME) {
      fail('NOT_A_FELT', `calldata[${i}] is outside the felt252 field: ${v}`)
      return
    }
    parsed[i] = v
  })
  if (failures.length) return failures

  const mode = parsed[0]
  const declaredLength = parsed[2]
  const payload = parsed.slice(3)

  // The length prefix is checked against the array itself, which is the only place a
  // wrong prefix can be seen. The pool does not look at it and neither does the wallet.
  if (declaredLength !== BigInt(payload.length)) {
    fail(
      'LENGTH_PREFIX_MISMATCH',
      `calldata[2] declares ${declaredLength} payload felts but ${payload.length} follow it — ` +
        `the pool copies this array verbatim, so the call would mis-parse on-chain`,
    )
  }

  const revert = predictMessageBookRevert(mode, payload)
  if (revert === 'EMPTY_PAYLOAD') {
    fail('EMPTY_PAYLOAD', 'the payload is empty and privacy_invoke asserts payload.len() != 0')
  } else if (revert === 'SEAL_NEEDS_ONE_FELT') {
    fail(
      'SEAL_NEEDS_ONE_FELT',
      `MODE_SEAL takes exactly one felt (the root); this payload has ${payload.length}`,
    )
  } else if (revert === 'UNKNOWN_MODE') {
    fail('UNKNOWN_MODE', `mode ${mode} is neither MODE_APPEND (1) nor MODE_SEAL (2)`)
  }

  return failures
}
