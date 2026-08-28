//
// The Teller under test: the counting (final ballot per identity, exclusion for anything the key
// does not open or that lies about its public half), the key ledger, and one full sweep driving
// tally + reveal through stubbed submission legs.
//
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { mintBallotVector } from '../../protocol/src/governance-commitment.js'
import { mintTallyKey, sealBallot } from '../../protocol/src/governance-seal.js'
import { countBallots, decodeTellerProposal, openTeller, type TellerBallot, type TellerProposal } from '../src/teller.js'

const NOW_S = 1_700_000_000

function proposal(over: Partial<TellerProposal> = {}): TellerProposal {
  return {
    id: 0,
    state: 1,
    mode: 1,
    options: 2,
    deadline: NOW_S - 10,
    tallyKey: 0n,
    totalWeight: 8n,
    ...over,
  }
}

async function sealedBallot(
  identityKey: string,
  weight: bigint,
  choice: number,
  seq: number,
  tallyPublicX: bigint,
  options = 2,
): Promise<{ ballot: TellerBallot; blinds: readonly bigint[] }> {
  const vector = mintBallotVector(weight, choice, options)
  const sealed = await sealBallot({ choice, weight, blinds: vector.blinds }, tallyPublicX)
  return { ballot: { identityKey, weight, seq, sealed }, blinds: vector.blinds }
}

describe('countBallots', () => {
  it('counts final ballots, sums weights per choice and blinds per option', async () => {
    const key = mintTallyKey()
    const a = await sealedBallot('0xa', 5n, 1, 1, key.publicX)
    const b = await sealedBallot('0xb', 3n, 0, 1, key.publicX)
    const work = await countBallots(proposal({ tallyKey: key.publicX }), [a.ballot, b.ballot], key.secret)
    expect(work.sums).toEqual([3n, 5n])
    expect(work.excluded).toEqual([])
    expect(work.countedBallots).toBe(2)
  })

  it('the replace rule off the event stream: the last seq is the ballot', async () => {
    const key = mintTallyKey()
    const first = await sealedBallot('0xa', 5n, 1, 1, key.publicX)
    const changed = await sealedBallot('0xa', 5n, 0, 2, key.publicX)
    const work = await countBallots(
      proposal({ tallyKey: key.publicX, totalWeight: 5n }),
      [first.ballot, changed.ballot],
      key.secret,
    )
    expect(work.sums).toEqual([5n, 0n])
    expect(work.countedBallots).toBe(1)
  })

  it('a ballot the key does not open is excluded, publicly, and costs only itself', async () => {
    const key = mintTallyKey()
    const stranger = mintTallyKey()
    const good = await sealedBallot('0xa', 5n, 1, 1, key.publicX)
    const alien = await sealedBallot('0xb', 3n, 0, 1, stranger.publicX)
    const work = await countBallots(proposal({ tallyKey: key.publicX }), [good.ballot, alien.ballot], key.secret)
    expect(work.sums).toEqual([0n, 5n])
    expect(work.excluded).toEqual(['0xb'])
  })

  it('a sealed half that lies about the public weight is excluded too', async () => {
    const key = mintTallyKey()
    const liar = await sealedBallot('0xa', 5n, 1, 1, key.publicX)
    // The event says 7; the seal says 5. The contract holds the PUBLIC number; the Teller must
    // not count the private one.
    liar.ballot = { ...liar.ballot, weight: 7n }
    const work = await countBallots(proposal({ tallyKey: key.publicX }), [liar.ballot], key.secret)
    expect(work.excluded).toEqual(['0xa'])
  })
})

describe('the key ledger', () => {
  it('mints, persists, and holds across a reopen', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'teller-')), 'teller.json')
    const teller = openTeller({ file })
    const publicX = teller.mintKey()
    expect(teller.holds(publicX)).toBe(true)

    const reopened = openTeller({ file })
    expect(reopened.holds(publicX)).toBe(true)
    expect(reopened.keyCount()).toBe(1)
  })
})

describe('one sweep', () => {
  it('tallies a closed proposal it holds the key for, then reveals in secret-until-close mode', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'teller-')), 'teller.json')
    const teller = openTeller({ file })
    const publicX = teller.mintKey()

    const a = await sealedBallot('0xa', 5n, 1, 1, publicX)
    const submitTally = vi.fn(async () => '0xtally')
    const submitKey = vi.fn(async () => '0xkey')

    await teller.tick({
      proposalCount: async () => 1,
      getProposal: async () => proposal({ tallyKey: publicX, totalWeight: 5n }),
      ballotEvents: async () => [a.ballot],
      submitTally,
      submitKey,
      now: () => NOW_S * 1000,
      log: () => {},
      warn: () => {},
    })

    expect(submitTally).toHaveBeenCalledWith(0, [0n, 5n], expect.anything(), [])
    expect(submitKey).toHaveBeenCalledTimes(1)
  })

  it('leaves an open vote alone, and a key it does not hold alone', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'teller-')), 'teller.json')
    const teller = openTeller({ file })
    teller.mintKey()
    const submitTally = vi.fn(async () => '0x')

    await teller.tick({
      proposalCount: async () => 2,
      getProposal: async (id) =>
        id === 0
          ? proposal({ deadline: NOW_S + 1000 }) // still open
          : proposal({ id: 1, tallyKey: 0xdeadn }), // somebody else's key
      ballotEvents: async () => [],
      submitTally,
      submitKey: vi.fn(async () => '0x'),
      now: () => NOW_S * 1000,
      log: () => {},
      warn: () => {},
    })
    expect(submitTally).not.toHaveBeenCalled()
  })
})

describe('decodeTellerProposal', () => {
  it('reads state and weight from the struct declaration order', () => {
    const felts = [
      '0x1', // house_id
      '0x1', // mode
      '0x2', // options
      '0x64', // deadline
      '0xabc', // tally_key
      '0x0', // published_key
      '0x8', // quorum
      '0x1388', // threshold_bps
      '0x1', // action_kind
      '0x0', // action_amount
      '0x0', // action_recipient
      '0x1', // state
      '0x8', // total_weight
      '0x2', // ballot_count
      '0x0', // tally_for
      '0x0', // tally_against
    ]
    expect(decodeTellerProposal(3, felts)).toEqual({
      id: 3,
      mode: 1,
      options: 2,
      deadline: 100,
      tallyKey: 0xabcn,
      state: 1,
      totalWeight: 8n,
    })
  })
})
