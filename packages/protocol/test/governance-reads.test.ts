//
// The governance readers: selectors pinned to `getSelectorFromName`, decoders held to the Cairo
// declaration order, and the list reads through the transport seam.
//
import { hash } from 'starknet'
import { describe, expect, it } from 'vitest'

import type { Transport } from '../src/app-reads.js'
import {
  GOV_SELECTOR,
  decodeHouse,
  decodeProposal,
  proposalPhase,
  quorumPct,
  readHouses,
  PROPOSAL_STATE,
} from '../src/governance-reads.js'

describe('GOV_SELECTOR', () => {
  it.each(Object.entries(GOV_SELECTOR))('%s matches getSelectorFromName', (name, pinned) => {
    expect(BigInt(pinned)).toBe(BigInt(hash.getSelectorFromName(name)))
  })
})

const HOUSE_FELTS = [
  '0x7777', // token
  '0x8', // quorum
  '0x1388', // threshold_bps (5000)
  '0x1', // counting
  '0x2', // membership
  '0xabc', // invite_commitment (never rendered)
  '0x5', // member_count
  '0x64', // treasury
  '0xdef', // creator_commitment
  '0x1', // state
]

describe('decodeHouse', () => {
  it('reads HouseInfo in declaration order and skips the secret-bearing slots', () => {
    expect(decodeHouse(2, HOUSE_FELTS, 'ipfs://x')).toEqual({
      id: 2,
      token: '0x7777',
      quorum: 8n,
      thresholdBps: 5000,
      counting: 1,
      membership: 2,
      memberCount: 5,
      treasury: 100n,
      state: 1,
      metadata: 'ipfs://x',
    })
  })
})

const PROPOSAL_FELTS = [
  '0x2', '0x1', '0x2', '0x64', '0xabc', '0x0', '0x8', '0x1388',
  '0x2', '0x28', '0x9999', '0x1', '0x5', '0x3', '0x0', '0x0',
]

describe('decodeProposal and its derivations', () => {
  it('reads Proposal in declaration order', () => {
    const proposal = decodeProposal(7, PROPOSAL_FELTS, 'ipfs://grant')
    expect(proposal).toMatchObject({
      id: 7,
      houseId: 2,
      mode: 1,
      options: 2,
      deadline: 100,
      tallyKey: 0xabcn,
      quorum: 8n,
      actionKind: 2,
      actionAmount: 40n,
      actionRecipient: '0x9999',
      state: 1,
      totalWeight: 5n,
      ballotCount: 3,
    })
    expect(quorumPct(proposal)).toBe(62) // 5 of 8
    expect(proposalPhase(proposal, 0)).toBe('Sealed Ballot Box')
    expect(proposalPhase(proposal, 200_000)).toBe('Closed · tallying')
    expect(proposalPhase({ ...proposal, state: PROPOSAL_STATE.executed }, 0)).toBe('Executed')
  })
})

describe('readHouses', () => {
  it('reads newest first through the seam, metadata included', async () => {
    const transport: Transport = (_method, params) => {
      const { request } = params as { request: { entry_point_selector: string; calldata: string[] } }
      if (request.entry_point_selector === GOV_SELECTOR.house_count) return Promise.resolve(['0x1'])
      if (request.entry_point_selector === GOV_SELECTOR.get_house) return Promise.resolve(HOUSE_FELTS)
      // 'club' as a ByteArray: no full words, pending 0x636c7562, length 4.
      if (request.entry_point_selector === GOV_SELECTOR.house_metadata) {
        return Promise.resolve(['0x0', '0x636c7562', '0x4'])
      }
      throw new Error(`unstubbed ${request.entry_point_selector}`)
    }
    const out = await readHouses('0xG', { transport })
    expect(out.total).toBe(1)
    expect(out.houses[0]).toMatchObject({ id: 0, metadata: 'club' })
    expect(out.problem).toBeNull()
  })
})
