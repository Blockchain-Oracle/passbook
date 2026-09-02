//
// Position history: what each Markets bet became, kept after the secret that claimed it is gone.
//
// A MEMORY, NOT MONEY. No secret is ever in a receipt — only the commitment (already public on
// chain), the canonical facts of the bet, and the transactions that opened and closed it. So this
// record is allowed to be lost without losing anything claimable, and it is allowed to be
// rendered while a position's secret is retired. It is cleared by Forget with everything else.
//
// Facts, never presentation: amounts are canonical integers as strings, sides are the contract's
// numbers, and the human snapshot (pair, strike, symbol) is context the chain would otherwise
// have to be asked for again. Every field the chain can answer carries where the answer came from.
//

import { SESSION_KEYS, type SessionStore } from './session-store.js'

export const HISTORY_RECORD_VERSION = 1

export type OpeningState = 'intent' | 'unknown' | 'landed' | 'reverted'
export type TerminalKind = 'claimed' | 'residual' | 'refunded' | 'cashed-out' | 'lost' | 'spent-elsewhere'
export type FactSource = 'client' | 'receipt' | 'storage' | 'events'

export interface MarketReceipt {
  readonly v: typeof HISTORY_RECORD_VERSION
  readonly chainId: string
  /** The Markets deployment the bet was placed on; `null` for a row older than this record. */
  readonly contract: string | null
  readonly venue: 'market'
  /** `poseidon(secret)` — public, on chain, the identity everything is keyed by. */
  readonly commitment: string
  readonly marketId: number
  readonly side: number
  /** Canonical integer, as a string. */
  readonly cashIn: string
  readonly token: string
  /** Human context captured at the bet; `decimals: null` means unreadable then, never a guess. */
  readonly snapshot: { readonly pair: string; readonly strike: string; readonly deadline: number; readonly symbol: string; readonly decimals: number | null } | null
  readonly opening: { readonly state: OpeningState; readonly txHash: string | null; readonly block: number | null; readonly observedAt: number }
  readonly terminal: {
    readonly kind: TerminalKind
    readonly txHash: string | null
    readonly block: number | null
    readonly amount: string | null
    readonly source: FactSource
    readonly observedAt: number
  } | null
  readonly createdAt: number
  readonly updatedAt: number
}

export type StoredReceipts =
  | { readonly state: 'ok'; readonly receipts: MarketReceipt[] }
  | { readonly state: 'empty' }
  | { readonly state: 'corrupt'; readonly because: string; readonly raw: string }

const FELT = /^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/
const INT = /^[0-9]{1,78}$/
const OPENINGS: readonly OpeningState[] = ['intent', 'unknown', 'landed', 'reverted']
const TERMINALS: readonly TerminalKind[] = ['claimed', 'residual', 'refunded', 'cashed-out', 'lost', 'spent-elsewhere']
const SOURCES: readonly FactSource[] = ['client', 'receipt', 'storage', 'events']

const isHash = (v: unknown): v is string | null => v === null || (typeof v === 'string' && FELT.test(v))
const isBlock = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0)
const isTime = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function isSnapshot(v: unknown): v is MarketReceipt['snapshot'] {
  if (v === null) return true
  const s = v as Record<string, unknown> | null
  return (
    !!s &&
    typeof s.pair === 'string' &&
    typeof s.strike === 'string' &&
    INT.test(s.strike) &&
    typeof s.deadline === 'number' &&
    typeof s.symbol === 'string' &&
    (s.decimals === null || (typeof s.decimals === 'number' && Number.isInteger(s.decimals) && s.decimals >= 0))
  )
}

function isTerminal(v: unknown): v is MarketReceipt['terminal'] {
  if (v === null) return true
  const t = v as Record<string, unknown> | null
  return (
    !!t &&
    TERMINALS.includes(t.kind as TerminalKind) &&
    isHash(t.txHash) &&
    isBlock(t.block) &&
    (t.amount === null || (typeof t.amount === 'string' && INT.test(t.amount))) &&
    SOURCES.includes(t.source as FactSource) &&
    isTime(t.observedAt)
  )
}

export function isMarketReceipt(value: unknown): value is MarketReceipt {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  const opening = r.opening as Record<string, unknown> | null
  return (
    r.v === HISTORY_RECORD_VERSION &&
    typeof r.chainId === 'string' &&
    (r.contract === null || (typeof r.contract === 'string' && FELT.test(r.contract))) &&
    r.venue === 'market' &&
    typeof r.commitment === 'string' &&
    FELT.test(r.commitment) &&
    typeof r.marketId === 'number' &&
    Number.isInteger(r.marketId) &&
    typeof r.side === 'number' &&
    Number.isInteger(r.side) &&
    typeof r.cashIn === 'string' &&
    INT.test(r.cashIn) &&
    typeof r.token === 'string' &&
    isSnapshot(r.snapshot) &&
    !!opening &&
    OPENINGS.includes(opening.state as OpeningState) &&
    isHash(opening.txHash) &&
    isBlock(opening.block) &&
    isTime(opening.observedAt) &&
    isTerminal(r.terminal) &&
    isTime(r.createdAt) &&
    isTime(r.updatedAt)
  )
}

interface HistoryRecord {
  version: number
  receipts: MarketReceipt[]
}

export function parseReceipts(raw: string | null): StoredReceipts {
  if (raw === null || raw.trim() === '') return { state: 'empty' }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { state: 'corrupt', because: `the stored history is not JSON: ${String(e)}`, raw }
  }
  if (typeof parsed !== 'object' || parsed === null) return { state: 'corrupt', because: 'the stored history is not an object', raw }
  const record = parsed as Partial<HistoryRecord>
  if (record.version !== HISTORY_RECORD_VERSION) {
    return { state: 'corrupt', because: `the stored history is version ${String(record.version)}, and this app writes ${HISTORY_RECORD_VERSION}`, raw }
  }
  if (!Array.isArray(record.receipts)) return { state: 'corrupt', because: 'the stored history carries no receipts array', raw }
  // One bad row does not discard the rest — each receipt is its own memory.
  const receipts = record.receipts.filter(isMarketReceipt)
  if (receipts.length === 0 && record.receipts.length > 0) return { state: 'corrupt', because: 'every stored receipt was malformed', raw }
  return receipts.length === 0 ? { state: 'empty' } : { state: 'ok', receipts }
}

/** Round-trips through the parser before it is called serialised: a row that would not read back is never written. */
export function serializeReceipts(receipts: readonly MarketReceipt[]): string {
  const raw = JSON.stringify({ version: HISTORY_RECORD_VERSION, receipts: [...receipts] } satisfies HistoryRecord)
  const echo = parseReceipts(raw)
  if (echo.state === 'corrupt') throw new Error(`refusing to write a history that would not read back: ${echo.because}`)
  if (echo.state === 'ok' && echo.receipts.length !== receipts.length) throw new Error('refusing to write a history that drops a receipt on read')
  return raw
}

export const sameCommitment = (a: string, b: string): boolean => {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return a === b
  }
}

export interface HistoryStore {
  read(): StoredReceipts
  list(): MarketReceipt[]
  find(commitment: string): MarketReceipt | null
  /** Inserts or replaces by commitment. */
  upsert(receipt: MarketReceipt): void
  /** Applies a change to one receipt; a no-op when it is absent. */
  patch(commitment: string, change: (receipt: MarketReceipt) => MarketReceipt): void
  remove(commitment: string): void
}

export function sessionHistoryStore(store: SessionStore, now: () => number = Date.now): HistoryStore {
  const list = (): MarketReceipt[] => {
    const read = parseReceipts(store.read(SESSION_KEYS.positionHistory))
    return read.state === 'ok' ? read.receipts : []
  }
  const write = (receipts: readonly MarketReceipt[]) => store.write(SESSION_KEYS.positionHistory, serializeReceipts(receipts))
  return {
    read: () => parseReceipts(store.read(SESSION_KEYS.positionHistory)),
    list,
    find: (commitment) => list().find((r) => sameCommitment(r.commitment, commitment)) ?? null,
    upsert(receipt) {
      if (!isMarketReceipt(receipt)) throw new Error('refusing to store a malformed receipt')
      const rest = list().filter((r) => !sameCommitment(r.commitment, receipt.commitment))
      write([...rest, { ...receipt, updatedAt: now() }])
    },
    patch(commitment, change) {
      const current = list()
      if (!current.some((r) => sameCommitment(r.commitment, commitment))) return
      write(current.map((r) => (sameCommitment(r.commitment, commitment) ? { ...change(r), updatedAt: now() } : r)))
    },
    remove(commitment) {
      write(list().filter((r) => !sameCommitment(r.commitment, commitment)))
    },
  }
}
