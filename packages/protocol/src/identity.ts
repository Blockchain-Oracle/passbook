import { ec, stark } from 'starknet'
import { webcrypto as crypto } from 'node:crypto'

const KDF_ITERATIONS = 600_000            // OWASP 2023 floor for PBKDF2-SHA256
const CODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'  // no I, O — misread as 1, 0

export function generateIdentity(): { privateKey: string; publicKey: string } {
  const privateKey = stark.randomAddress()
  return { privateKey, publicKey: deriveIdentityPublicKey(privateKey) }
}

export function deriveIdentityPublicKey(privateKey: string): string {
  return ec.starkCurve.getStarkKey(privateKey)
}

function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-')
}

async function deriveWrappingKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

/**
 * Two-secret split: the file is useless without the code, and the code is useless
 * without the file. We never see either. There is no vault to fall back on, which
 * is exactly why the code is generated rather than chosen by the user.
 */
export async function createBackup(
  privateKey: string,
): Promise<{ file: string; recoveryCode: string }> {
  const recoveryCode = generateRecoveryCode()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveWrappingKey(recoveryCode, salt)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(privateKey),
    ),
  )
  const file = JSON.stringify(
    { v: 1, kdf: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS,
      salt: b64(salt), iv: b64(iv), ct: b64(ct) },
    null, 2,
  )
  return { file, recoveryCode }
}

export async function restoreBackup(file: string, recoveryCode: string): Promise<string> {
  const env = JSON.parse(file) as {
    v: number; iterations: number; salt: string; iv: string; ct: string
  }
  if (env.v !== 1) throw new Error(`unsupported backup version ${env.v}`)
  const key = await deriveWrappingKey(recoveryCode, unb64(env.salt))
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct),
    )
    return new TextDecoder().decode(pt)
  } catch {
    throw new Error('That file and recovery code do not open this key.')
  }
}
