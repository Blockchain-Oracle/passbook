import { describe, it, expect, afterEach } from 'vitest'
import http from 'node:http'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { NET } from '../../protocol/src/constants.js'
import {
  INVITE_ALREADY_USED_NOTICE,
  inviteExhaustedNotice,
  SEND_CAP_NOTICE,
} from '../../protocol/src/relayer-wire.js'
import {
  createRelayerServer,
  resolveInviteConfig,
  resolveSponsorshipCaps,
  openInviteLedger,
  type RelayerServerOptions,
} from '../src/server.js'
import { SponsorshipLedger } from '../src/sponsorship.js'
import { MemorySponsorshipStore } from '../src/sponsorship-store.js'
import {
  decideClaim,
  decideConsume,
  decideMint,
  InviteLedger,
  INVITE_ALPHABET,
  INVITE_CODE_LENGTH,
  INVITE_RETENTION_MS,
  inviterKeyFor,
  mintCode,
  normalizeCode,
  pruned,
  type InviteConfig,
} from '../src/invite.js'
import {
  FileInviteStore,
  MemoryInviteStore,
  emptyInvites,
  type InviteRecord,
  type InviteStore,
  type PersistedInvites,
} from '../src/invite-store.js'

const T0 = Date.UTC(2026, 7, 24, 12, 0, 0)
const HOUR = 3_600_000
const A_SALT = 'a'.repeat(64)
const A_CALL = { contractAddress: NET.pool, entrypoint: 'apply_actions', calldata: [] }
const JSON_HEADERS = { 'content-type': 'application/json' }

const CONFIG: InviteConfig = {
  allowance: 3,
  windowMs: 24 * HOUR,
  ttlMs: 72 * HOUR,
  claimAttemptsPerDay: 10,
  mintDailyGlobal: 50,
}

const tempDirs: string[] = []
function tempStorePath(name = 'invites.json'): string {
  const dir = mkdtempSync(join(tmpdir(), 'passbook-invites-'))
  tempDirs.push(dir)
  return join(dir, name)
}
afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true })
})

/** A store that can be made to fail on demand, standing in for a full or unwritable disk. */
class BreakableInviteStore implements InviteStore {
  failing = false
  constructor(private readonly inner = new MemoryInviteStore(emptyInvites(A_SALT))) {}
  load(): PersistedInvites {
    return this.inner.load()
  }
  save(next: PersistedInvites): void {
    if (this.failing) throw new Error('ENOSPC: no space left on device')
    this.inner.save(next)
  }
}

function ledger(over: Partial<InviteConfig> = {}, store: InviteStore = new MemoryInviteStore(emptyInvites(A_SALT))) {
  return new InviteLedger({ ...CONFIG, ...over }, store, T0)
}

/** Mints in a fixture, narrowing the union: a refusal here is a broken fixture, not a case. */
function mintCodeOf(l: InviteLedger, inviter = 'inviter'): string {
  const minted = l.mint(inviter, T0)
  if (!minted.allow) throw new Error(`fixture mint refused: ${minted.reason}`)
  return minted.code
}

function sponsorship(perVisitor = 1, daily = 20) {
  return new SponsorshipLedger(
    { perVisitor, daily },
    new MemorySponsorshipStore({ salt: A_SALT, budget: { utcDay: '', dailyCount: 0, perVisitor: {} }, claimed: [] }),
    T0,
  )
}

async function start(extra: Partial<RelayerServerOptions> = {}) {
  const server = createRelayerServer({
    submit: async () => '0xok',
    resolveApproveCeiling: async () => 0n,
    now: () => T0,
    ...extra,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { port, close: () => new Promise<void>((r) => server.close(() => r())) }
}

/** A relayer with invites AND both budgets — the only shape `createRelayerServer` accepts. */
async function startWithInvites(
  invites: InviteLedger,
  sponsor: SponsorshipLedger = sponsorship(),
  extra: Partial<RelayerServerOptions> = {},
) {
  return start({
    invites,
    sponsorship: sponsor,
    sendBudget: new SponsorshipLedger(
      { perVisitor: 10_000, daily: 10_000 },
      new MemorySponsorshipStore(),
      T0,
      SEND_CAP_NOTICE,
    ),
    visitorSalt: invites.salt,
    ...extra,
  })
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

describe('the invite code itself', () => {
  it('draws six characters from the 32-character unambiguous alphabet, and only those', () => {
    expect(INVITE_ALPHABET).toHaveLength(32)
    // The four Crockford exclusions. Their presence is what a transcription error looks like.
    for (const ambiguous of ['i', 'l', 'o', 'u']) expect(INVITE_ALPHABET).not.toContain(ambiguous)
    for (let i = 0; i < 200; i++) {
      const code = mintCode()
      expect(code).toHaveLength(INVITE_CODE_LENGTH)
      for (const ch of code) expect(INVITE_ALPHABET).toContain(ch)
    }
  })

  it('is not derived from anything: 500 draws collide never', () => {
    const seen = new Set(Array.from({ length: 500 }, () => mintCode()))
    expect(seen.size).toBe(500)
  })

  it('reaches every character of the alphabet, so the masking is not biased toward a prefix', () => {
    // `& 31` is unbiased only because the alphabet is exactly 32 long. If someone shortens it,
    // the tail characters stop appearing — this is the assertion that notices.
    const seen = new Set<string>()
    for (let i = 0; i < 5_000; i++) for (const ch of mintCode()) seen.add(ch)
    expect(seen.size).toBe(32)
  })

  it('normalises case and surrounding whitespace, and repairs nothing else', () => {
    expect(normalizeCode('7F3A2B')).toBe('7f3a2b')
    expect(normalizeCode('  7f3a2b\n')).toBe('7f3a2b')
    // `o`, `i`, `l` and `u` are NOT mapped onto digits: two strings must never name one code.
    expect(normalizeCode('7f3a2o')).toBeNull()
    expect(normalizeCode('7f3a2u')).toBeNull()
    expect(normalizeCode('7f3a2')).toBeNull()
    expect(normalizeCode('7f3a2bc')).toBeNull()
    expect(normalizeCode(7)).toBeNull()
    expect(normalizeCode(undefined)).toBeNull()
  })
})

describe('decideMint — the rolling window (I/O matrix rows 1-2)', () => {
  const key = 'inviter-1'
  const mints = (times: number[]): InviteRecord[] =>
    times.map((mintedAt, i) => ({ code: `c${i}`, mintedAt, expiresAt: mintedAt + CONFIG.ttlMs, inviterKey: key }))

  it('allows a mint while the window has room, reporting the POST-mint world', () => {
    // Both numbers describe the state after this mint: 2 left, and the mint being made right
    // now returns in a full window. `null` here would render `3 left` a moment after a mint.
    const d = decideMint([], key, CONFIG, T0)
    expect(d).toEqual({ allow: true, left: 2, nextInHours: 24 })
  })

  it('reports nextInHours as the wait for the OLDEST mint to fall out of the window', () => {
    // One mint five hours ago: with a 24h window, one returns in 19h — the Flow W2 number.
    const d = decideMint(mints([T0 - 5 * HOUR]), key, CONFIG, T0)
    expect(d).toEqual({ allow: true, left: 1, nextInHours: 19 })
  })

  it('gives the LAST mint its clock too — zero left is never a locked door', () => {
    // The third mint exhausts the allowance, and the answer must already carry when one
    // returns; computing from the pre-mint window would answer `{ left: 0, nextInHours: null }`.
    const d = decideMint(mints([T0 - 5 * HOUR, T0 - 2 * HOUR]), key, CONFIG, T0)
    expect(d).toEqual({ allow: true, left: 0, nextInHours: 19 })
  })

  it('refuses when the window is full, and the refusal carries its own clock', () => {
    const d = decideMint(mints([T0 - 5 * HOUR, T0 - 2 * HOUR, T0 - HOUR]), key, CONFIG, T0)
    expect(d.allow).toBe(false)
    expect(d).toMatchObject({ reason: 'invite-allowance-exhausted', left: 0, nextInHours: 19 })
    // Never a locked door: the refusal is a sentence with a number in it.
    expect(d.allow === false && d.notice).toBe('No invites left. One returns in 19 hours.')
  })

  it('lets a mint back in once the oldest has aged out of the window', () => {
    const old = mints([T0 - 25 * HOUR, T0 - 26 * HOUR, T0 - 27 * HOUR])
    expect(decideMint(old, key, CONFIG, T0).allow).toBe(true)
  })

  it('counts only THIS inviter, so one busy inviter cannot spend another allowance', () => {
    const others: InviteRecord[] = [0, 1, 2].map((i) => ({
      code: `x${i}`, mintedAt: T0 - HOUR, expiresAt: T0 + HOUR, inviterKey: 'someone-else',
    }))
    expect(decideMint(others, key, CONFIG, T0).allow).toBe(true)
  })

  it('counts a mint against the window whatever became of it — claimed, expired or ignored', () => {
    // Otherwise an inviter mints, lets it expire, and mints again immediately: the allowance
    // would meter outcomes rather than mints, and would not be an allowance.
    const spent = mints([T0 - HOUR, T0 - 2 * HOUR, T0 - 3 * HOUR]).map((r) => ({
      ...r, expiresAt: T0 - 1, claimedAt: T0 - 30 * 60_000,
    }))
    expect(decideMint(spent, key, CONFIG, T0).allow).toBe(false)
  })

  it('rounds the wait UP, so the row never promises a return sooner than it happens', () => {
    // 23h30m left rounds to 24, not 23: "1 more in 23h" would be a promise that lapses early.
    const d = decideMint(mints([T0 - 30 * 60_000]), key, CONFIG, T0)
    expect(d.allow === true && d.nextInHours).toBe(24)
  })
})

describe('decideMint — the global daily ceiling', () => {
  // Fifty mints spread across fifty different inviters inside the last day. No single
  // allowance is anywhere near spent; only the relayer's own ceiling is.
  const crowd = (n: number, at = T0 - 6 * HOUR): InviteRecord[] =>
    Array.from({ length: n }, (_, i) => ({
      code: `g${i}`, mintedAt: at, expiresAt: at + CONFIG.ttlMs, inviterKey: `inviter-${i}`,
    }))

  it('refuses past the ceiling, whoever is asking, with the same clocked never-locked shape', () => {
    const d = decideMint(crowd(50), 'a-fresh-inviter', CONFIG, T0)
    expect(d).toMatchObject({ allow: false, reason: 'invite-mint-daily-cap', left: 0, nextInHours: 18 })
    expect(d.allow === false && d.notice).toBe('No invites left. One returns in 18 hours.')
  })

  it('binds on the whole crowd, not on the asker: one under the ceiling still mints', () => {
    expect(decideMint(crowd(49), 'a-fresh-inviter', CONFIG, T0).allow).toBe(true)
  })

  it('measures a fixed day, so yesterday mints do not count against today', () => {
    expect(decideMint(crowd(50, T0 - 25 * HOUR), 'a-fresh-inviter', CONFIG, T0).allow).toBe(true)
  })
})

describe('decideClaim / decideConsume — the burn (I/O matrix rows 3-6)', () => {
  const record = (over: Partial<InviteRecord> = {}): InviteRecord => ({
    code: '7f3a2b', mintedAt: T0 - HOUR, expiresAt: T0 + HOUR, inviterKey: 'k', ...over,
  })
  const state = (invites: InviteRecord[], counts: Record<string, number> = {}): PersistedInvites => ({
    salt: A_SALT, invites, attempts: { utcDay: '2026-08-24', counts },
  })

  it('burns a fresh, unexpired code', () => {
    expect(decideClaim(state([record()]), '7f3a2b', 'v', CONFIG, T0).allow).toBe(true)
  })

  it('refuses an already-claimed code with the verbatim double-claim notice', () => {
    const d = decideClaim(state([record({ claimedAt: T0 - 60_000 })]), '7f3a2b', 'v', CONFIG, T0)
    expect(d).toEqual({ allow: false, reason: 'invite-already-used', notice: INVITE_ALREADY_USED_NOTICE })
  })

  it('separates expired from never-minted', () => {
    expect(decideClaim(state([record({ expiresAt: T0 - 1 })]), '7f3a2b', 'v', CONFIG, T0))
      .toEqual({ allow: false, reason: 'invite-expired' })
    expect(decideClaim(state([]), '7f3a2b', 'v', CONFIG, T0))
      .toEqual({ allow: false, reason: 'invite-not-found' })
  })

  it('calls a claimed-then-expired code already-used, not expired', () => {
    // The loser of a race needs to know the invite is gone, not to go looking for a new link.
    const d = decideClaim(state([record({ claimedAt: T0 - HOUR, expiresAt: T0 - 1 })]), '7f3a2b', 'v', CONFIG, T0)
    expect(d).toMatchObject({ reason: 'invite-already-used' })
  })

  it('checks the attempt cap BEFORE looking the code up, so a capped visitor gets no oracle', () => {
    const capped = state([record()], { v: CONFIG.claimAttemptsPerDay })
    // A real code and a fake code answer identically once the cap binds.
    expect(decideClaim(capped, '7f3a2b', 'v', CONFIG, T0)).toEqual({ allow: false, reason: 'invite-too-many-attempts' })
    expect(decideClaim(capped, 'zzzzzz', 'v', CONFIG, T0)).toEqual({ allow: false, reason: 'invite-too-many-attempts' })
  })

  it('counts attempts per visitor, so one guesser cannot cap everyone else', () => {
    const s = state([record()], { guesser: CONFIG.claimAttemptsPerDay })
    expect(decideClaim(s, '7f3a2b', 'someone-else', CONFIG, T0).allow).toBe(true)
  })

  it('rolls the attempt counter when the UTC day turns', () => {
    const s: PersistedInvites = { ...state([record()]), attempts: { utcDay: '2026-08-23', counts: { v: 99 } } }
    expect(decideClaim(s, '7f3a2b', 'v', CONFIG, T0).allow).toBe(true)
  })

  it('answers the WINNER retrying with the same yes, not the loser copy', () => {
    // A claim whose response was lost gets retried by the browser that already won the burn;
    // `invite-already-used` there would lock the real invitee out of the invite they hold. The
    // replay keys on the client's claimant TOKEN, not the visitor — behind one NAT the loser
    // shares the winner's IP, and only the token can honestly say "that was me".
    const s = state([record({ claimedAt: T0 - 60_000, claimedBy: 'winner-token-1' })])
    expect(decideClaim(s, '7f3a2b', 'v', CONFIG, T0, 'winner-token-1')).toMatchObject({
      allow: true, replay: true,
    })
    // Same IP, different browser: a different token, and the honest loser answer.
    expect(decideClaim(s, '7f3a2b', 'v', CONFIG, T0, 'other-token-2')).toMatchObject({
      allow: false, reason: 'invite-already-used',
    })
    // No token offered → no replay, however the IPs line up.
    expect(decideClaim(s, '7f3a2b', 'v', CONFIG, T0)).toMatchObject({
      allow: false, reason: 'invite-already-used',
    })
  })

  it('never replays a burn that recorded no token, whatever a claimant offers', () => {
    const s = state([record({ claimedAt: T0 - 60_000 })])
    expect(decideClaim(s, '7f3a2b', 'v', CONFIG, T0, 'any-token-99')).toMatchObject({
      allow: false, reason: 'invite-already-used',
    })
  })

  it('stops replaying once the code is consumed — one registration, however many retries', () => {
    const s = state([record({ claimedAt: T0 - HOUR, claimedBy: 'winner-token-1', consumedAt: T0 - 60_000 })])
    expect(decideClaim(s, '7f3a2b', 'v', CONFIG, T0, 'winner-token-1')).toMatchObject({
      allow: false, reason: 'invite-already-used',
    })
  })

  it('lets a claimed code pay for a registration, once and only once', () => {
    expect(decideConsume([record({ claimedAt: T0 })], '7f3a2b', T0)).toMatchObject({ allow: true })
    expect(decideConsume([record({ claimedAt: T0, consumedAt: T0 })], '7f3a2b', T0))
      .toEqual({ allow: false, reason: 'invite-consumed' })
    expect(decideConsume([record()], '7f3a2b', T0)).toEqual({ allow: false, reason: 'invite-not-claimed' })
    expect(decideConsume([], '7f3a2b', T0)).toEqual({ allow: false, reason: 'invite-not-found' })
  })

  it('does NOT re-check expiry on consume: a claimed code still pays after its TTL', () => {
    // Refusing here would strand a real invitee midway through the five-screen ceremony.
    expect(decideConsume([record({ claimedAt: T0 - HOUR, expiresAt: T0 - 1 })], '7f3a2b', T0))
      .toMatchObject({ allow: true })
  })
})

describe('InviteLedger — atomicity and durability', () => {
  it('has exactly one winner for two concurrent claims of one code', () => {
    const l = ledger()
    const code = mintCodeOf(l)
    // Fired without awaiting anything in between, which is the whole claim: nothing in `claim`
    // yields, so there is no window in which both observe the unburned record.
    const results = [l.claim(code, 'a', T0), l.claim(code, 'b', T0)]
    expect(results.filter((r) => r.allow)).toHaveLength(1)
    const loser = results.find((r) => !r.allow)!
    expect(loser).toMatchObject({ reason: 'invite-already-used', notice: INVITE_ALREADY_USED_NOTICE })
  })

  it('persists a burn before mutating memory, so a failed write burns nothing', () => {
    const store = new BreakableInviteStore()
    const l = new InviteLedger(CONFIG, store, T0)
    const code = mintCodeOf(l)
    store.failing = true
    expect(() => l.claim(code, 'v', T0)).toThrow(/ENOSPC/)
    // The exception reached the caller AND the code is still claimable — the failure is a
    // refusal to burn, not a burn nobody recorded.
    store.failing = false
    expect(l.claim(code, 'v', T0).allow).toBe(true)
  })

  it('persists a mint before mutating memory', () => {
    const store = new BreakableInviteStore()
    const l = new InviteLedger(CONFIG, store, T0)
    store.failing = true
    expect(() => l.mint('inviter', T0)).toThrow(/ENOSPC/)
    store.failing = false
    // Nothing was recorded, so the whole allowance is still there.
    expect(l.mint('inviter', T0).left).toBe(2)
  })

  it('survives a restart: burns stay burned and mints stay counted', () => {
    const path = tempStorePath()
    const first = new InviteLedger(CONFIG, new FileInviteStore(path), T0)
    const code = mintCodeOf(first)
    expect(first.claim(code, 'v', T0).allow).toBe(true)

    const second = new InviteLedger(CONFIG, new FileInviteStore(path), T0 + 60_000)
    // The burn survived...
    expect(second.claim(code, 'w', T0 + 60_000)).toMatchObject({ reason: 'invite-already-used' })
    // ...and so did the mint's place in the window.
    expect(second.mint('inviter', T0 + 60_000).left).toBe(1)
  })

  it('consumes a claimed code exactly once across a restart', () => {
    const path = tempStorePath()
    const first = new InviteLedger(CONFIG, new FileInviteStore(path), T0)
    const code = mintCodeOf(first)
    first.claim(code, 'v', T0)
    expect(first.consume(code, T0).allow).toBe(true)

    const second = new InviteLedger(CONFIG, new FileInviteStore(path), T0 + 60_000)
    expect(second.consume(code, T0 + 60_000)).toEqual({ allow: false, reason: 'invite-consumed' })
  })

  it('keys the inviter WITHOUT the UTC day, so a window survives midnight', () => {
    // The whole reason this is not `visitorId`. Same address, two days, one allowance.
    expect(inviterKeyFor('1.2.3.4', A_SALT)).toBe(inviterKeyFor('1.2.3.4', A_SALT))
    expect(inviterKeyFor('1.2.3.4', A_SALT)).not.toBe(inviterKeyFor('5.6.7.8', A_SALT))

    const l = ledger()
    const key = l.inviterKey('1.2.3.4')
    l.mint(key, T0)
    l.mint(key, T0)
    l.mint(key, T0)
    // 03:00 UTC the next morning — past midnight, still inside the 24h window.
    const pastMidnight = Date.UTC(2026, 7, 25, 3, 0, 0)
    expect(l.mint(l.inviterKey('1.2.3.4'), pastMidnight).allow).toBe(false)
  })

  it('charges a status MISS against the attempt cap and a hit against nothing', () => {
    const l = ledger({ claimAttemptsPerDay: 2 })
    const code = mintCodeOf(l)
    // A sender polling their own real code, forever, is never charged.
    for (let i = 0; i < 50; i++) expect(l.status(code, 'sender', T0)).toEqual({ found: true, state: 'unclaimed' })
    // A prober asking about codes that do not exist runs out.
    expect(l.status('zzzzzz', 'prober', T0)).toEqual({ found: false, reason: 'invite-not-found' })
    expect(l.status('zzzzzy', 'prober', T0)).toEqual({ found: false, reason: 'invite-not-found' })
    expect(l.status('zzzzzx', 'prober', T0)).toEqual({ found: false, reason: 'invite-too-many-attempts' })
    // And having spent them on the status route, they cannot then claim either.
    expect(l.claim(code, 'prober', T0)).toEqual({ allow: false, reason: 'invite-too-many-attempts' })
  })

  it('reports consumed as claimed, so the sender never reads someone else traffic', () => {
    const l = ledger()
    const code = mintCodeOf(l)
    l.claim(code, 'v', T0)
    expect(l.status(code, 'sender', T0)).toEqual({ found: true, state: 'claimed' })
    l.consume(code, T0)
    expect(l.status(code, 'sender', T0)).toEqual({ found: true, state: 'claimed' })
  })

  it('reports an unclaimed code past its TTL as expired', () => {
    const l = ledger()
    const code = mintCodeOf(l)
    expect(l.status(code, 'sender', T0 + CONFIG.ttlMs + 1)).toEqual({ found: true, state: 'expired' })
  })

  it('prunes only records nothing will ask about again', () => {
    const long = T0 - INVITE_RETENTION_MS - HOUR
    const keep: InviteRecord = { code: 'keep00', mintedAt: T0, expiresAt: T0 + HOUR, inviterKey: 'k' }
    const claimedLongAgo: InviteRecord = { code: 'claim0', mintedAt: long, expiresAt: long, inviterKey: 'k', claimedAt: long, claimedBy: 'v' }
    const stillClaimable: InviteRecord = { code: 'fresh0', mintedAt: long, expiresAt: T0 + HOUR, inviterKey: 'k' }
    expect(pruned([keep, claimedLongAgo, stillClaimable], T0).map((r) => r.code)).toEqual(['keep00', 'fresh0'])
  })

  it('never prunes a mint still inside the allowance window, however long that window is', () => {
    // An operator may set the window LONGER than the retention. A finished mint pruned while
    // still in-window would make `mintsInWindow` undercount — a ceiling that leaks is the one
    // direction a ceiling must never fail.
    const windowMs = 30 * 24 * HOUR
    const old = T0 - INVITE_RETENTION_MS - HOUR
    const inWindow: InviteRecord = { code: 'window', mintedAt: old, expiresAt: old, inviterKey: 'k' }
    expect(pruned([inWindow], T0, windowMs).map((r) => r.code)).toEqual(['window'])
    // And with the default 24h window it goes, as before.
    expect(pruned([inWindow], T0, CONFIG.windowMs)).toEqual([])
  })

  it('answers a winner retry from memory: no attempt charged, nothing rewritten', () => {
    // Cap 2: the real claim charges the winner's first attempt (successful or not, a claim is
    // an attempt), and the cap-first check must still let the replay through on the second.
    const store = new BreakableInviteStore()
    const l = ledger({ claimAttemptsPerDay: 2 }, store)
    const code = mintCodeOf(l)
    expect(l.claim(code, 'v', T0, 'winner-token-1').allow).toBe(true)
    // The store now refuses every write. A replay needs none — proof it neither re-burns nor
    // charges — and it stays answerable indefinitely, not just once.
    store.failing = true
    expect(l.claim(code, 'v', T0, 'winner-token-1')).toMatchObject({ allow: true, replay: true })
    expect(l.claim(code, 'v', T0, 'winner-token-1')).toMatchObject({ allow: true, replay: true })
  })

  it('persists the winning token, so the replay answer survives a restart', () => {
    const store = new MemoryInviteStore(emptyInvites(A_SALT))
    const first = ledger({}, store)
    const code = mintCodeOf(first)
    expect(first.claim(code, 'v', T0, 'winner-token-1').allow).toBe(true)
    const restarted = ledger({}, store)
    expect(restarted.claim(code, 'v', T0, 'winner-token-1')).toMatchObject({ allow: true, replay: true })
    expect(restarted.claim(code, 'v', T0, 'other-token-2')).toMatchObject({
      allow: false, reason: 'invite-already-used',
    })
  })

  it('refuses a capped visitor on status BEFORE the lookup — hits included', () => {
    // Answering hits while refusing misses would let a capped visitor keep distinguishing live
    // codes from dead ones by the shape of the refusal.
    const l = ledger({ claimAttemptsPerDay: 1 })
    const code = mintCodeOf(l)
    expect(l.status('zzzzzz', 'prober', T0)).toMatchObject({ found: false, reason: 'invite-not-found' })
    expect(l.status(code, 'prober', T0)).toMatchObject({ found: false, reason: 'invite-too-many-attempts' })
    // A visitor under the cap still reads the same code fine.
    expect(l.status(code, 'sender', T0)).toMatchObject({ found: true, state: 'unclaimed' })
  })

  it('meters the /submit vet exactly like a claim: refusals charge, a valid code does not', () => {
    const l = ledger({ claimAttemptsPerDay: 2 })
    const code = mintCodeOf(l)
    expect(l.claim(code, 'invitee', T0).allow).toBe(true)
    // Two misses spend the prober's attempts; the third refusal is the cap, code unseen.
    expect(l.vetForSubmit('zzzzzz', 'prober', T0)).toMatchObject({ allow: false, reason: 'invite-not-found' })
    expect(l.vetForSubmit('yyyyyy', 'prober', T0)).toMatchObject({ allow: false, reason: 'invite-not-found' })
    expect(l.vetForSubmit(code, 'prober', T0)).toMatchObject({ allow: false, reason: 'invite-too-many-attempts' })
    // The invitee's own vet costs nothing, however often the client retries it.
    for (let i = 0; i < 5; i++) expect(l.vetForSubmit(code, 'invitee', T0).allow).toBe(true)
  })
})

describe('the invite store', () => {
  it('refuses to start on a corrupt file rather than silently un-burning every code', () => {
    const path = tempStorePath()
    writeFileSync(path, '{ not json')
    expect(() => new FileInviteStore(path).load()).toThrow(/unreadable/)
  })

  it('refuses a short salt, a bad record, a duplicate code and a laundered timestamp', () => {
    const cases: [string, unknown][] = [
      ['salt', { salt: 'abc', invites: [], attempts: { utcDay: '', counts: {} } }],
      ['claim-attempt count', { salt: A_SALT, invites: [], attempts: { utcDay: '', counts: { v: 'lots' } } }],
      ['mintedAt', { salt: A_SALT, invites: [{ code: 'a', mintedAt: null, expiresAt: 1, inviterKey: 'k' }], attempts: { utcDay: '', counts: {} } }],
      ['twice', {
        salt: A_SALT,
        invites: [
          { code: 'a', mintedAt: 1, expiresAt: 2, inviterKey: 'k' },
          { code: 'a', mintedAt: 1, expiresAt: 2, inviterKey: 'k' },
        ],
        attempts: { utcDay: '', counts: {} },
      }],
      ['consumed without ever having been claimed', {
        salt: A_SALT,
        invites: [{ code: 'a', mintedAt: 1, expiresAt: 2, inviterKey: 'k', consumedAt: 3 }],
        attempts: { utcDay: '', counts: {} },
      }],
      // A claimant token with no claim was hand-edited: `claimedBy` is written only by the
      // burn. (A claim WITHOUT a token is legal — the claimer simply offered none.)
      ['has a claimedBy of v', {
        salt: A_SALT,
        invites: [{ code: 'a', mintedAt: 1, expiresAt: 2, inviterKey: 'k', claimedBy: 'v' }],
        attempts: { utcDay: '', counts: {} },
      }],
    ]
    for (const [why, value] of cases) {
      const path = tempStorePath()
      writeFileSync(path, JSON.stringify(value))
      expect(() => new FileInviteStore(path).load(), why).toThrow(new RegExp(why.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    }
  })

  it('creates the file on first boot, so a bad path fails at startup and not at the first mint', () => {
    const path = join(tempStorePath(), 'nested', 'invites.json')
    const store = new FileInviteStore(path)
    expect(store.load().invites).toEqual([])
    expect(store.load().salt).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('the routes, behind the existing gates', () => {
  it('404s every invite route when this relayer offers no invites', async () => {
    const s = await start({})
    try {
      for (const path of ['/invite/mint', '/invite/claim', '/invite/status', '/api/invite/mint']) {
        expect((await request(s.port, path, {})).status).toBe(404)
      }
    } finally {
      await s.close()
    }
  })

  it('serves both the bare and the /api spellings', async () => {
    const s = await startWithInvites(ledger())
    try {
      expect((await request(s.port, '/invite/mint', {})).status).toBe(200)
      expect((await request(s.port, '/api/invite/mint', {})).status).toBe(200)
    } finally {
      await s.close()
    }
  })

  it('applies the content-type, Origin and auth gates in the existing order', async () => {
    const s = await startWithInvites(ledger(), sponsorship(), {
      allowedOrigins: new Set(['https://app.example']),
      authToken: 'secret',
    })
    try {
      // A cross-origin form's content type is what separates a web page from this endpoint.
      expect((await request(s.port, '/invite/mint', {}, { 'content-type': 'text/plain' })).status).toBe(415)
      expect(
        (await request(s.port, '/invite/mint', {}, { ...JSON_HEADERS, origin: 'https://evil.example' })).status,
      ).toBe(403)
      expect((await request(s.port, '/invite/mint', {})).status).toBe(401)
      const ok = await request(s.port, '/invite/mint', {}, { ...JSON_HEADERS, 'x-relayer-auth': 'secret' })
      expect(ok.status).toBe(200)
    } finally {
      await s.close()
    }
  })

  it('mints, then refuses with the numbers the copy needs (never a locked door)', async () => {
    const s = await startWithInvites(ledger({ allowance: 1 }))
    try {
      const first = await request(s.port, '/invite/mint', {})
      expect(first.status).toBe(200)
      expect(normalizeCode(first.body.code)).toBe(first.body.code)
      // Post-mint truth: the last code is gone AND the row already knows when one returns.
      expect(first.body).toMatchObject({ left: 0, nextInHours: 24 })

      const second = await request(s.port, '/invite/mint', {})
      expect(second.status).toBe(429)
      expect(second.body).toMatchObject({ reason: 'invite-allowance-exhausted', left: 0, nextInHours: 24 })
      expect(second.body.notice).toBe(inviteExhaustedNotice(24))
    } finally {
      await s.close()
    }
  })

  it('claims once; the second claim is a 409 carrying the verbatim notice', async () => {
    const l = ledger()
    const s = await startWithInvites(l)
    try {
      const { body } = await request(s.port, '/invite/mint', {})
      expect((await request(s.port, '/invite/claim', { code: body.code })).status).toBe(200)
      const loser = await request(s.port, '/invite/claim', { code: body.code })
      expect(loser.status).toBe(409)
      expect(loser.body).toMatchObject({ reason: 'invite-already-used', notice: INVITE_ALREADY_USED_NOTICE })
    } finally {
      await s.close()
    }
  })

  it('replays a claim to the browser holding the claimant token — and only to it', async () => {
    // The winner's response was lost; their retry carries the same client-minted token and gets
    // the same yes. A different browser on the SAME IP holds a different token and is honestly
    // the loser — which is exactly why the replay cannot key on the visitor id.
    const s = await startWithInvites(ledger())
    try {
      const { body } = await request(s.port, '/invite/mint', {})
      const claim = { code: body.code, claimant: 'winner-token-1' }
      expect((await request(s.port, '/invite/claim', claim)).status).toBe(200)
      expect((await request(s.port, '/invite/claim', claim)).status).toBe(200)
      const sameIpStranger = await request(s.port, '/invite/claim', { code: body.code, claimant: 'other-token-2' })
      expect(sameIpStranger.status).toBe(409)
      expect(sameIpStranger.body.reason).toBe('invite-already-used')
      // A malformed token is refused, never silently dropped into a tokenless burn.
      expect((await request(s.port, '/invite/claim', { code: body.code, claimant: 'x' })).status).toBe(400)
      expect((await request(s.port, '/invite/claim', { code: body.code, claimant: 42 })).status).toBe(400)
    } finally {
      await s.close()
    }
  })

  it('answers an unknown code the same 409 an already-used one gets', async () => {
    // The shared status is tidiness, not an enumeration defence — the body's reason token
    // legitimately distinguishes the cases (the client's typed branches need it). What stands
    // between a guesser and the code space is the attempt cap, charged on every miss.
    const s = await startWithInvites(ledger())
    try {
      const r = await request(s.port, '/invite/claim', { code: 'zzzzzz' })
      expect(r.status).toBe(409)
      expect(r.body.reason).toBe('invite-not-found')
    } finally {
      await s.close()
    }
  })

  it('answers 429 over HTTP once a visitor spends their claim attempts — claim and status both', async () => {
    const l = ledger({ claimAttemptsPerDay: 1 })
    const s = await startWithInvites(l)
    try {
      const { body } = await request(s.port, '/invite/mint', {})
      // One miss spends the only attempt.
      expect((await request(s.port, '/invite/claim', { code: 'zzzzzz' })).status).toBe(409)
      const cappedClaim = await request(s.port, '/invite/claim', { code: body.code })
      expect(cappedClaim.status).toBe(429)
      expect(cappedClaim.body.reason).toBe('invite-too-many-attempts')
      // The status route refuses cap-first too — a HIT included, so the refusal shape cannot
      // tell a capped enumerator which codes are live.
      const cappedStatus = await request(s.port, '/invite/status', { code: body.code })
      expect(cappedStatus.status).toBe(429)
      expect(cappedStatus.body.reason).toBe('invite-too-many-attempts')
    } finally {
      await s.close()
    }
  })

  it('answers a status miss 404 with its typed reason', async () => {
    const s = await startWithInvites(ledger())
    try {
      const r = await request(s.port, '/invite/status', { code: 'zzzzzz' })
      expect(r.status).toBe(404)
      expect(r.body.reason).toBe('invite-not-found')
    } finally {
      await s.close()
    }
  })

  it('refuses a malformed code without spending a claim attempt', async () => {
    const l = ledger({ claimAttemptsPerDay: 1 })
    const s = await startWithInvites(l)
    try {
      const { body } = await request(s.port, '/invite/mint', {})
      for (const code of ['', 'abc', 'toolongcode', 42, null, undefined]) {
        expect((await request(s.port, '/invite/claim', { code })).status).toBe(400)
      }
      // The one real attempt is still available.
      expect((await request(s.port, '/invite/claim', { code: body.code })).status).toBe(200)
    } finally {
      await s.close()
    }
  })

  it('reports status for the sender ladder', async () => {
    const s = await startWithInvites(ledger())
    try {
      const { body } = await request(s.port, '/invite/mint', {})
      expect((await request(s.port, '/invite/status', { code: body.code })).body).toEqual({ state: 'unclaimed' })
      await request(s.port, '/invite/claim', { code: body.code })
      expect((await request(s.port, '/invite/status', { code: body.code })).body).toEqual({ state: 'claimed' })
    } finally {
      await s.close()
    }
  })

  it('refuses a body that is not a JSON object', async () => {
    const s = await startWithInvites(ledger())
    try {
      for (const body of ['null', '7', '[]']) {
        expect((await request(s.port, '/invite/claim', body)).status).toBe(400)
      }
    } finally {
      await s.close()
    }
  })

  it('answers 500 rather than hanging when the ledger cannot be written', async () => {
    const store = new BreakableInviteStore()
    const l = new InviteLedger(CONFIG, store, T0)
    const s = await startWithInvites(l)
    try {
      store.failing = true
      const r = await request(s.port, '/invite/mint', {})
      expect(r.status).toBe(500)
      expect(r.body.error).toMatch(/could not be written/)
    } finally {
      await s.close()
    }
  })
})

describe('the sponsored-submit waiver (I/O matrix rows 7-8)', () => {
  /** A ledger holding one code that has been minted and claimed, ready to pay. */
  function claimedLedger() {
    const l = ledger()
    const code = mintCodeOf(l)
    l.claim(code, 'invitee', T0)
    return { l, code }
  }

  it('accepts an invited registration whose per-visitor cap is already exhausted', async () => {
    const { l, code } = claimedLedger()
    const sponsor = sponsorship(1, 20)
    const s = await startWithInvites(l, sponsor)
    try {
      // Strangers on this NAT-shared address already spent the per-visitor cap.
      const first = await request(s.port, '/submit', { calls: [A_CALL], sponsored: true })
      expect(first.status).toBe(200)
      const capped = await request(s.port, '/submit', { calls: [A_CALL], sponsored: true })
      expect(capped.status).toBe(403)
      expect(capped.body.reason).toBe('sponsorship-paused')

      // The invite gets through anyway — that is the whole point of the waiver.
      const invited = await request(s.port, '/submit', { calls: [A_CALL], sponsored: true, invite: code })
      expect(invited.status).toBe(200)

      // And exactly once: the code is consumed.
      const again = await request(s.port, '/submit', { calls: [A_CALL], sponsored: true, invite: code })
      expect(again.status).toBe(400)
      expect(again.body.reason).toBe('invite-consumed')
    } finally {
      await s.close()
    }
  })

  it('does NOT waive the global daily budget — a waiver is not a bypass', async () => {
    const { l, code } = claimedLedger()
    // A budget with one unit left in the DAY, and a per-visitor cap that is not the binding one.
    const sponsor = new SponsorshipLedger(
      { perVisitor: 10, daily: 1 },
      new MemorySponsorshipStore({ salt: A_SALT, budget: { utcDay: '2026-08-24', dailyCount: 1, perVisitor: {} }, claimed: [] }),
      T0,
    )
    const s = await startWithInvites(l, sponsor)
    try {
      const r = await request(s.port, '/submit', { calls: [A_CALL], sponsored: true, invite: code })
      expect(r.status).toBe(403)
      expect(r.body.reason).toBe('sponsorship-paused')
      // The invitee's code is INTACT: a budget refusal must not spend the invite too.
      expect(l.consumable(code, T0)).toMatchObject({ allow: true })
    } finally {
      await s.close()
    }
  })

  it('refuses an unclaimed code rather than silently ignoring it', async () => {
    const l = ledger()
    const code = mintCodeOf(l)
    const s = await startWithInvites(l)
    try {
      const r = await request(s.port, '/submit', { calls: [A_CALL], sponsored: true, invite: code })
      expect(r.status).toBe(400)
      expect(r.body.reason).toBe('invite-not-claimed')
    } finally {
      await s.close()
    }
  })

  it('refuses an unknown code, a malformed code, and a code on an unsponsored submission', async () => {
    const { l, code } = claimedLedger()
    const s = await startWithInvites(l)
    try {
      expect((await request(s.port, '/submit', { calls: [A_CALL], sponsored: true, invite: 'zzzzzz' })).body.reason)
        .toBe('invite-not-found')
      expect((await request(s.port, '/submit', { calls: [A_CALL], sponsored: true, invite: 'nope' })).status).toBe(400)
      const unsponsored = await request(s.port, '/submit', { calls: [A_CALL], invite: code })
      expect(unsponsored.status).toBe(400)
      expect(unsponsored.body.error).toMatch(/not sponsored/)
    } finally {
      await s.close()
    }
  })

  it('refuses a code on a relayer that offers no invites', async () => {
    const s = await start({
      sponsorship: sponsorship(),
      sendBudget: new SponsorshipLedger({ perVisitor: 99, daily: 99 }, new MemorySponsorshipStore(), T0, SEND_CAP_NOTICE),
    })
    try {
      const r = await request(s.port, '/submit', { calls: [A_CALL], sponsored: true, invite: '7f3a2b' })
      expect(r.status).toBe(400)
      expect(r.body.reason).toBe('invites-not-offered')
    } finally {
      await s.close()
    }
  })

  it('leaves an uninvited sponsored submission behaving exactly as before', async () => {
    const { l } = claimedLedger()
    const s = await startWithInvites(l, sponsorship(1, 20))
    try {
      expect((await request(s.port, '/submit', { calls: [A_CALL], sponsored: true })).status).toBe(200)
      const capped = await request(s.port, '/submit', { calls: [A_CALL], sponsored: true })
      expect(capped.status).toBe(403)
      expect(capped.body.reason).toBe('sponsorship-paused')
    } finally {
      await s.close()
    }
  })

  it('meters the /submit vet: guessed codes spend claim attempts, then 429', async () => {
    // Without this, /submit is the one route left answering "is this code live" for free —
    // a shape-valid body with a guessed code would read the typed refusal without limit.
    const l = ledger({ claimAttemptsPerDay: 2 })
    const s = await startWithInvites(l)
    try {
      for (const guess of ['zzzzzz', 'yyyyyy']) {
        const r = await request(s.port, '/submit', { calls: [A_CALL], sponsored: true, invite: guess })
        expect(r.status).toBe(400)
        expect(r.body.reason).toBe('invite-not-found')
      }
      const capped = await request(s.port, '/submit', { calls: [A_CALL], sponsored: true, invite: 'xxxxxx' })
      expect(capped.status).toBe(429)
      expect(capped.body.reason).toBe('invite-too-many-attempts')
    } finally {
      await s.close()
    }
  })

  it('refuses to sign when the consume cannot be written — 500, and the key never used', async () => {
    // The one partial-failure path where a burn and a signature could diverge: on a full disk
    // the consume write fails AFTER the budget accepted. Log-and-continue here would sign a
    // registration whose burn was never durably recorded — the next restart resurrects the
    // code and it pays twice.
    const store = new BreakableInviteStore()
    const l = new InviteLedger(CONFIG, store, T0)
    const code = mintCodeOf(l)
    l.claim(code, 'invitee', T0)
    let signed = 0
    const s = await startWithInvites(l, sponsorship(), {
      submit: async () => {
        signed++
        return '0xok'
      },
    })
    try {
      store.failing = true
      const r = await request(s.port, '/submit', { calls: [A_CALL], sponsored: true, invite: code })
      expect(r.status).toBe(500)
      expect(r.body.error).toMatch(/refusing to sign/)
      expect(signed).toBe(0)
    } finally {
      await s.close()
    }
  })
})

describe('construction and configuration guards', () => {
  it('refuses an invite ledger with no sponsorship budget behind it', () => {
    expect(() =>
      createRelayerServer({
        submit: async () => '0x0',
        resolveApproveCeiling: async () => 0n,
        invites: ledger(),
      }),
    ).toThrow(/without a sponsorship budget/)
  })

  it('refuses an invite ledger salted differently from the budget gates', () => {
    expect(() =>
      createRelayerServer({
        submit: async () => '0x0',
        resolveApproveCeiling: async () => 0n,
        invites: ledger({}, new MemoryInviteStore(emptyInvites('b'.repeat(64)))),
        sponsorship: sponsorship(),
        sendBudget: new SponsorshipLedger({ perVisitor: 9, daily: 9 }, new MemorySponsorshipStore(), T0, SEND_CAP_NOTICE),
        visitorSalt: A_SALT,
      }),
    ).toThrow(/different visitor salt/)
  })

  it('is off when the switch is unset', () => {
    expect(resolveInviteConfig({})).toBeUndefined()
  })

  it('refuses to start when only SOME invite variables are set', () => {
    for (const orphan of [
      'RELAYER_INVITE_WINDOW_HOURS',
      'RELAYER_INVITE_TTL_HOURS',
      'RELAYER_INVITE_CLAIM_ATTEMPTS',
      'RELAYER_INVITE_STORE',
    ]) {
      expect(() => resolveInviteConfig({ [orphan]: '24' }), orphan).toThrow(
        /RELAYER_INVITE_ALLOWANCE is\s+not/,
      )
    }
  })

  it('turns on with the switch alone, and the rest take their documented defaults', () => {
    expect(resolveInviteConfig({ RELAYER_INVITE_ALLOWANCE: '5' })).toEqual({
      allowance: 5,
      windowMs: 24 * HOUR,
      ttlMs: 72 * HOUR,
      claimAttemptsPerDay: 10,
      mintDailyGlobal: 50,
    })
  })

  it('holds the invite knobs to the same parsing rules as every other number', () => {
    expect(() => resolveInviteConfig({ RELAYER_INVITE_ALLOWANCE: 'lots' })).toThrow(/plain decimal digits/)
    expect(() => resolveInviteConfig({ RELAYER_INVITE_ALLOWANCE: '0' })).toThrow(/positive integer/)
    expect(() => resolveInviteConfig({ RELAYER_INVITE_ALLOWANCE: '1', RELAYER_INVITE_TTL_HOURS: '1e3' }))
      .toThrow(/plain decimal digits/)
  })

  it('ceilings the knobs that bound the giveaway and the guessing wall', () => {
    // A fat-fingered extra digit on the allowance is a thousand registrations per address; a
    // huge attempt cap unmakes the six-character safety argument. Both refuse at startup.
    expect(() => resolveInviteConfig({ RELAYER_INVITE_ALLOWANCE: '1001' })).toThrow(/between 1 and 1000/)
    expect(() =>
      resolveInviteConfig({ RELAYER_INVITE_ALLOWANCE: '3', RELAYER_INVITE_CLAIM_ATTEMPTS: '10001' }),
    ).toThrow(/between 1 and 10000/)
    expect(() =>
      resolveInviteConfig({ RELAYER_INVITE_ALLOWANCE: '3', RELAYER_INVITE_MINT_DAILY: '100001' }),
    ).toThrow(/between 1 and 100000/)
  })

  it('refuses an allowance above the daily sponsorship budget — enforced, not advised', () => {
    // `.env.example` states the invariant; this is what stops it being one typo from false.
    expect(() =>
      resolveSponsorshipCaps({ RELAYER_INVITE_ALLOWANCE: '21', RELAYER_SPONSOR_DAILY: '20' }),
    ).toThrow(/exceeds RELAYER_SPONSOR_DAILY/)
    // At the budget exactly is allowed — "alongside, never past".
    expect(
      resolveSponsorshipCaps({
        RELAYER_INVITE_ALLOWANCE: '20',
        RELAYER_SPONSOR_DAILY: '20',
        RELAYER_INVITE_STORE: tempStorePath(),
      }).invites?.allowance,
    ).toBe(20)
  })

  it('refuses to adopt a new salt over an ESTABLISHED invite ledger', () => {
    // Deleting/rotating the sponsorship store mints a fresh shared salt; silently re-keying an
    // established invite ledger under it would reset every rolling allowance with no log line.
    const config = resolveSponsorshipCaps({
      RELAYER_INVITE_ALLOWANCE: '2',
      RELAYER_INVITE_STORE: tempStorePath(),
      RELAYER_SPONSOR_STORE: tempStorePath('sponsorship.json'),
      RELAYER_SEND_STORE: tempStorePath('send.json'),
    })
    const first = openInviteLedger(config, A_SALT)!
    expect(first.mint(first.inviterKey('10.0.0.1'), T0).allow).toBe(true)
    // Same file, new salt: refuse loudly rather than orphan the window that mint started.
    expect(() => openInviteLedger(config, 'b'.repeat(64))).toThrow(/different visitor\s+salt/)
    // A FRESH ledger (nothing minted, nothing counted) adopts the new salt silently.
    const freshConfig = { ...config, inviteStorePath: tempStorePath('fresh.json') }
    expect(openInviteLedger(freshConfig, 'b'.repeat(64))?.salt).toBe('b'.repeat(64))
  })

  it('mints from the wire contract alphabet — one definition on both sides of the wire', async () => {
    // Pinned to the literal, not to "length 32": a reordered or substituted relayer alphabet
    // would pass a length check while minting codes the client parses differently.
    expect(INVITE_ALPHABET).toBe('0123456789abcdefghjkmnpqrstvwxyz')
    const wire = await import('../../protocol/src/relayer-wire.js')
    expect(INVITE_ALPHABET).toBe(wire.INVITE_ALPHABET)
    expect(INVITE_CODE_LENGTH).toBe(wire.INVITE_CODE_LENGTH)
    expect(normalizeCode).toBe(wire.normalizeInviteCode)
  })

  it('gives the invite ledger its own file and the budget gates salt', () => {
    const config = resolveSponsorshipCaps({
      RELAYER_INVITE_ALLOWANCE: '2',
      RELAYER_INVITE_STORE: tempStorePath(),
      RELAYER_SPONSOR_STORE: tempStorePath('sponsorship.json'),
      RELAYER_SEND_STORE: tempStorePath('send.json'),
    })
    expect(config.inviteStorePath).not.toBe(config.storePath)
    expect(config.inviteStorePath).not.toBe(config.sendStorePath)
    const opened = openInviteLedger(config, A_SALT)
    expect(opened?.salt).toBe(A_SALT)
    // And the whole thing is absent when the feature is off.
    expect(openInviteLedger({ ...config, invites: undefined }, A_SALT)).toBeUndefined()
  })
})
