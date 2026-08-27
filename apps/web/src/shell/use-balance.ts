//
// The shielded balance, read from the pool (story: the wallet surface).
//
// ── THIS IS THE CLAIM THE PRODUCT IS NAMED AFTER ─────────────────────────────────────────
//
// `wallet.tsx` carried the obligation and deferred the balance half: *"a shielded balance needs the
// discovery walk and the walk needs the privacy SDK, which this bundle may not contain."* That
// constraint was real and it is now lifted — the SDK may live in a lazily-fetched chunk, and the
// build gate proves it never reaches first paint.
//
// ── FOUR STATES, AND "EMPTY" IS NOT "UNKNOWN" ────────────────────────────────────────────
//
// `balances.ts` models the difference and it is the whole point of reading honestly:
//
//   not-registered  the pool holds no viewing key for this address — nothing could have been sent
//   no-activity     registered, walked, holding nothing. An ordinary state, not a failure
//   holdings        registered and holding notes
//   unknown         the walk did not complete. We do NOT know, and this is not an empty book
//
// A UI that renders `unknown` as "0" tells someone they have nothing when the truth is that we
// could not look. That is the single most damaging thing this screen could do, so the state
// travels intact all the way to the render.
//
import { useCallback, useEffect, useState } from 'react'
import type { ShieldedBalance } from '@strk20/protocol/balances'
import type { DiscoveryResult } from '@strk20/protocol/discovery'

export interface BalanceState {
  /** `null` until the first walk completes or fails. */
  balance: ShieldedBalance | null
  /**
   * The walk itself, for readings this hook does not take.
   *
   * ── ONE WALK, TWO READINGS ─────────────────────────────────────────────────────────────
   *
   * The activity feed needs this walk's REGISTRY to tell its own rows from the pool's, and a
   * second `discoverWallet` would be a second sweep of pool storage for data already in memory —
   * and worse, a sweep taken at a different height, so the feed and the balance beside it would
   * describe two different moments. Exposed rather than duplicated for that reason. `useActivity`
   * is the only consumer.
   */
  read: DiscoveryResult | null
  /** A walk is in flight. The previous reading, if any, is still in `balance`. */
  loading: boolean
  /** Re-walk. The user asking is the only refresh this screen has. */
  refresh: () => void
}

/**
 * Walk the pool for what this account holds.
 *
 * NOT POLLED, deliberately. A discovery walk is a bounded sweep over pool events, not a cheap
 * read, and a screen that re-walked on a timer would spend a user's connection to tell them the
 * same thing. It runs on mount and when they ask.
 */
export function useBalance(address: string | null, accountKey: string | null): BalanceState {
  const [balance, setBalance] = useState<ShieldedBalance | null>(null)
  const [read, setRead] = useState<DiscoveryResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  useEffect(() => {
    if (!address || !accountKey) return

    let live = true
    setLoading(true)

    void (async () => {
      // Lazy, for the gate's reason: `discovery` reaches the privacy SDK and `/wallet` is the cold
      // open, so a static import here would be the crypto graph in the entry chunk.
      const [{ discoverWallet }, { balancesFrom }] = await Promise.all([
        import('@strk20/protocol/discovery'),
        import('@strk20/protocol/balances'),
      ])

      // `discoverWallet` never throws — every failure arrives as `unreachable`/`unknown`, because
      // from the outside an exhausted RPC and a half-finished walk are the same fact.
      const result = await discoverWallet(address, accountKey)
      if (!live) return
      setBalance(balancesFrom(result))
      setRead(result)
      setLoading(false)
    })().catch(() => {
      // A failed CHUNK load, which `discoverWallet`'s own guarantee cannot cover. Same honest
      // answer: we do not know what this account holds.
      if (live) setLoading(false)
    })

    return () => {
      live = false
    }
  }, [address, accountKey, nonce])

  return { balance, read, loading, refresh }
}
