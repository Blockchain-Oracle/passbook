//
// The session tier's front door: the storage tier, the key, the lock, the account list, the vault
// and the copy. Everything the app's session boot reaches lives behind this one import.
//
// MAY be persisted: the root Account Key (the pool writes the viewing key once, so losing it
// orphans the account) and the `ready` projection of the backup ceremony, which carries no secret.
// MUST NEVER be persisted: the Recovery Code or File, note plaintext, discovery results, or the
// viewing key (derived from the account key for free).
//

export { browserSessionStore, SESSION_KEYS } from './session-store.js'

// `forgetAccountKey` is deliberately absent: a destructive function should not be one autocomplete
// away from the boot sequence.
export { loadCeremony, loadOrCreateAccountKey, saveCeremony } from './session-key.js'

export { createSessionLock } from './session-lock.js'

export {
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
} from './session-accounts.js'

// The password vault sits OVER the account list: when a vault exists, `passbook.accounts` and its
// `accountKey` mirror are deleted, so the entries above stop being where the keys live.
export {
  MIN_PASSWORD_LENGTH,
  VAULT_ERROR_TEXT,
  clearPlaintextKeys,
  openVault,
  sealVault,
  sealWithKey,
  sessionVaultStore,
} from './session-vault.js'

// Vault v2: the VEK envelope and its wrappers, so a passkey can seal what a password seals.
export {
  generateVek,
  localVaultFromRemote,
  newHkdfSalt,
  newPasswordKdf,
  newWrapperId,
  openEnvelope,
  parseRemoteEnvelope,
  passkeyKek,
  passkeyWrappers,
  passwordKek,
  passwordWrapper,
  remoteEnvelopeOf,
  sealEnvelope,
  unwrapVek,
  unwrapVekRaw,
  withoutWrapper,
  withWrapper,
  wrapVek,
} from './session-vault.js'

export { SESSION_STORAGE_UNAVAILABLE } from './session-copy.js'
