import { describe, it, expect } from 'vitest'

import { STRK_TOKEN } from '../../protocol/src/constants.js'
import {
  DRIP_WEI,
  dripCall,
  isDrippableAddress,
} from '../src/faucet.js'

describe('the drip call is built from constants, never from a request', () => {
  it('targets STRK.transfer and nothing else', () => {
    const call = dripCall('0x123')
    expect(call.contractAddress).toBe(STRK_TOKEN)
    expect(call.entrypoint).toBe('transfer')
  })

  it('encodes the amount as a u256 — two felts, low then high', () => {
    // The mistake this pins: emitting one felt. The ERC-20 would read the NEXT calldata slot as
    // the high half, and the transfer either reverts or moves an amount nobody intended.
    const call = dripCall('0x123')
    expect(call.calldata).toHaveLength(3)
    const [, low, high] = call.calldata as string[]
    expect(BigInt(low!)).toBe(DRIP_WEI)
    expect(BigInt(high!)).toBe(0n)
  })

  it('re-serialises the recipient rather than passing the string through', () => {
    // Three spellings of one address must produce identical calldata — proof the value in the
    // call is a felt THIS process produced rather than text a client sent.
    const canonical = (dripCall('0x123').calldata as string[])[0]
    expect((dripCall('0x0123').calldata as string[])[0]).toBe(canonical)
    expect((dripCall('0X123').calldata as string[])[0]).toBe(canonical)
  })

  it('is exactly one call — a drip can never become a batch', () => {
    // `dripCall` returns a single Call by type, and the route sends `[dripCall(...)]`. Asserted
    // because the value of this whole design is that the client contributes no calls at all.
    const call = dripCall('0x123')
    expect(Array.isArray(call)).toBe(false)
  })

  it('throws on an address it cannot parse, rather than emitting rubbish calldata', () => {
    expect(() => dripCall('hello')).toThrow()
  })
})

describe('the address gate', () => {
  it('accepts a real address', () => {
    expect(isDrippableAddress('0x123')).toBe(true)
    expect(isDrippableAddress(STRK_TOKEN)).toBe(true)
  })

  it('REJECTS zero, which parses fine and is a burn', () => {
    // The one failure of this route that costs real money and reports success. `asAddress('0x0')`
    // succeeds, so a check that only guards against parse failures lets it through.
    expect(isDrippableAddress('0x0')).toBe(false)
    expect(isDrippableAddress('0x000')).toBe(false)
  })

  it('rejects everything that is not a parseable address string', () => {
    expect(isDrippableAddress('')).toBe(false)
    expect(isDrippableAddress('hello')).toBe(false)
    expect(isDrippableAddress(null)).toBe(false)
    expect(isDrippableAddress(undefined)).toBe(false)
    expect(isDrippableAddress(123)).toBe(false)
    expect(isDrippableAddress({ address: '0x1' })).toBe(false)
  })
})

describe('the amount is a starter amount', () => {
  it('is 1 STRK — enough for a few actions, not enough to farm', () => {
    expect(DRIP_WEI).toBe(10n ** 18n)
  })
})
