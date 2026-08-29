//
// Barrel: the sealed vault (`vault.ts`) and the password rules (`password.ts`).
//

export { MIN_PASSWORD_LENGTH, passwordStrength, VAULT_ERROR_TEXT, type PasswordStrength } from './password.js'

export {
  clearPlaintextKeys,
  openVault,
  sealVault,
  sealWithKey,
  sessionVaultStore,
  type SealedVault,
  type VaultHeader,
  type VaultKey,
} from './vault.js'
