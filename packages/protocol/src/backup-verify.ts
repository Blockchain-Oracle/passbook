//
// The periodic check: decrypt the file with the code AND confirm the key inside is the one this
// account uses now. Decrypt-success alone would mark a backup of a PREVIOUS identity as verified.
//

import {
  BACKUP_VERIFICATION_FAILED, MALFORMED_BACKUP_FILE, UNSUPPORTED_BACKUP_VERSION, WRONG_RECOVERY_CODE,
} from './backup-copy.js'
import { BackupRestoreError, restoreBackup, type BackupRestoreFailure } from './backup.js'

// The four sentences this module and `backup.ts` can hand back, beside the functions that produce them.
export { BACKUP_VERIFICATION_FAILED, MALFORMED_BACKUP_FILE, UNSUPPORTED_BACKUP_VERSION, WRONG_RECOVERY_CODE }

/** `different-key` is the one failure decryption cannot see. */
export type BackupVerificationFailure = BackupRestoreFailure | 'different-key'

export type BackupVerification =
  | { ok: true }
  | { ok: false; reason: BackupVerificationFailure; message: string }

// Per-kind, not one catch-all: "make a new one now" on an intact-but-newer file invites deleting
// the only copy of a key that cannot be reissued.
function verificationMessageFor(reason: BackupVerificationFailure): string {
  switch (reason) {
    case 'unsupported-version':
      return UNSUPPORTED_BACKUP_VERSION
    case 'not-json':
    case 'not-an-envelope':
      return MALFORMED_BACKUP_FILE
    case 'undecryptable':
    case 'different-key':
      return BACKUP_VERIFICATION_FAILED
  }
}

/** Never throws. The key comparison is numeric, so `0x0a…` and `0xA…` are the same key. */
export async function verifyBackupAgainstKey(
  file: string,
  recoveryCode: string,
  expectedAccountKey: string,
): Promise<BackupVerification> {
  let recovered: string
  try {
    recovered = await restoreBackup(file, recoveryCode)
  } catch (e) {
    const kind = e instanceof BackupRestoreError ? e.kind : 'undecryptable'
    return { ok: false, reason: kind, message: verificationMessageFor(kind) }
  }
  let same: boolean
  try {
    same = BigInt(recovered) === BigInt(expectedAccountKey)
  } catch {
    same = recovered === expectedAccountKey
  }
  return same
    ? { ok: true }
    : { ok: false, reason: 'different-key', message: verificationMessageFor('different-key') }
}
