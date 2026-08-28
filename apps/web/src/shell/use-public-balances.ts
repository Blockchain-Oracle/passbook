//
// The public balances, as a hook, on `use-balance.ts`'s contract.
//
// It mirrors that file DELIBERATELY — same shape, same refresh discipline, same "the previous
// reading stays visible while a new one is in flight" promise — because the two numbers sit beside
// each other on the wallet and a user comparing them must not be comparing readings taken under
// different rules.
//
// THE ONE DIFFERENCE IS COST. A shielded read is a full discovery walk over the pool, which is why
// `useBalance` runs on mount and on request only. A public read is N `balanceOf` calls, which is
// cheap enough to also refresh when the token list itself changes — and it has to, or a wallet
// that just learned about USDC would keep showing the balances of the list it booted with.
//
import { useCallback, useEffect, useMemo, useState } from 'react'

import { readPublicBalances } from './public-balances'

export interface PublicBalanceState {
  /**
   * Per token, keyed by the token's address, lowercased.
   *
   * A token ABSENT from this map has not been read yet. A token PRESENT with `null` was read and
   * failed. Neither is zero, and the surface renders all three differently — see the file header
   * on `public-balances.ts`.
   */
  byToken: ReadonlyMap<string, bigint | null>
  /** A read is in flight. The previous readings, if any, are still in `byToken`. */
  loading: boolean
  /** Ask for a fresh read — after a send, a shield, or a drip that just landed. */
  refresh: () => void
}

export function usePublicBalances(
  address: string | null,
  tokens: readonly string[],
): PublicBalanceState {
  const [byToken, setByToken] = useState<ReadonlyMap<string, bigint | null>>(new Map())
  const [loading, setLoading] = useState(false)
  const [nonce, setNonce] = useState(0)

  const refresh = useCallback(() => setNonce((n) => n + 1), [])

  //
  // JOINED INTO A STRING, and that is not a micro-optimisation.
  //
  // `tokens` is an array the caller rebuilds every render (`useTokenList` maps over its list), so
  // depending on the array itself would re-run this effect forever — N `balanceOf` calls per render
  // against a mainnet RPC host. Depending on its CONTENT re-runs it exactly when the content
  // changes, which is the actual condition.
  //
  const key = tokens.join(',')

  useEffect(() => {
    if (address === null || tokens.length === 0) {
      setByToken(new Map())
      return
    }
    let live = true
    setLoading(true)
    void readPublicBalances(tokens, address)
      .then((readings) => {
        if (!live) return
        setByToken(new Map(readings.map((r) => [r.token.toLowerCase(), r.wei])))
        setLoading(false)
      })
      .catch(() => {
        // `readPublicBalances` does not throw, so this is unreachable by its contract. Handled
        // anyway, because the alternative is a hero stuck on a spinner forever if it ever does.
        if (live) setLoading(false)
      })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` IS `tokens`, by content.
  }, [address, key, nonce])

  return useMemo(() => ({ byToken, loading, refresh }), [byToken, loading, refresh])
}
