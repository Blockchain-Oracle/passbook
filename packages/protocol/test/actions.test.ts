import { describe, it, expect } from 'vitest'
import {
  assertActionListValid, decodeOpenNoteDeposits, PHASE, type ValidatableAction,
} from '../src/actions.js'

const ok = (as: ValidatableAction[]) => () => assertActionListValid(as)

describe('action-list invariants (FR-060 / AD-3)', () => {
  it('accepts a canonical registration+invoke list in phase order', () => {
    expect(ok([{ type: 'SetViewingKey' }, { type: 'InvokeExternal' }])).not.toThrow()
  })

  it('accepts the withdraw→invoke fund-a-helper sandwich', () => {
    expect(ok([
      { type: 'OpenChannel', index: 0 }, { type: 'Withdraw' }, { type: 'InvokeExternal' },
    ])).not.toThrow()
  })

  it('rejects actions out of phase order', () => {
    expect(ok([{ type: 'InvokeExternal' }, { type: 'SetViewingKey' }])).toThrow(/ACTIONS_OUT_OF_ORDER/)
    expect(ok([{ type: 'Withdraw' }, { type: 'Deposit', amount: 5n }])).toThrow(/ACTIONS_OUT_OF_ORDER/)
  })

  it('rejects a second invoke-phase action', () => {
    expect(ok([{ type: 'SetViewingKey' }, { type: 'InvokeExternal' }, { type: 'ComputeAndInvoke' }]))
      .toThrow(/MULTIPLE_INVOKE_ACTIONS/)
  })

  it('rejects an invoke with no WriteOnce companion (replay protection)', () => {
    expect(ok([{ type: 'InvokeExternal' }])).toThrow(/NO_REPLAY_PROTECTION/)
    // OpenSubchannel or OpenChannel or SetViewingKey each satisfy it
    expect(ok([{ type: 'OpenSubchannel' }, { type: 'InvokeExternal' }])).not.toThrow()
  })

  it('rejects a zero-amount deposit or open note', () => {
    expect(ok([{ type: 'Deposit', amount: 0n }])).toThrow(/ZERO_AMOUNT_DEPOSIT/)
    expect(ok([{ type: 'CreateOpenNote', amount: 0n }])).toThrow(/ZERO_AMOUNT_DEPOSIT/)
    expect(ok([{ type: 'Deposit', amount: 1n }])).not.toThrow()
  })

  it('rejects shield+invoke in one transaction (val-coverage F10), allows withdraw+invoke', () => {
    expect(ok([{ type: 'SetViewingKey' }, { type: 'Deposit', amount: 100n }, { type: 'InvokeExternal' }]))
      .toThrow(/SHIELD_WITH_INVOKE/)
    expect(ok([{ type: 'SetViewingKey' }, { type: 'Withdraw' }, { type: 'InvokeExternal' }])).not.toThrow()
  })

  it('rejects non-sequential channel indices', () => {
    expect(ok([{ type: 'OpenChannel', index: 0 }, { type: 'OpenChannel', index: 2 }]))
      .toThrow(/INDEX_NOT_SEQUENTIAL/)
    expect(ok([{ type: 'OpenChannel', index: 5 }, { type: 'OpenChannel', index: 6 }])).not.toThrow()
  })

  it('rejects an empty list', () => {
    expect(ok([])).toThrow(/EMPTY_ACTION_LIST/)
  })

  it('has the fixed 8-phase order', () => {
    expect([PHASE.ACCOUNT, PHASE.CHANNEL, PHASE.SUBCHANNEL, PHASE.DEPOSIT,
      PHASE.USE_NOTES, PHASE.CREATE_NOTES, PHASE.WITHDRAW, PHASE.INVOKE])
      .toEqual([0, 1, 2, 3, 4, 5, 6, 7])
  })
})

describe('bare Span<OpenNoteDeposit> decoder (AD-3)', () => {
  it('decodes an empty span (the buy-leg case)', () => {
    expect(decodeOpenNoteDeposits(['0x0'])).toEqual([])
  })

  it('decodes a one-item span: note_id, token, amount', () => {
    expect(decodeOpenNoteDeposits(['0x1', '0xaa', '0x4718f5a', '0x64'])).toEqual([
      { noteId: 0xaan, token: '0x4718f5a', amount: 0x64n },
    ])
  })

  it('decodes a two-item span', () => {
    const d = decodeOpenNoteDeposits(['0x2', '0x1', '0xt1', '0xa', '0x2', '0xt2', '0xb'].map(String))
    expect(d.length).toBe(2)
    expect(d[1]).toEqual({ noteId: 0x2n, token: '0xt2', amount: 0xbn })
  })

  it('throws when the length prefix disagrees with the felts that follow', () => {
    expect(() => decodeOpenNoteDeposits(['0x2', '0xaa', '0xbb', '0xcc'])).toThrow(/does not match/)
  })

  it('throws on an empty return (not even a length felt)', () => {
    expect(() => decodeOpenNoteDeposits([])).toThrow(/EMPTY_RETURN/)
  })
})
