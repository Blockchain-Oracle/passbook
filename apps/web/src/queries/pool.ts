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

/** Whether the starter drip is still there for this address, or `null` when we cannot say. */
export interface FaucetOffer {
  claimed: boolean
}

/**
 * Whether this address can still take the starter drip.
 *
 * `null` FOR EVERY "WE CANNOT SAY", exactly like `allowanceQuery`, and for the same reason: the
 * banner renders nothing on `null`. A deployment with no faucet answers 404, an unreachable one
 * throws, and in both cases offering starter STRK that will not arrive is worse than silence.
 * `available: false` also resolves `null` — there is no offer to make and no claim to report.
 */
export function faucetOfferQuery(address: string | undefined) {
  return queryOptions({
    queryKey: ['relayer', 'faucet-claim', address ?? null],
    enabled: Boolean(address),
    queryFn: async (): Promise<FaucetOffer | null> => {
      try {
        const body = await relayerGet<FaucetClaimBody>(`${RELAYER_PATHS.faucet}/${address}`)
        if (body.available === false || typeof body.claimed !== 'boolean') return null
        return { claimed: body.claimed }
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
