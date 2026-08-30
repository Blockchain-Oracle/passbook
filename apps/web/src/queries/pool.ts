import { queryOptions } from '@tanstack/react-query'
import type { PoolConstants, PoolHealth } from '@strk20/protocol/pool'
import type { Allowance, AllowanceBody } from '@strk20/protocol/relayer-wire'

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
