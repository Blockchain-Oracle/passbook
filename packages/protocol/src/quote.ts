//
// Swap quotes (story: swap; FR-028's venue, AD-14's honesty rules).
//
// ── WHAT A QUOTE IS AND IS NOT ────────────────────────────────────────────────────────────
//
// A quote is a MEASUREMENT taken at a moment: this much of that, by this route, right now. It is
// not a promise, and the difference is the whole reason `minOut` exists. Every field below is
// either something the venue told us or something derived from it in this file — nothing is
// rounded for display here, because a rounded number that later gets compared against a chain
// value is a bug waiting for a decimal place.
//
// ── BROWSER-SAFE ──────────────────────────────────────────────────────────────────────────
//
// `fetch` and JSON, exactly like `crowd-rpc.ts` and `token-list.ts`. No `starknet` import, because
// the build gate bans the `poseidon` graph from every emitted chunk.
//
// ── AND THE BROWSER SHOULD NOT BE THE ONE ASKING ──────────────────────────────────────────
//
// FR-034's rule for the venue API is that the browser never calls it directly — a quote request
// carries the pair and the size, and a third party watching those learns the shape of a private
// transaction before it happens. `quoteUrl` is exported so a relayer can proxy it, and
// `fetchQuote` takes a `fetchJson` seam so the caller decides which side of that boundary it runs
// on. Today the surface calls it directly and that is a KNOWN GAP, recorded rather than hidden:
// the proxy lands with the relayer host.
//
const AVNU_BASE = 'https://starknet.api.avnu.fi'

/** Basis points. 100 = 1%. */
export type Bps = number

/** The venue's default. Overridable per call; never silently changed. */
export const DEFAULT_SLIPPAGE_BPS: Bps = 100

export interface QuoteRequest {
  readonly sellToken: string
  readonly buyToken: string
  /** Smallest units of the sell token. */
  readonly sellAmount: bigint
  /** The address that will execute. For a private swap this is the pool's helper, not the user. */
  readonly takerAddress?: string
}

export interface QuoteRoute {
  readonly name: string
  /** 0–1. A single-venue fill is `[{ name, percent: 1 }]`. */
  readonly percent: number
}

export interface Quote {
  /** The venue's handle for this quote, needed to build its calls. */
  readonly quoteId: string
  readonly sellToken: string
  readonly buyToken: string
  readonly sellAmount: bigint
  /** What the venue says it can deliver, in smallest units of the buy token. */
  readonly buyAmount: bigint
  /** The venue's own USD marks, for the price-impact line. `null` when it did not say. */
  readonly sellAmountUsd: number | null
  readonly buyAmountUsd: number | null
  /** Estimated gas, in wei, as the venue reports it. `null` when absent. */
  readonly gasFeesWei: bigint | null
  /** Which venues fill this, and in what proportion. Empty when the venue did not say. */
  readonly routes: readonly QuoteRoute[]
}

export type QuoteResult =
  | { readonly state: 'quoted'; readonly quote: Quote }
  /** No route, or the venue declined. `because` is safe to show a person. */
  | { readonly state: 'no-route'; readonly because: string }
  /** We could not ask. Distinct from "there is no route", which is an answer. */
  | { readonly state: 'unavailable'; readonly because: string }

function toBigInt(value: unknown): bigint | null {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value)
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    return BigInt(value)
  } catch {
    return null
  }
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The URL a quote request goes to. Exported so a relayer proxy builds the identical one. */
export function quoteUrl(request: QuoteRequest): string {
  const params = new URLSearchParams({
    sellTokenAddress: request.sellToken,
    buyTokenAddress: request.buyToken,
    // Hex, which is what the venue's own client sends and what it echoes back.
    sellAmount: `0x${request.sellAmount.toString(16)}`,
    size: '1',
  })
  if (request.takerAddress) params.set('takerAddress', request.takerAddress)
  return `${AVNU_BASE}/swap/v3/quotes?${params.toString()}`
}

async function fetchJsonDefault(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`quote endpoint answered ${response.status}`)
  return response.json()
}

export interface FetchQuoteOptions {
  /** Test seam, and the proxy seam — see the header on why the browser should not ask directly. */
  fetchJson?: (url: string) => Promise<unknown>
}

/**
 * Ask for a quote.
 *
 * NEVER THROWS. A swap form is a screen someone is standing on; an exception from a price lookup
 * would take it down. Every failure is one of the two non-quoted arms, each carrying a sentence.
 *
 * A ZERO SELL AMOUNT IS NOT ASKED ABOUT. It has no answer worth having, and asking spends a round
 * trip on every keystroke that clears the field.
 */
export async function fetchQuote(
  request: QuoteRequest,
  options: FetchQuoteOptions = {},
): Promise<QuoteResult> {
  if (request.sellAmount <= 0n) {
    return { state: 'no-route', because: 'Enter an amount to see a price.' }
  }

  const fetchJson = options.fetchJson ?? fetchJsonDefault

  let payload: unknown
  try {
    payload = await fetchJson(quoteUrl(request))
  } catch {
    return { state: 'unavailable', because: 'The price service could not be reached.' }
  }

  // The endpoint returns an array of quotes, best first. `size=1` asks for one.
  const first = Array.isArray(payload) ? payload[0] : payload
  if (!first || typeof first !== 'object') {
    return { state: 'no-route', because: 'No route was found for this pair.' }
  }

  const raw = first as Record<string, unknown>
  const quoteId = raw.quoteId
  const buyAmount = toBigInt(raw.buyAmount)
  const sellAmount = toBigInt(raw.sellAmount)

  // A quote with no id cannot be built into calls, and a quote of zero is not a price. Both are
  // "no route" rather than errors: the venue answered, it simply has nothing to offer.
  if (typeof quoteId !== 'string' || quoteId === '' || buyAmount === null || buyAmount <= 0n) {
    return { state: 'no-route', because: 'No route was found for this pair.' }
  }

  const routes = Array.isArray(raw.routes)
    ? raw.routes
        .map((route) => {
          const entry = route as Record<string, unknown>
          const name = typeof entry.name === 'string' ? entry.name : null
          const percent = toNumber(entry.percent)
          return name !== null && percent !== null ? { name, percent } : null
        })
        .filter((route): route is QuoteRoute => route !== null)
    : []

  return {
    state: 'quoted',
    quote: {
      quoteId,
      sellToken: request.sellToken,
      buyToken: request.buyToken,
      sellAmount: sellAmount ?? request.sellAmount,
      buyAmount,
      sellAmountUsd: toNumber(raw.sellAmountInUsd),
      buyAmountUsd: toNumber(raw.buyAmountInUsd),
      gasFeesWei: toBigInt(raw.gasFees),
      routes,
    },
  }
}

/**
 * The floor the swap must clear, or it reverts.
 *
 * ── ZERO IS FORBIDDEN, AND THAT IS THE SPONSOR'S OWN FOOT-GUN ─────────────────────────────
 *
 * A `minOut` of 0 means "accept any output", which is an unbounded loss and is exactly what a
 * sandwich attack needs. The sponsor's own example passes 0 and the epic's acceptance criterion
 * calls it out; this throws instead, because a slippage setting that silently produces 0 is worse
 * than no slippage setting at all.
 *
 * Exact `bigint` arithmetic throughout — a float here loses the low digits of an 18-decimal amount,
 * which is the half that decides whether the transaction reverts.
 */
export function minimumOut(buyAmount: bigint, slippageBps: Bps = DEFAULT_SLIPPAGE_BPS): bigint {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) {
    throw new Error(
      `slippage must be whole basis points in [0, 10000), received ${String(slippageBps)}. ` +
        '10000 bps is 100%, which is a minimum of nothing.',
    )
  }
  const floor = (buyAmount * BigInt(10_000 - slippageBps)) / 10_000n
  if (floor <= 0n) {
    throw new Error(
      'the computed minimum output is zero, which accepts any result including nothing. ' +
        'Refused rather than sent: a zero floor is what a sandwich attack needs.',
    )
  }
  return floor
}

/**
 * How far the venue's own USD marks disagree, as a fraction. `null` when it did not price both.
 *
 * Positive means the buy side is worth LESS than the sell side — the cost of taking this route.
 * Surfaced rather than hidden: on a thin pair it is the number that matters most, and it is the one
 * a swap UI is most often accused of burying.
 */
export function priceImpact(quote: Quote): number | null {
  const { sellAmountUsd, buyAmountUsd } = quote
  if (sellAmountUsd === null || buyAmountUsd === null || sellAmountUsd <= 0) return null
  return (sellAmountUsd - buyAmountUsd) / sellAmountUsd
}
