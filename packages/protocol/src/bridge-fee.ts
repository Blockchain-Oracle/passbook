//
// What Circle charges for a crossing, read live from Iris.
//
// Nothing here is a constant: the flat forwarding fee is destination gas priced in USDC, so it
// moves with the destination chain (~$0.05 to Base, ~$1 to Ethereum on 2026-08-27). The fee and
// the finality tier travel together — a fee quoted for one tier on a burn declaring another is the
// stranding class this file exists to prevent, so `planSend` requires the two to match.
//
// Browser-safe: `fetch`, `BigInt` and JSON only.
//
import { FAST_FINALITY_THRESHOLD, STARKNET_CCTP_DOMAIN } from './bridge-calldata.js'

const IRIS_BASE = 'https://iris-api.circle.com'

/**
 * The forward-fee buffer to take. `feeExecuted == max_fee` on every observed message, so an
 * over-quote is money the user loses, while an under-quote only demotes the transfer to Standard
 * finality. Overpaying costs money; underpaying costs minutes. Take the middle.
 */
const FEE_TIER = 'med' as const

/** The URL a fee quote goes to. Exported so a relayer proxy builds the identical one. */
export function feeQuoteUrl(destinationDomain: number): string {
  return `${IRIS_BASE}/v2/burn/USDC/fees/${STARKNET_CCTP_DOMAIN}/${destinationDomain}?forward=true`
}

export interface ForwardFee {
  /** What goes in `max_fee`: the flat forwarding fee plus the protocol fee. */
  readonly maxFeeWei: bigint
  /** Circle's Forwarding Service, which submits the destination mint and pays its gas. */
  readonly forwardFeeWei: bigint
  /** CCTP's own basis-point cut of the amount. */
  readonly protocolFeeWei: bigint
  /** The tier this quote was computed for. Must equal what the burn declares. */
  readonly finalityThreshold: number
}

export type ForwardFeeResult =
  | { readonly state: 'quoted'; readonly fee: ForwardFee }
  /** `because` is renderable. A crossing with no live fee is one we refuse to guess at. */
  | { readonly state: 'unavailable'; readonly because: string }

interface IrisFeeRow {
  finalityThreshold?: unknown
  /** Protocol fee in BASIS POINTS. */
  minimumFee?: unknown
  /** Flat forwarding fee in USDC base units. Absent unless `?forward=true`. */
  forwardFee?: { low?: unknown; med?: unknown; high?: unknown }
}

async function fetchJsonDefault(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

/** What this crossing will cost, read live. NEVER THROWS — a surface calls this while typing. */
export async function fetchForwardFee(input: {
  destinationDomain: number
  amount: bigint
  /** Test seam, and the proxy seam. */
  fetchJson?: (url: string) => Promise<unknown>
}): Promise<ForwardFeeResult> {
  const unavailable = (because: string): ForwardFeeResult => ({ state: 'unavailable', because })
  if (input.amount <= 0n) return unavailable('Enter an amount')

  let payload: unknown
  try {
    payload = await (input.fetchJson ?? fetchJsonDefault)(feeQuoteUrl(input.destinationDomain))
  } catch {
    return unavailable('The bridge fee could not be read, so nothing was quoted.')
  }
  if (!Array.isArray(payload)) {
    return unavailable('The fee service answered in a shape this app does not recognise.')
  }

  const row = (payload as IrisFeeRow[]).find(
    (r) => r.finalityThreshold === FAST_FINALITY_THRESHOLD,
  )
  if (!row) {
    // NEVER fall through to the other tier: a Standard-priced fee on a Fast-declared burn strands.
    return unavailable('Fast delivery is not being quoted for this chain right now.')
  }

  const forwardRaw = row.forwardFee?.[FEE_TIER]
  if (typeof forwardRaw !== 'number' || !Number.isFinite(forwardRaw) || forwardRaw < 0) {
    // No forwarding fee means nobody submits the destination mint — the whole promise of this
    // surface — so its absence is a refusal.
    return unavailable(`Circle is not forwarding to this chain right now, so nothing was quoted.`)
  }

  const bps = row.minimumFee
  if (typeof bps !== 'number' || !Number.isFinite(bps) || bps < 0) {
    return unavailable('The fee service quoted a protocol fee this app will not build a burn from.')
  }

  // Circle's own arithmetic: bps scaled by 100 over 1e6. CEIL-divided, because their minimum is a
  // floor: a floored quote lands a wei under it and Iris demotes the transfer to Standard.
  const protocolFeeWei = (input.amount * BigInt(Math.ceil(bps * 100)) + 999_999n) / 1_000_000n
  const forwardFeeWei = BigInt(Math.ceil(forwardRaw))

  return {
    state: 'quoted',
    fee: {
      maxFeeWei: forwardFeeWei + protocolFeeWei,
      forwardFeeWei,
      protocolFeeWei,
      finalityThreshold: FAST_FINALITY_THRESHOLD,
    },
  }
}

/**
 * What actually lands at the destination: `amount − max_fee`, deterministic at signing because
 * `feeExecuted == max_fee` on every observed message. `null` when the fee swallows the amount —
 * the helper's own `AMOUNT_LE_MAX_FEE`, caught here so a surface can say the floor instead of
 * paying a pool fee to be told it.
 */
export function deliveredWei(amount: bigint, maxFeeWei: bigint): bigint | null {
  if (amount <= maxFeeWei) return null
  return amount - maxFeeWei
}
