//
// The token list, fetched once per app session.
//
// ── MODULE-SCOPE CACHE, NOT PER-MOUNT STATE ───────────────────────────────────────────────
//
// Every value surface wants the same list. Fetching per component means /swap and /wallet each pay
// for it, and a user moving between them pays again on every visit — for a list whose contents
// change on the order of days. The promise is cached at module scope, so N callers share one
// request and a remount is free.
//
// ── AND A FAILED FETCH IS NOT CACHED ──────────────────────────────────────────────────────
//
// `fetchTokenList` never throws; it returns `[]`. Caching that would make one bad moment on a
// flaky connection permanent for the life of the tab. So an empty result clears the cache and the
// next mount tries again.
//
import { useEffect, useState } from 'react'
import { fetchTokenList, type TokenInfo } from '@strk20/protocol/token-list'

let cached: Promise<TokenInfo[]> | null = null

function load(): Promise<TokenInfo[]> {
  if (cached) return cached
  cached = fetchTokenList().then((tokens) => {
    if (tokens.length === 0) cached = null
    return tokens
  })
  return cached
}

export interface TokenListState {
  tokens: TokenInfo[]
  /** True until the first answer arrives. Distinct from `tokens.length === 0`, which is an answer. */
  loading: boolean
}

export function useTokenList(): TokenListState {
  const [state, setState] = useState<TokenListState>({ tokens: [], loading: true })

  useEffect(() => {
    let live = true
    void load().then((tokens) => {
      if (live) setState({ tokens, loading: false })
    })
    return () => {
      live = false
    }
  }, [])

  return state
}

/** The list's entry for an address, or `null`. Compares as felts, not as strings. */
export function findToken(tokens: readonly TokenInfo[], address: string | null): TokenInfo | null {
  if (!address) return null
  let target: bigint
  try {
    target = BigInt(address)
  } catch {
    return null
  }
  return (
    tokens.find((token) => {
      try {
        return BigInt(token.address) === target
      } catch {
        return false
      }
    }) ?? null
  )
}
