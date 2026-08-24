import { describe, it, expect } from 'vitest'
import {
  readPoolConstants, getPublicKey, getNumOfChannels, noteExists,
  channelCountFrom, notePresentIn,
} from '../src/pool.js'

// The decoders, driven without a chain. The send pipeline injects past both live readers in
// every one of its tests, so these two lines are otherwise the only production code in the
// module that nothing exercises.
describe('the send path"s pool decoders', () => {
  it('reads a note as present only when its packed value is non-zero', () => {
    expect(notePresentIn(['0x0', '0x0'], 1n)).toBe(false)
    expect(notePresentIn(['0x1a2b', '0x4718f5a'], 1n)).toBe(true)
    // The token felt is not the existence test — a note can carry a zero token (the pool sets it
    // to zero for encrypted notes) and still exist.
    expect(notePresentIn(['0x1a2b', '0x0'], 1n)).toBe(true)
  })

  it('refuses a get_note reply it cannot read rather than calling the note missing', () => {
    expect(() => notePresentIn([], 7n)).toThrow(/no value for get_note\(7\)/)
    expect(() => notePresentIn(['<!DOCTYPE html>'], 7n)).toThrow(/non-numeric packed value/)
  })

  it('decodes a channel count', () => {
    expect(channelCountFrom(['0x0'])).toBe(0)
    expect(channelCountFrom(['0x2'])).toBe(2)
    expect(channelCountFrom(['7'])).toBe(7)
  })

  // Past 2^53 the value comes back ROUNDED, so the index a new channel would open at is not the
  // index the pool holds — and INDEX_NOT_SEQUENTIAL on a paid batch is the only symptom.
  it('refuses a count that cannot be represented exactly', () => {
    expect(() => channelCountFrom([`0x${(2n ** 60n).toString(16)}`])).toThrow(/cannot be represented/)
    expect(() => channelCountFrom([])).toThrow(/no value for get_num_of_channels/)
    expect(() => channelCountFrom(['not-a-number'])).toThrow(/non-numeric channel count/)
  })
})

describe('pool live reads', { timeout: 30_000 }, () => {
  it('reads a non-zero fee and a sane proof window', async () => {
    const c = await readPoolConstants()
    expect(c.feeWei).toBeGreaterThan(0n)
    expect(c.proofValidityBlocks).toBeGreaterThan(0)
    expect(c.blockNumber).toBeGreaterThan(13_000_000)
  })

  it('reports the pause state as a boolean', async () => {
    const c = await readPoolConstants()
    expect(typeof c.paused).toBe('boolean')
  })

  it('returns 0n for an address that has never registered', async () => {
    expect(await getPublicKey('0x1234')).toBe(0n)
  })

  // THE FIFTH STAGE RESTS ON THIS. `mature` polls `get_note` and treats a zero as "not yet"; if
  // the pool reverted on an unknown id instead, "not yet" and "the read broke" would be the same
  // answer and the watcher could not tell them apart. Free view, banked as a live canary rather
  // than a probe row because it is an assertion about behaviour rather than an action list.
  it('answers get_note for a note that does not exist, rather than reverting', async () => {
    expect(await noteExists(0xdeadbeefcafen)).toBe(false)
  })

  it('answers get_num_of_channels for an address with no channels', async () => {
    expect(await getNumOfChannels('0x1234')).toBe(0)
  })
})
