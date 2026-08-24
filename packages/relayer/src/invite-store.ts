// Durable backing for the invite ledger (FR-014, story 1.14).
//
// The THIRD ledger file, and the third is deliberate. The sponsorship budget and the send cap
// already live apart so that clearing one cannot silently refill the other; invites are a third
// thing again — a per-inviter allowance and a set of one-time bearer codes — and folding them
// into either file would mean an operator resetting a stuck counter also un-burning every code
// ever spent. A burn that can be undone by an unrelated maintenance action is not a burn.
//
// Every limit `sponsorship-store.ts` states applies here unchanged, and for the same reasons:
//
//   1. ONE PROCESS. Two relayers pointed at one file clobber each other, and here the damage is
//      worse than a miscounted budget: last-writer-wins over a claim set is how a burned code
//      comes back to life and pays for a second registration.
//
//   2. THE MUTEX IS SYNCHRONOUS I/O. `InviteLedger`'s claim is a check-then-set that must not
//      yield between deciding and recording, or two concurrent claims of one code both win —
//      the exact race the atomic burn exists to prevent. Keep this interface synchronous.
//
// A corrupt file is a hard startup failure, never a silent reset. An unreadable invite ledger
// read as empty un-burns every code and re-opens every inviter's allowance at once, which is
// indistinguishable from an attack and costs a day of budget to discover.

import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { atomicWriteJson, isAcceptableSalt } from './sponsorship-store.js'

/**
 * One minted invite, and the whole life of a code.
 *
 * `claimedAt` and `consumedAt` are SEPARATE and both monotonic. Claiming is the invitee's
 * browser burning the code before it is entitled to anything; consuming is the one sponsored
 * submission that burn paid for. Collapsing them into a single flag would make "claimed but
 * never registered" — the invitee who opened the link and wandered off, which is the common
 * case — indistinguishable from "already spent a registration", and the sender's ladder needs
 * to tell those apart.
 *
 * `inviterKey` is H(salt|ip) with NO UTC DAY MIXED IN, unlike `visitorId` in server.ts. A
 * rolling-24h window keyed on a day-salted id would silently reset every visitor's allowance at
 * midnight, so `1 more in 19h` would be a promise the ledger forgets on the way there.
 */
export interface InviteRecord {
  code: string
  mintedAt: number
  expiresAt: number
  inviterKey: string
  claimedAt?: number
  /**
   * The CLAIMANT TOKEN that won the burn — a random string the claiming browser minted and sent,
   * recorded so a RETRY BY THE WINNER is not mistaken for a double claim. A claim response lost
   * to a dropped connection gets retried by the browser that already won, and without this the
   * real invitee is shown the loser's copy: locked out of the invite they hold by a network blip.
   *
   * NOT A VISITOR ID, and the distinction is the whole reason this is a separate value rather
   * than the id the caps already key on. Visitor ids derive from the client ADDRESS, so every
   * browser behind one NAT shares one — the loser of a genuine race in the same office would
   * match the winner's id and be told they had won, which is precisely the outcome the burn
   * exists to prevent. It carries no identity of any kind; it is an idempotency token and
   * nothing else.
   *
   * OPTIONAL. A claimer that offered no token gets a burn with no `claimedBy`, and such a burn
   * can never be replayed — a later retry is treated as a fresh claim and refused. That fails
   * toward refusing, which is the right direction for a bearer credential.
   */
  claimedBy?: string
  consumedAt?: number
}

/**
 * Claim attempts, one UTC day at a time.
 *
 * ROLLED RATHER THAN ACCUMULATED, matching `BudgetState`. A map keyed by visitor-and-day would
 * grow forever in a file that is rewritten whole on every write; a map for today, cleared when
 * the day turns, is bounded by the number of addresses that tried today.
 */
export interface ClaimAttemptState {
  utcDay: string
  counts: Record<string, number>
}

/**
 * Everything the invite ledger must not forget across a restart.
 *
 * The salt has exactly the properties `PersistedLedger` documents for its own: opaque at rest,
 * NOT one-way against a leak of the file, and worth treating as sensitive rather than as
 * anonymised. One difference worth stating: this salt is not day-scoped in use, so the inviter
 * ids here are stable for as long as the salt is. That is the point — the rolling window has to
 * outlive midnight — and it is also the cost, so rotating the file rotates the ids with it.
 */
export interface PersistedInvites {
  salt: string
  invites: InviteRecord[]
  attempts: ClaimAttemptState
}

/** Synchronous by contract — see the mutex note at the top of this file. */
export interface InviteStore {
  load(): PersistedInvites
  /** Durably replaces the persisted ledger. Must not return before the bytes are committed. */
  save(next: PersistedInvites): void
}

/** A fresh ledger with a newly minted salt. Callers that share a salt overwrite it on open. */
export function emptyInvites(salt: string = randomBytes(32).toString('hex')): PersistedInvites {
  return { salt, invites: [], attempts: { utcDay: '', counts: {} } }
}

export class CorruptInviteStore extends Error {
  constructor(path: string, why: string) {
    super(
      `the invite ledger at ${path} is unreadable (${why}). Refusing to start: treating an ` +
        `unreadable invite ledger as an empty one un-burns every code that was ever claimed and ` +
        `re-opens every inviter's allowance at once. Inspect the file, then either repair it or ` +
        `delete it deliberately.`,
    )
    this.name = 'CorruptInviteStore'
  }
}

/** Rejects anything that is not an invite record, field by field. */
function validateRecord(path: string, value: unknown, index: number): InviteRecord {
  const r = value as Partial<InviteRecord> | null
  const bad = (why: string): never => {
    throw new CorruptInviteStore(path, `invite ${index} ${why}`)
  }
  if (!r || typeof r !== 'object' || Array.isArray(r)) bad('is not an object')
  if (typeof r!.code !== 'string' || r!.code === '') bad('has no code')
  if (typeof r!.inviterKey !== 'string' || r!.inviterKey === '') bad('has no inviter key')
  // Timestamps are checked as FINITE numbers, not merely as numbers. `JSON.parse` will hand back
  // whatever was written, and a `null` that arrived from a laundered `NaN` compares false against
  // every expiry — which reads as a code that never expires rather than as a broken record.
  for (const field of ['mintedAt', 'expiresAt'] as const) {
    if (typeof r![field] !== 'number' || !Number.isFinite(r![field])) bad(`has a ${field} of ${String(r![field])}`)
  }
  for (const field of ['claimedAt', 'consumedAt'] as const) {
    const v = r![field]
    if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v))) {
      bad(`has a ${field} of ${String(v)}`)
    }
  }
  // A consumed code that was never claimed is not a state this ledger can produce, so a file
  // holding one has been edited or corrupted. It matters because `consumedAt` is what stops a
  // code paying twice and `claimedAt` is what let it pay at all.
  if (r!.consumedAt !== undefined && r!.claimedAt === undefined) {
    bad('is consumed without ever having been claimed')
  }
  // A CLAIM WITHOUT A CLAIMANT TOKEN IS LEGAL. The token is offered by the claiming browser and
  // is optional, so a burn that recorded none is an ordinary burn — it simply cannot be replayed,
  // and a later retry is refused as a fresh claim. That fails toward refusing, which is the
  // correct direction for a bearer credential.
  //
  // THE REVERSE IS NOT LEGAL. Only the burn writes `claimedBy`, so a token sitting on a record
  // that was never claimed is a file somebody edited or a write that went wrong — and its effect
  // would be to hand a replay to whoever holds that token the moment the code IS claimed.
  if (r!.claimedAt === undefined && r!.claimedBy !== undefined) {
    bad(`has a claimedBy of ${String(r!.claimedBy)} without ever having been claimed`)
  }
  // An empty token is worse than an absent one: it is a string, so it would COMPARE EQUAL to
  // another empty token and let any claimer who sent nothing inherit the burn.
  if (r!.claimedBy !== undefined && (typeof r!.claimedBy !== 'string' || r!.claimedBy === '')) {
    bad(`has a claimedBy of ${String(r!.claimedBy)}, which is not a usable claimant token`)
  }
  const { code, mintedAt, expiresAt, inviterKey, claimedAt, claimedBy, consumedAt } =
    r as InviteRecord
  return { code, mintedAt, expiresAt, inviterKey, claimedAt, claimedBy, consumedAt }
}

/** Rejects anything that is not a ledger, so a truncated or hand-edited file fails loudly. */
export function validateInvites(path: string, value: unknown): PersistedInvites {
  const r = value as Partial<PersistedInvites> | null
  if (!r || typeof r !== 'object' || Array.isArray(r)) {
    throw new CorruptInviteStore(path, `the file holds ${r === null ? 'null' : typeof r}`)
  }
  // Held to the same standard as an operator-supplied salt, through the same predicate the
  // sponsorship store uses. Two salt rules would eventually be two different salt rules.
  if (!isAcceptableSalt(r.salt)) {
    throw new CorruptInviteStore(path, 'the salt is missing or shorter than 32 hexadecimal characters')
  }
  if (!Array.isArray(r.invites)) {
    throw new CorruptInviteStore(path, 'invites is not an array')
  }
  const invites = r.invites.map((v, i) => validateRecord(path, v, i))
  // Duplicate codes would make "the first match wins" the rule that decides whether a code is
  // burned, and which one is first is an artefact of write order. Refuse instead.
  const seen = new Set<string>()
  for (const invite of invites) {
    if (seen.has(invite.code)) {
      throw new CorruptInviteStore(path, `the code ${JSON.stringify(invite.code)} appears twice`)
    }
    seen.add(invite.code)
  }
  const a = r.attempts as Partial<ClaimAttemptState> | undefined
  if (
    typeof a?.utcDay !== 'string' ||
    typeof a.counts !== 'object' ||
    a.counts === null ||
    Array.isArray(a.counts)
  ) {
    throw new CorruptInviteStore(path, 'attempts is not a claim-attempt state')
  }
  // The counts themselves, not just the map around them. An unchecked `{"someone": "lots"}`
  // reaches the cap comparison as a compare against a string, which is silently false — a cap
  // that has stopped binding is exactly what the corrupt-store rule exists to prevent, and here
  // it is the only thing standing between a six-character code and an offline guessing run.
  for (const [visitor, count] of Object.entries(a.counts)) {
    if (!Number.isInteger(count) || (count as number) < 0) {
      throw new CorruptInviteStore(
        path,
        `visitor ${JSON.stringify(visitor)} has a claim-attempt count that is not a non-negative integer`,
      )
    }
  }
  return { salt: r.salt, invites, attempts: { utcDay: a.utcDay, counts: a.counts } }
}

/**
 * The named durable store: one JSON file, replaced whole on every write.
 *
 * The write discipline — temp file, fsync, rename, fsync the directory, mode 0o600 — is
 * `FileSponsorshipStore`'s, shared through `atomicWriteJson` rather than written twice. Two
 * copies of a durability argument is how one of them quietly stops being true.
 */
export class FileInviteStore implements InviteStore {
  constructor(readonly path: string) {}

  load(): PersistedInvites {
    let raw: string
    try {
      raw = readFileSync(this.path, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      // First boot. Written now rather than on the first mint, so a bad path or an unwritable
      // directory fails at startup where the operator is looking.
      const fresh = emptyInvites()
      this.save(fresh)
      return fresh
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (e) {
      throw new CorruptInviteStore(this.path, String(e))
    }
    return validateInvites(this.path, parsed)
  }

  save(next: PersistedInvites): void {
    atomicWriteJson(this.path, next)
  }
}

/**
 * Non-durable store for tests and for exercising the ledger without touching a disk.
 *
 * Deliberately NOT a default anywhere, for the reason `MemorySponsorshipStore` gives: a relayer
 * that silently falls back to this re-opens every allowance and un-burns every code on restart,
 * and it would not announce itself.
 */
export class MemoryInviteStore implements InviteStore {
  constructor(private record: PersistedInvites = emptyInvites()) {}
  load(): PersistedInvites {
    return structuredClone(this.record)
  }
  save(next: PersistedInvites): void {
    this.record = structuredClone(next)
  }
}
