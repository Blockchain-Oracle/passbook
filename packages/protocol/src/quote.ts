//
// Swap quotes. A quote is a MEASUREMENT taken at a moment, not a promise — which is why `minOut`
// exists. Nothing is rounded for display here: a rounded number later compared against a chain
// value is a bug waiting for a decimal place. `fetch` and JSON only, no `starknet`. The browser
// never asks the venue directly (a quote carries the pair and the size); `fetchQuote` takes a
// `fetchJson` seam and the relayer proxies it.
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

//
// ── BUILDING THE CALLS ────────────────────────────────────────────────────────────────────
//
// `/swap/v3/build` with `private: true` returns the two calls the swap is made of — `approve` on
// the sell token, then `multi_route_swap` on the AVNU Exchange — plus the ADDRESS OF THE EXECUTOR
// that is expected to make them.
//
// THE EXECUTOR IS RETURNED, NOT CONFIGURED, and that is the single most important thing in this
// file. Measured live: `0x426dcd1ab5fa2f852f138d07cb37708b00a4db999677fe2d0c9a440702dbe5e`, which
// is AVNU's own deployed privacy helper. Pinning it as a constant here would be a copy of a value
// the venue controls, and the day they migrate the copy becomes a swap that withdraws real funds to
// an address that no longer does anything with them.
//
// ── WHY THIS SHAPE FITS THE POOL EXACTLY ──────────────────────────────────────────────────
//
// The pool's `InvokeExternal` action calls `privacy_invoke(buy_token, calls, note_id)` on a named
// contract. `calls` is a `Span<Call>` — which is what came back. So the sandwich is: withdraw the
// sell token TO the executor, create an empty open note for the buy token, and hand the executor
// these calls plus that note's id. It fills the note with the output.
//

/** One call, in the shape both the venue and `starknet.js` use. */
export interface SwapCall {
  readonly contractAddress: string
  readonly entrypoint: string
  readonly calldata: readonly string[]
}

export interface SwapPlan {
  /** The contract that will perform the swap. FROM THE VENUE — never a constant. */
  readonly executorAddress: string
  /** `approve`, then `multi_route_swap`. Passed to the executor verbatim. */
  readonly calls: readonly SwapCall[]
}

export type BuildResult =
  | { readonly state: 'built'; readonly plan: SwapPlan }
  | { readonly state: 'failed'; readonly because: string }

export interface BuildOptions {
  /** Test seam, and the proxy seam. */
  postJson?: (url: string, body: unknown) => Promise<unknown>
}

/** The URL a build request goes to. Exported so a relayer proxy builds the identical one. */
export const BUILD_URL = `${AVNU_BASE}/swap/v3/build`

async function postJsonDefault(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`build endpoint answered ${response.status}`)
  return response.json()
}

function shapeCall(raw: unknown): SwapCall | null {
  const call = raw as Record<string, unknown>
  const contractAddress = call?.contractAddress
  const entrypoint = call?.entrypoint
  const calldata = call?.calldata
  if (typeof contractAddress !== 'string' || contractAddress === '') return null
  if (typeof entrypoint !== 'string' || entrypoint === '') return null
  if (!Array.isArray(calldata) || !calldata.every((felt) => typeof felt === 'string')) return null
  return { contractAddress, entrypoint, calldata: calldata as string[] }
}

/**
 * Turn a quote into the calls that perform it.
 *
 * `slippage` IS A FRACTION HERE, NOT BASIS POINTS — the venue's own convention, and the exact place
 * a factor-of-a-hundred error would be invisible: 0.01 is one percent, and `1` would be a hundred.
 * The conversion happens in one place, here, so no caller ever holds both units.
 *
 * NEVER THROWS. A build that fails is a swap that does not happen, not a screen that falls over.
 */
export async function buildSwap(
  quoteId: string,
  slippageBps: Bps = DEFAULT_SLIPPAGE_BPS,
  options: BuildOptions = {},
): Promise<BuildResult> {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= 10_000) {
    return { state: 'failed', because: 'The slippage setting is not a usable value.' }
  }

  const postJson = options.postJson ?? postJsonDefault

  let payload: unknown
  try {
    payload = await postJson(BUILD_URL, {
      quoteId,
      // Fraction, per the venue. `100 bps` becomes `0.01`.
      slippage: slippageBps / 10_000,
      // The flag that routes through the executor the privacy pool can call.
      private: true,
    })
  } catch {
    return { state: 'failed', because: 'The route could not be prepared. Nothing was submitted.' }
  }

  const body = payload as { executorAddress?: unknown; calls?: unknown }
  const executorAddress = body?.executorAddress

  // NO EXECUTOR, NO SWAP. Falling back to a remembered address would send funds to a contract the
  // venue did not name for this route.
  if (typeof executorAddress !== 'string' || executorAddress === '') {
    return { state: 'failed', because: 'The route came back without an executor, so it was refused.' }
  }

  const calls = Array.isArray(body.calls) ? body.calls.map(shapeCall) : null
  if (!calls || calls.length === 0 || calls.some((call) => call === null)) {
    return { state: 'failed', because: 'The route came back malformed, so it was refused.' }
  }

  return {
    state: 'built',
    plan: { executorAddress, calls: calls as SwapCall[] },
  }
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

/**
 * The bounds a hand-typed slippage tolerance has to fall inside.
 *
 * 0.01% is one basis point, the smallest thing the unit can express. 50% is not a protocol limit —
 * it is a judgement that beyond it the number is far likelier to be a typo than an intention.
 */
export const MIN_SLIPPAGE_BPS = 1
export const MAX_SLIPPAGE_BPS = 5000

/**
 * Parse a typed percentage into basis points, or say why it will not.
 *
 * ── WHY THIS REFUSES INSTEAD OF CLAMPING ──────────────────────────────────────────────────
 *
 * Clamping silently is the worst available behaviour: the user believes they set one tolerance and
 * the swap executes against another. A refusal with a sentence is the only version where what is
 * on screen and what is in the transaction are the same number.
 *
 * ── AND WHY IT LIVES HERE RATHER THAN IN THE POPOVER ──────────────────────────────────────
 *
 * It decides what tolerance reaches a real swap, which makes it protocol logic wearing a form
 * control's clothes. In `apps/web` it would also be untestable — the suite collects
 * `packages/*​/test` only.
 */
export function parseSlippage(input: string): { bps: Bps } | { problem: string } {
  // Whitespace stripped THROUGHOUT, not just at the ends, and the percent sign taken off after —
  // "0.5 %" is a thing people type and trimming alone leaves an inner space the pattern rejects.
  const trimmed = input.replace(/\s+/g, '').replace(/%$/, '')
  if (trimmed === '') return { problem: 'Enter a percentage.' }
  if (!/^\d*\.?\d*$/.test(trimmed)) return { problem: 'That is not a percentage.' }

  const percent = Number(trimmed)
  if (!Number.isFinite(percent)) return { problem: 'That is not a percentage.' }

  // Rounded to nearest and THEN range-checked. Rounding up would hand back a tolerance looser than
  // the one typed; refusing a value that rounds to zero stops "0.001%" becoming "no slippage".
  const bps = Math.round(percent * 100)
  if (bps < MIN_SLIPPAGE_BPS) return { problem: 'The smallest step is 0.01%.' }
  if (bps > MAX_SLIPPAGE_BPS) return { problem: 'Above 50% is almost always a typo.' }
  return { bps: bps as Bps }
}
