// Durable backing for the sponsorship ledger (FR-053 / AD-7, story 1.5).
//
// Without this, every restart hands the daily budget back out. A relayer that forgets what
// it spent has no budget at all — it has a budget per uptime, and the operator learns the
// difference from the balance. So the counters and the burned invite codes live in a named
// file that outlives the process.
//
// Two deliberate limits, stated rather than discovered:
//
//   1. ONE PROCESS. Durability here means "survives a restart of this process", not
//      "coordinates two of them". Two relayers pointed at one file will clobber each
//      other's counters — last writer wins, and both think they are under budget. The
//      multi-process case wants a store with real compare-and-set (a database, a lock
//      service); do not fake it by pointing two processes at one path.
//
//   2. THE MUTEX IS SYNCHRONOUS I/O. Every read and write below is a *sync* fs call, so
//      the check-then-set in SponsorshipLedger never yields between deciding and
//      recording. That is the whole mutual exclusion, and it is the same argument the
//      in-memory version already relied on — an async store would need a real lock, and
//      an `await` in the middle of a compare-and-set is how two callers both get the
//      last unit of budget. Keep this interface synchronous.
//
// A corrupt file is a hard startup failure, never a silent reset: "the ledger was
// unreadable so we started the day over" is indistinguishable from an attack, and the
// consequence is spending the budget twice.

import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { emptyBudget, type BudgetState } from './sponsorship.js'

/**
 * Everything the ledger must not forget across a restart.
 *
 * The salt lives here with the counters, and it is worth being exact about what that buys
 * and what it does not. It buys opacity AT REST — the file holds no IP, so anything that
 * reads a counter does not thereby read an address — and it buys day-scoped unlinkability,
 * because the day is mixed into every id and yesterday's ids cannot be matched to today's.
 *
 * It does NOT make the file one-way. The salt sits beside the hashes it produced, so anyone
 * who obtains THIS FILE can brute-force the whole IPv4 space against it: 2^32 SHA-256s is
 * hours on commodity hardware, not a barrier. Rotating the store rotates the salt and
 * retires the old ids with it. Treat the file as sensitive, not as anonymised.
 */
export interface PersistedLedger {
  salt: string
  budget: BudgetState
  /** Invite codes already burned. Burns are permanent — a code spent last week stays spent. */
  claimed: string[]
}

/** Synchronous by contract — see the mutex note at the top of this file. */
export interface SponsorshipStore {
  /** The persisted ledger. A store that has never been written returns a fresh one. */
  load(): PersistedLedger
  /** Durably replaces the persisted ledger. Must not return before the bytes are committed. */
  save(next: PersistedLedger): void
}

/** A fresh ledger with a newly minted salt. 32 bytes: this is what un-hashes visitor ids. */
export function emptyLedger(now: number = Date.now()): PersistedLedger {
  return { salt: randomBytes(32).toString('hex'), budget: emptyBudget(now), claimed: [] }
}

/**
 * The one rule for what counts as a salt, applied wherever one arrives.
 *
 * A salt shorter than this is worse than none, because it looks like one: it survives review,
 * it reads in a config file as though privacy were configured, and it raises the cost of
 * recovering addresses by approximately nothing. 32 hex characters is 128 bits, which is what
 * `openssl rand -hex 32` produces. The rule lives here, beside the file the salt is stored in,
 * so a hand-edited ledger is held to exactly the standard an environment variable is.
 */
export function isAcceptableSalt(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-fA-F]{32,}$/.test(value)
}

/**
 * Flushes a directory entry, so a rename that has happened has also been recorded.
 *
 * Best effort by necessity: Windows cannot open a directory as a file descriptor at all, and
 * some filesystems refuse the fsync. Those platforms lose the last-write-before-power-loss
 * guarantee and nothing else — the atomicity of the rename itself is unaffected — so failing
 * the write over it would trade a real capability for a guarantee we cannot offer there anyway.
 */
function syncDirectory(dir: string): void {
  let fd: number | undefined
  try {
    fd = openSync(dir, 'r')
    fsyncSync(fd)
  } catch {
    // Platform cannot do this. See above.
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

class CorruptSponsorshipStore extends Error {
  constructor(path: string, why: string) {
    super(
      `the sponsorship ledger at ${path} is unreadable (${why}). Refusing to start: ` +
        `treating an unreadable ledger as an empty one hands out the whole daily budget ` +
        `a second time. Inspect the file, then either repair it or delete it deliberately.`,
    )
  }
}

/** Rejects anything that is not a ledger, so a truncated or hand-edited file fails loudly. */
function validate(path: string, value: unknown): PersistedLedger {
  const r = value as Partial<PersistedLedger>
  // Held to the same standard as an operator-supplied salt. A hand-edited one-character salt
  // would otherwise load in silence and key every visitor id from then on — the weakest link
  // arriving through the path nobody validates.
  if (!isAcceptableSalt(r?.salt)) {
    throw new CorruptSponsorshipStore(
      path,
      'the salt is missing or shorter than 32 hexadecimal characters',
    )
  }
  if (!Array.isArray(r.claimed) || r.claimed.some((c) => typeof c !== 'string')) {
    throw new CorruptSponsorshipStore(path, 'claimed is not an array of strings')
  }
  const b = r.budget as Partial<BudgetState> | undefined
  if (
    typeof b?.utcDay !== 'string' ||
    !Number.isInteger(b.dailyCount) ||
    (b.dailyCount as number) < 0 ||
    typeof b.perVisitor !== 'object' ||
    b.perVisitor === null ||
    Array.isArray(b.perVisitor)
  ) {
    throw new CorruptSponsorshipStore(path, 'budget is not a budget state')
  }
  // The per-visitor counts are checked too, not just the map around them. An unchecked
  // `{"someone": "lots"}` or a negative count reaches `decideSponsorship` as a comparison
  // against a string, which is silently false — a cap that stops binding is exactly the
  // failure the corrupt-store rule exists to prevent.
  for (const [visitor, count] of Object.entries(b.perVisitor)) {
    if (!Number.isInteger(count) || (count as number) < 0) {
      throw new CorruptSponsorshipStore(
        path,
        `visitor ${JSON.stringify(visitor)} has a count that is not a non-negative integer`,
      )
    }
  }
  return { salt: r.salt, budget: b as BudgetState, claimed: r.claimed }
}

/**
 * The named durable store: one JSON file, replaced whole on every write.
 *
 * Writes go to a sibling temp file and are then renamed over the target. Rename is atomic
 * within a filesystem, so a crash mid-write leaves either the previous ledger or the new
 * one — never a half-written file that the next boot refuses to parse. Writing in place
 * would make "the process died while saving" and "someone corrupted the ledger" the same
 * observable state.
 */
export class FileSponsorshipStore implements SponsorshipStore {
  constructor(readonly path: string) {}

  load(): PersistedLedger {
    let raw: string
    try {
      raw = readFileSync(this.path, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      // First boot. Create the file now rather than on the first spend, so a bad path or a
      // directory we cannot write to fails at startup where the operator is looking.
      const fresh = emptyLedger()
      this.save(fresh)
      return fresh
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      throw new CorruptSponsorshipStore(this.path, String(e))
    }
    return validate(this.path, parsed)
  }

  save(next: PersistedLedger): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = `${this.path}.tmp`
    // fsync before the rename, because the interface promises the bytes are committed when
    // this returns and a plain write only promises they reached the page cache. Renaming over
    // an unflushed temp file survives a process crash but not a power loss: the rename can be
    // durable while the contents it points at are not, which is how an atomic write still
    // yields an empty ledger. The whole point of this file is to be right after a hard stop.
    // 0o600: this file holds the salt beside the hashes that salt keys, so anyone who can read
    // it can brute-force the addresses back out (see PersistedLedger). Default permissions
    // would make it world-readable on a shared host — the mode is set at creation rather than
    // chmod'd after, so there is no window where it exists readable.
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeFileSync(fd, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try {
      renameSync(tmp, this.path)
      // The rename is atomic but not, by itself, durable: the directory entry it creates lives
      // in the parent's metadata, which can still be in cache when the power goes. fsync on the
      // file guarantees the CONTENTS survive; fsync on the directory is what guarantees the
      // NAME points at them. Without this the promise in the interface is half true.
      syncDirectory(dirname(this.path))
    } catch (e) {
      // Leaving the temp file behind would make the next save's write land on a stale name
      // and, worse, leave a copy of the ledger at a path nothing manages. Best-effort: the
      // rename failure is the error worth reporting, not whatever cleanup hits on the way out.
      try {
        unlinkSync(tmp)
      } catch {
        // Nothing useful to do; the rename error below is the one that matters.
      }
      throw e
    }
  }
}

/**
 * Non-durable store for tests and for exercising the ledger without touching a disk.
 *
 * Deliberately NOT a default anywhere: a relayer that silently falls back to this has the
 * bug the file store exists to fix, and it would not announce itself. Callers pass one on
 * purpose or pass a real store.
 */
export class MemorySponsorshipStore implements SponsorshipStore {
  constructor(private record: PersistedLedger = emptyLedger()) {}
  load(): PersistedLedger {
    return structuredClone(this.record)
  }
  save(next: PersistedLedger): void {
    this.record = structuredClone(next)
  }
}
