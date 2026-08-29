//
// Serialising a Markets operation into the pool's invoke calldata: the pool's `InvokeExternal`
// calls `privacy_invoke(op, payload)` on the Markets contract, flattened as
// `[op, payload_len, ...payload]`. Every shape below is the one `contracts/tests/test_markets.cairo`
// asserts against the deployed logic.
//
// Pure — no `starknet.js`, no hashing, no I/O — because a markets surface imports this eagerly;
// commitments arrive ALREADY HASHED from `commitment.ts` in the lazy graph. Refuses rather than
// throws: a surface calls this while someone is standing on it, and a refusal carries a sentence.
//

/** The ops `Markets::privacy_invoke` dispatches on. Transcribed from `markets.cairo`. */
export const MARKET_OP = {
  create: 1,
  bet: 2,
  cashout: 3,
  claim: 4,
} as const

/** `SIDE_DOWN` / `SIDE_UP` as the contract numbers them. `SIDE_SEED` is never client-supplied. */
export const SIDE_DOWN = 0
export const SIDE_UP = 1

/** The contract's own ceiling on one batched op (`batch.cairo`, `MAX_BATCH`) — a Cairo constant, so duplicated. */
export const MAX_BATCH = 64

export type CalldataResult =
  | {
      readonly state: 'ready'
      readonly calldata: readonly string[]
      /**
       * Indices into `calldata` holding an open note's id — the ONLY felts the plan cannot know.
       *
       * A settling payload carries the note each payout lands in, and those ids are minted by the
       * compiler from `(channelKey, token, index)` at proof time. So the planner pins every felt
       * EXCEPT these, and `assertSendSpan` compares the rest byte for byte. That is what turns
       * "the venue rewrote something between the plan and the proof" from a mainnet discovery into
       * a local throw.
       *
       * Reported here rather than re-derived by the planner: the layout is this file's business,
       * and a second implementation of "where the note ids are" is a second thing to get wrong.
       */
      readonly noteIdSlots: readonly number[]
    }
  /** Something in the request is not a shape we will execute. `because` is safe to show. */
  | { readonly state: 'refused'; readonly because: string }

/** A felt, as the chain wants it: `0x`-prefixed lowercase hex. */
function felt(value: bigint | number | string): string | null {
  try {
    if (typeof value === 'string' && value.trim() === '') return null
    const n = BigInt(value)
    if (n < 0n) return null
    return `0x${n.toString(16)}`
  } catch {
    return null
  }
}

const U128 = 1n << 128n
const U64 = 1n << 64n

/** A felt that must fit the Cairo integer the contract will `try_into` it as. */
function bounded(value: bigint | number | string, ceiling: bigint): string | null {
  const f = felt(value)
  if (f === null) return null
  return BigInt(f) < ceiling ? f : null
}

/**
 * What stands in for a note id until the compiler mints one.
 *
 * Its VALUE is never read: the planner blanks the slot so `assertSendSpan` does not compare it, and
 * `proveSend` overwrites it once the notes exist. Zero is chosen because it is the one value that is
 * unmistakably not a real note id — so a placeholder that somehow survived to the chain reverts,
 * rather than depositing a payout into whatever note it happened to name.
 */
const NOTE_ID_PLACEHOLDER = '0x0'

const refuse = (because: string): CalldataResult => ({ state: 'refused', because })

/** Wraps a payload in the `[op, len, ...payload]` envelope the invoke leg carries. */
function envelope(
  op: number,
  payload: readonly string[],
  noteIdSlots: readonly number[] = [],
): CalldataResult {
  return {
    state: 'ready',
    calldata: [`0x${op.toString(16)}`, `0x${payload.length.toString(16)}`, ...payload],
    noteIdSlots,
  }
}

/** `[pair_id, strike, deadline, token, seed, seeder_commitment, experimental]` — seven felts. */
export interface MarketCreateInput {
  /** The Pragma pair, e.g. `'BTC/USD'` short-string encoded. */
  pairId: bigint | string
  /** The line, in Pragma's 8-decimal fixed point. */
  strike: bigint
  /** Unix seconds. The contract enforces its own minimum window; see below. */
  deadline: number | bigint
  token: string
  seed: bigint
  seederCommitment: bigint | string
  /**
   * The 15-minute tier. The contract refuses anything under an hour WITHOUT this flag and
   * anything under fifteen minutes with it, so a caller that means to open a short market must
   * say so — the flag is what makes the void-and-refund rule advertised rather than a surprise.
   */
  experimental?: boolean
}

export function createPayload(input: MarketCreateInput): CalldataResult {
  const pairId = felt(input.pairId)
  if (pairId === null || BigInt(pairId) === 0n) return refuse('The market needs a price pair.')

  const strike = bounded(input.strike, U128)
  if (strike === null || BigInt(strike) === 0n) {
    return refuse('The strike price is not a number this market can settle against.')
  }

  const deadline = bounded(input.deadline, U64)
  if (deadline === null || BigInt(deadline) === 0n) return refuse('The market needs a closing time.')

  const token = felt(input.token)
  if (token === null || BigInt(token) === 0n) return refuse('The stake token is not an address.')

  const seed = bounded(input.seed, U128)
  if (seed === null || BigInt(seed) === 0n) {
    return refuse('A market opens with a seed, and this one carried none.')
  }

  const commitment = felt(input.seederCommitment)
  if (commitment === null || BigInt(commitment) === 0n) {
    return refuse('The seeder position has no commitment, so nothing could ever claim it.')
  }

  return envelope(MARKET_OP.create, [
    pairId,
    strike,
    deadline,
    token,
    seed,
    commitment,
    input.experimental ? '0x1' : '0x0',
  ])
}

/** One rung of a ladder. `n` of these ride in a single transaction and a single fee. */
export interface MarketBet {
  marketId: number | bigint
  /** `SIDE_UP` or `SIDE_DOWN`. Nothing else — `SIDE_SEED` is the contract's, not a caller's. */
  side: number
  amount: bigint
  commitment: bigint | string
}

/** `[n, (market_id, side, amount, commitment) × n]`. */
export function betPayload(bets: readonly MarketBet[]): CalldataResult {
  const count = checkBatch(bets.length, 'bet')
  if (count) return count

  const payload: string[] = [`0x${bets.length.toString(16)}`]
  const seen = new Set<string>()

  for (const [i, bet] of bets.entries()) {
    const marketId = bounded(bet.marketId, U64)
    if (marketId === null) return refuse(`Bet ${i + 1} names a market that is not a market id.`)

    if (bet.side !== SIDE_UP && bet.side !== SIDE_DOWN) {
      return refuse(`Bet ${i + 1} is neither up nor down.`)
    }

    const amount = bounded(bet.amount, U128)
    if (amount === null || BigInt(amount) === 0n) {
      return refuse(`Bet ${i + 1} stakes nothing, which would take a position worth nothing.`)
    }

    const commitment = felt(bet.commitment)
    if (commitment === null || BigInt(commitment) === 0n) {
      return refuse(`Bet ${i + 1} has no commitment, so nothing could ever claim it.`)
    }
    // A commitment is the ONLY way a position is ever claimed, so two bets sharing one is not a
    // duplicate — it is the second bet's money with no way to get it back. The contract refuses
    // this too (`COMMITMENT_USED`); refusing here means learning it before the fee rather than after.
    if (seen.has(commitment)) {
      return refuse(`Bets ${i + 1} and an earlier one share a commitment, so one of them could never be claimed.`)
    }
    seen.add(commitment)

    payload.push(marketId, `0x${bet.side.toString(16)}`, amount, commitment)
  }

  return envelope(MARKET_OP.bet, payload)
}

/**
 * `[n, (secret, note_id) × n]` — one entry per position being settled.
 *
 * TAKES SECRETS ONLY, NEVER NOTE IDS. An open note's id is minted by the compiler from
 * `(channelKey, token, index)` at proof time, so at the moment a payload is built it does not
 * exist. Each id's slot is written as a placeholder and reported in `noteIdSlots`; the planner
 * leaves those felts unpinned and `proveSend` fills them in payload order once the notes are
 * minted. A caller who could supply an id would be a caller who could supply the WRONG id, and
 * the contract would deposit somebody's payout into somebody else's note.
 */
export function claimPayload(secrets: readonly (bigint | string)[]): CalldataResult {
  return settlementPayload(MARKET_OP.claim, secrets, 'claim')
}

/** `[secret, note_id, min_out]` — one position, sold back whole. */
export function cashoutPayload(input: {
  secret: bigint | string
  /** The worst price the seller will take. Zero is legal and means "any". */
  minOut: bigint
}): CalldataResult {
  const secret = felt(input.secret)
  if (secret === null || BigInt(secret) === 0n) return refuse('The position has no secret to prove it.')

  const minOut = bounded(input.minOut, U128)
  if (minOut === null) return refuse('The minimum acceptable payout is not a number.')

  // `[op, len, secret, note_id, min_out]` — the note id is calldata index 3, and a placeholder
  // until the compiler mints the note. See `claimPayload` for why callers never supply one.
  return envelope(MARKET_OP.cashout, [secret, NOTE_ID_PLACEHOLDER, minOut], [3])
}

// ── Shared batch machinery ────────────────────────────────────────────────────────────────

function checkBatch(length: number, noun: string): CalldataResult | null {
  if (length === 0) return refuse(`There were no ${noun}s to send.`)
  if (length > MAX_BATCH) {
    return refuse(`${length} ${noun}s is more than one transaction carries; the limit is ${MAX_BATCH}.`)
  }
  return null
}

/**
 * `[n, (secret, note_id) × n]` — the shape both settling ops share.
 *
 * Exported through `claimPayload` here and `redeemPayload`/`refundPayload` in `launch-calldata.ts`,
 * which is three ops with one layout. Kept as one function because the interesting part is not the
 * loop, it is the two duplicate checks below, and three copies of those is three chances to lose one.
 */
export function settlementPayload(
  op: number,
  secretList: readonly (bigint | string)[],
  noun: string,
): CalldataResult {
  const count = checkBatch(secretList.length, noun)
  if (count) return count

  const payload: string[] = [`0x${secretList.length.toString(16)}`]
  const noteIdSlots: number[] = []
  const secrets = new Set<string>()

  for (const [i, entry] of secretList.entries()) {
    const secret = felt(entry)
    if (secret === null || BigInt(secret) === 0n) {
      return refuse(`Position ${i + 1} has no secret to prove it.`)
    }
    // The contract writes the position closed inside its own loop, so a repeated secret meets a
    // closed position and reverts the WHOLE batch — every other settlement in it included. That
    // makes one careless duplicate a fee spent settling nothing.
    if (secrets.has(secret)) {
      return refuse(`Position ${i + 1} is already being settled earlier in this batch.`)
    }
    secrets.add(secret)

    // `[op, len, n, (secret, note) × n]`, so entry `i`'s note id sits at calldata index
    // `2 + 1 + 2i + 1` — the two envelope felts, the count, then two felts per entry.
    noteIdSlots.push(3 + i * 2 + 1)
    payload.push(secret, NOTE_ID_PLACEHOLDER)
  }

  return envelope(op, payload, noteIdSlots)
}
