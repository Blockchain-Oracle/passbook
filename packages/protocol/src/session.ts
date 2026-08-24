//
// The session tier's front door (story 1.11, G6). Three adapters, one import.
//
// Epic 6 boots the browser app from here: build a store, get the account key, wire the submit
// lock into `registerSponsored`, wire the cadence store into `readBackupCadence`. Nothing in
// this file has behaviour of its own — it exists so the boundary below has one place to be
// stated, and so the three frozen seams have one place to be satisfied from.
//
// ── THE STORAGE BOUNDARY. FOUR VALUES, AND THE LIST IS CLOSED. ────────────────────────────
//
// MAY be persisted:
//   1. The root Account Key. It has to survive a reload or the account is orphaned on the next
//      one — the pool writes the viewing key once and `WriteOnce` refuses every replacement.
//   2. `persistableCeremonyState(state)` — the `ready` projection and nothing else it could
//      have returned. That state was scrubbed at construction (`markFileSaved`) and carries
//      only a filename and a plaintext header.
//   3. The backup cadence record: a ladder index, the last passing verification's timestamp,
//      and the tri-state status.
//   4. Invite intents (story 1.14): per invite, the code, the state on the ladder, timestamps,
//      and — when the sender attached money — the recipient, token and amount they typed.
//
//      THE FOURTH ENTRY IS A DELIBERATE ADDITION TO A LIST THAT SAID THREE, so it carries its
//      argument rather than an assumption that nobody minds. It is here because the alternative
//      is not "store less", it is "no invite can carry money": there is no escrow and no
//      relayer-held record by design (FR-060 — relayer-opened channels would serialize globally
//      on `INDEX_NOT_SEQUENTIAL` and would put the relayer's address on chain as the sender), so
//      the sender's own app is the only party that holds the intent, and one that does not
//      survive a reload is a promise forgotten while the invitee is still reading the link.
//
//      It clears the exclusion below that it most resembles — decrypted amounts — because it is
//      not something this app learned about anyone's money. It is what the SENDER TYPED, about
//      money that has not moved. Nothing in it is decrypted, discovered, or derivable into a
//      balance; deleting it reveals nothing and costs only the sender's own note-to-self. The
//      full argument lives at `session-invite-store.ts`, beside the record it describes.
//
// MUST NEVER be persisted, and each of these is a specific mistake somebody would otherwise
// make for a good-sounding reason:
//   - The Recovery Code, or the wrapped Recovery File, or any mid-ceremony state holding
//     either. They are the two halves of a split whose whole security property is that they
//     are not stored together, and localStorage is readable by every script on the page.
//     `persistableCeremonyState` returns `null` for exactly these states; do not route around
//     it to make a ceremony "resumable".
//   - Note plaintext, decrypted amounts, or anything else read out of the pool. A cache of
//     what a user holds is a copy of their balance history sitting in the browser.
//   - Discovery results, indexer responses, or channel contents (story 1.9's territory).
//   - The viewing key. It is DERIVED from the account key by `deriveViewingKey`, deterministically
//     and for free. Storing it would be a second copy of a secret with nothing gained.
//
// ── WHAT THIS STORY DID NOT DO ───────────────────────────────────────────────────────────
//
// No UI. The non-leader banner, the tab-switch experience, and the call that builds a store at
// app boot are epic 6's. This story ships the modules, the adapters and the copy.
//
// `REFUSING_CADENCE_STORE` IS KEPT as `readBackupCadence`'s default rather than deleted.
// `backup-cadence.ts` is a frozen seam this story satisfies from outside, so removing its
// default was never available — and it is the right default anyway: a caller that has not
// wired `sessionCadenceStore` has not wired persistence, and the honest answer to "is this
// account backed up" in that state is a refusal that says so, not an empty store that reads
// like a fresh account.
//

// 1. The storage tier.
export {
  browserSessionStore,
  inMemorySessionStore,
  localStorageSessionStore,
  probeLocalStorage,
  refusingSessionStore,
  REFUSING_SESSION_STORE,
  SESSION_KEYS,
  SESSION_STORE_UNWIRED,
  type SessionKey,
  type SessionStore,
  type StorageProbe,
} from './session-store.js'

// 2. The key and the ceremony projection — satisfies `backup-gate.ts`'s persistable contract.
//
// `forgetAccountKey` is DELIBERATELY ABSENT. It erases the account key, it exists so a test can
// reach a fresh state, and this file is the surface epic 6 builds against — a destructive
// function whose own documentation says "a test, and only a test" should not be one autocomplete
// away from the boot sequence. It is still exported from `session-key.ts` for the suite that
// needs it; reaching past the front door is the friction that makes the call deliberate.
export {
  isPlausibleFilename,
  loadCeremony,
  loadOrCreateAccountKey,
  saveCeremony,
  MAX_STORED_FILENAME_LENGTH,
  type AccountKeyDeps,
  type AccountKeyResult,
  type SessionWrite,
} from './session-key.js'

// 3. The leader lock — satisfies `register.ts`'s `acquireSubmitLock` seam, unmodified.
export {
  beatsInLockOrder,
  broadcastLockChannel,
  createSessionLock,
  DEFAULT_LOCK_CHANNEL,
  DEFAULT_LOCK_TIMINGS,
  DUPLICATE_TAB_ID,
  initialLockState,
  isLeader,
  makeAcquireSubmitLock,
  parseLockMessage,
  reduceLock,
  SUBMIT_LOCK_ALREADY_HELD,
  SUBMIT_LOCK_CLOSED,
  SUBMIT_LOCK_NO_CHANNEL,
  type LockChannel,
  type LockEvent,
  type LockMessage,
  type LockPeer,
  type LockRole,
  type LockState,
  type LockTimings,
  type LockTransition,
  type SessionLock,
  type SessionLockOptions,
} from './session-lock.js'

// 4. The cadence store — satisfies `backup-cadence.ts`'s `BackupCadenceStore` seam, unmodified.
export {
  CADENCE_RECORD_VERSION,
  parseStoredCadence,
  serializeCadence,
  sessionCadenceStore,
} from './session-cadence-store.js'

// 5. The invite-intent store (story 1.14) — the sender's client-held money intent.
export {
  INVITE_INTENTS_RECORD_VERSION,
  parseStoredInviteIntents,
  revokeInviteIntent,
  serializeInviteIntents,
  sessionInviteIntentStore,
  withInviteIntent,
  withInviteIntentState,
  type InviteIntent,
  type InviteIntentStore,
  type RevokeResult,
  type StoredInviteIntents,
} from './session-invite-store.js'

// 6. The copy. Byte-exact, and imported rather than retyped by whatever renders it.
export {
  ACCOUNT_OPEN_IN_ANOTHER_TAB,
  SESSION_STORAGE_UNAVAILABLE,
  SUBMISSION_ALREADY_IN_PROGRESS,
} from './session-copy.js'
