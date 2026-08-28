//
// The session tier's front door: one import for the storage tier, the key, the lock, the
// account list, the vault and the copy.
//
// ── THE STORAGE BOUNDARY ──────────────────────────────────────────────────────────────────
//
// MAY be persisted:
//   1. The root Account Key. It has to survive a reload or the account is orphaned on the next
//      one — the pool writes the viewing key once and `WriteOnce` refuses every replacement.
//   2. `persistableCeremonyState(state)` — the `ready` projection and nothing else it could
//      have returned. That state was scrubbed at construction (`markFileSaved`) and carries
//      only a filename and a plaintext header.
//
// MUST NEVER be persisted:
//   - The Recovery Code, or the wrapped Recovery File, or any mid-ceremony state holding
//     either. They are the two halves of a split whose whole security property is that they
//     are not stored together, and localStorage is readable by every script on the page.
//     `persistableCeremonyState` returns `null` for exactly these states; do not route around
//     it to make a ceremony "resumable".
//   - Note plaintext, decrypted amounts, or anything else read out of the pool. A cache of
//     what a user holds is a copy of their balance history sitting in the browser.
//   - Discovery results, indexer responses, or channel contents.
//   - The viewing key. It is DERIVED from the account key by `deriveViewingKey`, deterministically
//     and for free. Storing it would be a second copy of a secret with nothing gained.
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

// 4. The account list (Wave 1) — more than one identity in one browser.
//
// It sits BESIDE `session-key.ts` rather than replacing it: the single-key slot keeps mirroring
// the active account, so `loadOrCreateAccountKey` remains the first-boot path and remains correct
// for a browser that has never seen this record. See `session-accounts.ts`'s header.
export {
  ACCOUNTS_RECORD_VERSION,
  MAX_ACCOUNT_LABEL_LENGTH,
  activeAccount,
  findAccount,
  parseStoredAccounts,
  sameAddress,
  seedFrom,
  serializeAccounts,
  sessionAccountStore,
  withAccount,
  withActive,
  withLabel,
  withLocked,
  type AccountRecordStore,
  type StoredAccount,
  type StoredAccounts,
  type StoredAccountsRead,
} from './session-accounts.js'

// 5. The password vault (2026-08-28) — the account list, sealed at rest.
//
// It sits OVER the account list rather than beside it, and that is the one relationship in this
// barrel that is a replacement: when a vault exists, `passbook.accounts` and its `accountKey`
// mirror are deleted, so the two entries above stop being where the keys live. `session-key.ts`'s
// first-boot path stays correct for the browsers that never set a password, which is the default.
export {
  MIN_PASSWORD_LENGTH,
  VAULT_ERROR_TEXT,
  VAULT_VERSION,
  clearPlaintextKeys,
  openVault,
  parseVault,
  passwordStrength,
  sealVault,
  sealWithKey,
  serializeVault,
  sessionVaultStore,
  type OpenedVault,
  type PasswordStrength,
  type SealedVault,
  type VaultKey,
  type VaultError,
  type VaultHeader,
  type VaultRead,
  type VaultResult,
  type VaultStore,
} from './session-vault.js'

// 6. The copy. Byte-exact, and imported rather than retyped by whatever renders it.
export {
  ACCOUNT_OPEN_IN_ANOTHER_TAB,
  SESSION_STORAGE_UNAVAILABLE,
  SUBMISSION_ALREADY_IN_PROGRESS,
} from './session-copy.js'
