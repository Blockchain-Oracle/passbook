//
// The governance wire: the payload builders against the Cairo read order, the seal round trip,
// and the ComputeAndInvoke encoding against the pool's serde.
//
import { describe, expect, it } from 'vitest'

import {
  GOV_OP,
  ballotPayload,
  delegatePayload,
  expectedOpenNotes,
  fundPayload,
  joinPayload,
  reclaimPayload,
  revokePayload,
} from '../src/governance-calldata.js'
import { mintBallotVector } from '../src/governance-commitment.js'
import { mintTallyKey, openBallot, sealBallot } from '../src/governance-seal.js'
import { encodeClientActions } from '../src/message-book.js'

describe('the ballot payload', () => {
  const vector = [
    { x: 0x11n, y: 0x22n },
    { x: 0x33n, y: 0x44n },
  ]

  it('lays out op_ballot exactly as the Cairo reads it', () => {
    const built = ballotPayload({
      houseId: 1,
      proposalId: 2,
      newTotalWeight: 5n,
      reclaimCommitment: 0xabcn,
      drawPot: false,
      vector,
      sealed: ['0xdead', '0xbeef'],
    })
    expect(built.state).toBe('ready')
    if (built.state !== 'ready') return
    // [op, len, house, proposal, weight, reclaim, draw_pot, x0, y0, x1, y1, ...sealed]
    expect(built.calldata).toEqual([
      '0x1', '0xb', '0x1', '0x2', '0x5', '0xabc', '0x0', '0x11', '0x22', '0x33', '0x44', '0xdead', '0xbeef',
    ])
    expect(built.noteIdSlots).toEqual([])
  })

  it('a change of mind carries no commitment, and null spells that', () => {
    const built = ballotPayload({
      houseId: 1,
      proposalId: 2,
      newTotalWeight: 5n,
      reclaimCommitment: null,
      drawPot: true,
      vector,
      sealed: ['0x1'],
    })
    expect(built.state).toBe('ready')
    if (built.state !== 'ready') return
    expect(built.calldata[5]).toBe('0x0')
    expect(built.calldata[6]).toBe('0x1')
  })

  it('refuses the shapes the contract would refuse, before a fee is spent', () => {
    expect(ballotPayload({ houseId: 1, proposalId: 2, newTotalWeight: 5n, reclaimCommitment: null, drawPot: false, vector: [vector[0]!], sealed: ['0x1'] }).state).toBe('refused')
    expect(ballotPayload({ houseId: 1, proposalId: 2, newTotalWeight: 5n, reclaimCommitment: null, drawPot: false, vector, sealed: [] }).state).toBe('refused')
    expect(ballotPayload({ houseId: 1, proposalId: 2, newTotalWeight: -1n as never, reclaimCommitment: null, drawPot: false, vector, sealed: ['0x1'] }).state).toBe('refused')
  })
})

describe('the other five payloads', () => {
  it('join, delegate and fund are the funding trio', () => {
    expect(joinPayload({ houseId: 3, inviteSecret: '0x9' })).toMatchObject({
      state: 'ready',
      calldata: ['0x2', '0x2', '0x3', '0x9'],
    })
    expect(
      delegatePayload({ houseId: 3, delegate: '0x77', amount: 100n, reclaimCommitment: '0x88' }),
    ).toMatchObject({ state: 'ready', calldata: ['0x3', '0x4', '0x3', '0x77', '0x64', '0x88'] })
    expect(fundPayload({ houseId: 3, amount: 100n })).toMatchObject({
      state: 'ready',
      calldata: ['0x4', '0x2', '0x3', '0x64'],
    })
  })

  it('reclaim and revoke report their note-id slots and count their notes', () => {
    const built = reclaimPayload(['0xa', '0xb'])
    expect(built.state).toBe('ready')
    if (built.state !== 'ready') return
    expect(built.calldata).toEqual(['0x5', '0x5', '0x2', '0xa', '0x0', '0xb', '0x0'])
    expect(built.noteIdSlots).toEqual([4, 6])
    // The slots really are the placeholders.
    for (const slot of built.noteIdSlots) expect(built.calldata[slot]).toBe('0x0')

    expect(revokePayload(['0xa']).state).toBe('ready')
    expect(expectedOpenNotes(GOV_OP.reclaim, 2)).toBe(2)
    expect(expectedOpenNotes(GOV_OP.ballot, 2)).toBe(0)
  })
})

describe('the seal (§6)', () => {
  it('round-trips a choice under the tally key, blinds intact', async () => {
    const teller = mintTallyKey()
    const ballot = mintBallotVector(5_000_000_000_000_000_000n, 1, 3)
    const sealed = await sealBallot(
      { choice: 1, weight: 5_000_000_000_000_000_000n, blinds: ballot.blinds },
      teller.publicX,
    )
    const opened = await openBallot(sealed, teller.secret)
    expect(opened.choice).toBe(1)
    expect(opened.weight).toBe(5_000_000_000_000_000_000n)
    expect(opened.blinds).toEqual(ballot.blinds)
  })

  it('the wrong key opens nothing — the exclusion lane, exercised', async () => {
    const teller = mintTallyKey()
    const wrong = mintTallyKey()
    const sealed = await sealBallot({ choice: 0, weight: 1n, blinds: [2n, 3n] }, teller.publicX)
    await expect(openBallot(sealed, wrong.secret)).rejects.toThrow()
  })
})

describe('the ComputeAndInvoke encoding', () => {
  it('serialises variant 9 with both halves length-prefixed, the pool struct order', () => {
    const encoded = encodeClientActions([
      { type: 'ComputeAndInvoke', contractAddress: '0xg0'.replace('g', 'a'), compute: ['0x1', '0x2'], invoke: ['0x1', '0x2'] },
    ])
    expect(encoded).toEqual(['0x1', '0x9', '0xa0', '0x2', '0x1', '0x2', '0x2', '0x1', '0x2'])
  })
})
