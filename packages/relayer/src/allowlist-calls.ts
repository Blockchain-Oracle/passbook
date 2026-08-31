// Per-call allowlist rules: which entrypoint on which contract, the bounded STRK approve, and the
// v3 details (proofFacts, resourceBounds) that ride beside a call. `allowlist.ts` owns the batch
// rules and re-exports everything here, so its public surface is unchanged.
import type { Call } from 'starknet'
import { NET, STRK_TOKEN } from '../../protocol/src/constants.js'

export interface SubmissionPolicy {
  /** The deployed MessageBook, once evidence/deployment.json exists. */
  messageBook?: string
  /** Absent means permitted NOTHING — the closing `throw refuse(call)` fails safe. Same for the rest. */
  markets?: string
  launch?: string
  /** The deployed Governance contract — only when writable. */
  governance?: string
  /** Ceiling for a STRK approve, from the LIVE fee. Absent means no approve may be signed. */
  maxApproveWei?: bigint
}

/**
 * The direct entrypoints a BROWSER may ask this relayer to sign. All are permissionless, take no
 * value, and pay the caller nothing; `sweep` and `publish_key` are deliberately absent (they carry
 * a bearer secret / Teller material and must never be signed from a user submission).
 *
 * ── IT WAS CALLED `KEEPER_ENTRYPOINTS`, AND THE NAME WAS THE BUG ──────────────────────────
 *
 * Nothing here has ever served the keeper. `assertSubmittable` is reached from exactly one place —
 * `POST /submit` — and the market keeper and the Teller do not go through it: both sign through the
 * signer queue directly (`server.ts` wires `send` to `execute`, `tellerSubmitters` likewise). So
 * this list never granted the keeper anything it needed, and `resolve`, `void`, `graduate`,
 * `publish_tally`, `execute` and `void_proposal` sat here granting a capability nothing asked for.
 * They are gone. If a keeper action ever does need to travel through `/submit`, add it back
 * deliberately and say why — do not restore it to make an error disappear.
 *
 * What is left is the three calls the app actually posts, and they are now METERED: the browser
 * signs them itself unless the user spends one of their covered transactions, in which case it
 * arrives with `account` + `covered` and counts down (`use-direct-invoke.ts`). Before that, the app
 * posted them with no flags at all and this relayer paid the gas for every House, proposal and
 * token launch anybody cared to create, forever, counted against nothing a user could see.
 */
export const DIRECT_ENTRYPOINTS = {
  markets: [],
  launch: ['create_launch'],
  governance: ['create_house', 'propose'],
} as const satisfies Record<string, readonly string[]>

export type AppContractName = keyof typeof DIRECT_ENTRYPOINTS

/** A felt in hex or decimal — starknet.js `CallData.compile` emits decimal. 78 digits leaves margin. */
export const FELT = /^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/

/** The Cairo field order, `2^251 + 17·2^192 + 1`. */
export const STARK_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n

const U128_CEILING = 1n << 128n

/** A real mainnet prove returns nine facts; 128 is generous and still a bound. */
export const MAX_PROOF_FACTS = 128

/** Worst-case gas one submission may cost this wallet — matches ABSOLUTE_MAX_APPROVE_WEI. */
export const MAX_RESOURCE_BOUNDS_WEI = 20_000_000_000_000_000_000n

const GAS_LANES = ['l1_gas', 'l2_gas', 'l1_data_gas'] as const

/** BIGINTS, not hex strings — a hex string throws inside starknet.js hash construction. */
export interface ResourceBounds {
  l1_gas: { max_amount: bigint; max_price_per_unit: bigint }
  l2_gas: { max_amount: bigint; max_price_per_unit: bigint }
  l1_data_gas: { max_amount: bigint; max_price_per_unit: bigint }
}

/** Never throws: a refusal whose own formatting throws (bigint in JSON) is a failure of its own. */
export function describe(value: unknown): string {
  if (typeof value === 'bigint') return `${value}n`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    try {
      return String(value)
    } catch {
      return '[unprintable]'
    }
  }
}

/** Shape before value: `BigInt(["0x…"])` parses, so arrays and padded strings are refused here. */
export function assertFeltAddress(value: unknown, label: string): string {
  if (typeof value !== 'string' || !FELT.test(value)) {
    throw new Error(`refusing ${label}: ${describe(value)} is not a felt address`)
  }
  return value
}

/** Felts have no canonical zero-padding, so addresses compare as numbers, never as strings. */
export function sameAddress(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

export function matches(call: Call, address: string, entrypoint: string): boolean {
  return (
    typeof call?.contractAddress === 'string' &&
    FELT.test(call.contractAddress) &&
    sameAddress(call.contractAddress, address) &&
    call.entrypoint === entrypoint
  )
}

function refuse(call: Call): Error {
  return new Error(
    `refusing to sign ${call.entrypoint} on ${call.contractAddress}: not an allowlisted call`,
  )
}

/** `approve` only with the pool as spender AND under the live-fee ceiling — `approve(pool, MAX)` is the wallet. */
export function assertApproveIsBounded(call: Call, policy: SubmissionPolicy): void {
  const { calldata } = call
  if (!Array.isArray(calldata)) {
    throw new Error('refusing STRK.approve: calldata is not an array this server can inspect')
  }
  if (calldata.length !== 3) {
    throw new Error(
      `refusing STRK.approve: expected 3 calldata felts (spender, amount_low, amount_high), got ${calldata.length}`,
    )
  }
  const spender = assertFeltAddress(calldata[0], 'STRK.approve spender')
  if (!sameAddress(spender, NET.pool)) {
    throw new Error(`refusing STRK.approve to ${spender}: the pool is the only permitted spender`)
  }
  const low = BigInt(assertFeltAddress(calldata[1], 'STRK.approve amount_low'))
  const high = BigInt(assertFeltAddress(calldata[2], 'STRK.approve amount_high'))
  if (low >= U128_CEILING || high >= U128_CEILING) {
    throw new Error('refusing STRK.approve: amount is not a well-formed u256')
  }
  const amount = (high << 128n) | low
  if (policy.maxApproveWei === undefined) {
    throw new Error(
      'refusing STRK.approve: the live fee could not be read, so there is no bound to check it against',
    )
  }
  if (amount > policy.maxApproveWei) {
    throw new Error(
      `refusing STRK.approve of ${amount} wei: above the ${policy.maxApproveWei} wei ceiling drawn from the live fee`,
    )
  }
}

/** One call against the policy. First match wins; anything unmatched is refused. */
export function assertCallAllowed(call: Call, policy: SubmissionPolicy): void {
  const to = assertFeltAddress(call.contractAddress, 'contractAddress')
  if (typeof call.entrypoint !== 'string') {
    throw new Error('refusing a call whose entrypoint is not a string')
  }
  if (sameAddress(to, NET.pool)) {
    if (call.entrypoint !== 'apply_actions') throw refuse(call)
    return
  }
  if (policy.messageBook && sameAddress(to, policy.messageBook)) {
    if (call.entrypoint !== 'privacy_invoke') throw refuse(call)
    return
  }
  for (const [name, entrypoints] of Object.entries(DIRECT_ENTRYPOINTS) as [
    AppContractName,
    readonly string[],
  ][]) {
    const address = policy[name]
    if (address && sameAddress(to, address)) {
      if (call.entrypoint === 'privacy_invoke') return
      // The pool calls these mid-transaction; naming them directly is impersonating the pool.
      if (
        call.entrypoint === 'privacy_compute' ||
        call.entrypoint === 'privacy_invoke_with_computation'
      ) {
        throw refuse(call)
      }
      if (entrypoints.includes(call.entrypoint)) return
      throw refuse(call)
    }
  }
  if (sameAddress(to, STRK_TOKEN)) {
    // `transfer` would hand the whole balance to the caller — the single most important refusal.
    if (call.entrypoint !== 'approve') throw refuse(call)
    assertApproveIsBounded(call, policy)
    return
  }
  throw refuse(call)
}

/** Caller-supplied v3 bounds: shape, then the product of all lanes against one cap. Refuses, never clamps. */
export function assertResourceBounds(value: unknown): ResourceBounds {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`refusing resourceBounds: ${describe(value)} is not an object`)
  }
  const raw = value as Record<string, unknown>
  const out = {} as ResourceBounds
  let worstCase = 0n
  for (const lane of GAS_LANES) {
    const entry = raw[lane]
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`refusing resourceBounds: ${lane} is missing or not an object`)
    }
    const fields = entry as Record<string, unknown>
    const parse = (field: 'max_amount' | 'max_price_per_unit'): bigint => {
      const v = fields[field]
      if (typeof v === 'bigint') return v
      if (typeof v !== 'string' || !FELT.test(v)) {
        throw new Error(`refusing resourceBounds ${lane}.${field}: ${describe(v)} is not a number`)
      }
      return BigInt(v)
    }
    const amount = parse('max_amount')
    const price = parse('max_price_per_unit')
    worstCase += amount * price
    out[lane] = { max_amount: amount, max_price_per_unit: price }
  }
  if (worstCase > MAX_RESOURCE_BOUNDS_WEI) {
    throw new Error(
      `refusing resourceBounds whose worst case is ${worstCase} wei: the ceiling is ` +
        `${MAX_RESOURCE_BOUNDS_WEI}. Bounds are spending authority over this wallet, and raising ` +
        'this number to clear the error removes the only thing bounding it.',
    )
  }
  return out
}

/** Prover facts ride in the v3 details, not calldata, so they get their own gate: shape, count, range. */
export function assertProofFacts(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`refusing proofFacts: ${describe(value)} is not an array`)
  }
  if (value.length > MAX_PROOF_FACTS) {
    throw new Error(
      `refusing ${value.length} proofFacts: the limit is ${MAX_PROOF_FACTS}, and a real ` +
        'mainnet prove returns nine',
    )
  }
  // Empty is a caller who meant to send some; omitting the field is how "none" is spelled.
  if (value.length === 0) {
    throw new Error('refusing an empty proofFacts array: omit the field entirely instead')
  }
  // `Array.from`, not `.map`: `map` skips holes, and a hole arrives at signing as `undefined`.
  return Array.from({ length: value.length }, (_, i) => {
    const fact = value[i]
    if (typeof fact !== 'string' || !FELT.test(fact)) {
      throw new Error(`refusing proofFacts[${i}]: ${describe(fact)} is not a felt`)
    }
    // A value above the prime is reduced modulo P on the way in — signed ≠ inspected.
    if (BigInt(fact) >= STARK_PRIME) {
      throw new Error(
        `refusing proofFacts[${i}]: ${fact} is not below the Stark field prime, so it ` +
          'would be silently reduced into a different value than the one checked here',
      )
    }
    return fact
  })
}
