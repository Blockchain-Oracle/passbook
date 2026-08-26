import { describe, it, expect } from 'vitest'
import { selfLinkAgainst, SELF_LINK_SEVERITY } from '../src/self-link.js'
import { forbiddenClaimsIn } from '../src/forbidden-claims.js'
import { SELF_LINK_SENTENCE, SELF_LINK_WAY_OUT } from '../src/linkability-copy.js'

const OURS = '0xa11ce'

describe('the third state, which is the app’s current and only one', () => {
  it('says it has nothing to compare against when the set is empty', () => {
    // There is no funding-wallet accessor anywhere in the repository, so this is not a defensive
    // branch — it is what every call returns today.
    expect(selfLinkAgainst(OURS, [])).toEqual({ state: 'no-known-addresses' })
  })

  it('reports no-known-addresses even when the destination is one we would have matched', () => {
    // The ordering is the point. "No match" would read as "we checked and you are fine", and we
    // did not check.
    expect(selfLinkAgainst(OURS, []).state).toBe('no-known-addresses')
  })

  it('treats a set of blanks as no set at all', () => {
    expect(selfLinkAgainst(OURS, ['', '   ']).state).toBe('no-known-addresses')
  })
})

describe('comparison, once there is something to compare against', () => {
  it('matches our own address through a padded spelling', () => {
    expect(selfLinkAgainst('0x00000a11ce', [OURS])).toEqual({ state: 'self-link', matched: OURS })
  })

  it('returns the address as WE spell it, not as it was pasted', () => {
    // The way-out flow shows the user which of their addresses this is; echoing their paste back
    // would show them the string they already typed.
    const result = selfLinkAgainst('0x00000a11ce', [OURS])
    expect(result.state === 'self-link' && result.matched).toBe(OURS)
  })

  it('does not match somebody else', () => {
    expect(selfLinkAgainst('0xb0b', [OURS])).toEqual({ state: 'no-match' })
  })

  it('finds a match anywhere in the set', () => {
    expect(selfLinkAgainst('0xb0b', [OURS, '0xb0b']).state).toBe('self-link')
  })
})

describe('a destination we cannot parse is a correct negative, not an error', () => {
  it('does not throw on a Solana address pasted into a Starknet field', () => {
    const solana = '7cVfgArCheMR6Cs4t6vz5rfnqd56vZq4ndaBrY5xkxXy'
    expect(() => selfLinkAgainst(solana, [OURS])).not.toThrow()
    expect(selfLinkAgainst(solana, [OURS])).toEqual({ state: 'no-match' })
  })

  it('does not match an empty box against the zero address', () => {
    expect(selfLinkAgainst('', ['0x0'])).toEqual({ state: 'no-match' })
  })
})

describe('what the finding is worth, and what it says', () => {
  it('is high and never blocked — the action stays reachable', () => {
    // `blocked` means refused. This is never refused; the product's claim is informed consent.
    expect(SELF_LINK_SEVERITY).toBe('high')
  })

  it('carries no banned claim', () => {
    expect(forbiddenClaimsIn(SELF_LINK_SENTENCE)).toEqual([])
    expect(forbiddenClaimsIn(SELF_LINK_WAY_OUT)).toEqual([])
  })
})
