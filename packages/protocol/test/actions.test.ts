import { describe, it, expect } from 'vitest'
import {
  assertActionListValid, assertBalancedActionList, decodeOpenNoteDeposits, PHASE,
  type ValidatableAction,
} from '../src/actions.js'

const ok = (as: ValidatableAction[]) => () => assertActionListValid(as)
const balanced = (as: ValidatableAction[]) => () => assertBalancedActionList(as)

const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const USDC = '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8'

describe('action-list invariants (FR-060 / AD-3)', () => {
  it('accepts a canonical registration+invoke list in phase order', () => {
    expect(ok([{ type: 'SetViewingKey' }, { type: 'InvokeExternal' }])).not.toThrow()
  })

  it('accepts the withdraw→invoke fund-a-helper sandwich', () => {
    expect(ok([
      { type: 'OpenChannel', index: 0 }, { type: 'Withdraw', amount: 1n }, { type: 'InvokeExternal' },
    ])).not.toThrow()
  })

  it('rejects actions out of phase order', () => {
    expect(ok([{ type: 'InvokeExternal' }, { type: 'SetViewingKey' }])).toThrow(/ACTIONS_OUT_OF_ORDER/)
    expect(ok([{ type: 'Withdraw', amount: 1n }, { type: 'Deposit', amount: 5n }]))
      .toThrow(/ACTIONS_OUT_OF_ORDER/)
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

  // The rule is NOT invoke-gated, and this pair is the correction. The pool sets
  // `has_replay_protection` only from a ServerAction::WriteOnce and asserts it over the whole
  // list, so `[Deposit, Withdraw]` — no invoke anywhere — is refused on-chain. Probed live:
  // ACTION_LIST_EVIDENCE's send group carries the NO_REPLAY_PROTECTION row and the row showing
  // the same list accepted once a companion is added.
  it('rejects a value-bearing list that writes no write-once slot, invoke or not', () => {
    expect(ok([{ type: 'Deposit', amount: 1n }, { type: 'Withdraw', amount: 1n }]))
      .toThrow(/NO_REPLAY_PROTECTION/)
    expect(ok([{ type: 'Deposit', amount: 1n }])).toThrow(/NO_REPLAY_PROTECTION/)
    expect(ok([
      { type: 'OpenChannel', index: 0 }, { type: 'Deposit', amount: 1n }, { type: 'Withdraw', amount: 1n },
    ])).not.toThrow()
  })

  // The other half of the correction: `UseNote` writes a NULLIFIER and both note creators write
  // the note slot, so all three ARE replay protection. A plain send carries no setup action and
  // must not be refused for it.
  it('accepts a plain send: UseNote and CreateEncNote are write-once writers', () => {
    expect(ok([{ type: 'UseNote', amount: 5n }, { type: 'CreateEncNote', amount: 5n }])).not.toThrow()
    expect(ok([{ type: 'UseNote', amount: 5n }, { type: 'Withdraw', amount: 5n }])).not.toThrow()
    expect(ok([{ type: 'CreateOpenNote', amount: 1n }])).not.toThrow()
  })

  it('rejects a zero-amount deposit or open note', () => {
    expect(ok([{ type: 'Deposit', amount: 0n }])).toThrow(/ZERO_AMOUNT_DEPOSIT/)
    expect(ok([{ type: 'CreateOpenNote', amount: 0n }])).toThrow(/ZERO_AMOUNT_DEPOSIT/)
  })

  // The pool names the zero amount first — `deposit()` runs `assert_valid` inside the compile
  // loop while the replay assert fires after it. Live: `[Deposit(0), Withdraw(0)]` → ZERO_AMOUNT.
  it('names a zero amount before the missing replay protection, as the pool does', () => {
    expect(ok([{ type: 'Deposit', amount: 0n }, { type: 'Withdraw', amount: 0n }]))
      .toThrow(/ZERO_AMOUNT_DEPOSIT/)
  })

  it('rejects shield+invoke in one transaction (val-coverage F10), allows withdraw+invoke', () => {
    expect(ok([{ type: 'SetViewingKey' }, { type: 'Deposit', amount: 100n }, { type: 'InvokeExternal' }]))
      .toThrow(/SHIELD_WITH_INVOKE/)
    expect(ok([{ type: 'SetViewingKey' }, { type: 'Withdraw', amount: 1n }, { type: 'InvokeExternal' }]))
      .not.toThrow()
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

// Every expectation here mirrors a row the deployed pool actually produced through free
// `compile_actions` calls — see ACTION_LIST_EVIDENCE's send group.
describe('per-token balance invariants (story 1.16)', () => {
  it('accepts a send whose change note closes the token exactly', () => {
    expect(balanced([
      { type: 'UseNote', token: STRK, amount: 10n },
      { type: 'CreateEncNote', token: STRK, amount: 3n },   // to the recipient
      { type: 'CreateEncNote', token: STRK, amount: 7n },   // change back to us
    ])).not.toThrow()
  })

  it('accepts the relayer fee fold: a second Withdraw leg paid out of the same notes', () => {
    expect(balanced([
      { type: 'UseNote', token: STRK, amount: 10n },
      { type: 'CreateEncNote', token: STRK, amount: 3n },
      { type: 'Withdraw', token: STRK, amount: 1n },        // the user's leg
      { type: 'Withdraw', token: STRK, amount: 6n },        // the relayer's reimbursement
    ])).not.toThrow()
  })

  // Surplus is as fatal as shortfall: the pool squashes every token counter and demands zero.
  it('refuses a leftover balance — a send with no change note', () => {
    expect(balanced([
      { type: 'UseNote', token: STRK, amount: 10n },
      { type: 'CreateEncNote', token: STRK, amount: 3n },
    ])).toThrow(/FINAL_BALANCE_MUST_BE_ZERO/)
  })

  it('refuses an overspend at the point it goes negative, not at the end', () => {
    expect(balanced([
      { type: 'UseNote', token: STRK, amount: 1n },
      { type: 'CreateEncNote', token: STRK, amount: 2n },
      { type: 'UseNote', token: STRK, amount: 1n },
    ])).toThrow(/NEGATIVE_INTERMEDIATE_BALANCE/)
  })

  // The same actions in a different order pass, because the pool's counter is an unsigned
  // running total rather than a sum — which is exactly why this walks the list.
  it('is order-sensitive, as the pool is', () => {
    expect(balanced([
      { type: 'UseNote', token: STRK, amount: 1n },
      { type: 'UseNote', token: STRK, amount: 1n },
      { type: 'CreateEncNote', token: STRK, amount: 2n },
    ])).not.toThrow()
  })

  it('keeps one counter per token rather than netting them', () => {
    expect(balanced([
      { type: 'UseNote', token: STRK, amount: 5n },
      { type: 'CreateEncNote', token: USDC, amount: 5n },
    ])).toThrow(/NEGATIVE_INTERMEDIATE_BALANCE/)
  })

  it('treats two spellings of the same felt address as one token', () => {
    expect(balanced([
      { type: 'UseNote', token: '0x04718f5a', amount: 5n },
      { type: 'CreateEncNote', token: '0x4718f5a', amount: 5n },
    ])).not.toThrow()
  })

  it('refuses a value-bearing action that will not name its token', () => {
    expect(balanced([
      { type: 'UseNote', amount: 5n },
      { type: 'CreateEncNote', token: STRK, amount: 5n },
    ])).toThrow(/MISSING_TOKEN at UseNote/)
  })

  it('refuses a zero-amount note rather than letting it balance to nothing', () => {
    expect(balanced([
      { type: 'UseNote', token: STRK, amount: 5n },
      { type: 'CreateEncNote', token: STRK, amount: 0n },
      { type: 'CreateEncNote', token: STRK, amount: 5n },
    ])).toThrow(/ZERO_AMOUNT at CreateEncNote/)
  })

  // A CreateOpenNote's amount is filled by a later deposit, so it moves nothing here. Counting
  // it would report every open-note list as short by an amount nobody has committed yet.
  it('does not count an open note against the balance', () => {
    expect(balanced([
      { type: 'UseNote', token: STRK, amount: 5n },
      { type: 'CreateOpenNote', token: STRK, amount: 5n },
      { type: 'Withdraw', token: STRK, amount: 5n },
    ])).not.toThrow()
  })

  it('ignores actions that move no value at all', () => {
    expect(balanced([
      { type: 'SetViewingKey' }, { type: 'OpenChannel', index: 0 }, { type: 'OpenSubchannel' },
      { type: 'InvokeExternal' },
    ])).not.toThrow()
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
