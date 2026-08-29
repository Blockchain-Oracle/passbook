//
// The chat room's cryptography: a shared key derived from two addresses and nothing else.
//
// WHAT THIS BUYS, STATED PRECISELY. Two people who have both registered with the pool can talk
// without exchanging a key, without a directory, and without either of them publishing anything
// new. The only inputs are one secret each side already holds (its pool VIEWING key, derived from
// the root account key by `identity.ts`) and one number anyone can read for free from the chain
// (`get_public_key(address)`, a view call). There is no handshake to intercept because there is
// no handshake.
//
// THE CURVE FACT THIS RESTS ON, verified against `ec.starkCurve` rather than assumed. The pool
// stores only the X-COORDINATE of a registered viewing key — one felt, no sign bit. An x on the
// Stark curve corresponds to two points, P and −P, and there is no way to tell from the chain
// which one the owner holds. That ambiguity does not matter here and the reason is exact:
// k·(−P) = −(k·P), and a point and its negation share an x. So taking the x of the shared point
// as the secret makes the sign choice unobservable — both sides agree no matter which they lifted.
// This is the same reason X25519 can ignore y entirely. If it were false, half of all room pairs
// would silently derive different keys and every message would fail to open.
//
// WHO ELSE CAN DERIVE THIS KEY, STATED FIRST BECAUSE IT IS THE LIMIT OF THE WHOLE SCHEME. The
// secret is built from POOL VIEWING KEYS, and StarkWare's auditor holds an escrowed copy of every
// one of them — `get_enc_private_key` is permissionless. So the auditor can derive any room's
// secret and read its messages, including ones sent before it looked, without asking either
// party. That is inherent to deriving a key from something a third party already holds; it is the
// price of a conversation with no handshake and no directory. It is why the phrase "end-to-end"
// is on this repository's forbidden-claims list and must never appear on a surface that renders
// these messages.
//
// WHAT THE RELAYER SEES, and why the room id is derived rather than chosen. The transport needs a
// routing key, and the obvious one — a hash of the two addresses — would hand the relayer a
// membership graph it currently cannot compute. The id here is derived from the SHARED SECRET
// instead, so it is opaque to anyone who does not already hold the key: the relayer learns that
// some room exists and how much traffic it carries, and cannot learn whose it is. It sees
// ciphertext and an opaque 128-bit label. That claim is only as good as this derivation, so the
// id and the message keys come out of separate HKDF `info` strings — the id is published to the
// relayer, and a published value must not be a function anyone can invert back toward the key.
//
// DIRECTIONAL KEYS, and the bug their absence would be. Both sides derive the same secret, so a
// single AES-GCM key would be used by two independent processes choosing random 96-bit nonces
// with no coordination. Nonce reuse under one key is the failure mode that breaks GCM outright —
// it leaks the XOR of two plaintexts and, worse, the authentication subkey. The birthday bound
// makes it unlikely at chat volumes, but "unlikely" is not a property worth relying on when the
// fix is free: each party SEALS with a key bound to its own public key and OPENS with one bound
// to the peer's. Two keys, one direction each, and the two processes never share a nonce space.
//
import { ec } from 'starknet'

import { NET } from './constants.js'
import { assertViewingKey } from './identity.js'

/** Web Crypto from the global — the browser's in the app, Node's in the relayer. */
const webcrypto: Crypto = globalThis.crypto

/**
 * Domain separation, and every field in it is load-bearing.
 *
 * The chain id and the pool address are in the SALT rather than the info string because they
 * identify which deployment a room belongs to: the same two people on a different pool must not
 * derive the same room. The version prefix is what lets this change later without a room from an
 * old client silently half-working against a new one — a version bump produces unrelated keys and
 * an unrelated id, so the two clients simply never meet rather than meeting and failing to open.
 */
const ROOM_VERSION = 'passbook-room-v1'

/** HKDF `info` strings. Three purposes, three independent outputs from the one shared secret. */
const INFO_ROOM_ID = `${ROOM_VERSION}:id`
const INFO_SEND_KEY = `${ROOM_VERSION}:send`

/** 128 bits of room id. Long enough that the relayer's room table cannot be enumerated. */
const ROOM_ID_BYTES = 16

/** AES-GCM's standard nonce length. Anything else is a compatibility trap, never a hardening. */
const IV_BYTES = 12

/**
 * The cap on one message, in bytes of UTF-8 plaintext.
 *
 * It exists here, on the SEALING side, as well as on the relayer, because the relayer can only
 * ever cap ciphertext — it cannot see a plaintext to measure. A sender that respects this cap
 * cannot be surprised by a refusal it could not have predicted, and the relayer's own limit is
 * set above it with room for the envelope's overhead.
 */
export const MAX_MESSAGE_BYTES = 2_000

/** A sealed message, as it travels. Base64 rather than hex — a third smaller over the wire. */
export interface RoomEnvelope {
  readonly v: 1
  /** Base64 12-byte AES-GCM nonce. Fresh per message, never derived, never a counter. */
  readonly iv: string
  /** Base64 AES-GCM output: ciphertext with its 16-byte tag appended, as Web Crypto returns it. */
  readonly ct: string
  /**
   * The sender's viewing public key x, as a 0x felt. NOT a signature and not proof of anything —
   * it is the routing hint that tells the recipient WHICH of its two directional keys to open
   * with. A liar can only produce a message that fails to decrypt, which is the same outcome as
   * sending noise. Authentication comes from GCM's tag under a key only the two parties hold.
   */
  readonly from: string
}

/** A derived room: its public label and the two directional keys that make it a conversation. */
export interface Room {
  /** The opaque routing label the relayer sees. Hex, no 0x — it lives in a URL path. */
  readonly id: string
  /** Seals what we send. Bound to OUR public key. */
  readonly sendKey: CryptoKey
  /** Opens what they send. Bound to THEIR public key. */
  readonly receiveKey: CryptoKey
  /** Our own public key x, echoed into every envelope we seal so they know which key to use. */
  readonly selfPublicKey: string
}

function feltToBytes32(value: bigint): Uint8Array {
  const hex = value.toString(16).padStart(64, '0')
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * The ECDH step: the x-coordinate of `myViewingKey · TheirPublicKey`.
 *
 * `fromHex('02' + x)` lifts the peer's x to a point by ASSUMING the even-y root. The assumption
 * is safe for the reason in the header — the other root yields the negation, whose product shares
 * this x — and it is not silent: `fromHex` validates the point, so an x that is not on the curve
 * throws here rather than producing a key that fails to open a message later.
 *
 * Exported because it is the one step worth testing directly, both for agreement (A·b == B·a) and
 * for the sign-independence the whole scheme depends on.
 */
export function sharedSecretX(myViewingKey: bigint, theirPublicKeyX: bigint): bigint {
  // The viewing key is a curve scalar with a contract-enforced range; a zero or out-of-range
  // scalar would make `multiply` throw a message about internals. Refuse it in our own words.
  assertViewingKey(myViewingKey)
  if (theirPublicKeyX <= 0n) {
    // What an unregistered address answers. A caller that reaches here has skipped the
    // registration check, and deriving a room with a peer who has no key on chain would produce
    // a room only one person can ever enter.
    throw new Error('that address has no viewing key on chain — it has not registered yet')
  }
  const peer = ec.starkCurve.ProjectivePoint.fromHex(
    `02${theirPublicKeyX.toString(16).padStart(64, '0')}`,
  )
  return peer.multiply(myViewingKey).toAffine().x
}

async function hkdf(
  secret: Uint8Array,
  salt: Uint8Array,
  info: string,
  bytes: number,
): Promise<ArrayBuffer> {
  const material = await webcrypto.subtle.importKey('raw', secret as BufferSource, 'HKDF', false, [
    'deriveBits',
  ])
  return webcrypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: new TextEncoder().encode(info) },
    material,
    bytes * 8,
  )
}

async function aesKey(
  secret: Uint8Array,
  salt: Uint8Array,
  publicKeyX: string,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  // The direction is bound by putting the SEALER's public key in the info string. Both sides
  // compute both keys and disagree about which is which, exactly as intended.
  const bits = await hkdf(secret, salt, `${INFO_SEND_KEY}:${publicKeyX}`, 32)
  return webcrypto.subtle.importKey('raw', bits, { name: 'AES-GCM', length: 256 }, false, usages)
}

export interface RoomInput {
  /** Ours, secret: the pool viewing key from `deriveViewingKey`. */
  readonly myViewingKey: bigint
  /** Ours, public: `deriveIdentityPublicKey`-style x of the viewing key. Goes in every envelope. */
  readonly myPublicKey: bigint
  /** Theirs, public: the felt `get_public_key(theirAddress)` returned. */
  readonly theirPublicKey: bigint
  /** Defaulted to the active network — injectable so a test is not a network fact. */
  readonly chainId?: string
  readonly poolAddress?: string
}

/**
 * Derive the room two registered addresses share. Pure and offline: the two public keys are the
 * caller's business to read (`pool.ts`'s `getPublicKey`), and nothing here touches the network.
 */
export async function deriveRoom(input: RoomInput): Promise<Room> {
  const chainId = input.chainId ?? NET.chainId
  const poolAddress = input.poolAddress ?? NET.pool
  const secret = feltToBytes32(sharedSecretX(input.myViewingKey, input.theirPublicKey))
  const salt = new Uint8Array(
    await webcrypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${ROOM_VERSION}:${chainId}:${poolAddress}`),
    ),
  )

  const mine = `0x${input.myPublicKey.toString(16)}`
  const theirs = `0x${input.theirPublicKey.toString(16)}`
  const [idBits, sendKey, receiveKey] = await Promise.all([
    hkdf(secret, salt, INFO_ROOM_ID, ROOM_ID_BYTES),
    aesKey(secret, salt, mine, ['encrypt']),
    aesKey(secret, salt, theirs, ['decrypt']),
  ])

  return {
    id: [...new Uint8Array(idBits)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    sendKey,
    receiveKey,
    selfPublicKey: mine,
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

/** Seal one message for the room. The nonce is fresh random bytes, per message, always. */
export async function sealMessage(room: Room, text: string): Promise<RoomEnvelope> {
  const plaintext = new TextEncoder().encode(text)
  if (plaintext.length === 0) throw new Error('refusing to send an empty message')
  if (plaintext.length > MAX_MESSAGE_BYTES) {
    throw new Error(`message is ${plaintext.length} bytes, over the ${MAX_MESSAGE_BYTES} limit`)
  }
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ct = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, room.sendKey, plaintext as BufferSource)
  return { v: 1, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)), from: room.selfPublicKey }
}

/**
 * Open a message from the room, or throw.
 *
 * IT THROWS ON ANYTHING IT CANNOT AUTHENTICATE, and callers must render that as a message that
 * did not arrive rather than dropping it silently. The relayer is an untrusted broadcast bus: it
 * can drop, reorder, replay or inject, and the only one of those this layer detects is injection.
 * A forged envelope fails the GCM tag and lands here as an error, which is the correct and only
 * outcome — there is no partial trust to extend to a message that did not open.
 */
export async function openMessage(room: Room, envelope: RoomEnvelope): Promise<string> {
  if (envelope.v !== 1) throw new Error(`unsupported envelope version ${String(envelope.v)}`)
  // Our own echo coming back off the bus. Not an error — the sender already has the plaintext and
  // renders it locally, so this is the ordinary shape of a broadcast room, not a fault to report.
  if (envelope.from === room.selfPublicKey) throw new SelfEcho()
  const iv = fromBase64(envelope.iv)
  if (iv.length !== IV_BYTES) throw new Error(`nonce is ${iv.length} bytes, expected ${IV_BYTES}`)
  const plaintext = await webcrypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    room.receiveKey,
    fromBase64(envelope.ct) as BufferSource,
  )
  return new TextDecoder().decode(plaintext)
}

/** Thrown by `openMessage` for our own broadcast echo — a distinct type so callers can ignore it. */
export class SelfEcho extends Error {
  constructor() {
    super('this envelope is our own echo')
    this.name = 'SelfEcho'
  }
}

/** Narrow an unknown wire value to an envelope. The relayer is not trusted to send us a shape. */
export function isRoomEnvelope(value: unknown): value is RoomEnvelope {
  if (typeof value !== 'object' || value === null) return false
  const e = value as Record<string, unknown>
  return (
    e.v === 1 &&
    typeof e.iv === 'string' &&
    typeof e.ct === 'string' &&
    typeof e.from === 'string' &&
    e.iv.length > 0 &&
    e.ct.length > 0
  )
}
