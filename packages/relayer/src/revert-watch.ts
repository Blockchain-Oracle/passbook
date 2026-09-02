// The meters give a unit back when a transaction reverts.
//
// ── WHY THIS EXISTS ───────────────────────────────────────────────────────────────────────
//
// A spend is recorded before the broadcast, which is what stops two concurrent requests sharing
// one check. `/submit` already unwinds that spend when the batch provably never reached the chain
// (`NEVER_BROADCAST`). The case it could not cover is the one users actually hit: the transaction
// IS broadcast, lands in a block, and reverts. The user gets nothing, the unit is gone, and with a
// per-visitor cap of one that is now a PERMANENT lockout — bought by a failure that was ours.
// Per-visitor allocations stopped resetting at midnight (`ledger.ts`), so this refund is the only
// thing standing between a revert we caused and a user who can never be served again.
//
// ── WHY THE RELAYER READS THE RECEIPT ITSELF ──────────────────────────────────────────────
//
// The obvious cheaper design is a client that reports its own revert. That is an unmetered key:
// anyone willing to POST "it reverted" refills their own allowance forever. So the only claim
// trusted here is a receipt this process fetched for a hash this process broadcast. Nothing a
// caller sends reaches this file.
//
// ── AND WHY A REVERT REFUND IS NOT FREE MONEY FOR AN ATTACKER ─────────────────────────────
//
// A reverted transaction still costs us real gas, so a caller who can make transactions revert on
// purpose can drain the wallet — if the refund is total. It is not: `refundCourtesy` returns the
// per-visitor unit and leaves the day's count where it is, so `RELAYER_SPONSOR_DAILY` still bounds
// how many transactions this relayer will ever pay for in one day, reverting or otherwise. The
// courtesy is refundable; the solvency floor is not.
import type { SponsorshipLedger } from './sponsorship.js'
import { atomicWriteJson } from './sponsorship-store.js'
import { readFileSync } from 'node:fs'
// The receipt verdict is the browser's too (position history reads it) — one definition, in protocol.
import { receiptOutcome, type ReceiptOutcome as Outcome } from '../../protocol/src/market-events.js'

export { receiptOutcome }

/** How often the pending set is swept. Mainnet blocks are ~2 s; this is one sweep per two blocks. */
export const REVERT_WATCH_INTERVAL_MS = 4_000

/**
 * How long a hash is watched before the spend is left alone for good.
 *
 * The deadline direction is deliberate: a watch that expires KEEPS the unit spent. Reaching it
 * means we never saw a receipt, which is not evidence of a revert — it is evidence of a slow
 * chain or an unreachable node, and refunding on silence would hand a unit back for a
 * transaction that went on to succeed.
 */
export const REVERT_WATCH_DEADLINE_MS = 300_000

/** A bound on the file and on one sweep's RPC traffic. Beyond it the oldest watch is dropped. */
const MAX_PENDING = 64

/** Which IP-keyed budget paid for this submission. The account allowance is named separately. */
export type SpentMeter = 'sponsorship' | 'send' | 'starter'

/** One broadcast hash and exactly which units it spent, so a revert can give those back. */
export interface WatchedSubmission {
  hash: string
  /** The UTC day the spend was recorded against — a refund across the boundary is declined. */
  utcDay: string
  /** The hashed visitor id, when an IP-keyed budget was spent. */
  visitor?: string
  meter?: SpentMeter
  /** The account address, when the per-account allowance was spent. */
  account?: string
  /** The one-time claim key a starter drip burned, when this submission was one. */
  claim?: string
  submittedAt: number
}

export interface RevertWatchLedgers {
  sponsorship?: SponsorshipLedger
  send?: SponsorshipLedger
  account?: SponsorshipLedger
  /** Holds the once-per-account claims a starter drip burns. */
  faucet?: SponsorshipLedger
  /** The starter's DAY budget — the counters, not the claims. See ledger.ts for why they are apart. */
  starter?: SponsorshipLedger
}

export interface RevertWatchOptions {
  file: string
  /** Reads a receipt by hash. Throws while the transaction is not yet in a block — that is "pending". */
  readReceipt: (hash: string) => Promise<unknown>
  ledgers: RevertWatchLedgers
  deadlineMs?: number
  now?: () => number
  log?: (line: string) => void
}

/** Keeps only entries that are shaped like watches, so a hand-edited file loses rows, not the boot. */
function validate(value: unknown): WatchedSubmission[] {
  const rows = (value as { pending?: unknown } | null)?.pending
  if (!Array.isArray(rows)) return []
  const out: WatchedSubmission[] = []
  for (const row of rows) {
    const r = row as Partial<WatchedSubmission>
    if (typeof r?.hash !== 'string' || !r.hash.startsWith('0x')) continue
    if (typeof r.utcDay !== 'string' || !Number.isInteger(r.submittedAt)) continue
    if (r.visitor !== undefined && typeof r.visitor !== 'string') continue
    if (r.account !== undefined && typeof r.account !== 'string') continue
    if (r.claim !== undefined && typeof r.claim !== 'string') continue
    if (r.meter !== undefined && r.meter !== 'sponsorship' && r.meter !== 'send' && r.meter !== 'starter') continue
    out.push({
      hash: r.hash,
      utcDay: r.utcDay,
      submittedAt: r.submittedAt as number,
      ...(r.visitor ? { visitor: r.visitor } : {}),
      ...(r.meter ? { meter: r.meter } : {}),
      ...(r.account ? { account: r.account } : {}),
      ...(r.claim ? { claim: r.claim } : {}),
    })
  }
  return out
}

/**
 * The pending set, durable across restarts.
 *
 * ── AN UNREADABLE FILE IS NOT A STARTUP FAILURE HERE, UNLIKE EVERY LEDGER ─────────────────
 *
 * `FileSponsorshipStore` refuses to boot on a corrupt file, and it is right to: a forgotten ledger
 * hands the whole daily budget out twice. This file fails the other way. Forgetting a watch means
 * a refund that never happens — a user keeps a spend they were owed back, which is the same state
 * as before this file existed. Bricking a funded relayer to protect a courtesy would be the worse
 * trade, so a bad file starts empty and says so.
 */
export class RevertWatch {
  private pending: WatchedSubmission[]
  private sweeping = false
  private readonly log: (line: string) => void
  private readonly now: () => number
  private readonly deadlineMs: number

  constructor(private readonly opts: RevertWatchOptions) {
    this.log = opts.log ?? ((l) => console.log(l))
    this.now = opts.now ?? (() => Date.now())
    this.deadlineMs = opts.deadlineMs ?? REVERT_WATCH_DEADLINE_MS
    this.pending = this.load()
    if (this.pending.length > 0) {
      this.log(`revert-watch: resumed ${this.pending.length} pending submission(s) from ${opts.file}`)
    }
  }

  private load(): WatchedSubmission[] {
    let raw: string
    try {
      raw = readFileSync(this.opts.file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.log(`revert-watch: WARNING ${this.opts.file} is unreadable (${String(e)}); starting empty`)
      }
      return []
    }
    try {
      return validate(JSON.parse(raw))
    } catch (e) {
      this.log(`revert-watch: WARNING ${this.opts.file} is not JSON (${String(e)}); starting empty`)
      return []
    }
  }

  private persist(): void {
    atomicWriteJson(this.opts.file, { pending: this.pending })
  }

  /** How many hashes are being watched. Read by `/health`, so the deployment can be seen working. */
  size(): number {
    return this.pending.length
  }

  /**
   * Starts watching a hash. Persists BEFORE the process can lose it — the transaction is already
   * on its way, so a watch that exists only in memory is a refund a restart silently cancels.
   *
   * A submission that spent nothing is not watched: there is nothing to give back.
   */
  watch(entry: WatchedSubmission): void {
    if (!entry.visitor && !entry.account && !entry.claim) return
    this.pending = [...this.pending, entry].slice(-MAX_PENDING)
    this.persist()
  }

  /**
   * One pass over the pending set. Never runs twice at once — a slow node would otherwise stack
   * sweeps and read the same receipt from two ticks, and the second one refunds against a watch
   * the first already removed.
   */
  async sweep(): Promise<void> {
    if (this.sweeping || this.pending.length === 0) return
    this.sweeping = true
    try {
      const keep: WatchedSubmission[] = []
      let changed = false
      for (const w of this.pending) {
        const now = this.now()
        let outcome: Outcome = 'pending'
        try {
          outcome = receiptOutcome(await this.opts.readReceipt(w.hash))
        } catch {
          // Not in a block yet, or the node is unreachable. Both are "ask again next tick".
        }
        if (outcome === 'reverted') {
          this.refund(w, now)
          changed = true
          continue
        }
        if (outcome === 'succeeded') {
          changed = true
          continue
        }
        if (now - w.submittedAt > this.deadlineMs) {
          this.log(`revert-watch: giving up on ${w.hash.slice(0, 12)}… after ${Math.round(this.deadlineMs / 1000)}s; the spend stands`)
          changed = true
          continue
        }
        keep.push(w)
      }
      if (changed) {
        this.pending = keep
        this.persist()
      }
    } finally {
      this.sweeping = false
    }
  }

  /**
   * Gives back every unit this hash spent. ONE TRY EACH, like `/submit`'s pre-broadcast refund: a
   * failed write on the first meter must not skip the second and leave the user half repaid.
   */
  private refund(w: WatchedSubmission, now: number): void {
    const back: string[] = []
    if (w.visitor && w.meter) {
      // By NAME, not by a chain of ternaries: a third meter added to the union without a branch
      // here would silently refund the sponsorship budget instead, which is a real unit of someone
      // else's money moving for a transaction that had nothing to do with it.
      const ledger = this.opts.ledgers[w.meter === 'send' ? 'send' : w.meter === 'starter' ? 'starter' : 'sponsorship']
      try {
        ledger?.refundCourtesy(w.visitor, now)
        if (ledger) back.push(w.meter)
      } catch (e) {
        this.log(`revert-watch: the ${w.meter} unit stays spent, its refund could not be written: ${String(e)}`)
      }
    }
    if (w.account) {
      try {
        this.opts.ledgers.account?.refundCourtesy(w.account, now)
        if (this.opts.ledgers.account) back.push('allowance')
      } catch (e) {
        this.log(`revert-watch: the allowance unit stays spent, its refund could not be written: ${String(e)}`)
      }
    }
    // A drip that reverted delivered no note, so the one chance to receive one is not spent. This
    // is the only kind of refund that matters more than a meter: a burned claim never returns at
    // midnight, so without this a single revert would cost an account its starting balance forever.
    if (w.claim) {
      try {
        this.opts.ledgers.faucet?.releaseClaim(w.claim)
        if (this.opts.ledgers.faucet) back.push('starter claim')
      } catch (e) {
        this.log(`revert-watch: the starter claim stays burned, its release could not be written: ${String(e)}`)
      }
    }
    this.log(`revert-watch: ${w.hash.slice(0, 12)}… REVERTED — gave back ${back.join(' + ') || 'nothing'}`)
  }
}

/** Opens the watch over its file. Present in every deployment; the file is created on first watch. */
export function openRevertWatch(opts: RevertWatchOptions): RevertWatch {
  return new RevertWatch(opts)
}
