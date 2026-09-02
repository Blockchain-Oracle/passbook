// Position history: the store behind one query, the writers the bet ticket and settlement call,
// and the per-receipt reconciler that asks the chain what a bet became.
//
// Source priority, highest first: the receipt of the retained transaction hash; contract storage
// (`get_position` + the market); a commitment-keyed event read; what the client remembered. A
// read that FAILS changes nothing — `unknown` stays `unknown`, and a secret is retired only on an
// explicit REVERTED verdict for that hash.
import { queryOptions, skipToken } from '@tanstack/react-query'
import { MARKET_STATE, type OnChainMarket } from '@strk20/protocol/app-reads'
import { NET } from '@strk20/protocol/constants'
import { marketPositionAction } from '@strk20/protocol/position-actions'
import type { HistoryStore, MarketReceipt, TerminalKind } from '@strk20/protocol/position-history'

import { queryClient } from '@/app/query-client'
import { appContracts } from './app'

let store: HistoryStore | null = null

async function historyStore(): Promise<HistoryStore> {
  if (store) return store
  const [{ sessionHistoryStore }, { browserSessionStore }] = await Promise.all([
    import('@strk20/protocol/position-history'),
    import('@strk20/protocol/session-store'),
  ])
  store = sessionHistoryStore(browserSessionStore())
  return store
}

export type StoredReceiptsRead = { state: 'ok'; receipts: MarketReceipt[] } | { state: 'corrupt'; because: string }

const HISTORY_KEY = ['history', 'stored'] as const
const invalidate = () => queryClient.invalidateQueries({ queryKey: HISTORY_KEY })

/**
 * Every receipt this browser holds. The first read of this build also gives each market position
 * stored before history existed a receipt of its own (`contract: null` — the reconciler works out
 * which deployment it lives on), so nothing already held is left without a story.
 */
export function historyQuery() {
  return queryOptions({
    queryKey: HISTORY_KEY,
    queryFn: async (): Promise<StoredReceiptsRead> => {
      const s = await historyStore()
      const read = s.read()
      if (read.state === 'corrupt') return { state: 'corrupt', because: read.because }
      const { sessionPositionStore } = await import('@strk20/protocol/session-position-store')
      const { browserSessionStore } = await import('@strk20/protocol/session-store')
      const held = sessionPositionStore(browserSessionStore()).list().filter((p) => p.venue === 'market' && p.id >= 0)
      const known = new Set(s.list().map((r) => BigInt(r.commitment).toString()))
      const now = Date.now()
      for (const p of held) {
        if (known.has(BigInt(p.commitment).toString())) continue
        s.upsert({
          v: 1,
          chainId: NET.chainId,
          contract: null,
          venue: 'market',
          commitment: p.commitment,
          marketId: p.id,
          side: -1,
          cashIn: '0',
          token: '',
          snapshot: null,
          opening: { state: p.txHash ? 'unknown' : 'intent', txHash: p.txHash ?? null, block: null, observedAt: p.createdAt },
          terminal: null,
          createdAt: p.createdAt,
          updatedAt: now,
        })
      }
      const after = s.read()
      return { state: 'ok', receipts: after.state === 'ok' ? [...after.receipts] : [] }
    },
    staleTime: Infinity,
  })
}

// ── Writers: the bet ticket and the settlement door ─────────────────────────────────────

export interface IntentInput {
  commitment: string
  contract: string
  market: OnChainMarket
  side: number
  cashIn: bigint
  symbol: string
  decimals: number | null
}

/** Written beside the secret, before the send. The one moment every canonical fact is in hand. */
export async function recordIntent(input: IntentInput): Promise<void> {
  const now = Date.now()
  ;(await historyStore()).upsert({
    v: 1,
    chainId: NET.chainId,
    contract: input.contract,
    venue: 'market',
    commitment: input.commitment,
    marketId: input.market.id,
    side: input.side,
    cashIn: input.cashIn.toString(),
    token: input.market.token,
    snapshot: { pair: input.market.pair, strike: input.market.strike.toString(), deadline: input.market.deadline, symbol: input.symbol, decimals: input.decimals },
    opening: { state: 'intent', txHash: null, block: null, observedAt: now },
    terminal: null,
    createdAt: now,
    updatedAt: now,
  })
  await invalidate()
}

async function patchOpening(commitment: string, opening: Partial<MarketReceipt['opening']>): Promise<void> {
  ;(await historyStore()).patch(commitment, (r) => ({ ...r, opening: { ...r.opening, ...opening, observedAt: Date.now() } }))
  await invalidate()
}

export const recordLanded = (commitment: string, txHash: string, block: number | null) => patchOpening(commitment, { state: 'landed', txHash, block })
export const recordUnknown = (commitment: string, txHash: string | null) => patchOpening(commitment, { state: 'unknown', txHash })
export const recordReverted = (commitment: string, txHash: string) => patchOpening(commitment, { state: 'reverted', txHash })

/** Written BEFORE the secret is retired: the memory is durable before the money moves out of reach. */
export async function recordTerminal(commitment: string, kind: TerminalKind, txHash: string | null, block: number | null, amount: bigint | null): Promise<void> {
  ;(await historyStore()).patch(commitment, (r) => ({
    ...r,
    terminal: { kind, txHash, block, amount: amount === null ? null : amount.toString(), source: 'client', observedAt: Date.now() },
  }))
  await invalidate()
}

export async function patchReceipt(commitment: string, change: (r: MarketReceipt) => MarketReceipt): Promise<void> {
  ;(await historyStore()).patch(commitment, change)
  await invalidate()
}

export async function removeReceipt(commitment: string): Promise<void> {
  ;(await historyStore()).remove(commitment)
  await invalidate()
}

// ── The reconciler ──────────────────────────────────────────────────────────────────────

/** What the chain said. Only the fields that CHANGE are present; an absent field means "no news". */
export interface ChainFacts {
  contract?: string
  legacyUnknown?: true
  /** The bet's own facts off its `BetPlaced` event, for a row seeded before history existed. */
  bet?: { side: number; cashIn: string; marketId: number }
  /** The market's facts off `get_market`, for a row with no snapshot. Symbol and decimals are the token list's, at render. */
  market?: { pair: string; strike: string; deadline: number; token: string }
  opening?: { state: 'landed' | 'reverted'; txHash: string | null; block: number | null }
  terminal?: { kind: TerminalKind; txHash: string | null; block: number | null; amount: string | null; source: 'receipt' | 'storage' | 'events' }
}

/** Nothing left to ask once the story has an ending with its transaction, or a verdict of reverted or lost. */
export function receiptIsFinal(r: MarketReceipt): boolean {
  if (r.opening.state === 'reverted') return true
  if (!r.terminal) return false
  return r.terminal.kind === 'lost' || r.terminal.txHash !== null
}

const RECONCILE_MS = 30_000

export function receiptReconcileQuery(receipt: MarketReceipt, market: OnChainMarket | null, nowMs: number) {
  const contracts = appContracts()
  const final = receiptIsFinal(receipt)
  const settling = receipt.opening.state === 'intent' || receipt.opening.state === 'unknown'
  return queryOptions({
    queryKey: ['history', 'market', receipt.contract, receipt.commitment, receipt.opening.state, receipt.terminal?.kind ?? null, receipt.terminal?.txHash ?? null],
    queryFn: final || !contracts.markets ? skipToken : () => reconcile(receipt, market, contracts.markets!, contracts.marketsV1 ?? null, nowMs),
    staleTime: RECONCILE_MS,
    // A bet still settling is asked again; a story waiting only for a hash is asked once per visit.
    refetchInterval: settling ? RECONCILE_MS : false,
  })
}

async function reconcile(receipt: MarketReceipt, market: OnChainMarket | null, current: string, superseded: string | null, nowMs: number): Promise<ChainFacts> {
  const [{ defaultTransport, readMarket }, events, { readMarketPosition }] = await Promise.all([
    import('@strk20/protocol/app-reads'),
    import('@strk20/protocol/market-events'),
    import('@strk20/protocol/position-reads'),
  ])
  const facts: ChainFacts = {}
  const { commitment } = receipt

  // A row older than history: exactly one deployment must answer for it, or it stays unknown.
  let contract = receipt.contract
  let position: Awaited<ReturnType<typeof readMarketPosition>> | null = null
  if (!contract) {
    for (const candidate of [current, superseded].filter((c): c is string => c !== null)) {
      const read = await readMarketPosition(candidate, commitment)
      if (read.state !== events.POS_STATE.none) {
        contract = candidate
        position = read
        facts.contract = candidate
        break
      }
    }
    if (!contract) return { legacyUnknown: true }
  }

  // (a) The retained hash's receipt: the one source that can say "reverted".
  const opening = receipt.opening
  if (opening.txHash && (opening.state === 'intent' || opening.state === 'unknown' || opening.block === null)) {
    try {
      const rc = await defaultTransport('starknet_getTransactionReceipt', [opening.txHash])
      const verdict = events.receiptOutcome(rc)
      if (verdict === 'reverted') return { ...facts, opening: { state: 'reverted', txHash: opening.txHash, block: events.receiptBlock(rc) } }
      if (verdict === 'succeeded') {
        const placed = events
          .receiptEvents(rc)
          .map((e) => events.decodeBetPlaced(e, contract!))
          .find((bet) => bet !== null && events.sameFelt(bet.commitment, commitment))
        if (placed) {
          facts.opening = { state: 'landed', txHash: opening.txHash, block: events.receiptBlock(rc) }
          if (receipt.side < 0) facts.bet = { side: placed.side, cashIn: BigInt(placed.amount).toString(), marketId: placed.marketId }
        }
      }
    } catch {
      // Unreachable, or a hash no host knows yet: no verdict is no change.
    }
  }

  // (b) Storage: the position and its market. `lost` comes from the one existing derivation.
  if (!receipt.terminal || !opening.txHash) {
    position ??= await readMarketPosition(contract, commitment)
  }
  if (!receipt.terminal && position) {
    if (position.state === events.POS_STATE.claimed) {
      facts.terminal = { kind: 'spent-elsewhere', txHash: null, block: null, amount: null, source: 'storage' }
    } else if (position.state === events.POS_STATE.open) {
      if (!facts.opening && (opening.state === 'intent' || opening.state === 'unknown')) facts.opening = { state: 'landed', txHash: opening.txHash, block: null }
      // A window long off the board still answers `get_market`; the list is only the cheap path.
      const m = market ?? (await readMarket(contract, receipt.marketId).catch(() => null))
      if (m) {
        const action = marketPositionAction({
          positionOpen: true,
          marketState: m.state === MARKET_STATE.active ? 'active' : m.state === MARKET_STATE.resolved ? 'resolved' : 'voided',
          beforeDeadline: nowMs < m.deadline * 1000,
          cashoutQuote: position.cashoutQuote,
          claimPreview: position.claimPreview,
        })
        if (action.kind === 'lost') facts.terminal = { kind: 'lost', txHash: null, block: null, amount: null, source: 'storage' }
      }
    }
  }

  if (!receipt.snapshot && position && position.state !== events.POS_STATE.none) {
    const m = market ?? (await readMarket(contract, position.marketId).catch(() => null))
    if (m) facts.market = { pair: m.pair, strike: m.strike.toString(), deadline: m.deadline, token: m.token }
  }

  // (b′) A row with no opening hash at all: `BetPlaced` is keyed by market id, and storage just
  // said which market, so one bounded read recovers the opening transaction and the bet's facts.
  if (!opening.txHash && !facts.opening && position && position.state !== events.POS_STATE.none) {
    try {
      const page = (await defaultTransport('starknet_getEvents', [
        { from_block: { block_number: events.MARKETS_EVENTS_FLOOR_BLOCK }, to_block: 'latest', address: contract, keys: [[events.MARKET_EVENT_KEY.BetPlaced], [`0x${position.marketId.toString(16)}`]], chunk_size: 1000 },
      ])) as { events?: unknown[]; continuation_token?: string } | null
      if (page && Array.isArray(page.events) && !page.continuation_token) {
        for (const raw of page.events) {
          const bet = events.decodeBetPlaced(raw as Parameters<typeof events.decodeBetPlaced>[0], contract)
          if (bet && events.sameFelt(bet.commitment, commitment)) {
            facts.opening = { state: 'landed', txHash: bet.txHash, block: bet.block }
            if (receipt.side < 0) facts.bet = { side: bet.side, cashIn: BigInt(bet.amount).toString(), marketId: bet.marketId }
            break
          }
        }
      }
    } catch {
      // No answer is no change.
    }
  }

  // (c) One commitment-keyed event read for the terminal transaction. A continuation token is a
  // truncated answer from one host that the next host cannot continue — treated as no answer.
  const wantsEvents = facts.terminal?.kind === 'spent-elsewhere' || (receipt.terminal && receipt.terminal.txHash === null && receipt.terminal.kind !== 'lost')
  if (wantsEvents) {
    const from = facts.opening?.block ?? opening.block ?? events.MARKETS_EVENTS_FLOOR_BLOCK
    try {
      const page = (await defaultTransport('starknet_getEvents', [
        { from_block: { block_number: from }, to_block: 'latest', address: contract, keys: [[events.MARKET_EVENT_KEY.Claimed, events.MARKET_EVENT_KEY.CashedOut], [commitment]], chunk_size: 1000 },
      ])) as { events?: unknown[]; continuation_token?: string } | null
      if (page && Array.isArray(page.events) && !page.continuation_token) {
        for (const raw of page.events) {
          const t = events.decodeTerminal(raw as Parameters<typeof events.decodeTerminal>[0], contract, commitment)
          if (t) {
            facts.terminal = { kind: t.kind, txHash: t.txHash, block: t.block, amount: BigInt(t.amount).toString(), source: 'events' }
            break
          }
        }
      }
    } catch {
      // No answer is no change.
    }
  }
  return facts
}

/** Folds chain facts into a receipt. Returns the receipt itself when nothing changed. */
export function applyFacts(r: MarketReceipt, facts: ChainFacts): MarketReceipt {
  let next = r
  const now = Date.now()
  if (facts.contract && next.contract !== facts.contract) next = { ...next, contract: facts.contract }
  if (facts.bet && next.side < 0) next = { ...next, side: facts.bet.side, cashIn: facts.bet.cashIn, marketId: facts.bet.marketId }
  if (facts.market && !next.snapshot) next = { ...next, token: facts.market.token, snapshot: { pair: facts.market.pair, strike: facts.market.strike, deadline: facts.market.deadline, symbol: '', decimals: null } }
  if (facts.opening && (next.opening.state !== facts.opening.state || next.opening.block !== facts.opening.block)) {
    next = { ...next, opening: { ...next.opening, ...facts.opening, observedAt: now } }
  }
  if (facts.terminal) {
    const t = next.terminal
    // Events beat storage, and a hash beats no hash; a client-written ending keeps its amount.
    const better = !t || (t.txHash === null && facts.terminal.txHash !== null) || (t.source === 'storage' && facts.terminal.source === 'events')
    if (better) next = { ...next, terminal: { ...facts.terminal, amount: facts.terminal.amount ?? t?.amount ?? null, observedAt: now } }
  }
  return next
}
