//
// What this account can actually do, right now, on chain.
//
// ── THE LADDER NOBODY HAD WRITTEN DOWN IN ONE PLACE ──────────────────────────────────────
//
// An embedded key is not an account that can transact. Four things have to be true, in order, and
// each one has a different fix:
//
//   1. the key exists                    — `session.ts`, free, done on first load
//   2. the address is FUNDED             — someone sends STRK to it; nothing we can do for them
//   3. the account CONTRACT is deployed  — costs gas, paid from (2), and it is self-deploying
//   4. it is REGISTERED with the pool    — costs the pool fee, and needs (3) to exist first
//
// Step 3 before step 4 is not a preference. It was learned live on 2026-08-24: the prove leg
// SRC5-probes the user's address, so a counterfactual account cannot register — the probe has
// nothing to answer it. `register.ts:1067` records the same thing.
//
// A surface that does not model this ladder can only say "something went wrong". A surface that
// does can say WHICH RUNG and what clears it, which is the difference between a demo and a product.
//
// ── EVERY READ IS PLAIN JSON-RPC ─────────────────────────────────────────────────────────
//
// `fetch` only, like `crowd-rpc.ts` and `token-list.ts`. Deployment is a `starknet_getClassHashAt`
// that errors for an undeployed address; the balance is an ERC-20 `balanceOf`; registration is the
// pool's own `get_public_key`. None of that needs the SDK, so the wallet can tell a user where they
// stand before the crypto graph has finished loading.
//
import { NET, STRK_TOKEN } from '@strk20/protocol/constants'

/** `balanceOf(address)` — precomputed, per `crowd-rpc.ts`'s reason for pinning a selector. */
const BALANCE_OF = '0x2e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e'
/** `get_public_key(address)` on the pool. Zero means "no viewing key written for this address". */
const GET_PUBLIC_KEY = '0x1a35984e05126dbecb7c3bb9929e7dd9106d460c59b1633739a5c733a5fb13b'

export type AccountRung =
  /** Nothing has been read yet. */
  | 'unknown'
  /** The address holds no STRK, so it cannot pay to deploy itself. */
  | 'unfunded'
  /** Funded, but the account contract does not exist yet. */
  | 'undeployed'
  /** Deployed, but the pool holds no viewing key for it. */
  | 'unregistered'
  /** Registered. Everything downstream is available. */
  | 'ready'

export interface AccountStatus {
  rung: AccountRung
  /** Wei of STRK at the address. `null` when the read failed. */
  strkWei: bigint | null
  /** True once `getClassHashAt` answers. */
  deployed: boolean
  /** True once the pool holds a non-zero viewing key. */
  registered: boolean
  /** Set when a read failed — the rung is then `unknown` rather than a guess. */
  because: string | null
}

async function rpc(method: string, params: unknown): Promise<unknown> {
  let last: unknown
  for (const nodeUrl of NET.rpc) {
    try {
      const response = await fetch(nodeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
      if (!response.ok) throw new Error(`${nodeUrl} answered ${response.status}`)
      const body = (await response.json()) as { result?: unknown; error?: unknown }
      // An `error` here is not always a failure — `getClassHashAt` errors for an address that is
      // simply not deployed yet, which is an ANSWER. The caller decides which is which.
      if (body.error) return { __rpcError: body.error }
      return body.result
    } catch (error) {
      last = error
    }
  }
  throw new Error(`all RPC hosts failed: ${String(last)}`)
}

const isRpcError = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && '__rpcError' in value

/**
 * Where this address stands on the ladder.
 *
 * NEVER THROWS. A failed read produces `rung: 'unknown'` with a sentence — which is honest, and
 * distinct from every real rung. Reporting `unfunded` because a host was down would tell someone
 * to send money they may already have sent.
 */
export async function readAccountStatus(address: string): Promise<AccountStatus> {
  const base: AccountStatus = {
    rung: 'unknown',
    strkWei: null,
    deployed: false,
    registered: false,
    because: null,
  }

  try {
    const [balanceRaw, classHashRaw, publicKeyRaw] = await Promise.all([
      rpc('starknet_call', [
        { contract_address: STRK_TOKEN, entry_point_selector: BALANCE_OF, calldata: [address] },
        'latest',
      ]),
      rpc('starknet_getClassHashAt', ['latest', address]),
      rpc('starknet_call', [
        { contract_address: NET.pool, entry_point_selector: GET_PUBLIC_KEY, calldata: [address] },
        'latest',
      ]),
    ])

    // `balanceOf` returns a u256: `[low, high]`. Reading only the low half is correct for every
    // amount below 2^128 and wrong in a way nobody would ever see — so both are folded in.
    let strkWei: bigint | null = null
    if (Array.isArray(balanceRaw) && typeof balanceRaw[0] === 'string') {
      const low = BigInt(balanceRaw[0])
      const high = typeof balanceRaw[1] === 'string' ? BigInt(balanceRaw[1]) : 0n
      strkWei = (high << 128n) + low
    }

    // An error here means "no contract at that address", which is the undeployed state and not a
    // failure to read.
    const deployed = !isRpcError(classHashRaw) && typeof classHashRaw === 'string'

    const registered =
      Array.isArray(publicKeyRaw) && typeof publicKeyRaw[0] === 'string'
        ? BigInt(publicKeyRaw[0]) !== 0n
        : false

    if (strkWei === null) {
      return { ...base, deployed, registered, because: 'The STRK balance could not be read.' }
    }

    const rung: AccountRung = registered
      ? 'ready'
      : deployed
        ? 'unregistered'
        : strkWei > 0n
          ? 'undeployed'
          : 'unfunded'

    return { rung, strkWei, deployed, registered, because: null }
  } catch (error) {
    return {
      ...base,
      because: error instanceof Error ? error.message : 'The account could not be read.',
    }
  }
}
