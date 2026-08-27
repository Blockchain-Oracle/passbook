//
// More than one account in one browser (Wave 1).
//
// The two properties worth testing here are the ones whose failure is SILENT: a record that does
// not read back (the switch list simply vanishes on the next boot, and the write reported success)
// and an address compared by spelling rather than by value (a duplicate import, or a switch to an
// account that is already active, with nothing on screen to say so).
//
import { describe, it, expect } from 'vitest'

import {
  ACCOUNTS_RECORD_VERSION,
  activeAccount,
  findAccount,
  parseStoredAccounts,
  sameAddress,
  seedFrom,
  serializeAccounts,
  sessionAccountStore,
  withAccount,
  withActive,
  withLabel,
  withLocked,
  type StoredAccount,
  type StoredAccounts,
} from '../src/session-accounts.js'
import { inMemorySessionStore, SESSION_KEYS } from '../src/session-store.js'

// Two real Stark private keys — `isStarkPrivateKey` checks shape AND curve order, so a made-up
// hex string is rejected by the parser and every case below would pass for the wrong reason.
const KEY_A = '0x1c9053c053edf324aec366a34c6901b1095b07af69495bffec7d7fe21effb1b'
const KEY_B = '0x2b191c3b8a2fbd2ad33d0c86ca86b12f38d2ca88a30d5b8f45d3f0c9b8a0e11'

const ADDR_A = '0x043c2f4e0e29e9a1f6d1b5b5e3f2c1a09876543210fedcba9876543210fedcba'
const ADDR_B = '0x0512aaaa1111bbbb2222cccc3333dddd4444eeee5555ffff6666777788889999'

const account = (over: Partial<StoredAccount> = {}): StoredAccount => ({
  address: ADDR_A,
  accountKey: KEY_A,
  label: null,
  addedAt: 1_700_000_000_000,
  ...over,
})

describe('addresses are compared by value, not by spelling', () => {
  it('a padded felt and an unpadded one are the same address', () => {
    expect(sameAddress('0x0043c2', '0x43c2')).toBe(true)
    expect(sameAddress('0x43C2', '0x43c2')).toBe(true)
    expect(sameAddress('0x43c2', '0x43c3')).toBe(false)
  })

  it('two values that are not felts fall back to exact text rather than claiming a match', () => {
    // Fail closed: a comparison that cannot be made must not adopt one record into another.
    expect(sameAddress('not-a-felt', 'also-not')).toBe(false)
    expect(sameAddress('not-a-felt', 'not-a-felt')).toBe(true)
  })

  it('lookup finds an account written in a different spelling', () => {
    const record = seedFrom(KEY_A, ADDR_A, 1)
    expect(findAccount(record, ADDR_A.replace('0x0', '0x'))?.accountKey).toBe(KEY_A)
    expect(findAccount(record, ADDR_B)).toBeUndefined()
  })
})

describe('the record round-trips, and refuses to write one that would not', () => {
  it('a seeded record survives serialize → parse unchanged', () => {
    const record = seedFrom(KEY_A, ADDR_A, 1_700_000_000_000)
    const read = parseStoredAccounts(serializeAccounts(record))
    expect(read.kind).toBe('present')
    if (read.kind !== 'present') return
    expect(read.record).toEqual(record)
    expect(JSON.parse(serializeAccounts(record)).v).toBe(ACCOUNTS_RECORD_VERSION)
  })

  it('refuses to write a record whose active address is not in its own list', () => {
    const broken: StoredAccounts = { active: ADDR_B, locked: false, accounts: [account()] }
    // The refusal happens at WRITE time. Without it the record lands in storage, reads back as
    // unreadable on the next boot, and the whole switch list is gone with no error anywhere.
    expect(() => serializeAccounts(broken)).toThrow(/would not read back/)
  })

  it('refuses to write two entries for one address', () => {
    const doubled: StoredAccounts = {
      active: ADDR_A,
      locked: false,
      accounts: [account(), account({ accountKey: KEY_B })],
    }
    expect(() => serializeAccounts(doubled)).toThrow(/would not read back/)
  })
})

describe('parsing is total, and absent is never confused with unreadable', () => {
  it('nothing stored is absent', () => {
    expect(parseStoredAccounts(null)).toEqual({ kind: 'absent' })
    expect(parseStoredAccounts('')).toEqual({ kind: 'absent' })
  })

  it.each([
    ['not JSON', '{'],
    ['an array', '[]'],
    ['the wrong version', JSON.stringify({ v: 99, active: ADDR_A, locked: false, accounts: [account()] })],
    ['no active address', JSON.stringify({ v: 1, locked: false, accounts: [account()] })],
    ['a non-boolean lock', JSON.stringify({ v: 1, active: ADDR_A, locked: 'yes', accounts: [account()] })],
    ['an empty list', JSON.stringify({ v: 1, active: ADDR_A, locked: false, accounts: [] })],
    [
      'a key that is not a key',
      JSON.stringify({ v: 1, active: ADDR_A, locked: false, accounts: [{ ...account(), accountKey: '0xnope' }] }),
    ],
    [
      'an active address nothing matches',
      JSON.stringify({ v: 1, active: ADDR_B, locked: false, accounts: [account()] }),
    ],
  ])('%s reads as unreadable, with a reason', (_name, raw) => {
    const read = parseStoredAccounts(raw)
    expect(read.kind).toBe('unreadable')
    if (read.kind === 'unreadable') expect(read.reason.length).toBeGreaterThan(0)
  })

  it('drops anything the record did not declare, rather than passing it through', () => {
    const raw = JSON.stringify({
      v: 1,
      active: ADDR_A,
      locked: false,
      accounts: [{ ...account(), recoveryCode: 'ABCDEF-123456-ABCDEF-123456' }],
    })
    const read = parseStoredAccounts(raw)
    expect(read.kind).toBe('present')
    if (read.kind !== 'present') return
    // `loadCeremony`'s rule: a field somebody wrote by hand must not ride into a value this module
    // hands back as one it vouches for — least of all a recovery code.
    expect(Object.keys(read.record.accounts[0]!).sort()).toEqual([
      'accountKey',
      'addedAt',
      'address',
      'label',
    ])
  })
})

describe('adding, switching and locking', () => {
  it('adding an account makes it active and unlocks', () => {
    const one = withLocked(seedFrom(KEY_A, ADDR_A, 1), true)
    const two = withAccount(one, account({ address: ADDR_B, accountKey: KEY_B, addedAt: 2 }))
    expect(two.accounts).toHaveLength(2)
    expect(sameAddress(two.active, ADDR_B)).toBe(true)
    expect(two.locked).toBe(false)
  })

  it('re-adding an account already held replaces it rather than appending a twin', () => {
    const one = withLabel(seedFrom(KEY_A, ADDR_A, 1), ADDR_A, 'Everyday')
    // The same identity, re-imported from a recovery file, spelled without the leading zero.
    const again = withAccount(one, account({ address: ADDR_A.replace('0x0', '0x'), addedAt: 999 }))
    expect(again.accounts).toHaveLength(1)
    // The label the user typed survives a restore that carried none, and the original addedAt
    // stands — a re-import is not a new account.
    expect(again.accounts[0]!.label).toBe('Everyday')
    expect(again.accounts[0]!.addedAt).toBe(1)
  })

  it('switching to an address this browser does not hold changes nothing', () => {
    const one = seedFrom(KEY_A, ADDR_A, 1)
    expect(withActive(one, ADDR_B)).toBe(one)
    const two = withAccount(one, account({ address: ADDR_B, accountKey: KEY_B, addedAt: 2 }))
    expect(sameAddress(withActive(two, ADDR_A).active, ADDR_A)).toBe(true)
  })

  it('switching unlocks, and locking is a flag on the record', () => {
    const locked = withLocked(seedFrom(KEY_A, ADDR_A, 1), true)
    expect(locked.locked).toBe(true)
    expect(withActive(locked, ADDR_A).locked).toBe(false)
    expect(activeAccount(locked)?.accountKey).toBe(KEY_A)
  })

  it('a blank label clears rather than storing whitespace', () => {
    const named = withLabel(seedFrom(KEY_A, ADDR_A, 1), ADDR_A, '   ')
    expect(named.accounts[0]!.label).toBeNull()
    expect(withLabel(named, ADDR_A, '  Savings ').accounts[0]!.label).toBe('Savings')
  })
})

describe('the store mirrors the active key into the slot older builds read', () => {
  it('saving writes both the record and `passbook.account-key`', () => {
    const store = inMemorySessionStore()
    const accounts = sessionAccountStore(store)

    accounts.save(seedFrom(KEY_A, ADDR_A, 1))
    expect(store.read(SESSION_KEYS.accountKey)).toBe(KEY_A)

    accounts.save(withAccount(seedFrom(KEY_A, ADDR_A, 1), account({ address: ADDR_B, accountKey: KEY_B, addedAt: 2 })))
    // The mirror follows the ACTIVE account, which is what makes a build that never heard of this
    // record boot into the same identity the drawer is showing.
    expect(store.read(SESSION_KEYS.accountKey)).toBe(KEY_B)
  })

  it('a browser with only the old single-key slot reads as absent, so migration can seed it', () => {
    const store = inMemorySessionStore({ [SESSION_KEYS.accountKey]: KEY_A })
    expect(sessionAccountStore(store).load()).toEqual({ kind: 'absent' })
  })

  it('a failed mirror write puts the record back, so a caller never sees half a save', () => {
    // THE ORDERING THAT MAKES THIS REAL: the record write is the one that just grew storage, so a
    // quota failure landing on the SECOND write is the likely case, not the unlucky one. Without
    // the rollback the record commits the new active account, `save` throws, the caller reports
    // "could not switch", and the next reload opens the account the user was told it had not
    // switched to.
    const map = new Map<string, string>()
    let failNextMirrorWrite = false
    const flaky = {
      read: (key: string) => map.get(key) ?? null,
      write: (key: string, value: string) => {
        if (failNextMirrorWrite && key === SESSION_KEYS.accountKey) throw new Error('quota exceeded')
        map.set(key, value)
      },
      remove: (key: string) => void map.delete(key),
    } as unknown as Parameters<typeof sessionAccountStore>[0]

    const accounts = sessionAccountStore(flaky)
    accounts.save(seedFrom(KEY_A, ADDR_A, 1))
    const committed = map.get(SESSION_KEYS.accounts)

    failNextMirrorWrite = true
    expect(() =>
      accounts.save(withAccount(seedFrom(KEY_A, ADDR_A, 1), account({ address: ADDR_B, accountKey: KEY_B, addedAt: 2 }))),
    ).toThrow(/quota exceeded/)

    // Both keys are back where they were: the record still names A, and so does the mirror.
    expect(map.get(SESSION_KEYS.accounts)).toBe(committed)
    expect(map.get(SESSION_KEYS.accountKey)).toBe(KEY_A)
    const read = accounts.load()
    expect(read.kind).toBe('present')
    if (read.kind === 'present') expect(sameAddress(read.record.active, ADDR_A)).toBe(true)
  })

  it('a first save that fails on the mirror leaves NO record behind', () => {
    // The rollback has to remove rather than restore when there was nothing there before —
    // otherwise a failed first save leaves a record the boot would adopt.
    const map = new Map<string, string>()
    const flaky = {
      read: (key: string) => map.get(key) ?? null,
      write: (key: string, value: string) => {
        if (key === SESSION_KEYS.accountKey) throw new Error('quota exceeded')
        map.set(key, value)
      },
      remove: (key: string) => void map.delete(key),
    } as unknown as Parameters<typeof sessionAccountStore>[0]

    expect(() => sessionAccountStore(flaky).save(seedFrom(KEY_A, ADDR_A, 1))).toThrow()
    expect(map.has(SESSION_KEYS.accounts)).toBe(false)
  })

  it('refuses to save into a store it cannot read back, rather than writing blind', () => {
    // No read means no rollback, so the refusal happens BEFORE anything moves.
    const blind = {
      read: () => {
        throw new Error('blocked')
      },
      write: () => {
        throw new Error('should never be reached')
      },
      remove: () => undefined,
    } as unknown as Parameters<typeof sessionAccountStore>[0]

    expect(() => sessionAccountStore(blind).save(seedFrom(KEY_A, ADDR_A, 1))).toThrow(
      /cannot be read back/,
    )
  })

  it('a store that throws on read reports unreadable rather than absent', () => {
    const throwing = {
      read: () => {
        throw new Error('blocked')
      },
      write: () => undefined,
      remove: () => undefined,
    }
    const read = sessionAccountStore(throwing).load()
    expect(read.kind).toBe('unreadable')
    // The distinction that matters: "I could not look" must never be treated as "there is nothing
    // here", or the boot mints a second identity on top of one this browser already holds.
    expect(read).not.toEqual({ kind: 'absent' })
  })
})
