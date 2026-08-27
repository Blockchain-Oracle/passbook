import { describe, it, expect } from 'vitest'

import { inMemorySessionStore, SESSION_KEYS } from '../src/session-store.js'
import {
  POSITION_RECORD_VERSION,
  parseStoredPositions,
  serializePositions,
  sessionPositionStore,
  type StoredPosition,
} from '../src/session-position-store.js'
import { mintPositionSecret } from '../src/commitment.js'

//
// This store holds MONEY, not a record of money. A position is bearer — the contracts pay whoever
// reveals the secret, with no address on it and no recovery — so the failure modes here are not
// "the list looks wrong", they are "the bet cannot be collected". The tests are written against
// that standard.
//

const position = (over: Partial<StoredPosition> = {}): StoredPosition => ({
  venue: 'market',
  id: 0,
  secret: '0x2a',
  commitment: '0x689991b0e36441c881b859cf67f4eba29d68fc172bb6be80ae1be6956bcf21f',
  createdAt: 1_700_000_000_000,
  ...over,
})

describe('round-tripping', () => {
  it('reads back exactly what was written', () => {
    const store = sessionPositionStore(inMemorySessionStore())
    const p = position({ label: 'UP at $77,490' })
    store.add(p)
    expect(store.read()).toEqual({ state: 'ok', positions: [p] })
  })

  it('survives a reload, which is the whole reason it is persisted', () => {
    const session = inMemorySessionStore()
    sessionPositionStore(session).add(position())
    // A second store over the same session storage is what a page reload looks like from here.
    expect(sessionPositionStore(session).list()).toHaveLength(1)
  })

  it('stores a freshly minted secret with its own commitment', () => {
    const store = sessionPositionStore(inMemorySessionStore())
    const { secret, commitment } = mintPositionSecret()
    store.add(position({ secret, commitment }))
    const [stored] = store.list()
    expect(stored?.secret).toBe(secret)
    expect(stored?.commitment).toBe(commitment)
  })
})

describe('an empty store is not a corrupt one', () => {
  it('reads empty before anything is stored', () => {
    expect(sessionPositionStore(inMemorySessionStore()).read()).toEqual({ state: 'empty' })
  })

  it('reads empty for a record whose array is empty', () => {
    expect(parseStoredPositions(serializePositions([]))).toEqual({ state: 'empty' })
  })
})

//
// THE DISTINCTION THAT MATTERS MOST HERE.
//
// Returning `[]` for a corrupt record would render "you have no bets" — which reads exactly like
// the truth, so a user believes it and stops looking for the backup that would have recovered
// them. Corruption gets its own state so the surface can say something is wrong.
//
describe('corruption is never rendered as emptiness', () => {
  it('says so when the record is not JSON', () => {
    const read = parseStoredPositions('{not json')
    expect(read.state).toBe('corrupt')
  })

  it('says so when the version is one this app does not write', () => {
    const read = parseStoredPositions(JSON.stringify({ version: 99, positions: [] }))
    expect(read).toMatchObject({ state: 'corrupt', because: expect.stringContaining('version 99') })
  })

  it('says so when every entry is malformed', () => {
    const raw = JSON.stringify({ version: POSITION_RECORD_VERSION, positions: [{ nonsense: true }] })
    expect(parseStoredPositions(raw)).toMatchObject({ state: 'corrupt' })
  })

  // One bad entry must not discard the good ones. Each position is independent bearer material,
  // so throwing four claimable positions away to avoid a branch would be destroying money.
  it('keeps the claimable positions when one entry beside them is malformed', () => {
    const good = position()
    const raw = JSON.stringify({
      version: POSITION_RECORD_VERSION,
      positions: [good, { venue: 'market', id: 'not a number' }],
    })
    expect(parseStoredPositions(raw)).toEqual({ state: 'ok', positions: [good] })
  })

  it('refuses a secret that is not a felt, which could never claim anything', () => {
    const raw = JSON.stringify({
      version: POSITION_RECORD_VERSION,
      positions: [position({ secret: 'hello' })],
    })
    expect(parseStoredPositions(raw)).toMatchObject({ state: 'corrupt' })
  })
})

describe('adding and removing', () => {
  // The contracts refuse a reused commitment outright, so two records sharing one means one of
  // them names a position that does not exist — and nothing here can tell which.
  it('refuses a commitment that is already stored', () => {
    const store = sessionPositionStore(inMemorySessionStore())
    store.add(position())
    expect(() => store.add(position({ id: 5 }))).toThrow(/already stored/)
  })

  it('compares commitments as numbers, so padding cannot smuggle a duplicate in', () => {
    const store = sessionPositionStore(inMemorySessionStore())
    store.add(position({ commitment: '0x2a' }))
    expect(() => store.add(position({ commitment: '0x02a' }))).toThrow(/already stored/)
  })

  it('refuses a record that is not a well-formed bearer position', () => {
    const store = sessionPositionStore(inMemorySessionStore())
    expect(() => store.add({ ...position(), secret: 'not a felt' })).toThrow(/well-formed/)
  })

  it('removes by commitment once a position has been claimed', () => {
    const store = sessionPositionStore(inMemorySessionStore())
    store.add(position({ commitment: '0x1' }))
    store.add(position({ commitment: '0x2', secret: '0x3' }))
    store.remove('0x1')
    expect(store.list().map((p) => p.commitment)).toEqual(['0x2'])
  })

  it('holds market and launch positions side by side', () => {
    const store = sessionPositionStore(inMemorySessionStore())
    store.add(position({ venue: 'market', commitment: '0x1' }))
    store.add(position({ venue: 'launch', commitment: '0x2', secret: '0x3' }))
    expect(store.list().map((p) => p.venue)).toEqual(['market', 'launch'])
  })
})

//
// A backup that needs this app to interpret it is a backup that dies with the app. The payload is
// a plain, self-describing object for exactly that reason.
//
describe('the backup surface', () => {
  it('hands out every position as plain data', () => {
    const store = sessionPositionStore(inMemorySessionStore())
    store.add(position())
    const payload = store.backupPayload()
    expect(payload).toEqual({ version: POSITION_RECORD_VERSION, positions: [position()] })
    expect(() => JSON.stringify(payload)).not.toThrow()
  })

  it('carries the secret, because a backup without it recovers nothing', () => {
    const store = sessionPositionStore(inMemorySessionStore())
    const { secret, commitment } = mintPositionSecret()
    store.add(position({ secret, commitment }))
    expect(store.backupPayload().positions[0]?.secret).toBe(secret)
  })
})

describe('the session key', () => {
  it('is the namespaced one the closed union declares', () => {
    expect(SESSION_KEYS.positionSecrets).toBe('passbook.position-secrets')
  })

  it('is what the store actually writes under', () => {
    const session = inMemorySessionStore()
    sessionPositionStore(session).add(position())
    expect(session.read(SESSION_KEYS.positionSecrets)).not.toBeNull()
  })
})
