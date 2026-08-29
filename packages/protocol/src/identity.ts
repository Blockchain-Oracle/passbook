//
// Barrel: keys (`keys.ts`), the Recovery File (`backup.ts`) and the composed verification
// (`backup-verify.ts`). The app imports `identity`; the pieces live in their files.
//

export {
  assertViewingKey,
  deriveIdentityPublicKey,
  deriveViewingKey,
  generateIdentity,
  isStarkPrivateKey,
} from './keys.js'

export { readBackupHeader, restoreBackup, type BackupHeader } from './backup.js'

export { BACKUP_VERIFICATION_FAILED, type BackupVerification } from './backup-verify.js'
