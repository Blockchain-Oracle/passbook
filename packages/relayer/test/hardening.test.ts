import { describe, it, expect } from 'vitest'
import {
  decideSponsorship, commitSponsorship, emptyBudget, rolledToDay, utcDayKey,
  SponsorshipLedger, BUDGET_EXHAUSTED_NOTICE,
} from '../src/sponsorship.js'
import {
  classifyAllowance, allowanceFloor, userFacingState, shouldPageOps,
} from '../src/allowance-monitor.js'
import {
  buildUpstreamRequest, scrubClientHeaders, isIdentityLeakingHeader, UnknownProxyTarget,
} from '../src/quote-proxy.js'

const T0 = Date.UTC(2026, 7, 23, 12, 0, 0)          // 2026-08-23 12:00 UTC
const NEXT_DAY = Date.UTC(2026, 7, 24, 0, 30, 0)    // 2026-08-24 00:30 UTC
const CAPS = { perVisitor: 1, daily: 3 }

describe('sponsorship budget (FR-053, story 1.5)', () => {
  it('allows a fresh visitor and records exactly one', () => {
    let s = emptyBudget(T0)
    expect(decideSponsorship(s, CAPS, 'alice', T0).allow).toBe(true)
    s = commitSponsorship(s, 'alice', T0)
    const d = decideSponsorship(s, CAPS, 'alice', T0)
    expect(d.allow).toBe(false)
    expect(d.allow === false && d.reason).toBe('visitor-cap')
  })

  it('fails into pay-your-own-way with the exact notice when the daily budget is spent', () => {
    let s = emptyBudget(T0)
    s = commitSponsorship(s, 'a', T0)
    s = commitSponsorship(s, 'b', T0)
    s = commitSponsorship(s, 'c', T0)   // daily cap = 3 reached
    const d = decideSponsorship(s, CAPS, 'd', T0)
    expect(d.allow).toBe(false)
    expect(d.allow === false && d.reason).toBe('daily-budget')
    expect(d.allow === false && d.notice).toBe(BUDGET_EXHAUSTED_NOTICE)
    expect(BUDGET_EXHAUSTED_NOTICE).toMatch(/00:00 UTC.*funded Starknet wallet/s)
  })

  it('resets at the UTC day boundary', () => {
    let s = emptyBudget(T0)
    s = commitSponsorship(s, 'a', T0)
    s = commitSponsorship(s, 'b', T0)
    s = commitSponsorship(s, 'c', T0)   // exhausted for T0
    expect(decideSponsorship(s, CAPS, 'a', T0).allow).toBe(false)
    // next UTC day: fresh budget, alice allowed again
    expect(decideSponsorship(s, CAPS, 'a', NEXT_DAY).allow).toBe(true)
    expect(utcDayKey(T0)).toBe('2026-08-23')
    expect(rolledToDay(s, NEXT_DAY).dailyCount).toBe(0)
  })

  it('ledger burns an invite code exactly once (atomic single-claim)', () => {
    const ledger = new SponsorshipLedger(CAPS, T0)
    expect(ledger.tryClaim('7f3a2b')).toBe(true)
    expect(ledger.tryClaim('7f3a2b')).toBe(false)   // second claim of same code denied
    expect(ledger.tryClaim('other')).toBe(true)
  })

  it('ledger.spend enforces the caps through the stateful path', () => {
    const ledger = new SponsorshipLedger({ perVisitor: 2, daily: 5 }, T0)
    expect(ledger.spend('x', T0).allow).toBe(true)
    expect(ledger.spend('x', T0).allow).toBe(true)
    expect(ledger.spend('x', T0).allow).toBe(false)   // per-visitor cap 2
  })
})

describe('allowance-floor monitor (FR-053, story 1.5)', () => {
  const fee = 10n ** 18n * 6n            // ~6 STRK live fee
  const floor = allowanceFloor(fee)      // 10× default

  it('classifies healthy / low / exhausted against the floor', () => {
    expect(classifyAllowance(floor * 3n, floor)).toBe('healthy')
    expect(classifyAllowance((floor * 3n) / 2n, floor)).toBe('low')    // < 2× floor
    expect(classifyAllowance(floor - 1n, floor)).toBe('exhausted')
  })

  it('the user never sees a distinct "allowance" string — exhausted degrades to relayer-down', () => {
    expect(userFacingState('exhausted')).toBe('relayer-down')
    expect(userFacingState('low')).toBe('ok')
    expect(userFacingState('healthy')).toBe('ok')
  })

  it('pages ops on low (pre-emptive) and exhausted, not on healthy', () => {
    expect(shouldPageOps('low')).toBe(true)
    expect(shouldPageOps('exhausted')).toBe(true)
    expect(shouldPageOps('healthy')).toBe(false)
  })
})

describe('third-party proxy (FR-029 / AD-7, story 1.5)', () => {
  it('builds an AVNU quote request to the allowlisted host, no client identity', () => {
    const { url, headers } = buildUpstreamRequest('avnuQuotes', '/swap/v3/quotes', { sellTokenAddress: '0xabc' })
    expect(url).toBe('https://starknet.api.avnu.fi/swap/v3/quotes?sellTokenAddress=0xabc')
    expect(headers).not.toHaveProperty('x-forwarded-for')
    expect(headers).not.toHaveProperty('cookie')
  })

  it('rejects an unknown upstream (SSRF guard)', () => {
    // @ts-expect-error deliberately off-allowlist
    expect(() => buildUpstreamRequest('evil', '/x')).toThrow(UnknownProxyTarget)
  })

  it('scrubs every identity-leaking header before forwarding', () => {
    expect(isIdentityLeakingHeader('X-Forwarded-For')).toBe(true)
    expect(isIdentityLeakingHeader('Cookie')).toBe(true)
    expect(isIdentityLeakingHeader('accept')).toBe(false)
    const scrubbed = scrubClientHeaders({
      cookie: 'sid=1', 'x-forwarded-for': '1.2.3.4', 'user-agent': 'x', accept: 'application/json',
    })
    expect(scrubbed).toEqual({ accept: 'application/json' })
  })
})
