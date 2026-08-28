import { describe, it, expect, vi, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NET } from '../../protocol/src/constants.js'
import {
  decideSponsorship, commitSponsorship, emptyBudget, rolledToDay, utcDayKey,
  SponsorshipLedger, BUDGET_EXHAUSTED_NOTICE, SEND_CAP_NOTICE,
} from '../src/sponsorship.js'
import {
  FileSponsorshipStore, MemorySponsorshipStore, emptyLedger, isAcceptableSalt,
  type PersistedLedger, type SponsorshipStore,
} from '../src/sponsorship-store.js'
import {
  classifyFunding, fundingFloor, warningFloor, fundingThresholds, userFacingState, shouldPageOps,
  createFundingMonitor, RELAYER_DOWN_NOTICE, MAX_TIMER_MS,
  REFUSAL_FEE_MULTIPLE, WARNING_FEE_MULTIPLE,
} from '../src/funding-monitor.js'
import {
  buildUpstreamRequest, scrubClientHeaders, isIdentityLeakingHeader, UnknownProxyTarget,
  PROXY_EXCEPTIONS, PROXY_TARGETS,
} from '../src/quote-proxy.js'
import {
  createRelayerServer, resolveSponsorshipCaps, visitorId, createQuoteCounter,
  openSponsorshipLedger, openSendBudgetLedger, u256FromFelts, makeOpsPager,
  type RelayerServerOptions, type SubmitCalls, type SponsorshipConfig,
} from '../src/server.js'

const T0 = Date.UTC(2026, 7, 23, 12, 0, 0)          // 2026-08-23 12:00 UTC
const NEXT_DAY = Date.UTC(2026, 7, 24, 0, 30, 0)    // 2026-08-24 00:30 UTC
const CAPS = { perVisitor: 1, daily: 3 }
const A_SALT = 'a'.repeat(64)

const A_CALL = { contractAddress: NET.pool, entrypoint: 'apply_actions', calldata: [] }
const JSON_HEADERS = { 'content-type': 'application/json' }

// Temp ledgers, torn down whatever the assertions do.
const tempDirs: string[] = []
function tempStorePath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'passbook-ledger-'))
  tempDirs.push(dir)
  return join(dir, 'sponsorship.json')
}
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

/** A store that can be made to fail on demand, standing in for a full or unwritable disk. */
class BreakableStore implements SponsorshipStore {
  failing = false
  constructor(private readonly inner = new MemorySponsorshipStore()) {}
  load(): PersistedLedger {
    return this.inner.load()
  }
  save(next: PersistedLedger): void {
    if (this.failing) throw new Error('ENOSPC: no space left on device')
    this.inner.save(next)
  }
}

function config(over: Partial<SponsorshipConfig> = {}): SponsorshipConfig {
  return {
    caps: CAPS,
    storePath: tempStorePath(),
    sendCaps: CAPS,
    sendStorePath: tempStorePath(),
    // The drip's caps are present because the config type requires them; the ROUTE is still off
    // unless a `faucet` ledger is passed to `createRelayerServer`, which is the actual switch.
    faucetCaps: CAPS,
    faucetStorePath: tempStorePath(),
    opsWebhook: undefined,
    salt: undefined,
    fundingIntervalMs: 0,
    quoteDailyPerVisitor: 100,
    quoteDailyGlobal: 1_000,
    // Invites OFF by default here, matching the environment: the feature has a master switch
    // rather than a default (server.ts `resolveInviteConfig`), so a config nobody asked for
    // invites in must not quietly have them. `invite.test.ts` passes its own.
    invites: undefined,
    inviteStorePath: tempStorePath(),
    ...over,
  }
}

async function start(extra: Partial<RelayerServerOptions> = {}) {
  // A real relayer always has BOTH budgets — `createRelayerServer` refuses to start with only
  // the sponsorship one, because that would leave every plain submission unmetered. Tests that
  // are about the sponsorship gate should not have to say so, so the harness supplies a send
  // budget generous enough never to be the thing that bound. A test that cares about the send
  // cap passes its own and this default steps aside.
  const needsSendBudget = extra.sponsorship !== undefined && extra.sendBudget === undefined
  const server = createRelayerServer({
    submit: async () => '0xok',
    resolveApproveCeiling: async () => 0n,
    ...(needsSendBudget
      ? {
          sendBudget: new SponsorshipLedger(
            { perVisitor: 10_000, daily: 10_000 }, new MemorySponsorshipStore(), T0, SEND_CAP_NOTICE,
          ),
        }
      : {}),
    ...extra,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { port, close: () => new Promise<void>((r) => server.close(() => r())) }
}

function request(
  port: number,
  path: string,
  body: unknown,
  headers: Record<string, string> = JSON_HEADERS,
) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        // Parsed inside the try so a non-JSON response REJECTS this promise. Throwing from an
        // 'end' listener escapes as an unhandled exception instead, which surfaces as a timeout
        // or a crashed run rather than as the failing assertion it actually is.
        try {
          resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null })
        } catch (e) {
          reject(new Error(`expected JSON from ${path}, got ${JSON.stringify(data)}: ${String(e)}`))
        }
      })
    })
    req.on('error', reject)
    req.end(typeof body === 'string' ? body : JSON.stringify(body))
  })
}

/** The GET sibling of `request`, for the one endpoint that reads rather than submits. */
function get(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: any }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : null })
        } catch (e) {
          reject(new Error(`expected JSON from ${path}, got ${JSON.stringify(data)}: ${String(e)}`))
        }
      })
    })
    req.on('error', reject)
    req.end()
  })
}

describe('sponsorship budget (FR-053, story 1.5)', () => {
  it('allows a fresh visitor and records exactly one', () => {
    let s = emptyBudget(T0)
    expect(decideSponsorship(s, CAPS, 'alice', T0).allow).toBe(true)
    s = commitSponsorship(s, 'alice', T0)
    const d = decideSponsorship(s, CAPS, 'alice', T0)
    expect(d.allow).toBe(false)
    expect(d.allow === false && d.reason).toBe('visitor-cap')
  })

  // The notice ships byte-for-byte: it promises a specific reset time and a specific
  // alternative, and 1.12 renders it verbatim. Comparing it against the constant it came
  // from would assert nothing, so the literal is written out here in full — an edit to the
  // wording has to be made twice, deliberately, and shows up in the diff of a test.
  it('fails into pay-your-own-way with the exact notice when the daily budget is spent', () => {
    let s = emptyBudget(T0)
    s = commitSponsorship(s, 'a', T0)
    s = commitSponsorship(s, 'b', T0)
    s = commitSponsorship(s, 'c', T0)   // daily cap = 3 reached
    const d = decideSponsorship(s, CAPS, 'd', T0)
    expect(d.allow).toBe(false)
    expect(d.allow === false && d.reason).toBe('daily-budget')
    expect(d.allow === false && d.notice).toBe(
      'Sponsored registrations are paused until 00:00 UTC. ' +
        'You can still create an account from a funded Starknet wallet.',
    )
    expect(BUDGET_EXHAUSTED_NOTICE).toBe(
      'Sponsored registrations are paused until 00:00 UTC. ' +
        'You can still create an account from a funded Starknet wallet.',
    )
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
    const ledger = new SponsorshipLedger(CAPS, new MemorySponsorshipStore(), T0)
    expect(ledger.tryClaim('7f3a2b')).toBe(true)
    expect(ledger.tryClaim('7f3a2b')).toBe(false)   // second claim of same code denied
    expect(ledger.tryClaim('other')).toBe(true)
  })

  it('ledger.spend enforces the caps through the stateful path', () => {
    const ledger = new SponsorshipLedger({ perVisitor: 2, daily: 5 }, new MemorySponsorshipStore(), T0)
    expect(ledger.spend('x', T0).allow).toBe(true)
    expect(ledger.spend('x', T0).allow).toBe(true)
    expect(ledger.spend('x', T0).allow).toBe(false)   // per-visitor cap 2
  })
})

// The bug this story exists to close: before it, every restart handed the budget back out.
describe('durable sponsorship store (AC5, story 1.5)', () => {
  it('carries spent budget and burned codes across a restart', () => {
    const path = tempStorePath()
    const first = new SponsorshipLedger(CAPS, new FileSponsorshipStore(path), T0)
    expect(first.spend('visitor-1', T0).allow).toBe(true)
    expect(first.tryClaim('code-1')).toBe(true)

    // A whole new process would build a new store over the same file. This is that.
    const second = new SponsorshipLedger(CAPS, new FileSponsorshipStore(path), T0)
    expect(second.spend('visitor-1', T0).allow).toBe(false)   // cap survived the restart
    expect(second.tryClaim('code-1')).toBe(false)             // burn survived the restart
    expect(second.salt).toBe(first.salt)                      // and so did the id keying
  })

  it('creates the named store on first boot rather than failing or staying in memory', () => {
    const path = tempStorePath()
    const store = new FileSponsorshipStore(path)
    const loaded = store.load()
    expect(loaded.budget.dailyCount).toBe(0)
    // The file exists now, so a bad path fails at startup and not on the first submission.
    expect(JSON.parse(readFileSync(path, 'utf8')).salt).toBe(loaded.salt)
  })

  it('mints a salt long enough to not be guessed back into IPs', () => {
    expect(emptyLedger(T0).salt).toMatch(/^[0-9a-f]{64}$/)
  })

  it.each([
    ['unparseable', 'not json at all'],
    ['missing the salt', JSON.stringify({ budget: emptyBudget(T0), claimed: [] })],
    // Held to the same rule an operator-supplied salt is: a hand-edited one-character salt
    // would otherwise load in silence and key every visitor id from then on.
    ['carrying a one-character salt', JSON.stringify({
      salt: 'x', budget: emptyBudget(T0), claimed: [],
    })],
    ['carrying a salt that is not hex', JSON.stringify({
      salt: 'z'.repeat(64), budget: emptyBudget(T0), claimed: [],
    })],
    ['carrying a salt one character too short', JSON.stringify({
      salt: 'a'.repeat(31), budget: emptyBudget(T0), claimed: [],
    })],
    ['carrying a budget that is not one', JSON.stringify({
      salt: A_SALT, budget: {}, claimed: [],
    })],
    ['carrying a negative count', JSON.stringify({
      salt: A_SALT, budget: { ...emptyBudget(T0), dailyCount: -1 }, claimed: [],
    })],
    // An unchecked per-visitor value reaches decideSponsorship as `'lots' >= 1`, which is
    // false — a cap that silently stops binding, the exact failure this battery guards.
    ['carrying a non-numeric visitor count', JSON.stringify({
      salt: A_SALT, budget: { ...emptyBudget(T0), perVisitor: { someone: 'lots' } }, claimed: [],
    })],
    ['carrying a negative visitor count', JSON.stringify({
      salt: A_SALT, budget: { ...emptyBudget(T0), perVisitor: { someone: -3 } }, claimed: [],
    })],
    ['carrying a fractional visitor count', JSON.stringify({
      salt: A_SALT, budget: { ...emptyBudget(T0), perVisitor: { someone: 1.5 } }, claimed: [],
    })],
  ])('refuses to start on a store %s, rather than silently resetting the day', (_label, body) => {
    const path = tempStorePath()
    writeFileSync(path, body, 'utf8')
    expect(() => new FileSponsorshipStore(path).load()).toThrow(/unreadable/)
  })

  it('accepts the salt it mints itself, so the rule cannot lock out a fresh boot', () => {
    const path = tempStorePath()
    const minted = new FileSponsorshipStore(path).load().salt
    expect(isAcceptableSalt(minted)).toBe(true)
    expect(new FileSponsorshipStore(path).load().salt).toBe(minted)
  })

  // The file holds the salt beside the hashes that salt keys, so read access to it is read
  // access to the addresses. Default permissions would make it world-readable on a shared host.
  it('writes the ledger owner-only', () => {
    const path = tempStorePath()
    new SponsorshipLedger(CAPS, new FileSponsorshipStore(path), T0).spend('v', T0)
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it('replaces the file atomically, leaving no half-written ledger behind', () => {
    const path = tempStorePath()
    const ledger = new SponsorshipLedger(CAPS, new FileSponsorshipStore(path), T0)
    ledger.spend('v', T0)
    // The rename target is the only artefact; the temp file must not survive the write.
    expect(() => readFileSync(`${path}.tmp`, 'utf8')).toThrow()
    expect(JSON.parse(readFileSync(path, 'utf8')).budget.dailyCount).toBe(1)
  })

  // Mutating memory first and persisting second means a failed write leaves the spend
  // counted here and absent from disk — right until a restart resurrects the budget, which
  // is the very bug durability was added to fix, arriving silently and later.
  it('does not count a spend that could not be written', () => {
    const store = new BreakableStore()
    const ledger = new SponsorshipLedger({ perVisitor: 5, daily: 5 }, store, T0)
    expect(ledger.spend('v', T0).allow).toBe(true)

    store.failing = true
    expect(() => ledger.spend('v', T0)).toThrow(/ENOSPC/)

    // Memory did not move: the visitor still has four left, matching what is on disk.
    store.failing = false
    expect(ledger.spend('v', T0).allow).toBe(true)
    expect(store.load().budget.dailyCount).toBe(2)
    expect(store.load().budget.perVisitor['v']).toBe(2)
  })

  it('does not burn a code that could not be written', () => {
    const store = new BreakableStore()
    const ledger = new SponsorshipLedger(CAPS, store, T0)
    store.failing = true
    expect(() => ledger.tryClaim('code-1')).toThrow(/ENOSPC/)
    // The burn never happened, so the code is still spendable once the disk comes back.
    store.failing = false
    expect(ledger.tryClaim('code-1')).toBe(true)
    expect(store.load().claimed).toEqual(['code-1'])
  })

  it('re-keys and persists when an operator salt replaces the minted one', () => {
    const storePath = tempStorePath()
    const minted = openSponsorshipLedger(config({ storePath })).salt
    const rotated = openSponsorshipLedger(config({ storePath, salt: A_SALT }))
    expect(rotated.salt).toBe(A_SALT)
    expect(rotated.salt).not.toBe(minted)
    // Persisted, so the next boot keys visitors the same way rather than re-rotating.
    expect(JSON.parse(readFileSync(storePath, 'utf8')).salt).toBe(A_SALT)
  })
})

describe('visitor identity (AC1, story 1.5)', () => {
  it('is opaque, and re-keys at the UTC day boundary so yesterday does not link to today', () => {
    const today = visitorId('203.0.113.9', A_SALT, T0)
    expect(today).not.toContain('203.0.113.9')
    expect(today).toBe(visitorId('203.0.113.9', A_SALT, T0 + 1000))     // stable within the day
    expect(today).not.toBe(visitorId('203.0.113.9', A_SALT, NEXT_DAY))  // and not across it
  })

  it('does not collide across IPs, and changes entirely when the salt is rotated', () => {
    expect(visitorId('203.0.113.9', A_SALT, T0)).not.toBe(visitorId('203.0.113.10', A_SALT, T0))
    expect(visitorId('203.0.113.9', A_SALT, T0)).not.toBe(visitorId('203.0.113.9', 'b'.repeat(64), T0))
  })

  // The separator has to hold for the values clientIp actually produces, which include
  // IPv6 literals (hex letters, colons) and the literal word `unknown`.
  it('keeps IPv6 and the unknown-address bucket distinct', () => {
    const ids = ['203.0.113.9', '2001:db8::1', '2001:db8::2', 'unknown'].map((ip) =>
      visitorId(ip, A_SALT, T0),
    )
    expect(new Set(ids).size).toBe(4)
  })
})

// Same failure shape the ??/|| bug had: a value the operator believes they set must never
// be quietly not in force.
describe('sponsorship config resolution', () => {
  it('defaults to caps small enough that a misconfigured deployment costs a demo', () => {
    const c = resolveSponsorshipCaps({})
    expect(c.caps).toEqual({ perVisitor: 1, daily: 20 })
    expect(c.storePath).toMatch(/sponsorship\.json$/)
    expect(c.opsWebhook).toBeUndefined()
    expect(c.salt).toBeUndefined()
    expect(c.fundingIntervalMs).toBe(300_000)
    expect(c.quoteDailyPerVisitor).toBe(100)
  })

  it.each([
    ['set but empty', { RELAYER_SPONSOR_DAILY: '' }],
    ['unset', {}],
  ])('treats a %s budget as unset, never as zero', (_label, env) => {
    expect(resolveSponsorshipCaps(env).caps.daily).toBe(20)
  })

  it('honours explicit caps, store path, webhook and salt', () => {
    const c = resolveSponsorshipCaps({
      RELAYER_SPONSOR_PER_VISITOR: '3',
      RELAYER_SPONSOR_DAILY: '99',
      RELAYER_SPONSOR_STORE: '/tmp/ledger.json',
      RELAYER_OPS_WEBHOOK: 'https://ops.example/hook',
      RELAYER_VISITOR_SALT: A_SALT,
      RELAYER_QUOTE_DAILY_PER_VISITOR: '7',
    })
    expect(c.caps).toEqual({ perVisitor: 3, daily: 99 })
    expect(c.storePath).toBe('/tmp/ledger.json')
    expect(c.opsWebhook).toBe('https://ops.example/hook')
    expect(c.salt).toBe(A_SALT)
    expect(c.quoteDailyPerVisitor).toBe(7)
  })

  describe('the send cap (story 1.16)', () => {
    it('defaults to 3 per visitor, 20 a day, on its own ledger file', () => {
      const c = resolveSponsorshipCaps({})
      expect(c.sendCaps).toEqual({ perVisitor: 3, daily: 20 })
      expect(c.sendStorePath).toMatch(/send-budget\.json$/)
      // A SEPARATE FILE: one ledger holding both would make a reset of either a reset of both.
      expect(c.sendStorePath).not.toBe(c.storePath)
    })

    it('honours explicit send caps and store path', () => {
      const c = resolveSponsorshipCaps({
        RELAYER_SEND_PER_VISITOR: '11',
        RELAYER_SEND_DAILY: '222',
        RELAYER_SEND_STORE: '/tmp/sends.json',
      })
      expect(c.sendCaps).toEqual({ perVisitor: 11, daily: 222 })
      expect(c.sendStorePath).toBe('/tmp/sends.json')
    })

    it('leaves the sponsorship budget alone when only the send cap is set', () => {
      const c = resolveSponsorshipCaps({ RELAYER_SEND_DAILY: '222' })
      expect(c.caps).toEqual({ perVisitor: 1, daily: 20 })
    })

    it.each(['lots', '0', '-5', '2.5', '1e3', '0x10', ' 5 '])(
      'refuses a send cap of %s rather than substituting the default',
      (v) => {
        expect(() => resolveSponsorshipCaps({ RELAYER_SEND_DAILY: v })).toThrow(/integer/)
        expect(() => resolveSponsorshipCaps({ RELAYER_SEND_PER_VISITOR: v })).toThrow(/integer/)
      },
    )

    it('treats a blank as unset, as every other setting does', () => {
      expect(resolveSponsorshipCaps({ RELAYER_SEND_DAILY: '' }).sendCaps.daily).toBe(20)
      expect(resolveSponsorshipCaps({ RELAYER_SEND_STORE: '' }).sendStorePath).toMatch(/send-budget\.json$/)
    })
  })

  // Number() reads '1e3' as 1000 and '0x10' as 16, so an operator could set one and get the
  // other. Only plain digits pass.
  it.each(['lots', '0', '-5', '2.5', '1e3', '0x10', ' 5 '])(
    'refuses %s rather than substituting the default',
    (v) => {
      expect(() => resolveSponsorshipCaps({ RELAYER_SPONSOR_DAILY: v })).toThrow(/integer/)
    },
  )

  // All digits, so the shape check passes — but the value that would take effect is not the
  // value written, because it rounds on the way through Number(). Operating on a number the
  // operator did not choose is the failure this whole resolver exists to prevent.
  it.each(['99999999999999999999', '9007199254740993'])(
    'refuses %s, which cannot be represented exactly',
    (v) => {
      expect(() => resolveSponsorshipCaps({ RELAYER_SPONSOR_DAILY: v }))
        .toThrow(/too large to represent exactly/)
    },
  )

  it('accepts the largest exactly-representable integer', () => {
    expect(resolveSponsorshipCaps({ RELAYER_SPONSOR_DAILY: '9007199254740991' }).caps.daily)
      .toBe(Number.MAX_SAFE_INTEGER)
  })

  describe('quote caps', () => {
    it('defaults to 100 per visitor and 1000 overall', () => {
      const c = resolveSponsorshipCaps({})
      expect(c.quoteDailyPerVisitor).toBe(100)
      expect(c.quoteDailyGlobal).toBe(1_000)
    })

    it('honours an explicit global cap', () => {
      expect(resolveSponsorshipCaps({ RELAYER_QUOTE_DAILY_GLOBAL: '25' }).quoteDailyGlobal).toBe(25)
    })

    it.each(['0', 'many', '1e4'])('refuses a global cap of %s', (v) => {
      expect(() => resolveSponsorshipCaps({ RELAYER_QUOTE_DAILY_GLOBAL: v })).toThrow(/integer/)
    })
  })

  describe('funding interval', () => {
    it('defaults to five minutes', () => {
      expect(resolveSponsorshipCaps({}).fundingIntervalMs).toBe(300_000)
    })

    it('honours an explicit interval', () => {
      expect(resolveSponsorshipCaps({ RELAYER_FUNDING_INTERVAL_MS: '60000' }).fundingIntervalMs)
        .toBe(60_000)
    })

    // Unlike the caps, 0 is a real setting here: keep the startup check, never poll.
    it('accepts 0 as "startup check only"', () => {
      expect(resolveSponsorshipCaps({ RELAYER_FUNDING_INTERVAL_MS: '0' }).fundingIntervalMs).toBe(0)
    })

    it.each(['often', '-1', '1e3', '5.5'])('refuses %s', (v) => {
      expect(() => resolveSponsorshipCaps({ RELAYER_FUNDING_INTERVAL_MS: v })).toThrow(/integer/)
    })

    // Refused at startup rather than at the timer, because Node would clamp it to ~1ms and the
    // first symptom would be an RPC provider's rate limit rather than an error naming the key.
    it('refuses an interval past the 32-bit timer limit', () => {
      expect(() =>
        resolveSponsorshipCaps({ RELAYER_FUNDING_INTERVAL_MS: String(MAX_TIMER_MS + 1) }),
      ).toThrow(/between 0 and 2147483647/)
    })

    it('accepts the limit itself', () => {
      expect(
        resolveSponsorshipCaps({ RELAYER_FUNDING_INTERVAL_MS: String(MAX_TIMER_MS) })
          .fundingIntervalMs,
      ).toBe(MAX_TIMER_MS)
    })
  })

  // A salt short enough to brute-force reads in a config file as though privacy had been
  // configured, which is worse than leaving it unset and letting the store mint one.
  describe('operator-supplied salt', () => {
    it('accepts 32 or more hex characters', () => {
      expect(resolveSponsorshipCaps({ RELAYER_VISITOR_SALT: 'a'.repeat(32) }).salt).toHaveLength(32)
    })

    it.each(['deadbeef', 'a'.repeat(31), 'z'.repeat(64), `${A_SALT} `])(
      'refuses %s at startup',
      (salt) => {
        expect(() => resolveSponsorshipCaps({ RELAYER_VISITOR_SALT: salt })).toThrow(/32 hexadecimal/)
      },
    )

    it('treats a blank salt as unset, leaving the store to mint one', () => {
      expect(resolveSponsorshipCaps({ RELAYER_VISITOR_SALT: '' }).salt).toBeUndefined()
    })
  })
})

// Every request in here carries `sponsored: true`, and that is the story-1.16 correction rather
// than a detail of the harness: the sponsorship budget now meters only submissions that ask the
// relayer to PAY, which since 1.16 means registrations and nothing else. A body without the flag
// is a plain submission and is metered by the send cap — see the suite below this one.
const SPONSORED = { calls: [A_CALL], sponsored: true }

describe('budget gate on the submit path (AC1, story 1.5)', () => {
  it('refuses past the cap with a legible 403 carrying the reason and the notice', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const sponsorship = new SponsorshipLedger(
      { perVisitor: 1, daily: 10 }, new MemorySponsorshipStore(), T0,
    )
    const s = await start({ submit, sponsorship, now: () => T0 })
    try {
      expect((await request(s.port, '/submit', SPONSORED)).status).toBe(200)

      const refused = await request(s.port, '/submit', SPONSORED)
      expect(refused.status).toBe(403)
      expect(refused.body.reason).toBe('sponsorship-paused')
      expect(refused.body.notice).toBe(BUDGET_EXHAUSTED_NOTICE)
      expect(refused.body.error).toBeTruthy()
      // A refusal after signing would be no refusal at all.
      expect(submit).toHaveBeenCalledTimes(1)
    } finally {
      await s.close()
    }
  })

  // The refusal must not say which cap bound: "the global budget is gone" tells a stranger
  // what everyone else has been doing today.
  it('says nothing about WHICH cap ran out', async () => {
    const sponsorship = new SponsorshipLedger(
      { perVisitor: 5, daily: 1 }, new MemorySponsorshipStore(), T0,
    )
    const s = await start({ sponsorship, now: () => T0 })
    try {
      await request(s.port, '/submit', SPONSORED)
      const refused = await request(s.port, '/submit', SPONSORED)
      expect(refused.status).toBe(403)
      expect(refused.body.reason).toBe('sponsorship-paused')
      expect(JSON.stringify(refused.body)).not.toMatch(/daily-budget|visitor-cap/)
    } finally {
      await s.close()
    }
  })

  it('reopens on the next UTC day, which is what the notice promises', async () => {
    let clock = T0
    const sponsorship = new SponsorshipLedger(
      { perVisitor: 1, daily: 10 }, new MemorySponsorshipStore(), T0,
    )
    const s = await start({ sponsorship, now: () => clock })
    try {
      expect((await request(s.port, '/submit', SPONSORED)).status).toBe(200)
      expect((await request(s.port, '/submit', SPONSORED)).status).toBe(403)
      clock = NEXT_DAY
      expect((await request(s.port, '/submit', SPONSORED)).status).toBe(200)
    } finally {
      await s.close()
    }
  })

  // An unrecordable spend is one we refuse to make — and the request still gets an answer.
  it('answers 500 without signing when the ledger cannot be written', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const store = new BreakableStore()
    const sponsorship = new SponsorshipLedger({ perVisitor: 5, daily: 5 }, store, T0)
    store.failing = true
    const s = await start({ submit, sponsorship, now: () => T0 })
    try {
      const res = await request(s.port, '/submit', SPONSORED)
      expect(res.status).toBe(500)
      expect(res.body.error).toMatch(/ledger could not be written/)
      expect(submit).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  it('leaves the submit path alone when no budget is configured', async () => {
    const s = await start({})
    try {
      expect((await request(s.port, '/submit', SPONSORED)).status).toBe(200)
      expect((await request(s.port, '/submit', SPONSORED)).status).toBe(200)
    } finally {
      await s.close()
    }
  })
})

// The 403 that used to greet every non-registration submission (story 1.16). The premise it
// rested on — "every accepted submission IS a sponsorship" — is false for a send, which
// reimburses its own fee out of the proven action chain.
describe('the send cap is not the sponsorship budget (story 1.16)', () => {
  const SEND = { calls: [A_CALL] }

  it('never charges the registration budget for a plain send, or shows its copy', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const sponsorship = new SponsorshipLedger(
      { perVisitor: 1, daily: 1 }, new MemorySponsorshipStore(), T0,
    )
    const sendBudget = new SponsorshipLedger(
      { perVisitor: 50, daily: 50 }, new MemorySponsorshipStore(), T0, SEND_CAP_NOTICE,
    )
    const s = await start({ submit, sponsorship, sendBudget, now: () => T0 })
    try {
      // Five sends against a sponsorship budget of exactly one.
      for (let i = 0; i < 5; i++) {
        const res = await request(s.port, '/submit', SEND)
        expect(res.status, `send ${i}`).toBe(200)
      }
      expect(submit).toHaveBeenCalledTimes(5)
      // The one free registration is still there afterwards, untouched.
      expect((await request(s.port, '/submit', SPONSORED)).status).toBe(200)
      expect((await request(s.port, '/submit', SPONSORED)).status).toBe(403)
    } finally {
      await s.close()
    }
  })

  it('refuses past the send cap with its own reason and its own notice', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const sendBudget = new SponsorshipLedger(
      { perVisitor: 1, daily: 10 }, new MemorySponsorshipStore(), T0, SEND_CAP_NOTICE,
    )
    const s = await start({ submit, sendBudget, now: () => T0 })
    try {
      expect((await request(s.port, '/submit', SEND)).status).toBe(200)
      const refused = await request(s.port, '/submit', SEND)
      expect(refused.status).toBe(403)
      expect(refused.body.reason).toBe('send-cap-reached')
      // Byte-exact, and written out rather than compared to the constant it came from: this
      // sentence promises a reset time and an alternative, and both are claims.
      expect(refused.body.notice).toBe(
        'Relayed sends are paused until 00:00 UTC. ' +
          'You can still submit this send from your own Starknet wallet.',
      )
      // Not one word about registrations, which is the point of the second notice existing.
      expect(JSON.stringify(refused.body)).not.toMatch(/registration|account/i)
      expect(submit).toHaveBeenCalledTimes(1)
    } finally {
      await s.close()
    }
  })

  it('never charges the send cap for a sponsored registration', async () => {
    const sendBudget = new SponsorshipLedger(
      { perVisitor: 1, daily: 1 }, new MemorySponsorshipStore(), T0, SEND_CAP_NOTICE,
    )
    const sponsorship = new SponsorshipLedger(
      { perVisitor: 10, daily: 10 }, new MemorySponsorshipStore(), T0,
    )
    const s = await start({ sponsorship, sendBudget, now: () => T0 })
    try {
      for (let i = 0; i < 3; i++) {
        expect((await request(s.port, '/submit', SPONSORED)).status, `registration ${i}`).toBe(200)
      }
      // The single send this visitor is allowed is still available.
      expect((await request(s.port, '/submit', SEND)).status).toBe(200)
      expect((await request(s.port, '/submit', SEND)).status).toBe(403)
    } finally {
      await s.close()
    }
  })

  it('refuses a sponsored flag that is not exactly true, without signing', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const s = await start({ submit })
    try {
      for (const sponsoredValue of [false, 'true', 1, null, {}]) {
        const res = await request(s.port, '/submit', { calls: [A_CALL], sponsored: sponsoredValue })
        expect(res.status, `sponsored ${JSON.stringify(sponsoredValue)}`).toBe(400)
        expect(res.body.error).toMatch(/sponsored/)
      }
      expect(submit).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  // The whole point of an additive extension: a body the browser already sends must keep
  // working, and must reach the signer shaped exactly as it did before.
  it('leaves a {calls}-only submission byte-identical at the signer', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const s = await start({ submit })
    try {
      expect((await request(s.port, '/submit', { calls: [A_CALL] })).status).toBe(200)
      expect(submit).toHaveBeenCalledWith([A_CALL], undefined)
    } finally {
      await s.close()
    }
  })

  it('does not forward the sponsored flag to the signer — it is a routing hint, not calldata', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const s = await start({ submit })
    try {
      expect((await request(s.port, '/submit', SPONSORED)).status).toBe(200)
      expect(submit).toHaveBeenCalledWith([A_CALL], undefined)
    } finally {
      await s.close()
    }
  })

  it('answers 500 without signing when the SEND ledger cannot be written', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const store = new BreakableStore()
    const sendBudget = new SponsorshipLedger({ perVisitor: 5, daily: 5 }, store, T0, SEND_CAP_NOTICE)
    store.failing = true
    const s = await start({ submit, sendBudget, now: () => T0 })
    try {
      const res = await request(s.port, '/submit', SEND)
      expect(res.status).toBe(500)
      expect(res.body.error).toMatch(/send ledger could not be written/)
      expect(submit).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })
})

// `openSendBudgetLedger` is what `main()` actually calls, and the suite above hand-builds its
// ledgers — so a `sendStorePath → storePath` slip, or a forgotten notice, would pass every test
// there while shipping a relayer whose two budgets share one file.
describe('openSendBudgetLedger, against real files (story 1.16)', () => {
  it('writes its own file, never the sponsorship one', () => {
    const conf = config()
    const sponsorship = openSponsorshipLedger(conf)
    const sendBudget = openSendBudgetLedger(conf, sponsorship.salt)

    sendBudget.spend('visitor-a', T0)
    expect(existsSync(conf.sendStorePath)).toBe(true)
    const sent = JSON.parse(readFileSync(conf.sendStorePath, 'utf8'))
    expect(sent.budget.dailyCount).toBe(1)
    // The sponsorship ledger is untouched — it has not even been written yet.
    if (existsSync(conf.storePath)) {
      expect(JSON.parse(readFileSync(conf.storePath, 'utf8')).budget.dailyCount).toBe(0)
    }
    expect(conf.sendStorePath).not.toBe(conf.storePath)
  })

  it('carries the sponsorship salt, so both gates bucket a visitor the same way', () => {
    const conf = config()
    const sponsorship = openSponsorshipLedger(conf)
    const sendBudget = openSendBudgetLedger(conf, sponsorship.salt)
    expect(sendBudget.salt).toBe(sponsorship.salt)
    expect(visitorId('1.2.3.4', sendBudget.salt, T0)).toBe(visitorId('1.2.3.4', sponsorship.salt, T0))
  })

  it('refuses with the SEND notice, not the registration one', () => {
    const conf = config({ sendCaps: { perVisitor: 1, daily: 5 } })
    const sendBudget = openSendBudgetLedger(conf, A_SALT)
    expect(sendBudget.notice).toBe(SEND_CAP_NOTICE)
    sendBudget.spend('v', T0)
    const refused = sendBudget.spend('v', T0)
    expect(refused.allow).toBe(false)
    expect(refused.allow === false && refused.notice).toBe(SEND_CAP_NOTICE)
  })

  it('applies its own caps, independent of the sponsorship ones', () => {
    const conf = config({ caps: { perVisitor: 9, daily: 9 }, sendCaps: { perVisitor: 1, daily: 1 } })
    const sendBudget = openSendBudgetLedger(conf, A_SALT)
    expect(sendBudget.spend('v', T0).allow).toBe(true)
    expect(sendBudget.spend('v', T0).allow).toBe(false)
  })
})

// Both mistakes are otherwise SILENT: the server starts, serves, and is wrong in a way only a
// user would notice. Construction-time, so `handleSubmit`'s gate order is untouched.
describe('the server refuses to start half-configured (story 1.16)', () => {
  const base = { submit: async () => '0xok', resolveApproveCeiling: async () => 0n }

  it('refuses a sponsorship budget with no send budget beside it', () => {
    const sponsorship = new SponsorshipLedger(CAPS, new MemorySponsorshipStore(), T0)
    expect(() => createRelayerServer({ ...base, sponsorship })).toThrow(/without a send budget/)
  })

  it('refuses a send budget built with the registration notice', () => {
    const sponsorship = new SponsorshipLedger(CAPS, new MemorySponsorshipStore(), T0)
    // The default notice — the exact slip that would answer a refused send with copy about
    // account creation.
    const sendBudget = new SponsorshipLedger(CAPS, new MemorySponsorshipStore(), T0)
    expect(() => createRelayerServer({ ...base, sponsorship, sendBudget }))
      .toThrow(/without SEND_CAP_NOTICE/)
  })

  it('accepts both budgets configured correctly, and neither configured at all', () => {
    const sponsorship = new SponsorshipLedger(CAPS, new MemorySponsorshipStore(), T0)
    const sendBudget = new SponsorshipLedger(CAPS, new MemorySponsorshipStore(), T0, SEND_CAP_NOTICE)
    expect(() => createRelayerServer({ ...base, sponsorship, sendBudget })).not.toThrow()
    expect(() => createRelayerServer(base)).not.toThrow()
    // A send budget alone is fine: plain submissions are metered, and nothing claims to sponsor.
    expect(() => createRelayerServer({ ...base, sendBudget })).not.toThrow()
  })
})

describe('GET /fee-recipient (story 1.16)', () => {
  const RELAYER = `0x${'a'.repeat(63)}1`

  it('advertises the address a reimbursement leg must name', async () => {
    const s = await start({ feeRecipient: RELAYER })
    try {
      const res = await get(s.port, '/api/fee-recipient')
      expect(res.status).toBe(200)
      expect(res.body.feeRecipient).toBe(RELAYER)
    } finally {
      await s.close()
    }
  })

  it('answers on both spellings, as /submit does', async () => {
    const s = await start({ feeRecipient: RELAYER })
    try {
      expect((await get(s.port, '/fee-recipient')).status).toBe(200)
    } finally {
      await s.close()
    }
  })

  // No default, because there is no sensible one: a real withdraw is about to name this.
  it('refuses rather than guessing when no recipient is configured', async () => {
    const s = await start({})
    try {
      const res = await get(s.port, '/api/fee-recipient')
      expect(res.status).toBe(503)
      expect(res.body.feeRecipient).toBeUndefined()
    } finally {
      await s.close()
    }
  })

  it('refuses to advertise a zero or malformed recipient — a burn, from its own mouth', async () => {
    for (const bad of ['0x0', '0', 'not-an-address']) {
      const s = await start({ feeRecipient: bad })
      try {
        const res = await get(s.port, '/api/fee-recipient')
        expect(res.status).toBe(503)
        expect(res.body.feeRecipient).toBeUndefined()
        expect(res.body.error).toMatch(/refuses to advertise|not a usable address/)
      } finally {
        await s.close()
      }
    }
  })

  // Behind the same door as everything else. Only the content-type lock is skipped, because a
  // GET has no body to declare a type for.
  it('is still behind the auth token and the origin allowlist', async () => {
    const s = await start({ feeRecipient: RELAYER, authToken: 'shh', allowedOrigins: new Set(['https://ok.example']) })
    try {
      expect((await get(s.port, '/api/fee-recipient')).status).toBe(401)
      expect((await get(s.port, '/api/fee-recipient', { 'x-relayer-auth': 'shh' })).status).toBe(200)
      expect(
        (await get(s.port, '/api/fee-recipient', { 'x-relayer-auth': 'shh', origin: 'https://evil.example' })).status,
      ).toBe(403)
    } finally {
      await s.close()
    }
  })

  it('does not answer a POST, and /submit does not answer a GET', async () => {
    const s = await start({ feeRecipient: RELAYER })
    try {
      expect((await request(s.port, '/api/fee-recipient', {})).status).toBe(404)
      expect((await get(s.port, '/submit')).status).toBe(404)
    } finally {
      await s.close()
    }
  })
})

describe('POST /submit carries proofFacts (story 1.12)', () => {
  const FACTS = ['0x1a2b', '3141592653589793']   // hex and decimal: both reach this server
  // The blob the facts belong to. The sequencer takes the pair or nothing (story 1.13's
  // first real broadcast), so every proven body below carries both.
  const BLOB = 'AQICtest-proof-blob'

  it('passes validated facts and their proof blob through to the signer', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const s = await start({ submit })
    try {
      const res = await request(s.port, '/submit', { calls: [A_CALL], proofFacts: FACTS, proof: BLOB })
      expect(res.status).toBe(200)
      expect(res.body.transactionHash).toBe('0xok')
      expect(submit).toHaveBeenCalledWith([A_CALL], { proofFacts: FACTS, proof: BLOB })
    } finally {
      await s.close()
    }
  })

  // The sequencer's both-or-neither rule, mirrored at the free layer: either half alone
  // would be signed, broadcast, and rejected at this wallet's expense.
  it('answers 400 for proofFacts without their proof, and for a proof without facts', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const s = await start({ submit })
    try {
      const factsAlone = await request(s.port, '/submit', { calls: [A_CALL], proofFacts: FACTS })
      expect(factsAlone.status).toBe(400)
      expect(factsAlone.body.error).toMatch(/both or neither/)

      const blobAlone = await request(s.port, '/submit', { calls: [A_CALL], proof: BLOB })
      expect(blobAlone.status).toBe(400)
      expect(blobAlone.body.error).toMatch(/both or neither/)

      const emptyBlob = await request(s.port, '/submit', { calls: [A_CALL], proofFacts: FACTS, proof: '' })
      expect(emptyBlob.status).toBe(400)

      // A blob that is not a string at all — a number survives JSON, so it is a shape a
      // real caller can produce, and it must be a refusal rather than something signed.
      const numberBlob = await request(s.port, '/submit', { calls: [A_CALL], proofFacts: FACTS, proof: 123 })
      expect(numberBlob.status).toBe(400)
      const numberBlobAlone = await request(s.port, '/submit', { calls: [A_CALL], proof: 123 })
      expect(numberBlobAlone.status).toBe(400)

      expect(submit).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  // The whole point of an additive extension: every submission the browser route already
  // makes must keep working, and must go out shaped exactly as it did before.
  it('leaves a {calls}-only submission untouched — no details at all', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const s = await start({ submit })
    try {
      expect((await request(s.port, '/submit', { calls: [A_CALL] })).status).toBe(200)
      expect(submit).toHaveBeenCalledWith([A_CALL], undefined)
    } finally {
      await s.close()
    }
  })

  it('answers 400 on facts that are not felts, without signing', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const s = await start({ submit })
    try {
      for (const proofFacts of [
        ['0xzz'],                  // not hex
        [['0x1']],                 // an array that BigInt() would coerce to 1n
        [1],                       // a number, not a felt string
        ['  0x1  '],               // whitespace-padded: short-string encodes instead
        [null],
        'not-an-array',
        [],                        // meant to send some and sent none
      ]) {
        // The blob rides along so the refusal under test stays the FACTS gate, not the
        // both-or-neither gate one check earlier.
        const res = await request(s.port, '/submit', { calls: [A_CALL], proofFacts, proof: BLOB })
        expect(res.status, `proofFacts ${JSON.stringify(proofFacts)}`).toBe(400)
        expect(res.body.error).toMatch(/proofFacts/)
      }
      expect(submit).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  // Facts belong to a PROVEN POOL SUBMISSION. On a batch with no apply_actions there is
  // no proof they could belong to, so what they really are is caller-chosen felts being
  // signed into our V3 details — a field the allowlist never inspects.
  it('answers 400 for proofFacts on a batch with no pool apply_actions', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const messageBook = '0x' + '5'.repeat(63) + '1'
    const bookCall = { contractAddress: messageBook, entrypoint: 'privacy_invoke', calldata: [] }
    const s = await start({ submit, policy: { messageBook } })
    try {
      const res = await request(s.port, '/submit', { calls: [bookCall], proofFacts: FACTS, proof: BLOB })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/no pool apply_actions/)
      expect(submit).not.toHaveBeenCalled()

      // The same batch WITHOUT facts is still perfectly acceptable.
      expect((await request(s.port, '/submit', { calls: [bookCall] })).status).toBe(200)
    } finally {
      await s.close()
    }
  })

  // Shape is checked on the way in, before the allowlist and before the budget — a
  // malformed body is the caller's fault (400) and must not consume a sponsorship.
  it('does not spend budget on a malformed facts array', async () => {
    const sponsorship = new SponsorshipLedger(
      { perVisitor: 1, daily: 10 }, new MemorySponsorshipStore(), T0,
    )
    const s = await start({ sponsorship, now: () => T0 })
    try {
      expect((await request(s.port, '/submit', { calls: [A_CALL], proofFacts: [1], proof: BLOB })).status)
        .toBe(400)
      expect((await request(s.port, '/submit', { calls: [A_CALL], proofFacts: FACTS, proof: BLOB })).status)
        .toBe(200)
    } finally {
      await s.close()
    }
  })
})

describe('funding monitor (FR-053, story 1.5)', () => {
  const STRK = 10n ** 18n
  const fee = STRK * 6n                  // ~6 STRK live fee
  const floor = fundingFloor(fee)        // 2× fee — refuse only near genuine inability to pay
  const warn = warningFloor(fee)         // 5× fee — page ops while still working

  // Abu's ruling, pinned to the concrete numbers so that changing either multiple fails
  // here rather than in production.
  it('refuses below 2 live fees and pages below 5', () => {
    expect(REFUSAL_FEE_MULTIPLE).toBe(2n)
    expect(WARNING_FEE_MULTIPLE).toBe(5n)
    expect(floor).toBe(STRK * 12n)
    expect(warn).toBe(STRK * 30n)
  })

  // The point of the ruling: a wallet funded to the operating rule — a small working
  // balance, a few submissions' worth — must not sit below its own refusal floor.
  it('leaves a small working balance comfortably able to sign', () => {
    expect(classifyFunding(STRK * 40n, floor, warn)).toBe('healthy')
    expect(userFacingState(classifyFunding(STRK * 20n, floor, warn))).toBe('ok')
  })

  it('classifies healthy / low / exhausted against the two thresholds', () => {
    expect(classifyFunding(warn, floor, warn)).toBe('healthy')
    expect(classifyFunding(warn - 1n, floor, warn)).toBe('low')
    expect(classifyFunding(floor, floor, warn)).toBe('low')          // still signing
    expect(classifyFunding(floor - 1n, floor, warn)).toBe('exhausted')
  })

  // A pre-emptive page that arrives once the door is shut is not pre-emptive. The band
  // between the two thresholds is the window ops gets to act in.
  it('warns strictly before it refuses, leaving a window to act in', () => {
    expect(warn).toBeGreaterThan(floor)
    const inTheWindow = (floor + warn) / 2n
    expect(classifyFunding(inTheWindow, floor, warn)).toBe('low')
    expect(shouldPageOps(classifyFunding(inTheWindow, floor, warn))).toBe(true)
    expect(userFacingState(classifyFunding(inTheWindow, floor, warn))).toBe('ok')
  })

  // `fundingThresholds` is the single place the relationship between the two numbers is
  // enforced, so it is the single place that has to hold under a hostile configuration.
  describe('threshold pairing', () => {
    it('produces the production pair by default', () => {
      expect(fundingThresholds(fee)).toEqual({ floor: STRK * 12n, warn: STRK * 30n })
    })

    it('honours explicit multiples', () => {
      expect(fundingThresholds(fee, { burst: 3n, warnBurst: 9n }))
        .toEqual({ floor: STRK * 18n, warn: STRK * 54n })
    })

    // Nothing stops an operator raising the floor past the warning. Left alone that inverts
    // the pair, `low` becomes unreachable, and the only page ever sent arrives at refusal.
    it.each([
      ['above the warning', 10n],
      ['equal to the warning', WARNING_FEE_MULTIPLE],
    ])('keeps the warning above a floor raised %s', (_label, burst) => {
      const { floor: f, warn: w } = fundingThresholds(fee, { burst })
      expect(w).toBeGreaterThan(f)
      expect(classifyFunding(f, f, w)).toBe('low')   // the band exists
    })
  })

  it('the user never sees a funding detail — exhausted degrades to relayer-down', () => {
    expect(userFacingState('exhausted')).toBe('relayer-down')
    expect(userFacingState('low')).toBe('ok')
    expect(userFacingState('healthy')).toBe('ok')
    // Nothing about OUR funding state. "funded Starknet wallet" is the USER's wallet, which
    // is the alternative being offered, not a disclosure about the relayer.
    expect(RELAYER_DOWN_NOTICE.toLowerCase()).not.toMatch(
      /balance|allowance|out of funds|insufficient|top up|unfunded/,
    )
    expect(RELAYER_DOWN_NOTICE).toMatch(/funded Starknet wallet/)
  })

  it('pages ops on low (pre-emptive) and exhausted, not on healthy', () => {
    expect(shouldPageOps('low')).toBe(true)
    expect(shouldPageOps('exhausted')).toBe(true)
    expect(shouldPageOps('healthy')).toBe(false)
  })

  // `monitor` is a plain field, deliberately. As a getter it built a NEW monitor on every
  // property access, so a test touching `h.monitor` twice would be asserting against two
  // independent state machines while appearing to talk about one — and the paging logic under
  // test is entirely about state carried between calls.
  function monitorOver(balances: bigint[], pageOps = vi.fn(), intervalMs = 0) {
    let i = 0
    const readBalance = vi.fn(async () => balances[Math.min(i++, balances.length - 1)]!)
    const monitor = createFundingMonitor({
      readBalance,
      readFeeWei: async () => fee,
      pageOps,
      intervalMs,
    })
    return { pageOps, readBalance, monitor }
  }

  it('names the balance and the remedy in the page it sends', async () => {
    const h = monitorOver([floor - 1n])
    const monitor = h.monitor
    expect(await monitor.check()).toBe('exhausted')
    expect(h.pageOps).toHaveBeenCalledTimes(1)
    const page = h.pageOps.mock.calls[0]![0] as string
    expect(page).toMatch(/STRK balance is exhausted/)
    expect(page).toMatch(/Top up the relayer wallet/)
    expect(page).not.toMatch(/allowance/i)
  })

  // The sequence the two thresholds exist to produce: warned while still working, refused
  // only once the balance is genuinely too low to pay.
  it('pages while still signing, and only refuses once below the floor', async () => {
    const h = monitorOver([(floor + warn) / 2n, floor - 1n])
    const monitor = h.monitor

    expect(await monitor.check()).toBe('low')
    expect(monitor.userState()).toBe('ok')          // still accepting submissions
    expect(h.pageOps).toHaveBeenCalledTimes(1)
    expect(h.pageOps.mock.calls[0]![0]).toMatch(/balance is low/)

    expect(await monitor.check()).toBe('exhausted')
    expect(monitor.userState()).toBe('relayer-down')
  })

  it('names both thresholds in the page, so ops can see how much room is left', async () => {
    const h = monitorOver([floor - 1n])
    await h.monitor.check()
    const page = h.pageOps.mock.calls[0]![0] as string
    expect(page).toMatch(new RegExp(`refusal floor of ${floor} wei`))
    expect(page).toMatch(new RegExp(`warning threshold of ${warn} wei`))
  })

  // An operator raising `burst` past the warning multiple would otherwise collapse the
  // window: `low` becomes unreachable and the only page ever sent arrives at refusal.
  it('keeps the warning above the floor even when the floor is raised past it', async () => {
    const pageOps = vi.fn()
    const monitor = createFundingMonitor({
      readBalance: async () => fee * 15n,
      readFeeWei: async () => fee,
      pageOps,
      burst: 10n,                 // floor 10 fees, above the 5-fee warning multiple
    })
    expect(await monitor.check()).toBe('low')   // not 'healthy', and not 'exhausted'
    expect(monitor.userState()).toBe('ok')
  })

  it('pages once on entering a paging state, not on every poll', async () => {
    const h = monitorOver([floor - 1n])
    const monitor = h.monitor
    await monitor.check()
    await monitor.check()
    await monitor.check()
    expect(h.pageOps).toHaveBeenCalledTimes(1)   // a page per poll is no page
  })

  it('says so when it recovers, so the resolution is visible without checking', async () => {
    const h = monitorOver([floor - 1n, floor * 5n])
    const monitor = h.monitor
    await monitor.check()
    expect(monitor.userState()).toBe('relayer-down')
    await monitor.check()
    expect(monitor.health()).toBe('healthy')
    expect(monitor.userState()).toBe('ok')
    expect(h.pageOps).toHaveBeenLastCalledWith(expect.stringMatching(/healthy again/))
  })

  // The dangerous half of "a failed read is not exhausted". Reporting `unknown` as ok is right
  // when nothing has been measured; doing it AFTER a measured outage silently reopens a gate
  // that a real reading closed, and the relayer resumes signing on the strength of not having
  // been able to look. A failed read is an absence of news, not good news.
  describe('a failed read neither manufactures an outage nor cancels one', () => {
    function monitorWithFailableRead(balances: bigint[]) {
      let i = 0
      let failing = false
      const monitor = createFundingMonitor({
        readBalance: async () => {
          if (failing) throw new Error('all RPC hosts failed')
          return balances[Math.min(i++, balances.length - 1)]!
        },
        readFeeWei: async () => fee,
        pageOps: vi.fn(),
      })
      return { monitor, fail: (v: boolean) => { failing = v } }
    }

    it('keeps the gate CLOSED when a read fails after a measured exhaustion', async () => {
      const h = monitorWithFailableRead([floor - 1n, warn * 2n])
      expect(await h.monitor.check()).toBe('exhausted')
      expect(h.monitor.userState()).toBe('relayer-down')

      h.fail(true)
      expect(await h.monitor.check()).toBe('unknown')
      expect(h.monitor.health()).toBe('unknown')       // the reading is honest
      expect(h.monitor.userState()).toBe('relayer-down') // the gate is unmoved

      // Only a real measurement reopens it.
      h.fail(false)
      expect(await h.monitor.check()).toBe('healthy')
      expect(h.monitor.userState()).toBe('ok')
    })

    it('keeps the gate OPEN when a read fails after a measured healthy', async () => {
      const h = monitorWithFailableRead([warn * 2n])
      expect(await h.monitor.check()).toBe('healthy')
      h.fail(true)
      expect(await h.monitor.check()).toBe('unknown')
      expect(h.monitor.userState()).toBe('ok')
    })

    it('leaves the gate open when nothing has ever been measured', async () => {
      const h = monitorWithFailableRead([warn * 2n])
      h.fail(true)
      expect(await h.monitor.check()).toBe('unknown')
      expect(h.monitor.userState()).toBe('ok')
    })
  })

  it('classifies an unreadable balance as unknown, never as exhausted', async () => {
    const pageOps = vi.fn()
    const monitor = createFundingMonitor({
      readBalance: async () => { throw new Error('all RPC hosts failed') },
      readFeeWei: async () => fee,
      pageOps,
    })
    expect(await monitor.check()).toBe('unknown')
    // An RPC blip must not manufacture a relayer outage — but ops still hears about it.
    expect(monitor.userState()).toBe('ok')
    expect(pageOps).toHaveBeenCalledWith(expect.stringMatching(/unknown, not exhausted/))
  })

  // A floor of 0 is cleared by every balance in existence, so the monitor would report
  // healthy forever while measuring nothing at all.
  it('treats a non-positive live fee as unknown rather than as universally healthy', async () => {
    const pageOps = vi.fn()
    const monitor = createFundingMonitor({
      readBalance: async () => 0n,
      readFeeWei: async () => 0n,
      pageOps,
    })
    expect(await monitor.check()).toBe('unknown')
    expect(monitor.userState()).toBe('ok')
    expect(pageOps).toHaveBeenCalledWith(expect.stringMatching(/would make the floor 0/))
  })

  it('keeps polling when a page throws', async () => {
    const h = monitorOver([floor - 1n], vi.fn(() => { throw new Error('pager down') }))
    await expect(h.monitor.check()).resolves.toBe('exhausted')
  })

  // Without this, the startup check and the first tick race and `paged` is written by
  // whichever lands last — the state machine that makes pages fire once starts dropping them.
  it('shares one read between overlapping checks', async () => {
    let release: (v: bigint) => void = () => {}
    const readBalance = vi.fn(() => new Promise<bigint>((r) => { release = r }))
    const pageOps = vi.fn()
    const monitor = createFundingMonitor({ readBalance, readFeeWei: async () => fee, pageOps })

    const a = monitor.check()
    const b = monitor.check()
    expect(readBalance).toHaveBeenCalledTimes(1)
    release(floor - 1n)
    expect(await a).toBe('exhausted')
    expect(await b).toBe('exhausted')
    expect(pageOps).toHaveBeenCalledTimes(1)
  })

  describe('the poll timer', () => {
    it('fires on the configured cadence and stops when told', async () => {
      vi.useFakeTimers()
      try {
        const h = monitorOver([floor * 5n], vi.fn(), 1_000)
        const monitor = h.monitor
        monitor.start()
        await vi.advanceTimersByTimeAsync(3_000)
        expect(h.readBalance).toHaveBeenCalledTimes(3)

        monitor.stop()
        await vi.advanceTimersByTimeAsync(10_000)
        expect(h.readBalance).toHaveBeenCalledTimes(3)   // stopped means stopped
      } finally {
        vi.useRealTimers()
      }
    })

    it('unrefs the timer, so polling can never be why the process will not exit', () => {
      const unref = vi.fn()
      const spy = vi
        .spyOn(globalThis, 'setInterval')
        .mockReturnValue({ unref } as unknown as NodeJS.Timeout)
      try {
        monitorOver([floor * 5n], vi.fn(), 1_000).monitor.start()
        expect(spy).toHaveBeenCalledWith(expect.any(Function), 1_000)
        expect(unref).toHaveBeenCalledTimes(1)
      } finally {
        spy.mockRestore()
      }
    })

    it('starts no timer at all when the interval is 0', () => {
      const spy = vi.spyOn(globalThis, 'setInterval')
      try {
        monitorOver([floor * 5n], vi.fn(), 0).monitor.start()
        expect(spy).not.toHaveBeenCalled()
      } finally {
        spy.mockRestore()
      }
    })

    // Both ends fail the same way. setInterval(fn, NaN) fires about every millisecond; so does
    // a value past 2^31-1, because Node clamps the overflow to 1 rather than rejecting it. A
    // "poll monthly" setting becoming a thousand reads a second is the same hot loop.
    it.each([
      ['a non-integer', Number('five')],
      ['a negative interval', -1],
      ['an interval past the 32-bit timer limit', MAX_TIMER_MS + 1],
      ['a month in milliseconds', 30 * 24 * 60 * 60 * 1000],
    ])('refuses %s instead of hot-looping', (_label, intervalMs) => {
      const monitor = monitorOver([floor * 5n], vi.fn(), intervalMs).monitor
      expect(() => monitor.start()).toThrow(/between 0 and 2147483647/)
    })

    it('accepts the largest interval Node can actually honour', () => {
      const spy = vi.spyOn(globalThis, 'setInterval').mockReturnValue({
        unref: vi.fn(),
      } as unknown as NodeJS.Timeout)
      try {
        monitorOver([floor * 5n], vi.fn(), MAX_TIMER_MS).monitor.start()
        expect(spy).toHaveBeenCalledWith(expect.any(Function), MAX_TIMER_MS)
      } finally {
        spy.mockRestore()
      }
    })
  })
})

// Every gate test stubs readBalance, so a limb swap or a shift of 64 instead of 128 would be
// invisible everywhere else: small balances live entirely in the low limb and come back correct
// either way. This is the only place the recombination itself is checked.
describe('u256 recombination (the balance read)', () => {
  const TWO_128 = 1n << 128n

  it.each([
    ['zero', '0x0', '0x0', 0n],
    ['one STRK, low limb only', '0xde0b6b3a7640000', '0x0', 10n ** 18n],
    ['the largest value the low limb holds', '0xffffffffffffffffffffffffffffffff', '0x0', TWO_128 - 1n],
    // The one that proves the shift is 128 and not 64, and that the limbs are not swapped:
    // a shift of 64 gives 2^64, and swapped limbs give 0.
    ['a bare high limb', '0x0', '0x1', TWO_128],
    ['both limbs', '0x1', '0x1', TWO_128 + 1n],
    ['decimal-shaped felts', '5', '2', 5n + 2n * TWO_128],
  ])('recombines %s', (_label, low, high, expected) => {
    expect(u256FromFelts(low, high)).toBe(expected)
  })

  it('is not the same as a 64-bit shift, and is not limb-swapped', () => {
    expect(u256FromFelts('0x0', '0x1')).not.toBe(1n << 64n)
    expect(u256FromFelts('0x2', '0x3')).not.toBe(u256FromFelts('0x3', '0x2'))
  })
})

describe('ops pager (AC3, story 1.5)', () => {
  /** The pager is fire-and-forget, so its promise settles a tick after the call returns. */
  const settle = () => new Promise((r) => setImmediate(r))

  it('posts the page to the webhook as {"text": ...}', async () => {
    const calls: Array<[string, RequestInit]> = []
    const fetchImpl = (async (url: any, init: any) => {
      calls.push([String(url), init])
      return new Response('', { status: 200 })
    }) as unknown as typeof fetch

    makeOpsPager('https://ops.example/hook', fetchImpl)('balance is low')
    await settle()

    expect(calls).toHaveLength(1)
    expect(calls[0]![0]).toBe('https://ops.example/hook')
    expect(calls[0]![1].method).toBe('POST')
    expect(JSON.parse(String(calls[0]![1].body))).toEqual({ text: 'relayer: balance is low' })
    expect(calls[0]![1].signal).toBeDefined()   // and it cannot hang forever
  })

  // The failure that matters most: a 404 from a rotated hook RESOLVES, so `.catch` never fires.
  // Without the ok check the pager looks configured, looks quiet, and delivers nothing.
  it('warns when the webhook answers but does not accept', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fetchImpl = (async () => new Response('gone', { status: 404 })) as unknown as typeof fetch
      makeOpsPager('https://ops.example/hook', fetchImpl)('balance is low')
      await settle()
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/answered 404; page not delivered/))
    } finally {
      warn.mockRestore()
    }
  })

  it('catches a rejected webhook rather than becoming an unhandled rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fetchImpl = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
      makeOpsPager('https://ops.example/hook', fetchImpl)('balance is low')
      await settle()
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/ops webhook failed.*ECONNREFUSED/))
    } finally {
      warn.mockRestore()
    }
  })

  // The log is a real destination, not a placeholder — a deployment without a webhook is still
  // paged, just into somewhere greppable.
  it('always logs under a greppable prefix, webhook or not', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const fetchImpl = vi.fn() as unknown as typeof fetch
      makeOpsPager(undefined, fetchImpl)('balance is low')
      await settle()
      expect(warn).toHaveBeenCalledWith('relayer: OPS balance is low')
      expect(fetchImpl).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('relayer-down refusal on the submit path (AC3, story 1.5)', () => {
  // The client branches on `reason` for every other non-200 on this endpoint, so the 503 has to
  // carry one too — `send.ts` reads it to decide whether to offer self-submission (story 1.16).
  // `state` stays alongside it: it is a shipped field, and removing it to tidy a name would
  // break a client for nothing.
  it('carries the same token in `reason` as in `state`, so one field routes every refusal', async () => {
    const s = await start({ relayerState: () => 'relayer-down' })
    try {
      const res = await request(s.port, '/submit', { calls: [A_CALL] })
      expect(res.status).toBe(503)
      expect(res.body.reason).toBe('relayer-down')
      expect(res.body.state).toBe('relayer-down')
      expect(res.body.notice).toBe(RELAYER_DOWN_NOTICE)
    } finally {
      await s.close()
    }
  })

  it('refuses with the relayer-down state and never mentions the funding detail', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xok')
    const s = await start({ submit, relayerState: () => 'relayer-down' })
    try {
      const res = await request(s.port, '/submit', { calls: [A_CALL] })
      expect(res.status).toBe(503)
      expect(res.body.state).toBe('relayer-down')
      expect(res.body.notice).toBe(RELAYER_DOWN_NOTICE)
      expect(JSON.stringify(res.body).toLowerCase()).not.toMatch(/balance|allowance/)
      // Refused before the key, and before the chain is consulted for a ceiling.
      expect(submit).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  it('does not consume sponsorship budget for a submission it refuses', async () => {
    const sponsorship = new SponsorshipLedger({ perVisitor: 1, daily: 5 }, new MemorySponsorshipStore(), T0)
    let state: 'ok' | 'relayer-down' = 'relayer-down'
    const s = await start({ sponsorship, now: () => T0, relayerState: () => state })
    try {
      expect((await request(s.port, '/submit', { calls: [A_CALL] })).status).toBe(503)
      // Budget intact: the visitor's one sponsored submission is still theirs to spend.
      state = 'ok'
      expect((await request(s.port, '/submit', { calls: [A_CALL] })).status).toBe(200)
    } finally {
      await s.close()
    }
  })

  it('submits normally while the state is ok', async () => {
    const s = await start({ relayerState: () => 'ok' })
    try {
      expect((await request(s.port, '/submit', { calls: [A_CALL] })).status).toBe(200)
    } finally {
      await s.close()
    }
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

  // A browser-direct call nobody wrote down is a leak nobody disclosed.
  it('enumerates every browser-direct exception with a one-line leak description', () => {
    expect(PROXY_EXCEPTIONS.length).toBeGreaterThan(0)
    for (const e of PROXY_EXCEPTIONS) {
      expect(e.what).toBeTruthy()
      expect(e.where).toMatch(/\.js:[1-9]\d*$/)   // checkable against the source
      expect(e.leaks.length).toBeGreaterThan(20)
    }
    expect(PROXY_EXCEPTIONS.some((e) => /JSON-RPC/i.test(e.what))).toBe(true)
  })
})

describe('POST /api/quote (AC4, story 1.5)', () => {
  function fetchStub(impl: (url: string, init: RequestInit) => Response | Promise<Response>) {
    return vi.fn(async (input: any, init: any) => impl(String(input), init ?? {})) as unknown as typeof fetch
  }
  const okStub = () => fetchStub(() => new Response('{}', { status: 200 }))
  const A_QUOTE = { target: 'avnuQuotes', path: '/swap/v3/quotes' }

  it('relays an allowlisted upstream server-side, carrying no client identity', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null
    const fetchUpstream = fetchStub((url, init) => {
      seen = { url, headers: init.headers as Record<string, string> }
      return new Response(JSON.stringify({ price: '1.02' }), { status: 200 })
    })
    const s = await start({ fetchUpstream })
    try {
      const res = await request(s.port, '/api/quote', {
        target: 'avnuQuotes', path: '/swap/v3/quotes', query: { sellTokenAddress: '0xabc' },
      })
      expect(res.status).toBe(200)
      expect(res.body).toEqual({ price: '1.02' })
      expect(seen!.url).toBe(`https://${PROXY_TARGETS.avnuQuotes.host}/swap/v3/quotes?sellTokenAddress=0xabc`)
      for (const name of ['cookie', 'x-forwarded-for', 'user-agent', 'referer', 'authorization']) {
        expect(Object.keys(seen!.headers).map((h) => h.toLowerCase())).not.toContain(name)
      }
    } finally {
      await s.close()
    }
  })

  it('refuses an unlisted host with 403, without fetching anything', async () => {
    const fetchUpstream = okStub()
    const s = await start({ fetchUpstream })
    try {
      const res = await request(s.port, '/api/quote', { target: 'evil.example', path: '/x' })
      expect(res.status).toBe(403)
      expect(res.body.error).toMatch(/not an allowlisted upstream/)
      expect(fetchUpstream).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  it('answers 502 when the upstream fails, and does not leak the exception as a 500', async () => {
    const fetchUpstream = fetchStub(() => { throw new Error('getaddrinfo ENOTFOUND') })
    const s = await start({ fetchUpstream })
    try {
      const res = await request(s.port, '/api/quote', { target: 'circleIris', path: '/v1/attestations' })
      expect(res.status).toBe(502)
      expect(res.body.error).toMatch(/proxying to circleIris failed/)
    } finally {
      await s.close()
    }
  })

  it('answers 502 on an upstream error status rather than passing it off as ours', async () => {
    const fetchUpstream = fetchStub(() => new Response('rate limited', { status: 429 }))
    const s = await start({ fetchUpstream })
    try {
      const res = await request(s.port, '/api/quote', A_QUOTE)
      expect(res.status).toBe(502)
      expect(res.body.error).toMatch(/answered 429/)
    } finally {
      await s.close()
    }
  })

  it('answers 502 when an allowlisted upstream stops answering JSON', async () => {
    const fetchUpstream = fetchStub(() => new Response('<html>maintenance</html>', { status: 200 }))
    const s = await start({ fetchUpstream })
    try {
      const res = await request(s.port, '/api/quote', A_QUOTE)
      expect(res.status).toBe(502)
      expect(res.body.error).toMatch(/did not answer JSON/)
    } finally {
      await s.close()
    }
  })

  // An allowlisted host having a bad day must not be able to exhaust this process.
  it('caps the upstream response rather than buffering whatever arrives', async () => {
    const fetchUpstream = fetchStub(() => new Response('x'.repeat(600 * 1024), { status: 200 }))
    const s = await start({ fetchUpstream })
    try {
      const res = await request(s.port, '/api/quote', A_QUOTE)
      expect(res.status).toBe(502)
      expect(res.body.error).toMatch(/exceeded/)
    } finally {
      await s.close()
    }
  })

  it('refuses a relative upstream path, which is how an allowlist gets walked around', async () => {
    const fetchUpstream = okStub()
    const s = await start({ fetchUpstream })
    try {
      const res = await request(s.port, '/api/quote', { target: 'avnuQuotes', path: 'swap' })
      expect(res.status).toBe(400)
      expect(fetchUpstream).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  it('never follows a redirect off the allowlisted host', async () => {
    let init: RequestInit = {}
    const fetchUpstream = fetchStub((_url, i) => {
      init = i
      return new Response('{}', { status: 200 })
    })
    const s = await start({ fetchUpstream })
    try {
      await request(s.port, '/api/quote', A_QUOTE)
      expect(init.redirect).toBe('error')
      expect(init.signal).toBeDefined()   // and it cannot hang forever
    } finally {
      await s.close()
    }
  })

  // JSON.parse('null') succeeds, and destructuring the result throws — which would leave the
  // request unanswered rather than answered badly.
  it.each([
    ['null', 'null'],
    ['a number', '7'],
    ['an array', '[]'],
    ['a string', '"hello"'],
  ])('answers 400 on a body that is %s, rather than throwing', async (_label, raw) => {
    const fetchUpstream = okStub()
    const s = await start({ fetchUpstream })
    try {
      const res = await request(s.port, '/api/quote', raw)
      expect(res.status).toBe(400)
      expect(fetchUpstream).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  // URLSearchParams stringifies anything, so an unchecked object becomes `[object Object]`
  // in the upstream URL — a silently wrong query rather than a refused one.
  it.each([
    ['an object', { nested: { a: 1 } }],
    ['an array', { list: ['a', 'b'] }],
    ['a number', { amount: 5 }],
    ['null', { amount: null }],
  ])('answers 400 when a query value is %s', async (_label, query) => {
    const fetchUpstream = okStub()
    const s = await start({ fetchUpstream })
    try {
      const res = await request(s.port, '/api/quote', { ...A_QUOTE, query })
      expect(res.status).toBe(400)
      expect(res.body.error).toMatch(/must be a string/)
      expect(fetchUpstream).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  // The proxy signs nothing, but it lends this host's address to whoever reaches it. Same
  // door, same lock as /submit.
  describe('is gated exactly like /submit', () => {
    it('answers 401 to a tokenless request when a token is configured', async () => {
      const fetchUpstream = okStub()
      const s = await start({ fetchUpstream, authToken: 'sekret' })
      try {
        const res = await request(s.port, '/api/quote', A_QUOTE)
        expect(res.status).toBe(401)
        expect(fetchUpstream).not.toHaveBeenCalled()
      } finally {
        await s.close()
      }
    })

    it('accepts the same request once it carries the token', async () => {
      const fetchUpstream = okStub()
      const s = await start({ fetchUpstream, authToken: 'sekret' })
      try {
        const res = await request(s.port, '/api/quote', A_QUOTE, {
          ...JSON_HEADERS, 'x-relayer-auth': 'sekret',
        })
        expect(res.status).toBe(200)
      } finally {
        await s.close()
      }
    })

    it('answers 403 to an origin that was never configured', async () => {
      const fetchUpstream = okStub()
      const s = await start({ fetchUpstream })
      try {
        const res = await request(s.port, '/api/quote', A_QUOTE, {
          ...JSON_HEADERS, origin: 'https://evil.example',
        })
        expect(res.status).toBe(403)
        expect(fetchUpstream).not.toHaveBeenCalled()
      } finally {
        await s.close()
      }
    })

    it('answers 415 to anything that is not application/json', async () => {
      const fetchUpstream = okStub()
      const s = await start({ fetchUpstream })
      try {
        const res = await request(s.port, '/api/quote', A_QUOTE, { 'content-type': 'text/plain' })
        expect(res.status).toBe(415)
        expect(fetchUpstream).not.toHaveBeenCalled()
      } finally {
        await s.close()
      }
    })
  })

  describe('per-IP daily cap', () => {
    it('answers 429 past the cap, and says when it reopens', async () => {
      const fetchUpstream = okStub()
      const s = await start({
        fetchUpstream, quoteCounter: createQuoteCounter(2, 1_000), visitorSalt: A_SALT, now: () => T0,
      })
      try {
        expect((await request(s.port, '/api/quote', A_QUOTE)).status).toBe(200)
        expect((await request(s.port, '/api/quote', A_QUOTE)).status).toBe(200)
        const refused = await request(s.port, '/api/quote', A_QUOTE)
        expect(refused.status).toBe(429)
        expect(refused.body.error).toMatch(/00:00 UTC/)
        expect(fetchUpstream).toHaveBeenCalledTimes(2)
      } finally {
        await s.close()
      }
    })

    it('resets at the UTC day boundary', async () => {
      let clock = T0
      const s = await start({
        fetchUpstream: okStub(), quoteCounter: createQuoteCounter(1, 1_000), visitorSalt: A_SALT,
        now: () => clock,
      })
      try {
        expect((await request(s.port, '/api/quote', A_QUOTE)).status).toBe(200)
        expect((await request(s.port, '/api/quote', A_QUOTE)).status).toBe(429)
        clock = NEXT_DAY
        expect((await request(s.port, '/api/quote', A_QUOTE)).status).toBe(200)
      } finally {
        await s.close()
      }
    })

    // Charging quotes against the sponsorship budget would let anyone burn a visitor's
    // sponsored registration — the thing this product gives away — by asking for prices.
    it('never spends the sponsorship budget', async () => {
      const sponsorship = new SponsorshipLedger(
        { perVisitor: 1, daily: 1 }, new MemorySponsorshipStore(), T0,
      )
      const s = await start({
        fetchUpstream: okStub(), sponsorship, quoteCounter: createQuoteCounter(5, 1_000), now: () => T0,
      })
      try {
        for (let i = 0; i < 5; i++) {
          expect((await request(s.port, '/api/quote', A_QUOTE)).status).toBe(200)
        }
        // Five quotes later, the one sponsored submission is still available.
        expect((await request(s.port, '/submit', { calls: [A_CALL] })).status).toBe(200)
      } finally {
        await s.close()
      }
    })

    it('does not meter the route at all when no counter is configured', async () => {
      const s = await start({ fetchUpstream: okStub() })
      try {
        for (let i = 0; i < 4; i++) {
          expect((await request(s.port, '/api/quote', A_QUOTE)).status).toBe(200)
        }
      } finally {
        await s.close()
      }
    })

    // A malformed body costs us no upstream request, so charging quota for it would let a
    // broken caller lock itself out of a service it never actually used.
    it.each([
      ['an unparseable body', 'not json'],
      ['a null body', 'null'],
      ['a non-string query value', { ...A_QUOTE, query: { amount: 5 } }],
      ['a relative path', { target: 'avnuQuotes', path: 'swap' }],
    ])('does not spend quota on %s', async (_label, body) => {
      const fetchUpstream = okStub()
      const s = await start({
        fetchUpstream, quoteCounter: createQuoteCounter(1, 1_000), visitorSalt: A_SALT,
        now: () => T0,
      })
      try {
        expect((await request(s.port, '/api/quote', body)).status).not.toBe(429)
        expect(fetchUpstream).not.toHaveBeenCalled()
        // The one good request still goes through, so nothing was consumed above.
        expect((await request(s.port, '/api/quote', A_QUOTE)).status).toBe(200)
      } finally {
        await s.close()
      }
    })
  })

  // The per-visitor cap bounds one address; it does not bound the bill. A rotating IPv6 /64
  // mints a fresh visitor id per request, so these two are what actually hold.
  describe('caps that survive cheap addresses', () => {
    const counterFor = (perVisitor: number, global: number, maxTracked?: number) =>
      createQuoteCounter(perVisitor, global, maxTracked)

    it('refuses past the global cap even when every request is a new visitor', () => {
      const counter = counterFor(100, 3)
      for (let i = 0; i < 3; i++) expect(counter.tryConsume(`visitor-${i}`, T0)).toBe(true)
      expect(counter.tryConsume('visitor-fresh', T0)).toBe(false)
    })

    it('stops tracking new visitors past the map bound, while regulars keep counting', () => {
      const counter = counterFor(5, 1_000_000, 2)
      expect(counter.tryConsume('a', T0)).toBe(true)
      expect(counter.tryConsume('b', T0)).toBe(true)
      expect(counter.tryConsume('c', T0)).toBe(false)   // map is full; no new entry
      expect(counter.tryConsume('a', T0)).toBe(true)    // already tracked, still served
    })

    // A clock stepping backwards — NTP correction, a VM resuming from a snapshot — must not
    // read as a new day and hand out a whole fresh day's quota.
    it('rolls the day forward only', () => {
      const counter = counterFor(1, 1_000)
      expect(counter.tryConsume('a', NEXT_DAY)).toBe(true)
      expect(counter.tryConsume('a', NEXT_DAY)).toBe(false)
      expect(counter.tryConsume('a', T0)).toBe(false)        // yesterday buys nothing
      expect(counter.tryConsume('a', NEXT_DAY + 86_400_000)).toBe(true)   // tomorrow does
    })

    it('resets both counters when the day does roll', () => {
      const counter = counterFor(1, 1)
      expect(counter.tryConsume('a', T0)).toBe(true)
      expect(counter.tryConsume('b', T0)).toBe(false)        // global cap of 1
      expect(counter.tryConsume('b', NEXT_DAY)).toBe(true)
    })
  })

  // An empty salt makes a visitor id a plain SHA-256 of the address: identical on every
  // deployment, and therefore precomputable rather than merely opaque.
  it('never hashes visitors with an empty salt, even with no ledger configured', async () => {
    const seen = new Set<string>()
    const counter = {
      tryConsume(visitor: string) {
        seen.add(visitor)
        return true
      },
    }
    const s = await start({ fetchUpstream: okStub(), quoteCounter: counter, now: () => T0 })
    try {
      await request(s.port, '/api/quote', A_QUOTE)
      const [id] = [...seen]
      expect(id).toBeTruthy()
      // Whatever salt was minted, it is not the empty one.
      expect(id).not.toBe(visitorId('127.0.0.1', '', T0))
    } finally {
      await s.close()
    }
  })

  // ── The invite waiver, at the level of the decision function (story 1.14) ────────────────
  //
  // The routes and the wiring are exercised in invite.test.ts. What belongs HERE is the
  // property the sponsorship gate itself has to hold, because this is the file that owns what
  // that gate promises: a waiver moves ONE line and cannot move the other.
  describe('a burned invite waives the per-visitor cap and nothing else', () => {
    const CAPS = { perVisitor: 1, daily: 3 }
    const spent = (over: Partial<ReturnType<typeof emptyBudget>> = {}) => ({
      ...emptyBudget(T0),
      perVisitor: { v: 1 },
      ...over,
    })

    it('waives an exhausted per-visitor cap', () => {
      expect(decideSponsorship(spent(), CAPS, 'v', T0)).toMatchObject({ reason: 'visitor-cap' })
      expect(decideSponsorship(spent(), CAPS, 'v', T0, undefined, { waivePerVisitorCap: true }))
        .toEqual({ allow: true })
    })

    it('does NOT waive the daily budget — that is the relayer solvency floor', () => {
      const exhausted = spent({ dailyCount: 3 })
      expect(decideSponsorship(exhausted, CAPS, 'v', T0, undefined, { waivePerVisitorCap: true }))
        .toMatchObject({ allow: false, reason: 'daily-budget', notice: BUDGET_EXHAUSTED_NOTICE })
    })

    it('still RECORDS the waived spend, so an invited registration is not invisible', () => {
      const ledger = new SponsorshipLedger(CAPS, new MemorySponsorshipStore({
        salt: A_SALT, budget: spent(), claimed: [],
      }), T0)
      expect(ledger.spend('v', T0, { waivePerVisitorCap: true })).toEqual({ allow: true })
      // Counted: the day moved, and so did this visitor's tally. Waiving a check is not the
      // same as not counting, and a spend nobody recorded is one the operator cannot find.
      expect(ledger.spend('v', T0, { waivePerVisitorCap: true })).toEqual({ allow: true })
      expect(ledger.spend('v', T0, { waivePerVisitorCap: true })).toEqual({ allow: true })
      // Three waived spends against a daily budget of three: the fourth hits the floor.
      expect(ledger.spend('v', T0, { waivePerVisitorCap: true })).toMatchObject({ reason: 'daily-budget' })
    })

    it('leaves every un-waived decision byte-identical to before', () => {
      // The option is additive: omitting it, and passing it false, must both behave exactly as
      // the two-argument call always did.
      for (const options of [undefined, {}, { waivePerVisitorCap: false }]) {
        expect(decideSponsorship(spent(), CAPS, 'v', T0, undefined, options))
          .toEqual(decideSponsorship(spent(), CAPS, 'v', T0))
      }
    })
  })
})
