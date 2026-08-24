//
// The session storage tier (story 1.11, G1) — the first persistence this browser app has.
//
// Everything above this file is pure. `identity.ts` mints keys and never keeps one,
// `backup-gate.ts` projects a ceremony and never writes it, `backup-cadence.ts` declares a
// store interface and ships a refusal in its place. This module is the one place that
// actually touches a browser storage API, and it is deliberately the smallest surface that
// can carry the values this app is allowed to persist.
//
// THE LIST IS CLOSED, AND IT IS FOUR LONG. The account key, the `ready` projection of the
// backup ceremony, the backup cadence record, and (story 1.14) the sender's invite intents.
// Never a note, never a discovery result, never a Recovery Code, never a wrapped Recovery
// File. See `session.ts`'s header for why each of those is excluded; `SESSION_KEYS` below is
// the enforcement, because a value with no key here has nowhere to go.
//
// SYNCHRONOUS ON PURPOSE, following `relayer/src/sponsorship-store.ts`. The cadence seam
// (`BackupCadenceStore`) is declared synchronous, and the reason is the same one written
// there: a check-then-write that cannot yield in the middle is atomic against anything else
// running in the same tab. An async store would let two callers interleave between the read
// and the write, which is the class of bug this whole story exists to close.
//

import { SESSION_STORAGE_UNAVAILABLE } from './session-copy.js'

/**
 * A place a small string can be kept across a reload. Three methods, all synchronous.
 *
 * `read` answers `null` for a key that was never written — the same shape `Storage.getItem`
 * uses, so the localStorage implementation is a pass-through rather than a translation. A
 * store that cannot answer THROWS instead of returning `null`: "there is nothing stored" and
 * "I could not look" are different facts, and collapsing them is how a broken store gets
 * mistaken for a fresh account and a second identity gets minted over the first.
 */
export interface SessionStore {
  read(key: SessionKey): string | null
  write(key: SessionKey, value: string): void
  remove(key: SessionKey): void
}

/**
 * The only keys a `SessionStore` will accept — the union of `SESSION_KEYS`' values.
 *
 * "The list is closed" was a claim in a comment and a count in a test; this makes it a rule the
 * compiler enforces. A new value cannot be persisted by adding a string at a call site: it has
 * to be added to `SESSION_KEYS`, which is the line a reviewer is watching and the decision the
 * spec reserves. The feature probe writes through the raw `Storage` API rather than through a
 * `SessionStore`, so its scratch key is unaffected by this and does not belong in the union.
 */
export type SessionKey = (typeof SESSION_KEYS)[keyof typeof SESSION_KEYS]

/**
 * Every key this application is allowed to persist under, and there are exactly four.
 *
 * Namespaced so the app can be hosted on an origin it shares with something else without
 * either side stepping on the other, and so a human reading their own localStorage can tell
 * what belongs to this app.
 *
 * THE FOURTH ENTRY WAS ADDED DELIBERATELY BY STORY 1.14, which is the process this union exists
 * to force. Story 1.11 wrote "exactly three" and meant it; the count is not the rule. The rule
 * is that adding one is a reviewable decision with an argument attached, and the argument for
 * `inviteIntents` is written at the key below and again in `session-invite-store.ts`.
 */
export const SESSION_KEYS = {
  /** The root Account Key (D33). The one secret this tier holds. */
  accountKey: 'passbook.account-key',
  /** `persistableCeremonyState`'s return, and nothing else it could have returned. */
  ceremony: 'passbook.backup-ceremony',
  /** The backup cadence ladder and its status. */
  cadence: 'passbook.backup-cadence',
  /**
   * Invite intents: what the SENDER TYPED when they attached money to an invite, plus where each
   * one stands (story 1.14, FR-014/FR-060).
   *
   * IT HAS TO BE PERSISTED OR THE FEATURE DOES NOT EXIST. There is no escrow and no relayer-held
   * record — deliberately, because relayer-opened channels would serialize globally on
   * `INDEX_NOT_SEQUENTIAL` and would put the relayer's address on chain as the sender of
   * somebody else's money. The sender's own app is therefore the only party holding the intent,
   * and an intent that does not survive a reload is a promise the app forgets while the invitee
   * is still reading the link.
   *
   * WHY IT IS NOT ON THE MUST-NEVER LIST, stated here because `amount` superficially resembles
   * something that is: this record is what the user TYPED — a recipient they chose, a token they
   * picked, an amount they entered, and a state this app set. Nothing in it is decrypted, nothing
   * is discovered, and nothing is read out of the pool. It is not a cache of a balance; it is a
   * note-to-self about money that has not moved. See `session-invite-store.ts` and `session.ts`.
   */
  inviteIntents: 'passbook.invite-intents',
} as const

/** An in-memory store: real semantics, no durability. The default for tests. */
export function inMemorySessionStore(
  seed: Readonly<Partial<Record<SessionKey, string>>> = {},
): SessionStore {
  const map = new Map<string, string>(Object.entries(seed))
  return {
    read: (key) => map.get(key) ?? null,
    write: (key, value) => void map.set(key, value),
    remove: (key) => void map.delete(key),
  }
}

/** The named reason the refusing default gives. Named, so a log says which store answered. */
export const SESSION_STORE_UNWIRED =
  'no session store is wired: pass one built by localStorageSessionStore() or inMemorySessionStore()'

/** A store whose every method throws `reason`. The shape of every refusal in this module. */
export function refusingSessionStore(reason: string): SessionStore {
  const refuse = (): never => {
    throw new Error(reason)
  }
  return { read: refuse, write: refuse, remove: refuse }
}

/**
 * The default store: it refuses, in as many words.
 *
 * The same shape of default `backup-cadence.ts` ships for its own seam, and for the same
 * reason stated there. An in-memory fallback would make persistence appear to work and forget
 * everything on reload — and the account key is the one value in this system where forgetting
 * is unrecoverable, because the pool writes the viewing key once. A store that throws is a bug
 * report; a store that quietly loses a key is an orphaned account.
 */
export const REFUSING_SESSION_STORE: SessionStore = refusingSessionStore(SESSION_STORE_UNWIRED)

/**
 * How old a probe key must be before a later probe will clear it away.
 *
 * A probe is three synchronous storage calls, so a live one is microseconds old and anything
 * this stale belongs to a page load that is gone. Generous by four orders of magnitude, because
 * the cost of waiting is one abandoned key and the cost of being wrong is deleting a key out
 * from under a probe that is running right now — which is the read-each-other race the
 * per-probe keys were introduced to fix.
 */
const PROBE_KEY_STALE_MS = 60_000

/**
 * The floor a parsed key timestamp must clear to be believed — epoch ms in 2001.
 *
 * `Number.parseInt(s, 36)` is far more permissive than it looks: base 36 is the digits plus the
 * whole alphabet, so ordinary words parse happily (`who` is 42,108) and `Number.isFinite` waves
 * every one of them through. Without a floor, a probe key with any alphabetic nonce dates to
 * the 1970s, reads as ancient, and gets swept — including one another tab is holding right now,
 * which is the race this whole mechanism exists to avoid. A real timestamp is thirteen digits.
 */
const PLAUSIBLE_EPOCH_MS_FLOOR = 1e12

/**
 * Removes probe keys abandoned by earlier page loads. `keep` and anything recent are spared.
 *
 * Per-probe keys fixed the race where two tabs read each other's witness, and introduced a
 * smaller problem in its place: a tab killed between `setItem` and `removeItem` leaves its key
 * forever, where on a single fixed key that was self-healing. Quota is finite and this is the
 * one thing in the app that writes keys nobody will ever read again.
 *
 * AGE IS WHAT MAKES THIS SAFE. A blanket sweep of every key but our own deletes the in-flight
 * key of a tab probing concurrently, which puts the original race straight back — the other tab
 * reads back `null` and declares a healthy storage broken. The timestamp is the first segment
 * of the nonce precisely so this can tell the two apart; a key whose age cannot be read is left
 * alone, because an unreadable date is not evidence of abandonment.
 *
 * Best effort, and silent. A sweep that threw would fail a probe of a storage that had just
 * demonstrably passed its round trip, which is the wrong answer to "does this storage work".
 */
function sweepStaleProbeKeys(storage: Storage, keep: string, now: number): void {
  try {
    const stale: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key || key === keep || !key.startsWith(`${PROBE_KEY_PREFIX}.`)) continue
      const written = Number.parseInt(key.slice(PROBE_KEY_PREFIX.length + 1).split('-')[0] ?? '', 36)
      // A value from the future is left alone too: it means a clock moved, not that a tab died.
      const dated = Number.isFinite(written) && written >= PLAUSIBLE_EPOCH_MS_FLOOR && written <= now
      if (dated && now - written > PROBE_KEY_STALE_MS) stale.push(key)
    }
    // Collected first, then removed: removing during the walk shifts the indices under it.
    for (const key of stale) storage.removeItem(key)
  } catch {
    // A storage that will not enumerate is still a storage that round-tripped a value.
  }
}

/** What the feature probe found: a usable storage, or the reason there is not one. */
export type StorageProbe =
  | { ok: true; storage: Storage }
  | { ok: false; reason: string }

/**
 * The prefix the probe writes under. Namespaced, so a leaked key is attributable.
 *
 * The full key carries the witness's random component, because two tabs probing at the same
 * moment share this storage: on a single fixed key, tab A writes, tab B overwrites, and A reads
 * back B's witness and concludes that a perfectly healthy localStorage does not keep what it is
 * given. The app then refuses to create an account in a browser that was fine. Per-probe keys
 * cannot collide, so each tab only ever reads its own.
 */
const PROBE_KEY_PREFIX = 'passbook.storage-probe'

/**
 * Distinguishes probes started inside the same millisecond by the same code.
 *
 * `Math.random()` alone is not enough on its own here and the reason is specific: two tabs
 * restored together by a session restore start from the same page, and some engines seed a
 * fresh context's PRNG in a way that makes the first draw correlate. A monotonic counter cannot
 * collide within a context, the timestamp separates contexts started at different moments, and
 * the random component covers the rest.
 */
let probeCounter = 0

/**
 * Decides whether `localStorage` actually works, by USING it.
 *
 * A WRITE / READ-BACK / REMOVE ROUND TRIP, NEVER A `typeof` CHECK, and the difference is not
 * theoretical — it is the environment this repository's own test suite runs in. Node 25 ships
 * a `localStorage` global that is an object (so `typeof localStorage === 'object'` passes)
 * whose `setItem` is `undefined`; a presence check therefore hands back a store that throws a
 * TypeError on the first write, at the exact moment a freshly generated account key is being
 * saved. Verified by probe on this machine, not assumed.
 *
 * The same round trip is what covers the three browser cases a presence check also misses:
 * Safari private mode (the API is there and every write throws), a browser configured to
 * block storage for the origin (property access itself throws), and a full quota (writes
 * throw only once you attempt one). All four failures look identical from here, which is the
 * point — the probe does not care WHY, it cares whether a value written comes back.
 *
 * The value is read BACK and compared rather than merely written. A storage that accepts
 * writes and forgets them is not a storage, and it is the one failure mode a write-only probe
 * would wave through.
 */
export function probeLocalStorage(candidate?: unknown): StorageProbe {
  let storage: Storage
  try {
    // `=== undefined`, not `??`. A caller passing `null` is saying "there is no storage here",
    // and coalescing that into the global would silently probe something else instead —
    // answering a question nobody asked.
    storage = (candidate === undefined
      ? (globalThis as { localStorage?: Storage }).localStorage
      : candidate) as Storage
  } catch (e) {
    return { ok: false, reason: `reaching localStorage threw: ${String(e)}` }
  }
  if (!storage) return { ok: false, reason: 'there is no localStorage in this environment' }

  // The timestamp leads, because `sweepStaleProbeKeys` reads it back out of the key to tell an
  // abandoned probe from one running right now.
  const startedAt = Date.now()
  const nonce = `${startedAt.toString(36)}-${(probeCounter += 1).toString(36)}-${Math.random().toString(36).slice(2)}`
  const probeKey = `${PROBE_KEY_PREFIX}.${nonce}`
  const witness = `probe-${nonce}`
  try {
    storage.setItem(probeKey, witness)
    const echo = storage.getItem(probeKey)
    storage.removeItem(probeKey)
    sweepStaleProbeKeys(storage, probeKey, startedAt)
    if (echo !== witness) {
      return {
        ok: false,
        reason: `localStorage accepted a write and read back ${String(echo)}, so it does not keep what it is given`,
      }
    }
    return { ok: true, storage }
  } catch (e) {
    // Cleaning up after a partial round trip. A probe key left behind would be the one piece
    // of litter this module produces, and it must not survive a failure it caused.
    try {
      storage.removeItem(probeKey)
    } catch {
      // Nothing to do: the storage that just failed a write is not going to honour a remove
      // either, and a probe must not throw out of its own cleanup.
    }
    return { ok: false, reason: `localStorage round trip threw: ${String(e)}` }
  }
}

/**
 * A store over `localStorage`, or `null` when this environment does not have a working one.
 *
 * `null` rather than a throwing store, so the caller has to decide what an environment
 * without persistence means for it — `browserSessionStore` below makes that decision one way,
 * and a caller that wants a different one (an in-memory session for a hardened browser, say)
 * can see the absence and choose.
 */
export function localStorageSessionStore(candidate?: unknown): SessionStore | null {
  const probe = probeLocalStorage(candidate)
  return probe.ok ? storeOver(probe.storage) : null
}

/** The adapter, written once. Both constructors above and below reach a `Storage` through it. */
const storeOver = (storage: Storage): SessionStore => ({
  read: (key) => storage.getItem(key),
  write: (key, value) => storage.setItem(key, value),
  remove: (key) => storage.removeItem(key),
})

/**
 * The sentence a surface shows when there is nowhere to save anything.
 *
 * The exported copy const IS the refusal's message rather than a second hand-written string, so
 * the sentence and the condition that produces it cannot drift apart — the diagnostic detail
 * rides along in parentheses for the log. Same discipline as the lock: one sentence, thrown by
 * the code path it describes.
 */
const storageRefusal = (reason: string) => `${SESSION_STORAGE_UNAVAILABLE} (${reason})`

/**
 * The one call an app boot makes: durable storage where it exists, a refusal that says why
 * where it does not.
 *
 * Never an in-memory fallback. A browser that cannot persist is a browser where registering
 * would orphan the account on the next reload, and the honest behaviour is for every seam
 * downstream to fail — `loadOrCreateAccountKey` returns a typed failure, the cadence store
 * reads `unreadable`, the backup status collapses to not-backed-up, and the registration gate
 * stays shut. That is a product that refuses to do something irreversible in a place it
 * cannot keep a record, which is the correct outcome and not a degraded one.
 */
export function browserSessionStore(candidate?: unknown): SessionStore {
  const probe = probeLocalStorage(candidate)
  return probe.ok ? storeOver(probe.storage) : refusingSessionStore(storageRefusal(probe.reason))
}
