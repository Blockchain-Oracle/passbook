//
// Sealing a ballot's choice to the proposal's tally key — and opening it, which is the Teller's
// whole job (docs/governance.md §6).
//
// ── ECIES ON THE STARK CURVE, `room.ts`'s PRIMITIVES REARRANGED ──────────────────────────
//
// The room scheme is two parties with one ECDH secret. A ballot is one party sealing to a
// PUBLISHED key: the voter mints an ephemeral scalar `e`, computes `S = e·TallyPub`, derives an
// AES-GCM key from S's x, and ships `E = e·G`'s x beside the ciphertext. The Teller — or, in
// secret-until-close mode after the key hits the chain, ANYONE — recomputes `S = teller_priv·E`
// and opens. The even-y lift is the same one `room.ts` proves sign-independent.
//
// ── WHAT TRAVELS, AND WHERE ──────────────────────────────────────────────────────────────
//
// `[eph_x, byte_len, ...ciphertext packed 31 bytes/felt]` — the `sealed` span of a ballot's
// payload, emitted in `BallotCast` so the ballot book is chain data. The plaintext is
// `{c: choice, w: weight, b: blinds}` — exactly what `verifyTally`'s sums are made of.
//
import { ec } from 'starknet'

import { CURVE_ORDER } from './governance-commitment.js'

const webcrypto: Crypto = globalThis.crypto

const INFO = 'passbook-governance-seal-v1'
const IV_BYTES = 12

export interface SealedChoice {
  /** The option index this ballot chose. */
  readonly choice: number
  /** The committed weight, base units. */
  readonly weight: bigint
  /** The blinds, option order — what the Teller sums into `R_i`. */
  readonly blinds: readonly bigint[]
}

function lift(x: bigint) {
  return ec.starkCurve.ProjectivePoint.fromHex(`02${x.toString(16).padStart(64, '0')}`)
}

async function aesKey(sharedX: bigint, usages: KeyUsage[]): Promise<CryptoKey> {
  const secret = new Uint8Array(32)
  let v = sharedX
  for (let i = 31; i >= 0; i -= 1) {
    secret[i] = Number(v & 0xffn)
    v >>= 8n
  }
  const material = await webcrypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits'])
  const bits = await webcrypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(INFO) },
    material,
    256,
  )
  return webcrypto.subtle.importKey('raw', bits, { name: 'AES-GCM', length: 256 }, false, usages)
}

function packBytesToFelts(bytes: Uint8Array): string[] {
  const felts: string[] = []
  for (let at = 0; at < bytes.length; at += 31) {
    let value = 0n
    for (const b of bytes.subarray(at, at + 31)) value = (value << 8n) | BigInt(b)
    felts.push(`0x${value.toString(16)}`)
  }
  return felts
}

function unpackFeltsToBytes(felts: readonly string[], byteLength: number): Uint8Array {
  const out = new Uint8Array(byteLength)
  let written = 0
  for (const [i, feltHex] of felts.entries()) {
    const take = Math.min(31, byteLength - i * 31)
    let value = BigInt(feltHex)
    for (let j = take - 1; j >= 0; j -= 1) {
      out[i * 31 + j] = Number(value & 0xffn)
      value >>= 8n
    }
    written += take
  }
  if (written !== byteLength) throw new Error('the sealed span is shorter than its declared length')
  return out
}

/** Mint a per-proposal tally keypair — the Teller's, at `propose` time. */
export function mintTallyKey(): { secret: bigint; publicX: bigint } {
  const bytes = webcrypto.getRandomValues(new Uint8Array(32))
  const secret = ([...bytes].reduce((acc, b) => (acc << 8n) | BigInt(b), 0n) % (CURVE_ORDER - 1n)) + 1n
  const publicX = ec.starkCurve.ProjectivePoint.BASE.multiply(secret).toAffine().x
  return { secret, publicX }
}

/** Seal one choice to `tallyPublicX`. Returns the felts the ballot payload carries. */
export async function sealBallot(input: SealedChoice, tallyPublicX: bigint): Promise<string[]> {
  const eBytes = webcrypto.getRandomValues(new Uint8Array(32))
  const e = ([...eBytes].reduce((acc, b) => (acc << 8n) | BigInt(b), 0n) % (CURVE_ORDER - 1n)) + 1n
  const ephemeralX = ec.starkCurve.ProjectivePoint.BASE.multiply(e).toAffine().x
  const shared = lift(tallyPublicX).multiply(e).toAffine().x

  const plaintext = new TextEncoder().encode(
    JSON.stringify({
      c: input.choice,
      w: input.weight.toString(),
      b: input.blinds.map((blind) => `0x${blind.toString(16)}`),
    }),
  )
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await aesKey(shared, ['encrypt'])
  const ct = new Uint8Array(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext))

  const body = new Uint8Array(IV_BYTES + ct.length)
  body.set(iv, 0)
  body.set(ct, IV_BYTES)
  return [`0x${ephemeralX.toString(16)}`, `0x${body.length.toString(16)}`, ...packBytesToFelts(body)]
}

/**
 * Open one sealed span with the tally secret. Throws on anything the key does not authenticate —
 * which, at publication time, is what marks a ballot for the public excluded list (§4.1).
 */
export async function openBallot(sealed: readonly string[], tallySecret: bigint): Promise<SealedChoice> {
  if (sealed.length < 3) throw new Error('the sealed span is too short to be a ballot')
  const ephemeralX = BigInt(sealed[0]!)
  const byteLength = Number(BigInt(sealed[1]!))
  if (!Number.isInteger(byteLength) || byteLength <= IV_BYTES || byteLength > 4096) {
    throw new Error('the sealed span declares an impossible length')
  }
  const body = unpackFeltsToBytes(sealed.slice(2), byteLength)
  const shared = lift(ephemeralX).multiply(tallySecret).toAffine().x
  const key = await aesKey(shared, ['decrypt'])
  const plaintext = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: body.subarray(0, IV_BYTES) },
    key,
    body.subarray(IV_BYTES),
  )
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as { c?: unknown; w?: unknown; b?: unknown }
  if (
    typeof parsed.c !== 'number' ||
    typeof parsed.w !== 'string' ||
    !Array.isArray(parsed.b) ||
    !parsed.b.every((blind): blind is string => typeof blind === 'string')
  ) {
    throw new Error('the sealed payload is not a ballot')
  }
  return { choice: parsed.c, weight: BigInt(parsed.w), blinds: parsed.b.map((blind) => BigInt(blind)) }
}
