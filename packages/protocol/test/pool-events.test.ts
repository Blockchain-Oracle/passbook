import { describe, it, expect } from 'vitest'
import { hash } from 'starknet'
import {
  decodeDeposit,
  decodeEncNoteCreated,
  decodeNoteUsed,
  decodeOpenNoteCreated,
  decodeOpenNoteDeposited,
  decodePoolEvent,
  decodeViewingKeySet,
  decodeWithdrawal,
  packedNoteValue,
  poolEventSelector,
  readPoolEvents,
  toRawEvent,
  EVENT_CHUNK_SIZE,
  MAX_EVENT_CHUNK_SIZE,
  MAX_EVENT_PAGES,
  OPEN_NOTE_SALT,
  POOL_EVENT_NAMES,
  type EventRequest,
} from '../src/pool-events.js'
import { NET } from '../src/constants.js'

const sel = (name: string) => `0x${hash.starknetKeccak(name).toString(16)}`
const raw = (keys: string[], data: string[] = [], blockNumber = 100, transactionHash = '0xtx') => ({
  keys,
  data,
  blockNumber,
  transactionHash,
})

describe('selectors are the contract\'s own', () => {
  it('every name hashes to starknet_keccak of the Cairo event name', () => {
    for (const name of POOL_EVENT_NAMES) {
      expect(poolEventSelector(name)).toBe(sel(name))
    }
  })

  it('the seven names are distinct', () => {
    const selectors = POOL_EVENT_NAMES.map(poolEventSelector)
    expect(new Set(selectors).size).toBe(selectors.length)
    expect(selectors).toHaveLength(7)
  })
})

describe('decoders read the fields the Cairo layout actually puts there', () => {
  it('Deposit: keys [sel, user, token], data [amount]', () => {
    expect(decodeDeposit([sel('Deposit'), '0xa', '0xb'], ['0x989680'])).toEqual({
      kind: 'deposit',
      user: 0xan,
      token: 0xbn,
      amount: 10_000_000n,
    })
  })

  it('Withdrawal reads the amount at data[3], past the three-felt EncUserAddr', () => {
    // The whole point of this test. `enc_user_addr` is auditor_public_key + ephemeral_pubkey +
    // enc_user_addr, declared before `amount` in events.cairo — so reading data[0] would return
    // an auditor key as a token amount. This is a real mainnet-shaped payload.
    const decoded = decodeWithdrawal(
      [sel('Withdrawal'), '0x9067f35d2cab3cb933f3d78793660402026f8fa31e041ca2cab4a8e9a49092', '0x33068f'],
      [
        '0x1eed60b8d483b3bede62d1cc0f32874aea30747e6943437c858359b41801bf7',
        '0x1e5bb099dfcbf6da9a022b45df93055fbad10da6f3b6e33fb274cd1b6c441c5',
        '0x53031284dfc103eed14b0310813bd8df5b0d066d3b60bd6bfe4c729e1a39cff',
        '0x31b482',
      ],
    )
    expect(decoded.amount).toBe(0x31b482n)
    expect(decoded.token).toBe(0x33068fn)
    // And explicitly NOT the auditor key sitting at data[0].
    expect(decoded.amount).not.toBe(0x1eed60b8d483b3bede62d1cc0f32874aea30747e6943437c858359b41801bf7n)
  })

  it('EncNoteCreated: note id is a key, packed value is data', () => {
    expect(decodeEncNoteCreated([sel('EncNoteCreated'), '0x7b0b'], ['0xf6c1'])).toEqual({
      kind: 'note-created',
      noteId: 0x7b0bn,
      packedValue: 0xf6c1n,
    })
  })

  it('NoteUsed carries a nullifier and nothing else', () => {
    expect(decodeNoteUsed([sel('NoteUsed'), '0x471b'])).toEqual({
      kind: 'note-spent',
      nullifier: 0x471bn,
    })
  })

  it('OpenNoteCreated: token then note id, both keys', () => {
    expect(decodeOpenNoteCreated([sel('OpenNoteCreated'), '0x33068f', '0x6bc4'])).toEqual({
      kind: 'open-note-created',
      token: 0x33068fn,
      noteId: 0x6bc4n,
    })
  })

  it('OpenNoteDeposited: three keys then the amount', () => {
    expect(
      decodeOpenNoteDeposited([sel('OpenNoteDeposited'), '0xd', '0x33068f', '0x6bc4'], ['0x540d0d']),
    ).toEqual({
      kind: 'open-note-deposited',
      depositor: 0xdn,
      token: 0x33068fn,
      noteId: 0x6bc4n,
      amount: 0x540d0dn,
    })
  })

  it('ViewingKeySet: the registration row', () => {
    expect(decodeViewingKeySet([sel('ViewingKeySet'), '0x5284', '0x5201'])).toEqual({
      kind: 'registration',
      user: 0x5284n,
      publicKey: 0x5201n,
    })
  })
})

describe('junk input is classified, never leaked as a raw parse error', () => {
  // The `pool.ts` convention. A decode that only ever ran inside a network call is a decode
  // nothing tested; these are the inputs a proxy, a captive portal or a resyncing node produce.
  const JUNK = ['<!DOCTYPE html>', 'not a felt', '0xZZ', 'null', '{}']

  it('a non-numeric felt names the field it was supposed to be', () => {
    for (const junk of JUNK) {
      expect(() => decodeDeposit([sel('Deposit'), junk, '0xb'], ['0x1']), junk).toThrow(
        /Deposit carried a non-numeric user_addr/,
      )
      expect(() => decodeDeposit([sel('Deposit'), junk, '0xb'], ['0x1']), junk).not.toThrow(SyntaxError)
    }
  })

  it('a missing field says which position it was missing from', () => {
    expect(() => decodeDeposit([sel('Deposit'), '0xa'], ['0x1'])).toThrow(/Deposit carried no token/)
    expect(() => decodeDeposit([sel('Deposit'), '0xa', '0xb'], [])).toThrow(/Deposit carried no amount/)
    expect(() => decodeNoteUsed([sel('NoteUsed')])).toThrow(/NoteUsed carried no nullifier/)
    // The short-Withdrawal case: three felts of EncUserAddr present, amount absent.
    expect(() => decodeWithdrawal([sel('Withdrawal'), '0xa', '0xb'], ['0x1', '0x2', '0x3'])).toThrow(
      /Withdrawal carried no amount \(expected at position 3\)/,
    )
  })

  it('the offending value is quoted back, but bounded', () => {
    expect(() => decodeDeposit([sel('Deposit'), '<!DOCTYPE html>', '0xb'], ['0x1'])).toThrow(/DOCTYPE/)
    try {
      decodeDeposit([sel('Deposit'), 'x'.repeat(5_000), '0xb'], ['0x1'])
      throw new Error('expected a throw')
    } catch (e) {
      expect((e as Error).message.length).toBeLessThan(200)
    }
  })

  it('an empty string is zero, not a throw — and that is correct for a felt', () => {
    // `BigInt('')` is 0n. Recorded rather than guarded, because zero IS a legal felt here and
    // guarding it would refuse a genuine zero address.
    expect(decodeDeposit([sel('Deposit'), '', '0xb'], ['0x1']).user).toBe(0n)
  })
})

describe('dispatch separates "not ours" from "ours and broken"', () => {
  it('an unknown selector is null, so an admin event cannot break a feed', () => {
    expect(decodePoolEvent(raw([sel('FeeAmountSet')], ['0x1']))).toBeNull()
    expect(decodePoolEvent(raw([sel('AuditorPublicKeySet')], ['0x1']))).toBeNull()
    expect(decodePoolEvent(raw([sel('OpenNoteDepositorBlockSet')], ['0x1']))).toBeNull()
  })

  it('no selector at all, or a non-felt selector, is null rather than a throw', () => {
    expect(decodePoolEvent(raw([]))).toBeNull()
    expect(decodePoolEvent(raw(['not a selector']))).toBeNull()
  })

  it('a KNOWN selector with broken fields throws — a moved field must be loud', () => {
    expect(() => decodePoolEvent(raw([sel('Deposit'), '0xa'], []))).toThrow(/Deposit carried no/)
    expect(() => decodePoolEvent(raw([sel('Withdrawal'), '0xa', '0xb'], ['0x1']))).toThrow(
      /Withdrawal carried no amount/,
    )
  })

  it('a padded selector still dispatches — normalization is not optional', () => {
    const padded = `0x0${sel('NoteUsed').slice(2)}`
    expect(decodePoolEvent(raw([padded, '0x1']))?.kind).toBe('note-spent')
  })
})

describe('every event must know its block', () => {
  it('a pending event with no block number is refused, not stamped zero', () => {
    expect(() => toRawEvent({ keys: [], data: [], transaction_hash: '0x1' })).toThrow(
      /without a usable block number/,
    )
    expect(() => toRawEvent({ block_number: null })).toThrow(/without a usable block number/)
    expect(() => toRawEvent({ block_number: 1.5 })).toThrow(/without a usable block number/)
    expect(() => toRawEvent({ block_number: -1 })).toThrow(/without a usable block number/)
    expect(() => toRawEvent(null)).toThrow(/without a usable block number/)
  })

  it('block zero is legal', () => {
    expect(toRawEvent({ block_number: 0, keys: ['0x1'], data: [], transaction_hash: '0xa' })).toEqual({
      blockNumber: 0,
      keys: ['0x1'],
      data: [],
      transactionHash: '0xa',
    })
  })

  it('a missing transaction hash is refused as loudly as a missing block', () => {
    // It is half of every entry id and the key a fee joins on. Defaulting it to '' collapses
    // every hash-less event into one synthetic transaction with colliding ids and a shared fee.
    for (const hash of [undefined, null, '', 0, {}]) {
      expect(() => toRawEvent({ block_number: 5, transaction_hash: hash }), String(hash)).toThrow(
        /without a transaction hash/,
      )
    }
  })

  it('missing keys or data become empty arrays rather than undefined', () => {
    const event = toRawEvent({ block_number: 5, transaction_hash: '0xa' })
    expect(event.keys).toEqual([])
    expect(event.data).toEqual([])
    expect(event.transactionHash).toBe('0xa')
  })

  it('element types are checked, not cast', () => {
    // A bare `as string[]` would hand the decoders objects whose BigInt conversion fails much
    // later, inside a message about a field name rather than about the response's shape.
    expect(() => toRawEvent({ block_number: 5, transaction_hash: '0xa', keys: [{}] })).toThrow(
      /at keys\[0\], which is not a felt/,
    )
    expect(() => toRawEvent({ block_number: 5, transaction_hash: '0xa', data: [null] })).toThrow(
      /at data\[0\], which is not a felt/,
    )
    expect(() => toRawEvent({ block_number: 5, transaction_hash: '0xa', keys: 'nope' })).toThrow(
      /non-array keys/,
    )
    // Numbers are a legal felt spelling and are normalized rather than refused.
    expect(toRawEvent({ block_number: 5, transaction_hash: '0xa', keys: [255] }).keys).toEqual(['0xff'])
  })
})

describe('packed note values', () => {
  it('an open note is salt 1 with a plaintext amount', () => {
    const packed = (OPEN_NOTE_SALT << 128n) | 5_508_301n
    expect(packedNoteValue(packed)).toEqual({
      open: true,
      amount: 5_508_301n,
      salt: 1n,
      absent: false,
    })
  })

  it('an encrypted note refuses to produce an amount', () => {
    const packed = (99n << 128n) | 123n
    const decoded = packedNoteValue(packed)
    expect(decoded.open).toBe(false)
    expect(decoded.salt).toBe(99n)
    // The rule the whole record depends on: not zero, not the ciphertext read as a number.
    expect(decoded.amount).toBeNull()
  })

  it('zero is absent, not an amount of zero', () => {
    expect(packedNoteValue(0n)).toEqual({ open: false, amount: null, salt: 0n, absent: true })
  })

  it('an open note holding zero is still an open note', () => {
    // The high bits carry the discriminator; the low bits being zero does not un-open it.
    expect(packedNoteValue(OPEN_NOTE_SALT << 128n)).toEqual({
      open: true,
      amount: 0n,
      salt: 1n,
      absent: false,
    })
  })
})

describe('the bounded read is bounded (AD-14)', () => {
  /** A fake paged RPC that always offers another page, so the cap is what has to stop it. */
  function endlessReader() {
    const requests: EventRequest[] = []
    return {
      requests,
      read: async (request: EventRequest) => {
        requests.push(request)
        return {
          events: [
            { block_number: 10, keys: [sel('NoteUsed'), '0x1'], data: [], transaction_hash: '0xa' },
          ],
          continuation_token: `page-${requests.length}`,
        }
      },
    }
  }

  it('stops at the page cap and SAYS it stopped, with a resume token', async () => {
    const reader = endlessReader()
    const page = await readPoolEvents({
      fromBlock: 1,
      toBlock: 100,
      maxPages: 5,
      getEvents: reader.read,
    })
    expect(page.pagesRead).toBe(5)
    expect(page.complete).toBe(false)
    expect(page.continuation?.token).toBe('page-5')
    // The cursor carries the host that minted it — a token is an opaque, host-specific offset.
    expect(page.continuation?.host).toBe(NET.rpc[0])
    expect(page.events).toHaveLength(5)
  })

  it('never exceeds the module cap even when asked to', async () => {
    const reader = endlessReader()
    const page = await readPoolEvents({
      fromBlock: 1,
      toBlock: 100,
      maxPages: 10_000,
      getEvents: reader.read,
    })
    expect(page.pagesRead).toBe(MAX_EVENT_PAGES)
    expect(page.complete).toBe(false)
  })

  it('never asks for a chunk larger than the cap, and always bounds both ends', async () => {
    const reader = endlessReader()
    await readPoolEvents({
      fromBlock: 42,
      toBlock: 99,
      chunkSize: 100_000,
      maxPages: 2,
      getEvents: reader.read,
    })
    for (const request of reader.requests) {
      // Clamped to the SPEC ceiling, which is what a host will actually answer. Asking beyond it
      // risks a refusal rather than a short page.
      expect(request.chunk_size).toBeLessThanOrEqual(MAX_EVENT_CHUNK_SIZE)
      // The AD-14 rule, asserted on the wire: never an unbounded range.
      expect(request.from_block).toEqual({ block_number: 42 })
      expect(request.to_block).toEqual({ block_number: 99 })
      expect(request.address).toBe(NET.pool)
    }
  })

  it('asks for the small default chunk when the caller does not choose', async () => {
    // The default is a deliberate browser trade — a caller that wants fewer round trips has to
    // say so. Raising this silently would change the shape of every existing read.
    const reader = endlessReader()
    await readPoolEvents({ fromBlock: 1, toBlock: 9, maxPages: 1, getEvents: reader.read })
    expect(reader.requests[0]?.chunk_size).toBe(EVENT_CHUNK_SIZE)
    expect(EVENT_CHUNK_SIZE).toBeLessThan(MAX_EVENT_CHUNK_SIZE)
  })

  it('honours a caller that asks for more, up to the ceiling', async () => {
    const reader = endlessReader()
    await readPoolEvents({
      fromBlock: 1,
      toBlock: 9,
      chunkSize: MAX_EVENT_CHUNK_SIZE,
      maxPages: 1,
      getEvents: reader.read,
    })
    // The regression this guards: clamping to the DEFAULT rather than the ceiling, which looks
    // like it honours the request and quietly does not.
    expect(reader.requests[0]?.chunk_size).toBe(MAX_EVENT_CHUNK_SIZE)
  })

  it('filters on keys[0] only — one inner array, or it matches nothing', async () => {
    const reader = endlessReader()
    await readPoolEvents({
      fromBlock: 1,
      toBlock: 2,
      names: ['Deposit', 'NoteUsed'],
      maxPages: 1,
      getEvents: reader.read,
    })
    // `[[a, b]]` is "keys[0] is a OR b". `[[a],[b]]` would be "keys[0] is a AND keys[1] is b",
    // which for these events filters on a note id and returns nothing at all.
    expect(reader.requests[0]!.keys).toHaveLength(1)
    expect(reader.requests[0]!.keys[0]).toEqual([sel('Deposit'), sel('NoteUsed')])
  })

  it('a completed range reports complete with no resume token', async () => {
    const page = await readPoolEvents({
      fromBlock: 1,
      toBlock: 2,
      getEvents: async () => ({
        events: [{ block_number: 1, keys: [sel('NoteUsed'), '0x1'], data: [], transaction_hash: '0xa' }],
      }),
    })
    expect(page.complete).toBe(true)
    expect(page.continuation).toBeNull()
    expect(page.pagesRead).toBe(1)
  })

  it('an inverted range is an empty COMPLETE page, and issues no request at all', async () => {
    let called = 0
    const page = await readPoolEvents({
      fromBlock: 500,
      toBlock: 100,
      getEvents: async () => {
        called += 1
        return { events: [] }
      },
    })
    expect(called).toBe(0)
    expect(page.events).toEqual([])
    expect(page.complete).toBe(true)
    expect(page.continuation).toBeNull()
  })

  it('resumes from a caller-supplied continuation token', async () => {
    const reader = endlessReader()
    await readPoolEvents({
      fromBlock: 1,
      toBlock: 2,
      maxPages: 1,
      continuation: { token: 'resume-here', host: NET.rpc[0]! },
      getEvents: reader.read,
    })
    expect(reader.requests[0]!.continuation_token).toBe('resume-here')
  })

  it('refuses to replay a cursor against a host that did not mint it', async () => {
    // The hazard the cursor type exists for: `withFallback` picks a host per attempt, and a
    // token from the other node is an opaque cursor into a different index — rejected at best,
    // silently a different page of history at worst. Every host refuses, so the call fails.
    const reader = endlessReader()
    await expect(
      readPoolEvents({
        fromBlock: 1,
        toBlock: 2,
        continuation: { token: 'from-elsewhere', host: 'https://not-a-host-we-use.example' },
        getEvents: reader.read,
      }),
    ).rejects.toThrow(/all RPC hosts failed/)
    // And no request was ever issued with the foreign token.
    expect(reader.requests).toHaveLength(0)
  })
})

describe('the bounds are validated before anything reaches the wire', () => {
  const never = async () => {
    throw new Error('a request was issued for an invalid call')
  }

  it('refuses a zero-length name list — an empty key filter matches EVERYTHING', async () => {
    // The most dangerous argument this function takes, and the most harmless-looking: `[[]]`
    // is starknet's match-anything wildcard at position 0, so asking for no event types would
    // return every event the pool has ever emitted.
    await expect(
      readPoolEvents({ fromBlock: 1, toBlock: 2, names: [], getEvents: never }),
    ).rejects.toThrow(/zero event types/)
  })

  it('refuses a non-integer or negative fromBlock', async () => {
    for (const fromBlock of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(
        readPoolEvents({ fromBlock, toBlock: 10, getEvents: never }),
        String(fromBlock),
      ).rejects.toThrow(/fromBlock must be a whole block height/)
    }
  })

  it('refuses a non-integer or negative toBlock', async () => {
    await expect(readPoolEvents({ fromBlock: 1, toBlock: -5, getEvents: never })).rejects.toThrow(
      /toBlock must be a whole block height/,
    )
    await expect(readPoolEvents({ fromBlock: 1, toBlock: 2.5, getEvents: never })).rejects.toThrow(
      /toBlock must be a whole block height/,
    )
  })

  it('refuses a chunkSize or maxPages below one', async () => {
    // A zero chunk asks for nothing forever; a zero page cap makes the do/while run once
    // anyway, which is a cap that silently does not cap.
    for (const chunkSize of [0, -1, 1.5]) {
      await expect(
        readPoolEvents({ fromBlock: 1, toBlock: 2, chunkSize, getEvents: never }),
        String(chunkSize),
      ).rejects.toThrow(/chunkSize must be at least 1/)
    }
    for (const maxPages of [0, -1, 2.5]) {
      await expect(
        readPoolEvents({ fromBlock: 1, toBlock: 2, maxPages, getEvents: never }),
        String(maxPages),
      ).rejects.toThrow(/maxPages must be at least 1/)
    }
  })
})
