//
// The Markets contract's public facts as the browser reads them off raw RPC shapes: the pinned
// event selectors, the position states, the claim kinds, a receipt's verdict, and decoders that
// skip a malformed event rather than fail a reading. A leaf — no imports — so a Positions row can
// reconcile against the chain without dragging `starknet` into its chunk.
//
// `Claimed` and `CashedOut` are KEYED on the commitment (`keys[1]`); `BetPlaced` is keyed on the
// market id with the commitment last in its data. That split is what makes a bounded, indexer-free
// reconciliation possible: one `starknet_getEvents` with the commitment as the second key.
//

/** Pinned like `SELECTOR` in app-codecs.ts; each equals `hash.getSelectorFromName(name)`. */
export const MARKET_EVENT_KEY = {
  BetPlaced: '0x3714964c81efee0fe58ac4504b7913e0e777e5d0f90ab45fc44568dd4ca88c1',
  MarketResolved: '0x3a69063a7ce6bf68928eda97af8f80e63b16ada5f75dacc66f432ab2683963',
  MarketVoided: '0x22e796813637e01cc55546e5af27911e667117f1ddf02dad9709e6194aeb423',
  Claimed: '0x35cc0235f835cc84da50813dc84eb10a75e24a21d74d6d86278c0f037cb7429',
  CashedOut: '0x1e27bebcd46bc944065dc93e3f3b8d71b4ffe68d6cfca1ee14301239a41b01f',
} as const

/** `Position.state` in markets.cairo. `none` is "not on this contract", never a settled position. */
export const POS_STATE = { none: 0, open: 1, claimed: 2 } as const

/** `Claimed.kind` in markets.cairo — a settled position's character, on chain, no derivation. */
export const CLAIM_KIND = { win: 1, residual: 2, refund: 3 } as const

/**
 * The v1 Markets deployment was verified at this block and no bet on either deployment predates
 * it. The floor for an event scan that has no better lower bound; an over-inclusive one.
 */
export const MARKETS_EVENTS_FLOOR_BLOCK = 13962406

export type ReceiptOutcome = 'reverted' | 'succeeded' | 'pending'

/**
 * A receipt's verdict off the loose wire shape. Anything that is not one of the two stated
 * execution statuses is `pending` — an unknown status is a receipt we do not understand, and
 * guessing "reverted" there would retire a position that may have landed.
 */
export function receiptOutcome(receipt: unknown): ReceiptOutcome {
  const status = (receipt as { execution_status?: unknown } | null)?.execution_status
  if (status === 'REVERTED') return 'reverted'
  if (status === 'SUCCEEDED') return 'succeeded'
  return 'pending'
}

export interface RawEvent {
  from_address?: unknown
  keys?: unknown
  data?: unknown
  transaction_hash?: unknown
  block_number?: unknown
}

const isHex = (v: unknown): v is string => typeof v === 'string' && /^0x[0-9a-fA-F]+$/.test(v)

/** Felts compare as numbers: `0x0a` and `0xa` are one value. Fails closed on garbage. */
export function sameFelt(a: unknown, b: unknown): boolean {
  if (!isHex(a) || !isHex(b)) return false
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return false
  }
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every(isHex) ? (value as string[]) : null
}

function num(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  if (isHex(value)) {
    const n = Number(BigInt(value))
    return Number.isSafeInteger(n) ? n : null
  }
  return null
}

export interface BetPlacedEvent {
  marketId: number
  side: number
  amount: string
  tickets: string
  commitment: string
  txHash: string | null
  block: number | null
}

/** `BetPlaced` from `contract`, or `null` for anything else or anything malformed. */
export function decodeBetPlaced(event: RawEvent, contract: string): BetPlacedEvent | null {
  if (!sameFelt(event.from_address, contract)) return null
  const keys = strings(event.keys)
  const data = strings(event.data)
  if (!keys || !data || keys.length < 2 || data.length < 6) return null
  if (!sameFelt(keys[0], MARKET_EVENT_KEY.BetPlaced)) return null
  const marketId = num(keys[1])
  const side = num(data[0])
  if (marketId === null || side === null) return null
  return { marketId, side, amount: data[1]!, tickets: data[2]!, commitment: data[5]!, txHash: isHex(event.transaction_hash) ? event.transaction_hash : null, block: num(event.block_number) }
}

export interface TerminalEvent {
  kind: 'claimed' | 'residual' | 'refunded' | 'cashed-out'
  marketId: number
  amount: string
  commitment: string
  txHash: string | null
  block: number | null
}

/** `Claimed` or `CashedOut` keyed on `commitment`, from `contract`; `null` otherwise. */
export function decodeTerminal(event: RawEvent, contract: string, commitment: string): TerminalEvent | null {
  if (!sameFelt(event.from_address, contract)) return null
  const keys = strings(event.keys)
  const data = strings(event.data)
  if (!keys || !data || keys.length < 2 || !sameFelt(keys[1], commitment)) return null
  const base = { commitment: keys[1]!, txHash: isHex(event.transaction_hash) ? event.transaction_hash : null, block: num(event.block_number) }
  if (sameFelt(keys[0], MARKET_EVENT_KEY.Claimed) && data.length >= 3) {
    const marketId = num(data[0])
    const claimKind = num(data[2])
    if (marketId === null) return null
    const kind = claimKind === CLAIM_KIND.residual ? 'residual' : claimKind === CLAIM_KIND.refund ? 'refunded' : 'claimed'
    return { kind, marketId, amount: data[1]!, ...base }
  }
  if (sameFelt(keys[0], MARKET_EVENT_KEY.CashedOut) && data.length >= 3) {
    const marketId = num(data[0])
    if (marketId === null) return null
    return { kind: 'cashed-out', marketId, amount: data[2]!, ...base }
  }
  return null
}

/** The events on a receipt, as a list or nothing — a receipt without a readable list has none. */
export function receiptEvents(receipt: unknown): RawEvent[] {
  const events = (receipt as { events?: unknown } | null)?.events
  return Array.isArray(events) ? (events as RawEvent[]) : []
}

export function receiptBlock(receipt: unknown): number | null {
  return num((receipt as { block_number?: unknown } | null)?.block_number)
}
