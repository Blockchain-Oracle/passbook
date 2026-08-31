import { queryOptions } from '@tanstack/react-query'
import type { PoolConstants, PoolHealth } from '@strk20/protocol/pool'
import { RELAYER_PATHS, type Allowance, type AllowanceBody, type FaucetClaimBody } from '@strk20/protocol/relayer-wire'
import type { MeasuredGas } from '@strk20/protocol/fee-ceiling'

import { relayerGet } from '@/lib/relayer'

const POOL_HEALTH_MS = 30_000

/** Paused / upgraded / unreachable / ok with the LIVE fee — never bake the fee as a constant. */
export function poolHealthQuery() {
  return queryOptions({
    queryKey: ['pool', 'health'],
    queryFn: async (): Promise<PoolHealth> => {
      const { readPoolHealth } = await import('@strk20/protocol/pool')
      return readPoolHealth()
    },
    staleTime: POOL_HEALTH_MS,
    refetchInterval: POOL_HEALTH_MS,
  })
}

/**
 * `get_fee_amount` and friends, read at call time for a review sheet. Short-lived on purpose: the
 * ShieldDialog's "Pool fee" row must never show a fee older than the pool it will pay.
 */
export function poolConstantsQuery() {
  return queryOptions({
    queryKey: ['pool', 'constants'],
    queryFn: async (): Promise<PoolConstants> => {
      const { readPoolConstants } = await import('@strk20/protocol/pool')
      return readPoolConstants()
    },
    staleTime: 15_000,
    refetchInterval: 15_000,
  })
}

/** The relayer's fee address. 503 means it is unset — the query errors, nothing is invented. */
export function feeRecipientQuery() {
  return queryOptions({
    queryKey: ['relayer', 'fee-recipient'],
    queryFn: async (): Promise<string> => {
      const body = await relayerGet<{ feeRecipient?: string }>('/api/fee-recipient')
      if (typeof body.feeRecipient !== 'string' || body.feeRecipient === '') {
        throw new Error('the relayer did not name a fee recipient')
      }
      return body.feeRecipient
    },
    staleTime: 5 * 60_000,
  })
}

/**
 * How many sponsored transactions this account has left, or `null` when we cannot say.
 *
 * ── NULL IS A RENDERED STATE, NOT AN ERROR ────────────────────────────────────────────────
 *
 * The banner shows nothing at all when this is `null`, and that is the whole reason the query
 * resolves rather than throws: a deployment that does not meter per account answers 404, and a
 * counter that rendered "0 of 3" there would tell every user their offer had been withdrawn.
 * `undefined` address means no account yet — the query does not run.
 */
export function allowanceQuery(address: string | undefined) {
  return queryOptions({
    queryKey: ['relayer', 'allowance', address ?? null],
    enabled: Boolean(address),
    queryFn: async (): Promise<Allowance | null> => {
      try {
        const body = await relayerGet<AllowanceBody>(`/api/allowance/${address}`)
        const a = body.allowance
        if (!a || !Number.isInteger(a.remaining) || !Number.isInteger(a.of)) return null
        return a
      } catch {
        return null
      }
    },
    staleTime: 15_000,
  })
}

/**
 * What this address can still be GIVEN, or `null` when the relayer could not say.
 *
 * ── TWO GIFTS, TWO GATES, AND CONFLATING THEM HID ONE OF THEM ─────────────────────────────
 *
 * The public drip (STRK to an address so it can deploy) and the shielded starter (a first private
 * note) are separate offers with separate limits. This read used to collapse the whole response to
 * `null` whenever `available` was false — and `available` is the PUBLIC drip's per-visitor budget,
 * which is spent the moment someone takes their drip. So every account that had ever been dripped
 * reported "no offers at all", and the starter it had never claimed became invisible. The starter
 * banner simply never appeared for the one group guaranteed to need it.
 *
 * So each gift now carries its own answer, and neither can silence the other.
 */
export interface FaucetOffer {
  /** The PUBLIC drip: unclaimed, budget left, relayer up. False means do not offer it. */
  drip: boolean
  /**
   * The SHIELDED starting balance, when this deployment hands one out. Absent is not zero: a
   * relayer that offers none has nothing to show, and `0n` would read as an offer withdrawn.
   *
   * Gated by its OWN once-per-account claim and its OWN day budget, not by the public drip's.
   */
  starter?: { wei: bigint; claimed: boolean; available: boolean }
}

/** Parses the shielded starter off the wire, or nothing at all when it cannot be trusted. */
function starterOf(
  raw: { wei: string; claimed: boolean; available?: boolean } | undefined,
): { starter: { wei: bigint; claimed: boolean; available: boolean } } | null {
  if (!raw || typeof raw.wei !== 'string' || typeof raw.claimed !== 'boolean') return null
  try {
    const wei = BigInt(raw.wei)
    // `!== false`, never `=== true`: a relayer from before the starter had a budget omits the
    // field, and reading that as "unavailable" would silently retire a gift that is still there.
    return wei > 0n ? { starter: { wei, claimed: raw.claimed, available: raw.available !== false } } : null
  } catch {
    return null
  }
}

/**
 * What this address can still be given — the public drip, the shielded starter, or neither.
 *
 * `null` FOR EVERY "WE CANNOT SAY", exactly like `allowanceQuery`, and for the same reason: the
 * banner renders nothing on `null`. A deployment with no faucet answers 404, an unreachable one
 * throws, and in both cases offering something that will not arrive is worse than silence.
 *
 * A SPENT DRIP IS NOT ONE OF THOSE CASES, and treating it as one was the bug: `available: false`
 * used to resolve `null`, so every account that had taken its public drip reported no offers at
 * all — and its unclaimed shielded starter went unmentioned on the one screen meant to mention it.
 * A relayer that answers has told us about both gifts; each is reported on its own terms.
 */
export function faucetOfferQuery(address: string | undefined) {
  return queryOptions({
    queryKey: ['relayer', 'faucet-claim', address ?? null],
    enabled: Boolean(address),
    queryFn: async (): Promise<FaucetOffer | null> => {
      try {
        const body = await relayerGet<FaucetClaimBody>(`${RELAYER_PATHS.faucet}/${address}`)
        // Both gifts, independently. A drip that is spent, claimed or unavailable is simply not
        // offered; it says nothing about the starter, which has its own claim.
        return {
          drip: body.available !== false && body.claimed === false,
          ...(starterOf(body.starter) ?? {}),
        }
      } catch {
        return null
      }
    },
    staleTime: 15_000,
  })
}

/**
 * What a proven pool transaction has actually been costing, measured by the relayer.
 *
 * ── NULL FALLS BACK TO THE CONSTANT, WHICH IS THE POINT ───────────────────────────────────
 *
 * Every consumer passes this straight into `resourceBoundsFor` / `feeFloor` / `expectedGasWei`,
 * all of which take it as optional and fall back to `GAS_UNITS` when it is absent. So a relayer
 * that has not sampled yet, or cannot be reached, costs accuracy and nothing else — never a
 * blocked transaction. Resolving rather than throwing is what keeps that true.
 *
 * Refreshed lazily: the relayer re-measures every fifteen minutes because the number tracks a
 * circuit's cost, not a price, and prices are read separately and live.
 */
export function measuredGasQuery() {
  return queryOptions({
    queryKey: ['relayer', 'gas'],
    queryFn: async (): Promise<MeasuredGas | null> => {
      try {
        const b = await relayerGet<{ l2Gas?: string; l1Gas?: string; l1DataGas?: string }>('/api/chain/gas')
        if (!b.l2Gas || !b.l1Gas || !b.l1DataGas) return null
        return { l2Gas: BigInt(b.l2Gas), l1Gas: BigInt(b.l1Gas), l1DataGas: BigInt(b.l1DataGas) }
      } catch {
        return null
      }
    },
    staleTime: 5 * 60_000,
  })
}
