// The one durable piece of the chain feed: the price history, as an append-only JSONL file
// (`RELAYER_CHAIN_FEED_STORE`). Not a ledger, not atomic — every failure degrades to "history
// starts now", never to a dead feed.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'

import type { PricePoint } from '../../protocol/src/chain-feed-wire.js'

/** Readings kept per pair: 24 hours at the poll cadence. The chart's whole ambition. */
export const HISTORY_BOUND = 5_760

/** Rewrite the JSONL once it holds this many lines; the tail is all anyone replays. */
export const STORE_COMPACT_LINES = 60_000

export type PriceHistory = Map<string, PricePoint[]>

/** Push onto a pair's ring, shifting past the bound. */
export function pushPoint(history: PriceHistory, pair: string, point: PricePoint): void {
  const series = history.get(pair) ?? []
  series.push(point)
  if (series.length > HISTORY_BOUND) series.shift()
  history.set(pair, series)
}

export function countPoints(history: PriceHistory): number {
  return [...history.values()].reduce((n, s) => n + s.length, 0)
}

export class PriceHistoryStore {
  private lines = 0

  constructor(
    private readonly path: string | undefined,
    private readonly history: PriceHistory,
    private readonly log: (line: string) => void,
    private readonly warn: (line: string) => void,
  ) {}

  /** Read every line back into the rings at boot. Bad lines cost one point; an unreadable file costs nothing. */
  warm(): void {
    const path = this.path
    if (!path) return
    try {
      if (!existsSync(path)) return
      for (const line of readFileSync(path, 'utf8').split('\n')) {
        if (!line) continue
        try {
          const row = JSON.parse(line) as { pair?: unknown; t?: unknown; p?: unknown }
          if (typeof row.pair !== 'string' || typeof row.t !== 'number' || typeof row.p !== 'number') continue
          pushPoint(this.history, row.pair, { t: row.t, p: row.p })
          this.lines += 1
        } catch {
          // One corrupt line costs one point.
        }
      }
      this.log(`chain feed: warmed ${countPoints(this.history)} price points from ${path}`)
    } catch (e) {
      this.warn(`chain feed: could not read ${path} — ${String(e)}; price history starts empty`)
    }
  }

  append(pair: string, point: PricePoint): void {
    const path = this.path
    if (!path) return
    try {
      appendFileSync(path, `${JSON.stringify({ pair, ...point })}\n`)
      this.lines += 1
      if (this.lines > STORE_COMPACT_LINES) this.compact(path)
    } catch (e) {
      this.warn(`chain feed: could not append to ${path} — ${String(e)}`)
    }
  }

  /** Rewrite the file as exactly the rings in memory — the tail is all a boot ever replays. */
  private compact(path: string): void {
    const lines: string[] = []
    for (const [pair, series] of this.history) {
      for (const point of series) lines.push(JSON.stringify({ pair, ...point }))
    }
    writeFileSync(path, lines.join('\n') + (lines.length ? '\n' : ''))
    this.lines = lines.length
    this.log(`chain feed: compacted ${path} to ${lines.length} lines`)
  }
}
