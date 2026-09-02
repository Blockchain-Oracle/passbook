//
// The password key derivation, frozen: PBKDF2-SHA256 → AES-GCM-256. Shared by the v1 vault (where
// the derived key seals the body directly) and the v2 password wrapper (where it seals the VEK).
// Parameters never change — existing vaults must keep opening.
//

import { buffer, utf8 } from './vault-bytes.js'

export const KDF_ITERATIONS = 600_000 // OWASP floor; paid once, on a screen meant to pause
export const KDF_NAME = 'PBKDF2'
export const KDF_HASH = 'SHA-256'
export const CIPHER_NAME = 'AES-GCM'
export const AES_KEY_BITS = 256
export const SALT_BYTES = 16
export const IV_BYTES = 12

export async function deriveKey(password: string, salt: Uint8Array, iterations: number, subtle: SubtleCrypto): Promise<CryptoKey> {
  // Not extractable: a key the page can read back is one an XSS can read back.
  const material = await subtle.importKey('raw', buffer(utf8(password)), KDF_NAME, false, ['deriveKey'])
  return subtle.deriveKey(
    { name: KDF_NAME, salt: buffer(salt), iterations, hash: KDF_HASH },
    material,
    { name: CIPHER_NAME, length: AES_KEY_BITS },
    false,
    ['encrypt', 'decrypt'],
  )
}
