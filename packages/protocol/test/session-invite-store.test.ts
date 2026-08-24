import { describe, it, expect, vi } from 'vitest'
import {
  INVITE_INTENTS_RECORD_VERSION,
  parseStoredInviteIntents,
  revokeInviteIntent,
  serializeInviteIntents,
  sessionInviteIntentStore,
  withInviteIntent,
  withInviteIntentState,
  type InviteIntent,
} from '../src/session-invite-store.js'
import { inMemorySessionStore, refusingSessionStore, SESSION_KEYS } from '../src/session-store.js'

const T0 = Date.UTC(2026, 7, 24, 12, 0, 0)

const INTENT: InviteIntent = {
  code: '7f3a2b',
  state: 'not-opened',
  createdAt: T0,
  updatedAt: T0,
  expiresAt: T0 + 72 * 3_600_000,
  recipient: '0xmia',
  token: '0xusdc',
  amountWei: '25000000',
}

/** An intent with no money attached — the plain Door B case. */
const BARE: InviteIntent = { ...INTENT, code: 'aa11bb', recipient: null, token: null, amountWei: null }

describe('the fourth session key', () => {
  it('is a namespaced key that the closed union accepts', () => {
    expect(SESSION_KEYS.inviteIntents).toBe('passbook.invite-intents')
    expect(Object.keys(SESSION_KEYS)).toHaveLength(4)
    // Every key is namespaced, so an origin shared with something else stays disentangled.
    for (const key of Object.values(SESSION_KEYS)) expect(key).toMatch(/^passbook\./)
  })
})

describe('the record round trip', () => {
  it('writes a versioned record and reads it back exactly', () => {
    const raw = serializeInviteIntents([INTENT, BARE])
    expect(JSON.parse(raw).v).toBe(INVITE_INTENTS_RECORD_VERSION)
    expect(parseStoredInviteIntents(raw)).toEqual({ kind: 'present', intents: [INTENT, BARE] })
  })

  it('keeps a wei amount EXACT past 2^53, which a number would not', () => {
    const big = { ...INTENT, amountWei: '123456789012345678901234567890' }
    const back = parseStoredInviteIntents(serializeInviteIntents([big]))
    expect(back.kind === 'present' && back.intents[0]!.amountWei).toBe('123456789012345678901234567890')
  })

  it('reports absent for a key that was never written', () => {
    expect(parseStoredInviteIntents(null)).toEqual({ kind: 'absent' })
    expect(parseStoredInviteIntents('')).toEqual({ kind: 'absent' })
  })

  it('reports unreadable WITH A REASON rather than repairing into an empty list', () => {
    // A repair here is a silent take-back: it looks identical to a sender who never invited.
    const cases: [string, string][] = [
      ['{ not json', 'not JSON'],
      ['null', 'null'],
      ['[]', 'object'],
      [JSON.stringify({ v: 99, intents: [] }), 'version 99'],
      [JSON.stringify({ v: 1, intents: 'lots' }), 'intents list'],
      [JSON.stringify({ v: 1, intents: [{ ...INTENT, state: 'invented' }] }), 'state of invented'],
      [JSON.stringify({ v: 1, intents: [{ ...INTENT, code: '' }] }), 'no code'],
      [JSON.stringify({ v: 1, intents: [{ ...INTENT, createdAt: null }] }), 'createdAt of null'],
      [JSON.stringify({ v: 1, intents: [{ ...INTENT, amountWei: 'lots' }] }), 'amountWei of lots'],
      [JSON.stringify({ v: 1, intents: [{ ...INTENT, amountWei: '1.5' }] }), 'amountWei of 1.5'],
      [JSON.stringify({ v: 1, intents: [{ ...INTENT, token: null }] }), 'amount with no token'],
      [JSON.stringify({ v: 1, intents: [{ ...INTENT, amountWei: null }] }), 'token with no amount'],
    ]
    for (const [raw, why] of cases) {
      const r = parseStoredInviteIntents(raw)
      expect(r.kind, raw).toBe('unreadable')
      expect(r.kind === 'unreadable' && r.reason, raw).toContain(why)
    }
  })

  it('fails the WHOLE list on one bad entry rather than dropping it silently', () => {
    const raw = JSON.stringify({ v: 1, intents: [INTENT, { ...BARE, state: 'invented' }] })
    expect(parseStoredInviteIntents(raw).kind).toBe('unreadable')
  })

  it('refuses on the way OUT to write what JSON would launder into a valid record', () => {
    // `JSON.stringify` turns NaN and Infinity into `null` without complaint, so a timestamp
    // that went wrong in memory would be written as a perfectly readable record. The read side
    // cannot catch it, because by then there is nothing wrong to catch.
    expect(() => serializeInviteIntents([{ ...INTENT, updatedAt: NaN }])).toThrow(/updatedAt of NaN/)
    expect(() => serializeInviteIntents([{ ...INTENT, createdAt: Infinity }])).toThrow(/createdAt of Infinity/)
    expect(() => serializeInviteIntents([{ ...INTENT, state: 'invented' as never }])).toThrow(/state of invented/)
    expect(() => serializeInviteIntents([INTENT, INTENT])).toThrow(/two invite intents for code/)
  })
})

describe('the store over a SessionStore', () => {
  it('round-trips through the session tier', () => {
    const session = inMemorySessionStore()
    const store = sessionInviteIntentStore(session)
    expect(store.load()).toEqual({ kind: 'absent' })
    store.save([INTENT])
    expect(store.load()).toEqual({ kind: 'present', intents: [INTENT] })
    // It went in under the fourth key and nowhere else.
    expect(session.read(SESSION_KEYS.inviteIntents)).toBeTruthy()
  })

  it('load NEVER throws, even when the underlying store refuses', () => {
    const store = sessionInviteIntentStore(refusingSessionStore('storage is blocked'))
    const r = store.load()
    expect(r.kind).toBe('unreadable')
    expect(r.kind === 'unreadable' && r.reason).toContain('storage is blocked')
  })

  it('save DOES throw, so a caller cannot believe a write happened when it did not', () => {
    const store = sessionInviteIntentStore(refusingSessionStore('storage is blocked'))
    expect(() => store.save([INTENT])).toThrow(/storage is blocked/)
  })
})

describe('the ladder', () => {
  it('adds an intent and replaces one already recorded under the same code', () => {
    expect(withInviteIntent([], INTENT)).toEqual([INTENT])
    const replaced = withInviteIntent([INTENT, BARE], { ...INTENT, recipient: '0xother' })
    expect(replaced).toHaveLength(2)
    expect(replaced.find((i) => i.code === INTENT.code)!.recipient).toBe('0xother')
  })

  it('moves one intent along the ladder and stamps it, leaving the others alone', () => {
    const next = withInviteIntentState([INTENT, BARE], INTENT.code, 'ready-to-settle', T0 + 5)
    expect(next[0]).toMatchObject({ state: 'ready-to-settle', updatedAt: T0 + 5 })
    expect(next[1]).toEqual(BARE)
  })
})

describe('take-back', () => {
  it('marks the intent revoked and persists it', () => {
    const store = sessionInviteIntentStore(inMemorySessionStore())
    store.save([INTENT, BARE])
    expect(revokeInviteIntent(store, INTENT.code, T0 + 10).kind).toBe('revoked')
    const after = store.load()
    expect(after.kind === 'present' && after.intents[0]).toMatchObject({ state: 'revoked', updatedAt: T0 + 10 })
    // MARKED, NOT DELETED: a sender who takes an invite back should see that they did.
    expect(after.kind === 'present' && after.intents).toHaveLength(2)
  })

  it('REFUSES to take back a settled intent — that money has actually moved', () => {
    // The one case where "taken back. Nothing had moved." would be a lie about somebody's money.
    const store = sessionInviteIntentStore(inMemorySessionStore())
    store.save([{ ...INTENT, state: 'settled' }])
    const r = revokeInviteIntent(store, INTENT.code, T0)
    expect(r.kind).toBe('not-revocable')
    expect(r.kind === 'not-revocable' && r.state).toBe('settled')
    expect(r.kind === 'not-revocable' && r.reason).toMatch(/already settled/)
    // And the stored state is untouched.
    const after = store.load()
    expect(after.kind === 'present' && after.intents[0]!.state).toBe('settled')
  })

  it('declines an already-expired or already-revoked intent without re-stamping it', () => {
    for (const state of ['expired', 'revoked'] as const) {
      const store = sessionInviteIntentStore(inMemorySessionStore())
      store.save([{ ...INTENT, state, updatedAt: T0 }])
      const r = revokeInviteIntent(store, INTENT.code, T0 + 999)
      expect(r.kind, state).toBe('not-revocable')
      const after = store.load()
      expect(after.kind === 'present' && after.intents[0]!.updatedAt, state).toBe(T0)
    }
  })

  it('takes back from every live rung of the ladder', () => {
    for (const state of ['not-opened', 'opened-not-registered', 'ready-to-settle'] as const) {
      const store = sessionInviteIntentStore(inMemorySessionStore())
      store.save([{ ...INTENT, state }])
      expect(revokeInviteIntent(store, INTENT.code, T0).kind, state).toBe('revoked')
    }
  })

  it('is genuinely free: zero network calls, because nothing ever moved', () => {
    // Asserted at the strongest level available — the global fetch is replaced with a spy that
    // fails the test if anything reaches for it. The real guarantee is structural: this
    // function takes a store and has no seam a request could go through.
    const fetchSpy = vi.fn()
    const original = globalThis.fetch
    globalThis.fetch = fetchSpy as unknown as typeof fetch
    try {
      const store = sessionInviteIntentStore(inMemorySessionStore())
      store.save([INTENT])
      revokeInviteIntent(store, INTENT.code, T0)
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      globalThis.fetch = original
    }
  })

  it('distinguishes "no such intent" from "nothing stored at all"', () => {
    const store = sessionInviteIntentStore(inMemorySessionStore())
    store.save([INTENT])
    expect(revokeInviteIntent(store, 'zzzzzz', T0).kind).toBe('no-such-intent')
    const empty = sessionInviteIntentStore(inMemorySessionStore())
    expect(revokeInviteIntent(empty, INTENT.code, T0).kind).toBe('no-such-intent')
  })

  it('reports unreadable as ITS OWN answer, never as "nothing to take back"', () => {
    // The distinction a sender's money depends on. Collapsing them tells somebody whose storage
    // went wrong that their attached amount was never recorded, and they stop expecting to owe
    // it. The stored bytes are also left exactly as they were — a repair here would destroy
    // precisely the record that could not be read.
    const session = inMemorySessionStore({ [SESSION_KEYS.inviteIntents]: '{ not json' })
    const store = sessionInviteIntentStore(session)
    const r = revokeInviteIntent(store, INTENT.code, T0)
    expect(r.kind).toBe('unreadable')
    expect(r.kind === 'unreadable' && r.reason).toMatch(/not JSON/)
    expect(session.read(SESSION_KEYS.inviteIntents)).toBe('{ not json')
  })
})
