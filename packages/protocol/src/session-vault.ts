//
// Barrel: the sealed vault (`vault.ts`, v1), the VEK envelope (`vault-envelope.ts`, v2), the VEK
// wrappers (`vek-wrap.ts`) and the password rules (`password.ts`).
//

export { MIN_PASSWORD_LENGTH, passwordStrength, VAULT_ERROR_TEXT, type PasswordStrength } from './password.js'

export {
  clearPlaintextKeys,
  openVault,
  sealVault,
  sealWithKey,
  sessionVaultStore,
  type SealedVault,
  type StoredVault,
  type VaultHeader,
  type VaultKey,
  type VaultResult,
} from './vault.js'

export {
  localVaultFromRemote,
  newWrapperId,
  openEnvelope,
  parseRemoteEnvelope,
  passkeyWrappers,
  passwordWrapper,
  remoteEnvelopeOf,
  sealEnvelope,
  VAULT_V2,
  withoutWrapper,
  withWrapper,
  type PasskeyWrapper,
  type PasswordWrapper,
  type RemoteEnvelope,
  type VaultV2,
  type VekWrapper,
} from './vault-envelope.js'

export { generateVek, newHkdfSalt, newPasswordKdf, passkeyKek, passwordKek, unwrapVek, unwrapVekRaw, wrapVek } from './vek-wrap.js'
