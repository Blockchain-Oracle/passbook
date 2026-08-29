//
// The shielded balance — per token, in exact wei, stamped with the block it was read beside.
// Pure: a function of a completed walk. Imports nothing that reaches the SDK (the
// `DiscoveryResult` import is type-only), so a browser chunk may take it eagerly.
//
// The one rule: a balance never rounds to a zero it does not have. The exact integer is always
// carried; `isDust` says separately whether the display precision can show it.
//

import { DEFAULT_DISPLAY_DECIMALS, KNOWN_TOKEN_DECIMALS, isDustAt, lookupDecimals } from './token-scale.js'
import { toFeltHex } from './address.js'
import type { DiscoveryResult } from './discovery.js'
import type { ShieldedBalancePresence } from './backup-cadence.js'

// Re-exported so this stays their conceptual home; browser callers may import token-scale directly.
export { DEFAULT_DISPLAY_DECIMALS, KNOWN_TOKEN_DECIMALS, isDustAt, lookupDecimals }

/** One token's holdings, exact. */
export interface TokenBalance {
  token: string
  /** The sum of every unspent note in this token, in the token's smallest unit. */
  wei: bigint
  noteCount: number
  /** How many of those notes are open notes (plaintext amounts in pool storage). */
  openNoteCount: number
  /** `null` means unverified — see `KNOWN_TOKEN_DECIMALS`. */
  decimals: number | null
  /** Non-zero but below display precision. `null`, not `false`, when decimals are unknown. */
  isDust: boolean | null
}

/** Why a book is empty — the distinction the copy turns on. */
export type BookState = 'not-registered' | 'no-activity' | 'holdings' | 'unknown'

export interface ShieldedBalance {
  /** The height the walk was read BESIDE ("as of about block N"), or `null` with no completed walk. */
  blockNumber: number | null
  tokens: TokenBalance[]
  presence: ShieldedBalancePresence
  book: BookState
}

export interface BalanceOptions {
  /** Decimals for tokens beyond `KNOWN_TOKEN_DECIMALS`. Merged over, never under, the known map. */
  decimals?: Readonly<Record<string, number>>
  displayDecimals?: number
}

/** Canonical spelling, or `null` when it is not a felt at all. */
function canonicalToken(token: string): string | null {
  try {
    return toFeltHex(token)
  } catch {
    return null
  }
}

/**
 * Sums a completed walk into per-token rows. A failed walk yields NO rows (zeros would be a
 * statement about holdings). Rows sorted by descending wei, then token, for a stable tile.
 */
export function balancesFrom(result: DiscoveryResult, options: BalanceOptions = {}): ShieldedBalance {
  if (result.state !== 'walked') {
    return { blockNumber: null, tokens: [], presence: 'unknown', book: 'unknown' }
  }

  // Merged BY FELT VALUE: a spread merge keeps both spellings and the built-in one wins silently.
  const decimalsFor: Record<string, number> = {}
  for (const [token, decimals] of Object.entries(KNOWN_TOKEN_DECIMALS)) {
    decimalsFor[canonicalToken(token) ?? token] = decimals
  }
  for (const [token, decimals] of Object.entries(options.decimals ?? {})) {
    decimalsFor[canonicalToken(token) ?? token] = decimals
  }

  // Keyed by felt value too: two spellings of one token would halve the balance on screen.
  const byToken = new Map<string, TokenBalance>()
  for (const note of result.notes) {
    const canonical = canonicalToken(note.token)
    const key = canonical ?? note.token
    const row = byToken.get(key) ?? {
      token: canonical ?? note.token,
      wei: 0n,
      noteCount: 0,
      openNoteCount: 0,
      decimals: lookupDecimals(decimalsFor, note.token),
      isDust: null,
    }
    row.wei += note.amount
    row.noteCount += 1
    if (note.open) row.openNoteCount += 1
    byToken.set(key, row)
  }

  const tokens = [...byToken.values()]
  for (const row of tokens) {
    row.isDust = row.decimals === null ? null : isDustAt(row.wei, row.decimals, options.displayDecimals)
  }
  tokens.sort((a, b) => (b.wei === a.wei ? a.token.localeCompare(b.token) : b.wei > a.wei ? 1 : -1))

  return {
    blockNumber: result.blockNumber,
    tokens,
    presence: result.presence,
    // Order matters: an unregistered address holding a note is still holding it.
    book: !result.registered ? 'not-registered' : tokens.length > 0 ? 'holdings' : 'no-activity',
  }
}
