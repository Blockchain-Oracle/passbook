//
// The password rules for the vault: the minimum, the sentence per failure, and a coarse strength
// meter that advises and never blocks. A leaf — no imports.
//

/**
 * Eight, not twelve: the threat is a stolen laptop, not an offline rig, and 600k PBKDF2 rounds do
 * more against the rig than four characters would. A longer minimum ends up on a sticky note.
 */
export const MIN_PASSWORD_LENGTH = 8

/**
 * `wrong-password` and `damaged` are DIFFERENT: the structural checks that run before decryption
 * are what let the UI say "try again" instead of "your wallet is corrupt".
 */
export type VaultError =
  | 'crypto-unavailable'
  | 'damaged'
  | 'password-too-short'
  | 'unopenable'
  | 'unsupported-version'
  | 'wrong-password'

/** The sentence each failure gets. Exported so the copy cannot drift from the enum. */
export const VAULT_ERROR_TEXT: Record<VaultError, string> = {
  'crypto-unavailable':
    'This browser will not do the encryption strk20.run needs. That usually means the page is not on a secure origin.',
  damaged:
    'The locked wallet in this browser could not be read. Your Recovery File still opens this account.',
  'password-too-short': `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
  // A passkey wrapper that will not open: a wrong key and a flipped bit look the same to GCM.
  unopenable: 'The sealed copy could not be opened with this passkey. Your Recovery File still opens this account.',
  'unsupported-version':
    'This wallet was locked by a newer version of strk20.run. Update the page, or open it with your Recovery File.',
  'wrong-password': 'That password does not open this wallet.',
}

export type PasswordStrength = 'too-short' | 'weak' | 'fair' | 'strong'

/** Length outweighs variety on purpose: a long lowercase passphrase beats a short one with a bang. */
export function passwordStrength(password: string): PasswordStrength {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too-short'
  const variety =
    Number(/[a-z]/.test(password)) +
    Number(/[A-Z]/.test(password)) +
    Number(/[0-9]/.test(password)) +
    Number(/[^A-Za-z0-9]/.test(password))
  if (password.length >= 16 || (password.length >= 12 && variety >= 3)) return 'strong'
  if (password.length >= 12 || variety >= 3) return 'fair'
  return 'weak'
}
