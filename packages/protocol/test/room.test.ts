import { describe, it, expect } from 'vitest'
import { ec } from 'starknet'

import {
  deriveRoom, sealMessage, openMessage, sharedSecretX, isRoomEnvelope, SelfEcho,
  MAX_MESSAGE_BYTES, type RoomEnvelope,
} from '../src/room.js'
import { canonicalizeViewingKey } from '../src/identity.js'

const POOL = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const SN_MAIN = '0x534e5f4d41494e'

/** Two parties, each holding a viewing key and publishing only its x-coordinate — as the pool does. */
function party(seed: bigint) {
  const viewingKey = canonicalizeViewingKey(seed)
  const publicKey = BigInt(ec.starkCurve.getStarkKey(`0x${viewingKey.toString(16)}`))
  return { viewingKey, publicKey }
}

const ALICE = party(0x5eeda11cen)
const BOB = party(0xb0b5eedn)

function roomFor(me: ReturnType<typeof party>, them: ReturnType<typeof party>) {
  return deriveRoom({
    myViewingKey: me.viewingKey,
    myPublicKey: me.publicKey,
    theirPublicKey: them.publicKey,
    chainId: SN_MAIN,
    poolAddress: POOL,
  })
}

describe('the ECDH step', () => {
  it('agrees in both directions — the whole scheme is this one property', () => {
    expect(sharedSecretX(ALICE.viewingKey, BOB.publicKey)).toBe(
      sharedSecretX(BOB.viewingKey, ALICE.publicKey),
    )
  })

  //
  // THE FACT THE HEADER CLAIMS, ASSERTED RATHER THAN TRUSTED. The chain hands out an x with no
  // sign bit, so `sharedSecretX` lifts it by assuming the even-y root. If the odd root produced a
  // different shared x, every second pair of users would derive different keys and no message
  // would ever open — a failure that would look like a transport bug for a long time. This test
  // is the one that would catch a curve library changing that behaviour underneath us.
  //
  it('does not depend on which square root of the peer x was lifted', () => {
    const x = BOB.publicKey.toString(16).padStart(64, '0')
    const even = ec.starkCurve.ProjectivePoint.fromHex(`02${x}`)
    const odd = ec.starkCurve.ProjectivePoint.fromHex(`03${x}`)

    expect(even.multiply(ALICE.viewingKey).toAffine().x).toBe(
      odd.multiply(ALICE.viewingKey).toAffine().x,
    )
    expect(odd.toAffine().y).not.toBe(even.toAffine().y)
  })

  it('refuses an address that has not registered', () => {
    expect(() => sharedSecretX(ALICE.viewingKey, 0n)).toThrow(/has not registered/)
  })

  it('refuses an x that is not a point on the curve', () => {
    // x = 5 has no square root on this curve, so no point has it — checked against the curve
    // rather than assumed, because most small integers (2, 3, 4 …) DO lift to a valid point and a
    // test written on one of those would assert nothing. The point validation inside `fromHex` is
    // what makes this a refusal here rather than a key that fails to open a message three screens
    // later.
    expect(() => sharedSecretX(ALICE.viewingKey, 5n)).toThrow(/not on curve/)
  })
})

describe('the derived room', () => {
  it('gives both parties the same id without either publishing anything', async () => {
    const alice = await roomFor(ALICE, BOB)
    const bob = await roomFor(BOB, ALICE)
    expect(alice.id).toBe(bob.id)
    expect(alice.id).toMatch(/^[0-9a-f]{32}$/)
  })

  //
  // The id is what the relayer sees. If it were derivable from public inputs alone, the relayer
  // (or anyone who scraped the pool's registrations) could compute the id for every pair of
  // registered addresses and turn its room table into a social graph. It is derived from the
  // shared secret precisely so that it cannot.
  //
  it('gives a different room for a different peer, and for a different pool', async () => {
    const carol = party(0xca401n)
    const withBob = await roomFor(ALICE, BOB)
    const withCarol = await roomFor(ALICE, carol)
    expect(withBob.id).not.toBe(withCarol.id)

    const otherPool = await deriveRoom({
      myViewingKey: ALICE.viewingKey,
      myPublicKey: ALICE.publicKey,
      theirPublicKey: BOB.publicKey,
      chainId: SN_MAIN,
      poolAddress: '0x1',
    })
    expect(otherPool.id).not.toBe(withBob.id)
  })
})

describe('sealing and opening', () => {
  it('round-trips a message between the two parties', async () => {
    const alice = await roomFor(ALICE, BOB)
    const bob = await roomFor(BOB, ALICE)

    const sealed = await sealMessage(alice, 'the money is already in the thread')
    expect(await openMessage(bob, sealed)).toBe('the money is already in the thread')

    const reply = await sealMessage(bob, 'received — nothing on chain says it was us')
    expect(await openMessage(alice, reply)).toBe('received — nothing on chain says it was us')
  })

  it('round-trips unicode without mangling it', async () => {
    const alice = await roomFor(ALICE, BOB)
    const bob = await roomFor(BOB, ALICE)
    const text = '¥1,000 → 🔐 送金しました'
    expect(await openMessage(bob, await sealMessage(alice, text))).toBe(text)
  })

  it('uses a fresh nonce for every message', async () => {
    const alice = await roomFor(ALICE, BOB)
    const nonces = new Set<string>()
    for (let i = 0; i < 25; i += 1) nonces.add((await sealMessage(alice, 'same text')).iv)
    expect(nonces.size).toBe(25)
  })

  //
  // The directional-key rule, tested as a behaviour rather than as an implementation detail: a
  // party cannot open what it sealed. That is what proves the two directions do not share a key,
  // and therefore that the two processes never share a nonce space.
  //
  it('cannot open its own message with its own receive key', async () => {
    const alice = await roomFor(ALICE, BOB)
    const sealed = await sealMessage(alice, 'mine')
    // Force the self-echo guard aside so the failure under test is the CRYPTO one, not the guard.
    const disguised: RoomEnvelope = { ...sealed, from: '0xdeadbeef' }
    await expect(openMessage(alice, disguised)).rejects.toThrow()
  })

  it('reports our own echo off the broadcast bus as a distinct, ignorable case', async () => {
    const alice = await roomFor(ALICE, BOB)
    const sealed = await sealMessage(alice, 'mine')
    await expect(openMessage(alice, sealed)).rejects.toBeInstanceOf(SelfEcho)
  })

  it('refuses a forged or tampered ciphertext instead of returning garbage', async () => {
    const alice = await roomFor(ALICE, BOB)
    const bob = await roomFor(BOB, ALICE)
    const sealed = await sealMessage(alice, 'pay me 5 USDC')

    // Flip one base64 character of the ciphertext. GCM's tag is what turns this into a refusal.
    const flipped = sealed.ct[0] === 'A' ? `B${sealed.ct.slice(1)}` : `A${sealed.ct.slice(1)}`
    await expect(openMessage(bob, { ...sealed, ct: flipped })).rejects.toThrow()
  })

  it('refuses a message from a third party who guessed the room id', async () => {
    const mallory = party(0x1337n)
    const bob = await roomFor(BOB, ALICE)
    const malloryToBob = await roomFor(mallory, BOB)
    const sealed = await sealMessage(malloryToBob, 'send it to me instead')
    await expect(openMessage(bob, sealed)).rejects.toThrow()
  })

  it('refuses an empty message and one over the size cap', async () => {
    const alice = await roomFor(ALICE, BOB)
    await expect(sealMessage(alice, '')).rejects.toThrow(/empty/)
    await expect(sealMessage(alice, 'x'.repeat(MAX_MESSAGE_BYTES + 1))).rejects.toThrow(/over the/)
  })

  it('refuses an envelope whose nonce is the wrong length', async () => {
    const alice = await roomFor(ALICE, BOB)
    const bob = await roomFor(BOB, ALICE)
    const sealed = await sealMessage(alice, 'hello')
    await expect(openMessage(bob, { ...sealed, iv: btoa('short') })).rejects.toThrow(/nonce is/)
  })

  it('refuses an unsupported envelope version', async () => {
    const bob = await roomFor(BOB, ALICE)
    const alien = { v: 2, iv: 'AA', ct: 'AA', from: '0x1' } as unknown as RoomEnvelope
    await expect(openMessage(bob, alien)).rejects.toThrow(/unsupported envelope version/)
  })
})

describe('wire narrowing', () => {
  it('accepts a real envelope and rejects everything the relayer could otherwise hand us', async () => {
    const alice = await roomFor(ALICE, BOB)
    expect(isRoomEnvelope(await sealMessage(alice, 'hi'))).toBe(true)

    for (const junk of [null, undefined, 7, 'string', [], {}, { v: 1, iv: '', ct: 'a', from: '0x1' }]) {
      expect(isRoomEnvelope(junk)).toBe(false)
    }
  })
})
