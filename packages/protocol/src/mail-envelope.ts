//
// The sealed memo that rides a shielded transfer: how it is keyed, bound, and packed into felts.
//
// ── THE KEY IS THE POOL'S OWN CHANNEL KEY, AND THAT IS THE WHOLE POINT ──────────────────────
//
// A transfer to someone creates an encrypted note inside a directional channel the pool keeps
// between the two accounts. The channel key is what the sender derived to open that channel and
// what the recipient recovers from the pool's channel record with their viewing key — the same
// material the pool itself uses to hide note amounts. Deriving the memo key from it means a memo
// can only be read by whoever can read the note it rides with, and nobody had to agree a second
// secret through a server. It also means the auditor, who can recover every viewing key, can read
// every memo; the copy says so.
//
// ── THE ANCHOR BINDS THE MEMO TO ONE NOTE ─────────────────────────────────────────────────
//
// The note id is the salt of the derivation and part of the authenticated data, so a memo opens
// only against the note it was sealed for: a ciphertext moved to another note's anchor fails
// authentication. The note id is already public in the pool's `EncNoteCreated` event of the same
// transaction, so keying the memo event by it reveals nothing the receipt does not.
//
// No forward secrecy: the channel key is static for the life of the channel. Web Crypto only.
//

const webcrypto: Crypto = globalThis.crypto

export const MAIL_VERSION = 1n
export const MAIL_DOMAIN = 'strk20.run/mail/v1'
/** AES-GCM's standard nonce length; it rides as one felt. */
export const MAIL_NONCE_BYTES = 12
/** Bytes a felt carries when a byte string is packed big-endian without wrapping the field. */
export const BYTES_PER_FELT = 31
/** Ciphertext bound; the contract refuses longer bodies and the composer counts against the plaintext share. */
export const MAX_MAIL_CIPHERTEXT_BYTES = 960
const AES_GCM_TAG_BYTES = 16
export const MAX_MAIL_PLAINTEXT_BYTES = MAX_MAIL_CIPHERTEXT_BYTES - AES_GCM_TAG_BYTES
export const MAX_MAIL_BODY_FELTS = Math.ceil(MAX_MAIL_CIPHERTEXT_BYTES / BYTES_PER_FELT)

/** The public facts a memo is bound to. All felts, so the encoding is the pool's, not ours. */
export interface MailContext {
  chainId: string
  pool: string
  mailbox: string
}

export interface MailSealInput extends MailContext {
  channelKey: bigint
  /** The note the memo rides with — its id is the event key and the KDF salt. */
  noteId: bigint
  token: bigint
}

/** What lands in the `Posted` event, felt by felt. */
export interface MailEnvelope {
  anchor: bigint
  version: bigint
  nonce: bigint
  byteLen: number
  body: bigint[]
}

// ── Bytes ↔ felts ─────────────────────────────────────────────────────────────────────────

/** 32-byte big-endian encoding of a felt, so every context value has one shape. */
export function feltBytes(value: bigint | string): Uint8Array {
  const out = new Uint8Array(32)
  let v = BigInt(value)
  for (let i = 31; i >= 0 && v > 0n; i--) {
    out[i] = Number(v & 0xffn)
    v >>= 8n
  }
  return out
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let v = 0n
  for (const b of bytes) v = (v << 8n) | BigInt(b)
  return v
}

/** Packs bytes into felts, 31 per felt, big-endian; the last felt is short. */
export function feltsFromBytes(bytes: Uint8Array): bigint[] {
  const out: bigint[] = []
  for (let at = 0; at < bytes.length; at += BYTES_PER_FELT) out.push(bytesToBigInt(bytes.subarray(at, at + BYTES_PER_FELT)))
  return out
}

/** The inverse of `feltsFromBytes`, given the exact byte length. Refuses a felt that does not fit. */
export function bytesFromFelts(felts: readonly bigint[], byteLen: number): Uint8Array {
  if (!Number.isInteger(byteLen) || byteLen < 0) throw new Error(`refusing a byte length of ${byteLen}`)
  const expectedFelts = Math.ceil(byteLen / BYTES_PER_FELT)
  if (felts.length !== expectedFelts) throw new Error(`${byteLen} bytes need ${expectedFelts} felts; ${felts.length} were given`)
  const out = new Uint8Array(byteLen)
  for (let i = 0; i < felts.length; i++) {
    const width = Math.min(BYTES_PER_FELT, byteLen - i * BYTES_PER_FELT)
    let v = felts[i]!
    if (v < 0n) throw new Error(`felt ${i} is negative`)
    for (let j = width - 1; j >= 0; j--) {
      out[i * BYTES_PER_FELT + j] = Number(v & 0xffn)
      v >>= 8n
    }
    if (v !== 0n) throw new Error(`felt ${i} carries more than ${width} bytes`)
  }
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

// ── Key and binding ───────────────────────────────────────────────────────────────────────

const text = (s: string) => new TextEncoder().encode(s)

function contextBytes(ctx: MailContext): Uint8Array {
  return concat(text(MAIL_DOMAIN), feltBytes(ctx.chainId), feltBytes(ctx.pool), feltBytes(ctx.mailbox))
}

/** HKDF-SHA256(ikm = channel key, salt = note id, info = domain ‖ chain ‖ pool ‖ mailbox) → AES-GCM-256. */
async function memoKey(input: MailSealInput, usages: KeyUsage[]): Promise<CryptoKey> {
  const material = await webcrypto.subtle.importKey('raw', feltBytes(input.channelKey) as BufferSource, 'HKDF', false, ['deriveKey'])
  return webcrypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: feltBytes(input.noteId) as BufferSource, info: contextBytes(input) as BufferSource },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

/** Everything a reader can reconstruct from the receipt and the note, authenticated with the body. */
function additionalData(input: MailSealInput): Uint8Array {
  return concat(contextBytes(input), feltBytes(input.noteId), feltBytes(input.token))
}

// ── Seal / open ───────────────────────────────────────────────────────────────────────────

export async function sealMail(input: MailSealInput, plaintext: Uint8Array): Promise<MailEnvelope> {
  if (plaintext.length > MAX_MAIL_PLAINTEXT_BYTES) {
    throw new Error(`refusing to seal ${plaintext.length} bytes: a memo carries at most ${MAX_MAIL_PLAINTEXT_BYTES}`)
  }
  const key = await memoKey(input, ['encrypt'])
  const iv = webcrypto.getRandomValues(new Uint8Array(MAIL_NONCE_BYTES))
  const ct = new Uint8Array(
    await webcrypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource, additionalData: additionalData(input) as BufferSource },
      key,
      plaintext as BufferSource,
    ),
  )
  return { anchor: input.noteId, version: MAIL_VERSION, nonce: bytesToBigInt(iv), byteLen: ct.length, body: feltsFromBytes(ct) }
}

export class MailUnreadable extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'MailUnreadable'
  }
}

/** Opens a posted envelope against the note it claims. Throws `MailUnreadable` on any mismatch. */
export async function openMail(input: MailSealInput, envelope: MailEnvelope): Promise<Uint8Array> {
  if (envelope.version !== MAIL_VERSION) throw new MailUnreadable(`memo version ${envelope.version} is not one this app reads`)
  if (envelope.anchor !== input.noteId) throw new MailUnreadable('the memo is anchored to a different note')
  if (envelope.byteLen > MAX_MAIL_CIPHERTEXT_BYTES) throw new MailUnreadable(`the memo body declares ${envelope.byteLen} bytes, over the bound`)
  let ct: Uint8Array
  try {
    ct = bytesFromFelts(envelope.body, envelope.byteLen)
  } catch (e) {
    throw new MailUnreadable(`the memo body is not well-formed: ${String(e)}`)
  }
  const iv = feltBytes(envelope.nonce).subarray(32 - MAIL_NONCE_BYTES)
  const key = await memoKey(input, ['decrypt'])
  try {
    return new Uint8Array(
      await webcrypto.subtle.decrypt(
        { name: 'AES-GCM', iv: iv as BufferSource, additionalData: additionalData(input) as BufferSource },
        key,
        ct as BufferSource,
      ),
    )
  } catch {
    throw new MailUnreadable('the memo does not authenticate against this note and channel')
  }
}

// ── Calldata ──────────────────────────────────────────────────────────────────────────────

const hex = (v: bigint) => `0x${v.toString(16)}`

/** `privacy_invoke(anchor, version, nonce, byte_len, body: Span<felt252>)`, serialised. */
export function mailCalldata(envelope: MailEnvelope): string[] {
  return [
    hex(envelope.anchor),
    hex(envelope.version),
    hex(envelope.nonce),
    hex(BigInt(envelope.byteLen)),
    hex(BigInt(envelope.body.length)),
    ...envelope.body.map(hex),
  ]
}

/** The inverse, for the `Posted` event and the span guard. */
export function envelopeFromFelts(felts: readonly bigint[]): MailEnvelope {
  if (felts.length < 5) throw new Error(`a memo envelope needs at least 5 felts; ${felts.length} given`)
  const [anchor, version, nonce, byteLen, bodyLen] = felts as [bigint, bigint, bigint, bigint, bigint]
  const body = felts.slice(5)
  if (BigInt(body.length) !== bodyLen) throw new Error(`memo body declares ${bodyLen} felts and carries ${body.length}`)
  return { anchor, version, nonce, byteLen: Number(byteLen), body }
}
