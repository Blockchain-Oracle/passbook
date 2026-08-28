import { describe, expect, it } from 'vitest'

import {
  governancePositionAction,
  launchPositionAction,
  marketPositionAction,
} from '../src/position-actions.js'

describe('position terminal actions', () => {
  it('offers cash-out only while an active market has a live quote', () => {
    expect(
      marketPositionAction({
        positionOpen: true,
        marketState: 'active',
        beforeDeadline: true,
        cashoutQuote: 12n,
        claimPreview: 0n,
      }),
    ).toEqual({ kind: 'cashout', amount: 12n })
    expect(
      marketPositionAction({
        positionOpen: true,
        marketState: 'active',
        beforeDeadline: false,
        cashoutQuote: 12n,
        claimPreview: 0n,
      }),
    ).toMatchObject({ kind: 'waiting' })
  })

  it('offers only non-zero settled claims and identifies a resolved loss', () => {
    expect(
      marketPositionAction({
        positionOpen: true,
        marketState: 'voided',
        beforeDeadline: false,
        cashoutQuote: 0n,
        claimPreview: 5n,
      }),
    ).toEqual({ kind: 'claim', amount: 5n })
    expect(
      marketPositionAction({
        positionOpen: true,
        marketState: 'resolved',
        beforeDeadline: false,
        cashoutQuote: 0n,
        claimPreview: 0n,
      }),
    ).toEqual({ kind: 'lost' })
  })

  it('maps graduated launches to redemption and missed raises to refund', () => {
    expect(
      launchPositionAction({
        positionOpen: true,
        launchState: 'graduated',
        deadlinePassed: true,
        redeemPreview: 64n,
        refundPreview: 0n,
      }),
    ).toEqual({ kind: 'redeem', amount: 64n })
    expect(
      launchPositionAction({
        positionOpen: true,
        launchState: 'active',
        deadlinePassed: true,
        redeemPreview: 0n,
        refundPreview: 8n,
      }),
    ).toEqual({ kind: 'refund', amount: 8n })
  })

  it('keeps Governance exits visible but blocked on the vulnerable deployment', () => {
    expect(
      governancePositionAction({
        escrowOpen: true,
        kind: 'ballot',
        amount: 5n,
        proposalActive: false,
        writesEnabled: false,
        writeBlocker: 'read-only',
      }),
    ).toEqual({ kind: 'blocked', because: 'read-only' })
  })
})
