import { describe, it, expect } from 'vitest'
import { ec, hash } from 'starknet'

import { OZ_ACCOUNT_CLASS_HASH, accountAddressFor } from '../src/account-address.js'
import { toFeltHex } from '../src/address.js'
import { toFeltHex as sdkToFeltHex } from '../src/discovery.js'

//
// THE PIN. `account-address.ts` states the address convention without importing the SDK, so the
// browser can compute where an account will live without fetching a crypto graph at first paint.
// This holds that reimplementation to `starknet.js`'s own — in Node, where the library is free.
//
// The failure mode it guards is the quiet one: get a step of the hash wrong and you do not get an
// error, you get a valid-looking felt that is a DIFFERENT address. Funds sent there wait forever
// for a contract that will never deploy.
//

const pedersen: (a: string, b: string) => string = (a, b) => hash.computePedersenHash(a, b)

/** A real keypair, so the arithmetic runs on the shapes it will see in production. */
function keypair(privateKey: string) {
  return { privateKey, publicKey: ec.starkCurve.getStarkKey(privateKey) }
}

describe('the address matches starknet.js', () => {
  const keys = [
    '0x1',
    '0xdeadbeef',
    '0x7c3e2f1a9b8d6c5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1',
  ]

  for (const privateKey of keys) {
    it(`derives the same address for ${privateKey.slice(0, 12)}…`, () => {
      const { publicKey } = keypair(privateKey)

      const ours = accountAddressFor(publicKey, pedersen)
      const reference = hash.calculateContractAddressFromHash(
        publicKey,
        OZ_ACCOUNT_CLASS_HASH,
        [publicKey],
        0,
      )

      // Compared as felts, not as strings: the two spell leading zeros differently and both are
      // the same number.
      expect(BigInt(ours)).toBe(BigInt(reference))
    })
  }

  it('is deterministic — the same key always lands on the same address', () => {
    const { publicKey } = keypair('0xabc123')
    expect(accountAddressFor(publicKey, pedersen)).toBe(accountAddressFor(publicKey, pedersen))
  })

  it('different keys land on different addresses', () => {
    const a = accountAddressFor(keypair('0x1').publicKey, pedersen)
    const b = accountAddressFor(keypair('0x2').publicKey, pedersen)
    expect(a).not.toBe(b)
  })

  it('pins the account class, because changing it moves every address', () => {
    expect(OZ_ACCOUNT_CLASS_HASH).toBe(
      '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f',
    )
  })
})

describe('the browser-safe toFeltHex matches the SDK-bound one', () => {
  it('agrees across the shapes a felt arrives in', () => {
    for (const value of ['0x0', '0xa11ce', '0x00000a11ce', '42', 0, 255, 1n << 200n]) {
      expect(toFeltHex(value as never)).toBe(sdkToFeltHex(value as never))
    }
  })

  it('refuses a negative, which is not a felt', () => {
    expect(() => toFeltHex(-1)).toThrow(/negative/)
  })
})
