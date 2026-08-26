//
// The shielded balance — per token, in exact wei, stamped with the block it was read against
// (FR-011a, story 1.9 AC2).
//
// Pure. Everything here is a function of a completed walk; nothing reaches a chain. The reads
// happened in `discovery.ts`, and keeping the arithmetic separate from them is what lets the
// dust rule and the empty-versus-unregistered rule be tested without a network at all.
//
// ── THE ONE RULE THIS FILE EXISTS TO ENFORCE ─────────────────────────────────────────────
//
// A balance must never round to a zero it does not have. A user holding 400 wei of an
// 18-decimal token holds something, and a tile that shows "0" has told them their money is
// gone. So the model carries the exact integer always, and says separately — as a predicate,
// not a rounded string — whether the exact integer is too small for the display precision the
// caller intends to use. Epic 6 owns the subscript rendering; this owns the truth it renders.
//

import {
  DEFAULT_DISPLAY_DECIMALS,
  KNOWN_TOKEN_DECIMALS,
  isDustAt,
  lookupDecimals,
} from './token-scale.js'
import { toFeltHex } from './discovery.js'
import type { DiscoveryResult } from './discovery.js'
import type { ShieldedBalancePresence } from './backup-cadence.js'

//
// THE SCALE AND THE DUST RULE LIVE IN `token-scale.ts`, AND THEY MOVED FOR A REASON.
//
// This module imports `toFeltHex` from `discovery.ts`, which imports the privacy SDK, whose logger
// imports Node's `async_hooks`. So anything importing this file to get one integer — how many
// decimal places STRK has — shipped the whole chain-walking graph to the browser with it. A UI
// story hit that and `build:web` caught it as a single unexpected externalization warning.
//
// They are re-exported here so this file remains their conceptual home and no existing caller had
// to change. A browser-side caller should import `token-scale.js` directly.
//
export { DEFAULT_DISPLAY_DECIMALS, KNOWN_TOKEN_DECIMALS, isDustAt }

/** One token's holdings, exact. */
export interface TokenBalance {
  token: string
  /** The sum of every unspent note in this token, in the token's smallest unit. Exact. */
  wei: bigint
  /** How many unspent notes make it up. A spend has to pick from these. */
  noteCount: number
  /** How many of those notes are open notes, whose amounts were plaintext in pool storage. */
  openNoteCount: number
  /** The token's decimals, when known. `null` means unverified — see `KNOWN_TOKEN_DECIMALS`. */
  decimals: number | null
  /**
   * True when the exact amount is non-zero but smaller than the display precision can show.
   *
   * `null`, NOT `false`, when the decimals are unknown. `false` is the claim "this renders
   * fine at full precision", and we cannot make it about a token whose scale we have not
   * verified — the tri-state is the same fail-closed habit as `ShieldedBalancePresence`.
   */
  isDust: boolean | null
}

/** Why a book is empty — the distinction the copy turns on. */
export type BookState =
  /** The pool holds no viewing key for this address. Nothing could have been sent to it. */
  | 'not-registered'
  /** Registered, walked, and holding nothing. A real, ordinary state. */
  | 'no-activity'
  /** Registered and holding at least one note. */
  | 'holdings'
  /** The walk did not complete. We do not know, and this is not an empty book. */
  | 'unknown'

/** The whole balance model for one session. */
export interface ShieldedBalance {
  /**
   * The height the walk was read BESIDE, or `null` when there was no completed walk.
   *
   * "Beside", not "at": the SDK walk cannot be pinned to a block (see `discoverWallet`), so
   * this is the height the same provider reported immediately before walking. The grammar the
   * copy uses for it — "as of about block N" — is the honest form of that.
   */
  blockNumber: number | null
  tokens: TokenBalance[]
  presence: ShieldedBalancePresence
  book: BookState
}

/** What `balancesFrom` may be told about tokens it does not already know. */
export interface BalanceOptions {
  /** Decimals for tokens beyond `KNOWN_TOKEN_DECIMALS`. Merged over, never under, the known map. */
  decimals?: Readonly<Record<string, number>>
  displayDecimals?: number
}

//
// MOVED TO `token-scale.ts` (story 6.6), RE-EXPORTED HERE so no caller changed.
//
// It is pure `BigInt` comparison and never needed anything this module imports — but living here
// made it unreachable from a browser, because this module's first import reaches the privacy SDK.
// The receipt page is the first UI caller that looks a token up by an address taken from chain
// data rather than from `constants.ts`, which is exactly the case 6.4's review predicted would
// silently return `undefined` from a direct index into the string-keyed map.
//
export { lookupDecimals } from './token-scale.js'

/** One token address's canonical spelling, or `null` when it is not a felt at all. */
function canonicalToken(token: string): string | null {
  try {
    return toFeltHex(token)
  } catch {
    return null
  }
}

/**
 * Sums a completed walk into per-token balances, or reports that there was no completed walk.
 *
 * A FAILED WALK PRODUCES NO TOKEN ROWS AT ALL, rather than a list of zeros. Zeros would be a
 * statement about what the account holds, and the whole point of the `unknown` state is that
 * no such statement is available. The caller gets `presence: 'unknown'`, `book: 'unknown'` and
 * an empty list whose emptiness means "nothing to show", not "nothing held".
 *
 * Rows are sorted by descending amount, then by token, so a tile's order is stable across
 * reloads rather than following whatever order a map iterated in.
 */
export function balancesFrom(result: DiscoveryResult, options: BalanceOptions = {}): ShieldedBalance {
  if (result.state !== 'walked') {
    return { blockNumber: null, tokens: [], presence: 'unknown', book: 'unknown' }
  }

  // MERGED BY FELT VALUE, so a caller override actually overrides. A spread merge compares
  // keys as strings, so `{[padded]: 6}` spread over `{[unpadded]: 18}` leaves BOTH entries and
  // `lookupDecimals` returns whichever it meets first — silently the built-in one. Callers pass
  // an override because they know something we do not, so theirs has to win.
  const decimalsFor: Record<string, number> = {}
  for (const [token, decimals] of Object.entries(KNOWN_TOKEN_DECIMALS)) {
    decimalsFor[canonicalToken(token) ?? token] = decimals
  }
  for (const [token, decimals] of Object.entries(options.decimals ?? {})) {
    decimalsFor[canonicalToken(token) ?? token] = decimals
  }

  // KEYED BY FELT VALUE for the same reason the lookup is. Grouping on the verbatim string
  // splits one token into two rows the moment two spellings of its address reach the same
  // wallet — the balance halves on screen while the notes are all still there, which is the
  // worst possible way for a padding difference to show up.
  const byToken = new Map<string, TokenBalance>()

  for (const note of result.notes) {
    const canonical = canonicalToken(note.token)
    const key = canonical ?? note.token
    const row = byToken.get(key) ?? {
      // The canonical spelling is what the row carries, so downstream comparisons and export
      // columns see one address per token rather than whichever spelling arrived first.
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
    row.isDust =
      row.decimals === null ? null : isDustAt(row.wei, row.decimals, options.displayDecimals)
  }
  tokens.sort((a, b) => (b.wei === a.wei ? a.token.localeCompare(b.token) : b.wei > a.wei ? 1 : -1))

  return {
    blockNumber: result.blockNumber,
    tokens,
    presence: result.presence,
    // The order matters. An unregistered address that somehow held a note would still be
    // holding it, and calling that book "not registered" would explain away real money.
    book: !result.registered ? 'not-registered' : tokens.length > 0 ? 'holdings' : 'no-activity',
  }
}

/**
 * True when at least one row is dust — the signal a tile uses to reach for subscript notation.
 *
 * `null` verdicts do not count. An unverified token is not evidence of dust in either
 * direction, and treating it as dust would decorate an ordinary balance with a warning.
 */
export function hasDust(balance: ShieldedBalance): boolean {
  return balance.tokens.some((t) => t.isDust === true)
}
