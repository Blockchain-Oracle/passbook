//
// Open rooms: a thread anyone on the page can read, riding the SAME relay as sealed chat.
//
// ── THE TRICK IS THAT THERE IS NO TRICK ──────────────────────────────────────────────────
//
// The relayer's room bus carries opaque envelopes by a 128-bit id and refuses to know more
// (`relayer/src/rooms.ts`). A PUBLIC thread — a token's Talk tab — needs no new transport, no new
// route, and no server change at all: it is a sealed room whose key everyone can derive, because
// the key material is the room's public TAG (`talk:launch:7`) instead of a pairwise ECDH secret.
// Every cap the relay enforces (history 50, rate 60/min, envelope 4KB) applies unchanged, and the
// relayer still cannot tell an open room from a sealed one — which is exactly the claim its
// privacy page makes, kept true by construction.
//
// ── WHAT "OPEN" HONESTLY MEANS, so surfaces can say it ───────────────────────────────────
//
// Anyone who can name the tag can read and write. The GCM tag authenticates nothing but "sealed
// by someone holding the public key", which is everyone; a byline inside a post is a CLAIM. The
// value of sealing with a derivable key is uniformity (one wire shape, one relay contract), not
// secrecy — and no surface may imply otherwise. `OPEN_ROOM_DISCLOSURE` below is the sentence.
//
// ── ITS OWN SEAL/OPEN, NOT room.ts's ─────────────────────────────────────────────────────
//
// `openMessage` throws `SelfEcho` on the sender's own envelopes because pairwise chat persists
// its own half locally. An open room persists NOTHING locally — the relay's 50-message replay is
// the whole history, and your own yesterday's post must render like anyone's. Same primitives,
// different contract, so the loop is written here rather than parameterised there.
//
import { NET } from './constants.js'
import { MAX_MESSAGE_BYTES, type RoomEnvelope } from './room.js'

// `room.ts`'s spelling: the runtime's own WebCrypto, which exists in every browser and in Node 20+.
const webcrypto: Crypto = globalThis.crypto

const IV_BYTES = 12
const ROOM_ID_BYTES = 16
const OPEN_ROOM_VERSION = 'passbook-open-room-v1'
const INFO_ROOM_ID = 'open-room-id'
const INFO_ROOM_KEY = 'open-room-key'

export interface OpenRoom {
  /** The routing label the relayer sees — 32 hex chars, `ROOM_ID_PATTERN`'s shape. */
  readonly id: string
  /** One key, everyone's. Encrypts and decrypts. */
  readonly key: CryptoKey
  /** This client's public identity x (`0x…`), stamped into `from`. `0x0` for a keyless reader. */
  readonly selfPublicKey: string
}

async function hkdf(secret: Uint8Array, salt: Uint8Array, info: string, bytes: number): Promise<ArrayBuffer> {
  const material = await webcrypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, ['deriveBits'])
  return webcrypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: new TextEncoder().encode(info) },
    material,
    bytes * 8,
  )
}

/**
 * Derive the open room a tag names. Pure and offline; the same tag is the same room for every
 * client on this chain against this pool, and a different pool (a testnet build) is a different
 * room — the salt carries both, `room.ts`'s discipline.
 */
export async function deriveOpenRoom(tag: string, myPublicKey: bigint | null): Promise<OpenRoom> {
  if (!/^[a-z0-9:.-]{3,64}$/.test(tag)) {
    throw new Error(`"${tag}" is not an open-room tag — lowercase, digits, ':' '.' '-', 3-64 chars`)
  }
  const secret = new Uint8Array(
    await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(`${OPEN_ROOM_VERSION}:${tag}`)),
  )
  const salt = new Uint8Array(
    await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(`${OPEN_ROOM_VERSION}:${NET.chainId}:${NET.pool}`)),
  )
  const [idBits, keyBits] = await Promise.all([
    hkdf(secret, salt, INFO_ROOM_ID, ROOM_ID_BYTES),
    hkdf(secret, salt, INFO_ROOM_KEY, 32),
  ])
  const key = await webcrypto.subtle.importKey('raw', keyBits, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ])
  return {
    id: [...new Uint8Array(idBits)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    key,
    selfPublicKey: myPublicKey === null ? '0x0' : `0x${myPublicKey.toString(16)}`,
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** Seal one post. Fresh random nonce per message, always — `sealMessage`'s rule. */
export async function sealOpenPost(room: OpenRoom, text: string): Promise<RoomEnvelope> {
  const plaintext = new TextEncoder().encode(text)
  if (plaintext.length === 0) throw new Error('refusing to send an empty message')
  if (plaintext.length > MAX_MESSAGE_BYTES) {
    throw new Error(`message is ${plaintext.length} bytes, over the ${MAX_MESSAGE_BYTES} limit`)
  }
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, room.key, plaintext as BufferSource)
  return { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)), from: room.selfPublicKey }
}

/**
 * Open one post — including this client's own replayed ones, which is the contract difference
 * from `openMessage`. Throws on anything the key does not authenticate; the caller renders that
 * as a message that did not arrive.
 */
export async function openOpenPost(room: OpenRoom, envelope: RoomEnvelope): Promise<string> {
  if (envelope.v !== 1) throw new Error(`unsupported envelope version ${String(envelope.v)}`)
  const iv = fromBase64(envelope.iv)
  if (iv.length !== IV_BYTES) throw new Error(`nonce is ${iv.length} bytes, expected ${IV_BYTES}`)
  const plaintext = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    room.key,
    fromBase64(envelope.ct) as BufferSource,
  )
  return new TextDecoder().decode(plaintext)
}

