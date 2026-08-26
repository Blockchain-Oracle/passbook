import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  EXPIRING_WINDOW_BLOCKS,
  REGENERATE_ACTION,
  expiredLabel,
  expiringLabel,
  expiryState,
} from '../src/proof-expiry.js'
import { forbiddenClaimsIn } from '../src/forbidden-claims.js'

// The live pool's value today. Passed as an ARGUMENT everywhere, never imported as a constant —
// that is the property under test.
const VALIDITY = 450

describe('the three expiry states', () => {
  it('a fresh proof is valid, with the whole window left', () => {
    const v = expiryState({ provedAtBlock: 100, currentBlock: 100, validityBlocks: VALIDITY })
    expect(v.state).toBe('valid')
    expect(v.blocksRemaining).toBe(450)
  })

  it('the last fifty blocks are the warning stretch', () => {
    // EXPERIENCE §5's authored pair: block 400 of 450.
    const v = expiryState({
      provedAtBlock: 13_412_106,
      currentBlock: 13_412_506,
      validityBlocks: VALIDITY,
    })
    expect(v.state).toBe('expiring')
    expect(v.blocksRemaining).toBe(50)
  })

  it('one block before the stretch is still plain valid', () => {
    const v = expiryState({ provedAtBlock: 0, currentBlock: 399, validityBlocks: VALIDITY })
    expect(v.state).toBe('valid')
    expect(v.blocksRemaining).toBe(51)
  })

  it('at the window it is expired', () => {
    const v = expiryState({ provedAtBlock: 0, currentBlock: VALIDITY, validityBlocks: VALIDITY })
    expect(v.state).toBe('expired')
    expect(v.blocksRemaining).toBe(0)
  })

  it('past the window the countdown holds at zero rather than going negative', () => {
    const v = expiryState({ provedAtBlock: 0, currentBlock: 9_999, validityBlocks: VALIDITY })
    expect(v.state).toBe('expired')
    expect(v.blocksRemaining).toBe(0)
  })
})

describe('the window is a chain read, not a constant', () => {
  it('a shorter validity moves the warning stretch with it', () => {
    // If 400 were hardcoded, this proof would warn 100 blocks AFTER it had already died.
    const v = expiryState({ provedAtBlock: 0, currentBlock: 260, validityBlocks: 300 })
    expect(v.state).toBe('expiring')
    expect(v.blocksRemaining).toBe(40)
  })

  it('the warning stretch is the derived difference, not an authored 400', () => {
    expect(EXPIRING_WINDOW_BLOCKS).toBe(50)
  })

  it('no shipped source hardcodes 450', () => {
    const source = readFileSync(new URL('../src/proof-expiry.ts', import.meta.url), 'utf8')
    const code = source
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n')
    expect(code).not.toMatch(/\b450\b/)
  })
})

describe('a reading we could not take is never a proof we vouch for', () => {
  it('a NaN anywhere in the inputs classifies expired, not valid', () => {
    // Every comparison against NaN is false, so the first version fell through to `valid` with
    // `blocksRemaining: NaN` — telling the user a proof is good on a reading that never happened.
    for (const input of [
      { provedAtBlock: Number.NaN, currentBlock: 100, validityBlocks: VALIDITY },
      { provedAtBlock: 0, currentBlock: Number.NaN, validityBlocks: VALIDITY },
      { provedAtBlock: 0, currentBlock: 100, validityBlocks: Number.NaN },
    ]) {
      const v = expiryState(input)
      expect(v.state, JSON.stringify(input)).toBe('expired')
      expect(v.blocksRemaining).toBe(0)
    }
  })

  it('expired is the safe direction: one wasted regeneration beats a submission that reverts', () => {
    const v = expiryState({ provedAtBlock: 0, currentBlock: 1, validityBlocks: Number.NaN })
    expect(v.state).toBe('expired')
    expect(v.clockSkew).toBe(false)
  })
})

describe('the warning stretch cannot swallow the whole window', () => {
  it('a validity at or under the stretch still has a genuinely valid life', () => {
    // With a fixed 50-block stretch, a validity of 40 would make every proof `expiring` from the
    // block it was built — a countdown that is always on is a countdown nobody reads.
    expect(expiryState({ provedAtBlock: 0, currentBlock: 0, validityBlocks: 40 }).state).toBe('valid')
  })

  it('and warns at half the window instead', () => {
    expect(expiryState({ provedAtBlock: 0, currentBlock: 21, validityBlocks: 40 }).state).toBe(
      'expiring',
    )
  })

  it('the full stretch still applies on a normal window', () => {
    expect(expiryState({ provedAtBlock: 0, currentBlock: 400, validityBlocks: VALIDITY }).state).toBe(
      'expiring',
    )
  })
})

describe('clock skew is its own sentence', () => {
  const v = expiryState({ provedAtBlock: 500, currentBlock: 100, validityBlocks: VALIDITY })

  it('a head behind the proof is classified, not rendered as an ordinary expiry', () => {
    expect(v.state).toBe('expired')
    expect(v.clockSkew).toBe(true)
    expect(v.blocksRemaining).toBe(0)
  })

  it('and it names the device rather than blaming the user', () => {
    expect(expiredLabel(v, 100)).toBe('Proof expired immediately. Your device clock may be wrong.')
  })
})

describe('the copy', () => {
  it('counts blocks and estimates no durations', () => {
    expect(expiringLabel(50)).toBe('Proof valid for 50 more blocks.')
    expect(expiringLabel(1)).toBe('Proof valid for 1 more block.')
    expect(expiringLabel(50)).not.toMatch(/~|about|min|sec/i)
  })

  it('the expired sentence names a checkable block', () => {
    const v = expiryState({ provedAtBlock: 0, currentBlock: 9_999, validityBlocks: VALIDITY })
    expect(expiredLabel(v, 13_412_556)).toBe('Proof expired at block 13,412,556')
  })

  it('regenerating is offered as a routine action', () => {
    expect(REGENERATE_ACTION).toBe('Regenerate')
  })

  it('no banned claim reaches this module', () => {
    const source = readFileSync(new URL('../src/proof-expiry.ts', import.meta.url), 'utf8')
    expect(forbiddenClaimsIn(source)).toEqual([])
  })
})
