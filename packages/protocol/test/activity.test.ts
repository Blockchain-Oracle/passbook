import { describe, it, expect } from 'vitest'
import { hash } from 'starknet'
import {
  actualFeeWei,
  buildActivity,
  entryById,
  markOwnAddress,
  personalEntries,
  personalKeysFrom,
  noteKey,
  FEE_NOT_READ,
  MAX_RECOMPUTABLE_NOTE_SLOTS,
  type ActivityFee,
} from '../src/activity.js'
import { compute_note_id, compute_nullifier } from '../src/discovery.js'
import type { DiscoveredRegistry } from '../src/discovery.js'
import type { RawPoolEvent } from '../src/pool-events.js'

const sel = (name: string) => `0x${hash.starknetKeccak(name).toString(16)}`
const ev = (keys: string[], data: string[] = [], blockNumber = 100, tx = '0xtx1'): RawPoolEvent => ({
  keys,
  data,
  blockNumber,
  transactionHash: tx,
})

const CHANNEL_KEY = 0x1234n
const TOKEN = 0x4718fn
const VIEWING_KEY = 0xabcden

const registry: DiscoveredRegistry = {
  incoming: [
    {
      counterparty: '0xa11ce',
      channelKey: CHANNEL_KEY,
      noteSlots: [{ token: `0x${TOKEN.toString(16)}`, nextIndex: 3 }],
    },
  ],
  outgoing: [],
  outgoingTotal: 0,
}

describe('the fee is the receipt\'s, and an unreadable one is never a zero', () => {
  it('reads the {amount, unit} shape', () => {
    expect(actualFeeWei({ actual_fee: { amount: '0x2540be400', unit: 'FRI' } })).toEqual({
      state: 'charged',
      amountWei: 10_000_000_000n,
      unit: 'FRI',
    })
    expect(actualFeeWei({ actual_fee: { amount: '0x1', unit: 'WEI' } })).toEqual({
      state: 'charged',
      amountWei: 1n,
      unit: 'WEI',
    })
  })

  it('reads a bare felt, and refuses to invent a unit for it', () => {
    // Older nodes and some proxies answer a bare felt. Every fee on this network is charged in
    // FRI today, but "today" is not a field value.
    expect(actualFeeWei({ actual_fee: '0x64' })).toEqual({
      state: 'charged',
      amountWei: 100n,
      unit: 'unknown',
    })
    expect(actualFeeWei({ actual_fee: 100 })).toEqual({
      state: 'charged',
      amountWei: 100n,
      unit: 'unknown',
    })
  })

  it('an unrecognised unit is `unknown`, not passed through as a claim', () => {
    expect(actualFeeWei({ actual_fee: { amount: '0x1', unit: 'DOGE' } })).toMatchObject({
      unit: 'unknown',
    })
    expect(actualFeeWei({ actual_fee: { amount: '0x1' } })).toMatchObject({ unit: 'unknown' })
  })

  it('a receipt with no readable fee is unknown — and specifically NOT zero', () => {
    for (const receipt of [null, undefined, {}, { actual_fee: null }, { actual_fee: {} }]) {
      const fee = actualFeeWei(receipt)
      expect(fee.state, JSON.stringify(receipt)).toBe('unknown')
      expect(fee).not.toHaveProperty('amountWei')
    }
  })

  it('a boolean amount is unknown, never BigInt(true) as a confident one wei', () => {
    // `BigInt` is more accommodating than a fee column can afford. Objects and arrays throw
    // and are caught; a boolean does not, and a silently plausible number is the worst outcome.
    expect(actualFeeWei({ actual_fee: { amount: true, unit: 'FRI' } })).toMatchObject({
      state: 'unknown',
    })
    expect(actualFeeWei({ actual_fee: { amount: false, unit: 'FRI' } })).toMatchObject({
      state: 'unknown',
    })
    expect(actualFeeWei({ actual_fee: true })).toMatchObject({ state: 'unknown' })
    // And the object/array shapes stay unknown too.
    expect(actualFeeWei({ actual_fee: { amount: {} } })).toMatchObject({ state: 'unknown' })
    expect(actualFeeWei({ actual_fee: { amount: [] } })).toMatchObject({ state: 'unknown' })
  })

  it('junk in the fee field is classified, never a raw parse error', () => {
    for (const junk of ['<!DOCTYPE html>', 'not a number', '0xZZ']) {
      const fee = actualFeeWei({ actual_fee: junk })
      expect(fee.state, junk).toBe('unknown')
      expect(fee.state === 'unknown' && fee.reason, junk).toMatch(/actual_fee was not a number/)
    }
    expect(actualFeeWei({ actual_fee: { amount: 'nope' } })).toMatchObject({ state: 'unknown' })
  })

  it('a genuinely free action and an unfetched receipt are different values', () => {
    const free = actualFeeWei({ actual_fee: { amount: '0x0', unit: 'FRI' } })
    expect(free).toEqual({ state: 'charged', amountWei: 0n, unit: 'FRI' })
    expect(actualFeeWei({}).state).toBe('unknown')
    // The distinction the whole type exists for.
    expect(free.state).not.toBe(actualFeeWei({}).state)
  })
})

describe('the record is one union built from decoded events', () => {
  it('builds a row per decodable event and skips the rest', () => {
    const entries = buildActivity([
      ev([sel('Deposit'), '0xa', '0xb'], ['0x64']),
      ev([sel('FeeAmountSet')], ['0x1']),
      ev([sel('NoteUsed'), '0x99']),
    ])
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.kind).sort()).toEqual(['deposit', 'note-spent'])
  })

  it('every row carries a block, a transaction and an addressable id', () => {
    const entries = buildActivity([
      ev([sel('Deposit'), '0xa', '0xb'], ['0x64'], 500, '0xtxA'),
      ev([sel('NoteUsed'), '0x99'], [], 500, '0xtxA'),
    ])
    expect(entries.map((e) => e.id).sort()).toEqual(['0xtxA-0', '0xtxA-1'])
    for (const entry of entries) {
      expect(entry.blockNumber).toBe(500)
      expect(entry.transactionHash).toBe('0xtxA')
    }
    // One apply_actions emits several events, so the hash alone is not addressable.
    expect(new Set(entries.map((e) => e.id)).size).toBe(2)
    expect(entryById(entries, '0xtxA-1')).toBeDefined()
    expect(entryById(entries, '0xtxA-9')).toBeUndefined()
  })

  it('ordinals restart per transaction, so ids stay stable as a feed grows', () => {
    const entries = buildActivity([
      ev([sel('NoteUsed'), '0x1'], [], 10, '0xA'),
      ev([sel('NoteUsed'), '0x3'], [], 10, '0xA'),
      ev([sel('NoteUsed'), '0x2'], [], 10, '0xB'),
    ])
    expect(entries.map((e) => e.id).sort()).toEqual(['0xA-0', '0xA-1', '0xB-0'])
  })

  it('ordinals count UNDECODABLE events too, so ids survive a new decoder', () => {
    // Teaching this build one more event type must not renumber the rows after it — every
    // bookmark and every support-thread link would then point at its neighbour.
    const entries = buildActivity([
      ev([sel('NoteUsed'), '0x1'], [], 10, '0xA'),
      ev([sel('FeeAmountSet')], ['0x1'], 10, '0xA'),
      ev([sel('NoteUsed'), '0x2'], [], 10, '0xA'),
    ])
    expect(entries.map((e) => e.id).sort()).toEqual(['0xA-0', '0xA-2'])
    expect(entries.map((e) => e.ordinal).sort()).toEqual([0, 2])
  })

  it('refuses an event stream whose transactions are interleaved', () => {
    // The detectable half of the whole-transactions contract: a hash reappearing after a
    // different one means pages were concatenated out of order, and the ordinals this assigns
    // would not match a correct merge's.
    expect(() =>
      buildActivity([
        ev([sel('NoteUsed'), '0x1'], [], 10, '0xA'),
        ev([sel('NoteUsed'), '0x2'], [], 10, '0xB'),
        ev([sel('NoteUsed'), '0x3'], [], 10, '0xA'),
      ]),
    ).toThrow(/appears in two separate runs/)
  })

  it('rows come out newest-first, with a total order inside a block', () => {
    const entries = buildActivity([
      ev([sel('NoteUsed'), '0x2'], [], 30, '0xC'),
      ev([sel('NoteUsed'), '0x3'], [], 10, '0xA'),
      ev([sel('NoteUsed'), '0x1'], [], 10, '0xB'),
    ])
    expect(entries.map((e) => e.blockNumber)).toEqual([30, 10, 10])
    // Ties inside a block break on the hash, so two renders of the same page never differ.
    expect(entries.slice(1).map((e) => e.transactionHash)).toEqual(['0xA', '0xB'])
  })

  it('orders past ordinal 9 numerically, not by the composed id string', () => {
    // `'0xtx-10' < '0xtx-2'` lexicographically. A batch emitting ten decodable events is an
    // ordinary send with change notes, not a corner case, so the tenth row must not sort second.
    const twelve = Array.from({ length: 12 }, (_, i) =>
      ev([sel('NoteUsed'), `0x${(i + 1).toString(16)}`], [], 10, '0xtx'),
    )
    const entries = buildActivity(twelve)
    expect(entries.map((e) => e.ordinal)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(entries.map((e) => e.id)).toEqual(twelve.map((_, i) => `0xtx-${i}`))
  })

  it('a fee is attached per transaction, and a missing one is the honest-unknown', () => {
    const fees = new Map<string, ActivityFee>([
      ['0xtxA', { state: 'charged', amountWei: 42n, unit: 'FRI' }],
    ])
    const entries = buildActivity(
      [ev([sel('NoteUsed'), '0x1'], [], 1, '0xtxA'), ev([sel('NoteUsed'), '0x2'], [], 1, '0xtxB')],
      { feesByTransaction: fees },
    )
    const withFee = entries.find((e) => e.transactionHash === '0xtxA')!
    const without = entries.find((e) => e.transactionHash === '0xtxB')!
    expect(withFee.fee).toEqual({ state: 'charged', amountWei: 42n, unit: 'FRI' })
    expect(without.fee).toEqual(FEE_NOT_READ)
    expect(without.fee.state).toBe('unknown')
  })
})

describe('Global shows what is public; Personal shows what we can prove is ours', () => {
  it('an encrypted note nobody matched carries no amount at all', () => {
    const packed = `0x${((99n << 128n) | 500n).toString(16)}`
    const [entry] = buildActivity([ev([sel('EncNoteCreated'), '0xbeef'], [packed])])
    expect(entry!.kind).toBe('note-created')
    expect(entry!.mine).toBe(false)
    expect(entry!.noteCommitment).toBe('0xbeef')
    // Ciphertext to everyone but its owner — a blank, never a zero and never the raw bits.
    expect(entry!.amount).toBeNull()
    expect(entry!.token).toBeNull()
    expect(entry!.counterparty).toBeNull()
  })

  it('an OPEN note publishes its amount to everyone, including the Global feed', () => {
    const packed = `0x${((1n << 128n) | 5_508_301n).toString(16)}`
    const [entry] = buildActivity([ev([sel('EncNoteCreated'), '0xbeef'], [packed])])
    expect(entry!.amount).toBe(5_508_301n)
    expect(entry!.kind === 'note-created' && entry!.open).toBe(true)
  })

  it('a note we can recompute is ours, with its token and counterparty filled in', () => {
    const noteId = compute_note_id(CHANNEL_KEY, TOKEN, 1)
    const keys = personalKeysFrom(registry, VIEWING_KEY)
    const packed = `0x${((99n << 128n) | 7n).toString(16)}`

    const [entry] = buildActivity(
      [ev([sel('EncNoteCreated'), `0x${noteId.toString(16)}`], [packed])],
      { personal: keys, amountsByNoteId: new Map([[noteId.toString(), 4_000n]]) },
    )
    expect(entry!.mine).toBe(true)
    expect(entry!.counterparty).toBe('0xa11ce')
    expect(BigInt(entry!.token!)).toBe(TOKEN)
    // The amount comes from the note we hold, not from the ciphertext.
    expect(entry!.amount).toBe(4_000n)
  })

  it('a spend is recognised by its NULLIFIER, and names the note it consumed', () => {
    const nullifier = compute_nullifier(CHANNEL_KEY, TOKEN, 2, VIEWING_KEY)
    const noteId = compute_note_id(CHANNEL_KEY, TOKEN, 2)
    const keys = personalKeysFrom(registry, VIEWING_KEY)

    const [entry] = buildActivity([ev([sel('NoteUsed'), `0x${nullifier.toString(16)}`])], {
      personal: keys,
      amountsByNoteId: new Map([[noteId.toString(), 9n]]),
    })
    expect(entry!.mine).toBe(true)
    expect(entry!.kind).toBe('note-spent')
    expect(entry!.noteCommitment).toBe(`0x${noteId.toString(16)}`)
    expect(entry!.amount).toBe(9n)
    expect(entry!.counterparty).toBe('0xa11ce')
  })

  it('someone else\'s spend publishes a nullifier and nothing else', () => {
    const keys = personalKeysFrom(registry, VIEWING_KEY)
    const [entry] = buildActivity([ev([sel('NoteUsed'), '0xdeadbeef'])], { personal: keys })
    expect(entry!.mine).toBe(false)
    expect(entry!.noteCommitment).toBeNull()
    expect(entry!.token).toBeNull()
    expect(entry!.amount).toBeNull()
  })

  it('with no registry supplied, nothing is claimed as ours', () => {
    const nullifier = compute_nullifier(CHANNEL_KEY, TOKEN, 0, VIEWING_KEY)
    const [entry] = buildActivity([ev([sel('NoteUsed'), `0x${nullifier.toString(16)}`])])
    expect(entry!.mine).toBe(false)
    expect(personalEntries([entry!])).toEqual([])
  })

  it('the registry covers SPENT indices too — that is what makes a Personal feed possible', () => {
    // `nextIndex` is 3, so indices 0, 1 and 2 are all recomputable even though the walk
    // returns only unspent notes. Without this, a feed shows arrivals and never departures.
    const keys = personalKeysFrom(registry, VIEWING_KEY)
    expect(keys.byNoteId.size).toBe(3)
    expect(keys.byNullifier.size).toBe(3)
    for (const index of [0, 1, 2]) {
      expect(keys.byNoteId.has(compute_note_id(CHANNEL_KEY, TOKEN, index).toString())).toBe(true)
    }
  })

  it('an empty registry produces no keys and claims nothing', () => {
    const keys = personalKeysFrom({ incoming: [], outgoing: [], outgoingTotal: 0 }, VIEWING_KEY)
    expect(keys.byNoteId.size).toBe(0)
    expect(keys.byNullifier.size).toBe(0)
  })
})

describe('public-address rows are marked separately from note rows', () => {
  it('a deposit naming our address is ours', () => {
    const entries = buildActivity([ev([sel('Deposit'), '0xa11ce', '0xb'], ['0x64'])])
    expect(entries[0]!.mine).toBe(false)
    const marked = markOwnAddress(entries, '0xa11ce')
    expect(marked[0]!.mine).toBe(true)
    expect(marked[0]!.amount).toBe(100n)
  })

  it('a padded spelling of our address is still our address', () => {
    const entries = buildActivity([ev([sel('Withdrawal'), '0xa11ce', '0xb'], ['0x1', '0x2', '0x3', '0x9'])])
    const marked = markOwnAddress(entries, '0x00000a11ce')
    expect(marked[0]!.mine).toBe(true)
    expect(marked[0]!.amount).toBe(9n)
  })

  it('note rows are untouched by address marking — different kinds of knowledge', () => {
    // A note row is ours because we can recompute a hash, which nobody else can do. An address
    // row is ours because a public field matches, which anyone watching can do. Fusing the two
    // would let a Personal feed imply the address rows are as unlinkable as the note rows.
    //
    // The row under test is a spend that is NOT ours, whose counterparty field would match the
    // marked address if this leaked across kinds. It must stay `mine: false` — a row already
    // marked `mine` would prove nothing, since the function short-circuits on those.
    const entries = buildActivity([ev([sel('NoteUsed'), '0xdeadbeef'])], {
      personal: personalKeysFrom(registry, VIEWING_KEY),
    })
    expect(entries[0]!.mine).toBe(false)
    expect(entries[0]!.counterparty).toBeNull()
    expect(markOwnAddress(entries, '0xdeadbeef')[0]!.mine).toBe(false)
  })

  it('a malformed counterparty costs its own row, never the whole feed', () => {
    const entries = buildActivity([ev([sel('Deposit'), '0xa11ce', '0xb'], ['0x64'])])
    const corrupted = [{ ...entries[0]!, counterparty: 'not an address' }]
    expect(() => markOwnAddress(corrupted, '0xa11ce')).not.toThrow()
    expect(markOwnAddress(corrupted, '0xa11ce')[0]!.mine).toBe(false)
  })

  it('a malformed OWN address is refused — every row would be mismarked', () => {
    const entries = buildActivity([ev([sel('Deposit'), '0xa11ce', '0xb'], ['0x64'])])
    expect(() => markOwnAddress(entries, 'not an address')).toThrow(/not an address/)
  })

  it('an unrelated address marks nothing', () => {
    const entries = buildActivity([ev([sel('Deposit'), '0xa11ce', '0xb'], ['0x64'])])
    expect(markOwnAddress(entries, '0xb0b')[0]!.mine).toBe(false)
  })

  it('a registration row names the address that registered', () => {
    const entries = buildActivity([ev([sel('ViewingKeySet'), '0xa11ce', '0x777'])])
    expect(entries[0]!.kind).toBe('registration')
    expect(entries[0]!.counterparty).toBe('0xa11ce')
    expect(markOwnAddress(entries, '0xa11ce')[0]!.mine).toBe(true)
  })
})

describe('open-note rows', () => {
  it('a created open note names its token and commitment, with no amount yet', () => {
    const [entry] = buildActivity([ev([sel('OpenNoteCreated'), '0x33068f', '0x6bc4'])])
    expect(entry!.kind).toBe('open-note-created')
    expect(entry!.token).toBe('0x33068f')
    expect(entry!.noteCommitment).toBe('0x6bc4')
    expect(entry!.amount).toBeNull()
  })

  it('a deposit into an open note publishes the depositor and the amount', () => {
    const [entry] = buildActivity([
      ev([sel('OpenNoteDeposited'), '0xd', '0x33068f', '0x6bc4'], ['0x540d0d']),
    ])
    expect(entry!.kind).toBe('open-note-deposited')
    expect(entry!.counterparty).toBe('0xd')
    expect(entry!.amount).toBe(0x540d0dn)
    expect(entry!.noteCommitment).toBe('0x6bc4')
  })
})

describe('the recompute loop is bounded and its keys have one spelling', () => {
  it('refuses a registry claiming more slots than any real account holds', () => {
    // Two curve-grade hashes per slot with no yield: a runaway index locks the tab rather than
    // failing. The cap is a hang guard, so reaching it means the walk returned something wrong.
    const runaway = {
      incoming: [
        {
          counterparty: '0xa11ce',
          channelKey: CHANNEL_KEY,
          noteSlots: [{ token: `0x${TOKEN.toString(16)}`, nextIndex: MAX_RECOMPUTABLE_NOTE_SLOTS + 1 }],
        },
      ],
      outgoing: [],
      outgoingTotal: 0,
    }
    expect(() => personalKeysFrom(runaway, VIEWING_KEY)).toThrow(/refusing to recompute/)
  })

  it('the cap counts across channels, not per slot', () => {
    const half = Math.ceil(MAX_RECOMPUTABLE_NOTE_SLOTS / 2) + 1
    const split = {
      incoming: [0, 1].map(() => ({
        counterparty: '0xa11ce',
        channelKey: CHANNEL_KEY,
        noteSlots: [{ token: `0x${TOKEN.toString(16)}`, nextIndex: half }],
      })),
      outgoing: [],
      outgoingTotal: 0,
    }
    expect(() => personalKeysFrom(split, VIEWING_KEY)).toThrow(/refusing to recompute/)
  })

  it('refuses BEFORE doing any of the work, not after paying for it', () => {
    // The guard has to fire in front of the delay it exists to prevent. Checking the budget
    // incrementally looks careful and is not: a registry sized just under the cap pays the
    // entire budget in curve hashing first, so the refusal arrives after the freeze.
    const overCap = {
      incoming: [
        {
          counterparty: '0xa11ce',
          channelKey: CHANNEL_KEY,
          noteSlots: [
            { token: `0x${TOKEN.toString(16)}`, nextIndex: MAX_RECOMPUTABLE_NOTE_SLOTS },
            { token: '0xbeef', nextIndex: MAX_RECOMPUTABLE_NOTE_SLOTS },
          ],
        },
      ],
      outgoing: [],
      outgoingTotal: 0,
    }
    const started = Date.now()
    expect(() => personalKeysFrom(overCap, VIEWING_KEY)).toThrow(/refusing to recompute/)
    // Two full budgets of hashing would be seconds. Refusing up front is microseconds.
    expect(Date.now() - started).toBeLessThan(250)
  })

  it('a nonsensical note index is refused rather than looped over', () => {
    for (const nextIndex of [-1, 1.5, Number.NaN]) {
      const bad = {
        incoming: [
          {
            counterparty: '0xa11ce',
            channelKey: CHANNEL_KEY,
            noteSlots: [{ token: `0x${TOKEN.toString(16)}`, nextIndex }],
          },
        ],
        outgoing: [],
        outgoingTotal: 0,
      }
      expect(() => personalKeysFrom(bad, VIEWING_KEY), String(nextIndex)).toThrow(
        /nonsensical note index/,
      )
    }
  })

  it('an ordinary registry is well under the cap and computes fine', () => {
    expect(personalKeysFrom(registry, VIEWING_KEY).byNoteId.size).toBe(3)
  })

  it('noteKey collapses every spelling of one id to one key', () => {
    const id = compute_note_id(CHANNEL_KEY, TOKEN, 0)
    expect(noteKey(id)).toBe(noteKey(`0x${id.toString(16)}`))
    expect(noteKey(id)).toBe(noteKey(`0x0${id.toString(16)}`))
    expect(noteKey(id)).toBe(id.toString())
  })

  it('an amounts map keyed by hex is found just as one keyed by decimal is', () => {
    // The silent failure this closes: a caller keys hex, the module keys decimal, every lookup
    // misses, and the feed simply shows no amounts while nothing throws.
    const noteId = compute_note_id(CHANNEL_KEY, TOKEN, 1)
    const keys = personalKeysFrom(registry, VIEWING_KEY)
    const packed = `0x${((99n << 128n) | 7n).toString(16)}`
    const event = ev([sel('EncNoteCreated'), `0x${noteId.toString(16)}`], [packed])

    for (const spelling of [
      noteId.toString(),
      `0x${noteId.toString(16)}`,
      `0x0${noteId.toString(16)}`,
    ]) {
      const [entry] = buildActivity([event], {
        personal: keys,
        amountsByNoteId: new Map([[spelling, 4_000n]]),
      })
      expect(entry!.amount, spelling).toBe(4_000n)
    }
  })
})
