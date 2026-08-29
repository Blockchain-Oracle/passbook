//
// The account key across reloads, and the one ceremony fact that may sit beside it.
//
// PERSIST BEFORE RETURN, AND RETURN WHAT WAS READ BACK. A key handed out and never written is an
// identity the user can register with the pool — which writes the viewing key ONCE — and then lose
// on the next reload. Re-reading the stored value is what makes two tabs that both generated
// converge on ONE key before either can act. This narrows the tab race (localStorage has no
// compare-and-set); `session-lock.ts` is what serialises the operations that matter.
//
// The root key sits in localStorage in PLAINTEXT, as an accepted risk: every alternative available
// in a browser moves the exposure rather than removing it, and a passkey WRAP (never a derive —
// WebAuthn assertions are not deterministic and the viewing key cannot be replaced) is the thing
// that would actually improve it. `session-vault.ts` is the opt-in password layer over this.
//

import { generateIdentity, isStarkPrivateKey, readBackupHeader, type BackupHeader } from './identity.js'
import { persistableCeremonyState, type BackupCeremonyState, type PersistableCeremonyState } from './backup-gate.js'
import { SESSION_KEYS, type SessionStore } from './session-store.js'

/** A write that either happened or says why it did not. Never a silent no-op. */
export type SessionWrite = { ok: true } | { ok: false; reason: string }

/**
 * The account key for this browser, or the reason there is not one.
 *
 * `created` distinguishes the first load from every later one — the surface that shows a
 * backup ceremony needs to know whether this key is new. It is NOT a claim about whether the
 * account is registered; that is `preflightRegistration`'s question and it is answered against
 * the chain.
 */
export type AccountKeyResult =
  | { ok: true; accountKey: string; created: boolean }
  | { ok: false; reason: string }

/** The one seam. The store is a positional parameter, not part of this. */
export interface AccountKeyDeps {
  generate?: () => { privateKey: string }
}

/**
 * Returns this browser's account key, generating and persisting one on first load.
 *
 * The order, which is the contract: read, validate, generate, WRITE, return. A caller can
 * therefore treat a returned key as one that is already durable, and the only way to get a
 * key back is for the write to have succeeded.
 *
 * A STORED VALUE THAT IS NOT A KEY IS TREATED AS ABSENT and replaced. `isStarkPrivateKey` is
 * the same predicate `createBackup` and `registration.ts` use, so "usable key" means one thing
 * across the codebase: right shape AND inside the curve order. Passing a corrupt value onward
 * instead would push the failure into `deriveViewingKey`, which throws — turning a recoverable
 * first-run problem into an exception from inside a registration.
 *
 * REPLACING IT LOSES NOTHING THAT WAS RECOVERABLE. A value that fails this predicate cannot
 * sign, cannot derive a viewing key, and is not the key any account was registered with; there
 * is no path that turns it back into one. The user's actual recovery path for a lost key is
 * the Recovery File, which is exactly why `backup-gate.ts` refuses to let registration happen
 * before that file exists.
 */
export function loadOrCreateAccountKey(
  store: SessionStore,
  deps: AccountKeyDeps = {},
): AccountKeyResult {
  const generate = deps.generate ?? generateIdentity

  let stored: string | null
  try {
    stored = store.read(SESSION_KEYS.accountKey)
  } catch (e) {
    // A store that could not be READ must not be written over. "There is nothing here" and "I
    // could not look" are different facts, and only the first one makes generating safe — a
    // read that threw may well be sitting on top of the key this account is already registered
    // with, and overwriting it would orphan that account.
    return { ok: false, reason: `could not read the stored account key: ${String(e)}` }
  }

  if (isStarkPrivateKey(stored)) return { ok: true, accountKey: stored, created: false }

  // The generator is an injection point, so it can throw as well as return rubbish. A seam that
  // threw must not escape as an exception — the caller handles one error channel, the typed
  // result, and `register.ts` sets the precedent for every seam in the codebase behaving that
  // way. (This function is synchronous, so there is no promise to reject; the rule is the same.)
  let generated: unknown
  try {
    generated = generate()?.privateKey
  } catch (e) {
    return { ok: false, reason: `the key generator threw: ${String(e)}` }
  }
  if (!isStarkPrivateKey(generated)) {
    // Nothing unusable is written. The next load would read it back, fail the same predicate,
    // and generate again — forever.
    return {
      ok: false,
      reason: `the key generator returned something that is not a Stark private key: ${String(generated)}`,
    }
  }
  // LOOK AGAIN, immediately before writing. Generating is not instant — it draws from the
  // CSPRNG and derives a public key — and another tab can have finished and written a perfectly
  // good key inside that window. Adopting theirs costs nothing; clobbering it means the tab
  // that already handed a key to a backup ceremony watches it get overwritten.
  //
  // The gap between this check and the write is still not atomic (localStorage has no
  // compare-and-set) — this shrinks the window from "the length of a key generation" to "two
  // adjacent synchronous calls", which is the same bargain the re-read below makes.
  let raced: string | null
  try {
    raced = store.read(SESSION_KEYS.accountKey)
  } catch (e) {
    return { ok: false, reason: `could not re-check the stored account key: ${String(e)}` }
  }
  if (isStarkPrivateKey(raced)) return { ok: true, accountKey: raced, created: false }

  try {
    store.write(SESSION_KEYS.accountKey, generated)
  } catch (e) {
    // The key is dropped on the floor here, deliberately and completely. Handing it back with
    // a warning would let a caller register with an identity nothing remembers.
    return { ok: false, reason: `could not save the generated account key: ${String(e)}` }
  }

  // The re-read. See the header: this is what makes two tabs converge on ONE key at generation
  // time rather than each walking away with its own.
  let settled: string | null
  try {
    settled = store.read(SESSION_KEYS.accountKey)
  } catch (e) {
    return { ok: false, reason: `could not confirm the saved account key: ${String(e)}` }
  }
  if (!isStarkPrivateKey(settled)) {
    // A store that accepted a write and did not keep it. `probeLocalStorage` rejects that
    // storage up front, so reaching here means an injected store is lying — and a key we cannot
    // read back is a key that will not survive the reload.
    return {
      ok: false,
      reason: `the account key did not survive being written: the store read back ${String(settled)}`,
    }
  }
  // `created` reports what THIS call did, and it did generate — even in the losing half of a
  // race, where the key coming back belongs to the tab that wrote last.
  return { ok: true, accountKey: settled, created: true }
}

// ── The ceremony projection ───────────────────────────────────────────────────────────────

/**
 * Persists the ceremony — meaning `persistableCeremonyState(state)` and nothing else.
 *
 * The projection is called HERE rather than being the caller's responsibility, so there is no
 * version of this function that can be handed a raw `code-issued` state and write it. That
 * state holds both halves of the two-secret split — the Recovery Code and the wrapped file —
 * and `backup-gate.ts` names this module as the one that must not write them.
 *
 * A NON-`ready` STATE CLEARS THE STORED VALUE rather than leaving the old one in place, and
 * the direction is deliberate. The alternative — never erase, so a stored `ready` outlives the
 * ceremony it described — means a reload could find a completed-backup record for a ceremony
 * the app is no longer in, and that record is what tells a surface the user has saved their
 * key. Believing a stale one opens the registration gate for someone who has not, which is the
 * orphaned-account failure `backup-gate.ts` exists to prevent. Clearing it costs a nag and a
 * repeated ceremony; keeping it costs the account.
 */
export function saveCeremony(store: SessionStore, state: BackupCeremonyState): SessionWrite {
  // The projection is `backup-gate.ts`'s function and therefore a seam this module does not
  // own; a caller can also hand it a shape it did not expect. A throw here would escape the
  // typed contract the rest of the module keeps.
  let projection: PersistableCeremonyState
  try {
    projection = persistableCeremonyState(state)
  } catch (e) {
    return { ok: false, reason: `could not project the backup ceremony state: ${String(e)}` }
  }

  try {
    if (projection === null) {
      store.remove(SESSION_KEYS.ceremony)
      return { ok: true }
    }
    // VALIDATED BEFORE THE WRITE, with the same predicate `loadCeremony` applies on the way
    // back. Without the symmetry a name that fails the read check writes perfectly happily and
    // then reads back as `null` — the ceremony is silently gone on the next reload, the gate is
    // shut again, and the write reported success. A refusal at least says so at the moment it
    // can still be acted on.
    if (!isPlausibleFilename(projection.filename)) {
      return {
        ok: false,
        reason: `refusing to save a ceremony whose filename would not read back: ${JSON.stringify(projection.filename)}`,
      }
    }
    store.write(SESSION_KEYS.ceremony, JSON.stringify(projection))
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: `could not save the backup ceremony state: ${String(e)}` }
  }
}

/**
 * The longest filename this will read back. The common filesystem limit, and far above the
 * ~40 characters `backupFilename` actually produces.
 */
export const MAX_STORED_FILENAME_LENGTH = 255

/**
 * True for something that could plausibly be the name a Recovery File was saved under.
 *
 * VALIDATED FOR THE SAME REASON EVERY OTHER FIELD IS. localStorage is writable by any script on
 * this origin and by the user, and this is the one value in the stored projection that a
 * surface renders back to a human — "you saved this as …". Every other field is re-checked on
 * the way in; leaving the rendered one unchecked is backwards. A megabyte of text, an embedded
 * newline, or a control character is not a filename, and reading it as one puts attacker-chosen
 * content into a sentence the product is making a factual claim with.
 *
 * A SHAPE CHECK, NOT A SANITIZER. It is not trying to make a hostile string safe to render —
 * that is the renderer's job and it has its own escaping. It is deciding whether this looks like
 * something this application wrote, and answering `null` when it does not.
 */
export function isPlausibleFilename(value: unknown): value is string {
  if (typeof value !== 'string') return false
  if (value.length === 0 || value.length > MAX_STORED_FILENAME_LENGTH) return false
  return !FILENAME_SPOOFING_CHARACTERS.test(value)
}

/**
 * Characters that have no business in a filename and every use in faking one.
 *
 * Spelled as escapes throughout, because by construction most of them are invisible in a
 * source file — the same property that makes them useful to somebody forging a name, and the
 * reason a length check plus a quote check is not enough. `identity.ts` strips the same
 * families out of a pasted Recovery Code; this is the rendering-side counterpart, and the two
 * exist for opposite reasons (that one is being generous about input, this one is refusing it).
 *
 * Group by group, and what each one buys:
 *   - C0 controls and DEL. A newline ends the line the filename is rendered on, so the rest
 *     of the string becomes what looks like the app's own next sentence.
 *   - C1 controls. The half of the control range the C0 check misses entirely.
 *   - Zero-width characters, the joiners and the BOM. They occupy no width, so two different
 *     stored names render identically — which defeats the one job the filename has, telling a
 *     user which of two Recovery Files they are looking at.
 *   - Bidi overrides and isolates. The worst of the set: they reorder what follows, so a name
 *     stored as `gpj.eciovni` renders as `invoice.jpg`. Nothing this application writes
 *     contains one.
 *   - Line and paragraph separators. Line breaks a newline check does not catch.
 */
const FILENAME_SPOOFING_CHARACTERS =
  /[\u0000-\u001f\u007f\u0080-\u009f\u200b-\u200f\u2028-\u2029\u202a-\u202e\u2060\u2066-\u2069\ufeff/\\]/

/**
 * Reads back a completed ceremony, or `null`.
 *
 * NEVER THROWS, and everything unusable is `null`: an unreadable store, text that is not JSON,
 * a value that is not a `ready` state, a filename that is not a string, a header that does not
 * validate. `null` is the fail-closed answer — it means "no completed ceremony", the gate stays
 * shut, and the user is asked to back up again, which costs them a ceremony rather than an
 * account.
 *
 * THE RESULT IS REBUILT FROM VALIDATED FIELDS, not handed back as parsed. Anything else in the
 * stored object — including a `backup` field somebody wrote there by hand or an older build
 * left behind — is dropped on the way through rather than resurrected into a state that is
 * supposed to carry no secrets. The scrub `markFileSaved` performs at construction is therefore
 * enforced again at every load, on a value that arrived from outside the program.
 */
export function loadCeremony(store: SessionStore): PersistableCeremonyState {
  let raw: string | null
  try {
    raw = store.read(SESSION_KEYS.ceremony)
  } catch {
    return null
  }
  if (typeof raw !== 'string' || !raw) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null

  const value = parsed as { step?: unknown; filename?: unknown; header?: unknown }
  if (value.step !== 'ready') return null
  if (!isPlausibleFilename(value.filename)) return null

  // `identity.ts`'s own header validator, reached through the entry point it exports. It takes
  // Recovery File TEXT, so the header is wrapped back into the envelope shape it expects —
  // which is odd to read and is still the right call: the alternative is a fourth hand-copy of
  // the field rules (felt-shaped auditor key below the field prime, integer blocks, a
  // nullable registration block), and this codebase has already been bitten by exactly that
  // kind of duplicate drifting from the original.
  const validated = readBackupHeader(JSON.stringify({ header: value.header }))
  if (!validated) return null

  // REBUILT FROM NAMED FIELDS, not spread. `readBackupHeader` validates the fields it knows
  // about and passes through nothing else — but it is another module's function and its
  // tolerance is its own business, so relying on it to strip is relying on a promise it never
  // made. Naming the four fields here means an extra property in the stored JSON cannot ride
  // into a value this module hands back as a scrubbed projection, whatever the header parser
  // decides to tolerate next year.
  const header: BackupHeader = {
    ...(validated.receiveAddress !== undefined ? { receiveAddress: validated.receiveAddress } : {}),
    backupBlock: validated.backupBlock,
    auditorKeyAtBackupBlock: validated.auditorKeyAtBackupBlock,
    registrationBlock: validated.registrationBlock,
  }

  return { step: 'ready', filename: value.filename, header }
}
