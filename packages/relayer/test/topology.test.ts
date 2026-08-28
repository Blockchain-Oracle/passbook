// Story 1.6 — the four-signer topology, pinned as data, and the per-job degrade matrix proven
// against a live server.
//
// TWO HALVES, AND THE SECOND IS THE POINT. The first half pins `topology.ts` against AD-17 so a
// signer cannot lose its host or a job its degrade state without a test saying so. The second
// half is what no existing test does: `hardening.test.ts` and `invite.test.ts` prove each job's
// refusal ONE JOB AT A TIME, which cannot distinguish "the sponsorship budget is spent" from
// "the relayer fell over". Every scenario below breaks exactly one thing on a relayer with all
// four jobs wired, and then asks the routes that should still work to answer in the same process.
//
// THE SCENARIO BLOCKS ARE GENERATED FROM THE MATRIX DATA. `describe` iterates the live degrade
// rows in `RELAYER_JOBS` and emits one `it` per row, which looks its scenario up by the row's
// `id`. A row with no scenario fails; a scenario with no row fails the orphan check. Neither can
// exist alone, and both hold under a filtered run because the binding is a table rather than a
// counter incremented as tests execute.
//
// The scenarios read their expected status and reason OUT OF `topology.ts` rather than restating
// them, so the matrix and the server cannot drift apart silently.

import { describe, it, expect, vi, afterEach } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { readFileSync } from 'node:fs'
import { NET } from '../../protocol/src/constants.js'
import { RELAYER_DOWN_NOTICE, SEND_CAP_NOTICE } from '../../protocol/src/relayer-wire.js'
import { SponsorshipLedger, BUDGET_EXHAUSTED_NOTICE, type BudgetCaps } from '../src/sponsorship.js'
import { MemorySponsorshipStore } from '../src/sponsorship-store.js'
import { InviteLedger, type InviteConfig } from '../src/invite.js'
import { MemoryInviteStore, emptyInvites } from '../src/invite-store.js'
import { createFundingMonitor } from '../src/funding-monitor.js'
import { createQuoteCounter, createRelayerServer, type RelayerServerOptions } from '../src/server.js'
import { MAX_PUBLISH_PER_MINUTE, MAX_SUBSCRIBERS_PER_ROOM, RoomHub } from '../src/rooms.js'
import { ChainFeed, MAX_FEED_SUBSCRIBERS } from '../src/chain-feed.js'
import {
  COLD_START_CAVEAT,
  DEMO_CRITICAL,
  DEPLOYED_ACCOUNT_RULE,
  RELAYER_JOBS,
  SIGNERS,
  type DegradeState,
  type RelayerJob,
  type RelayerJobName,
} from '../src/topology.js'

const T0 = Date.UTC(2026, 7, 24, 12, 0, 0)
const A_SALT = 'a'.repeat(64)
const A_CALL = { contractAddress: NET.pool, entrypoint: 'apply_actions', calldata: [] }
const A_QUOTE = { target: 'avnuQuotes', path: '/swap/v3/quotes' }
const JSON_HEADERS = { 'content-type': 'application/json' }
const FEE_RECIPIENT = '0x6e1c309456733fa40d17a560e4802b4ca65464cec172571b8883881bb6a0389'
const REQUEST_TIMEOUT_MS = 5_000

const INVITE_CONFIG: InviteConfig = {
  allowance: 3,
  windowMs: 24 * 3_600_000,
  ttlMs: 72 * 3_600_000,
  claimAttemptsPerDay: 10,
  mintDailyGlobal: 50,
}

const JOB_NAMES = RELAYER_JOBS.map((j) => j.job)

/** The row a scenario is proving. Throws rather than skipping: a missing row is a broken pin. */
function row(id: string): DegradeState {
  const found = RELAYER_JOBS.flatMap((j) => j.degradeStates).filter((d) => d.id === id)
  if (found.length !== 1) {
    throw new Error(`expected exactly one degrade row with id "${id}", found ${found.length}`)
  }
  return found[0]!
}

/** Every row a live server can be driven into — everything except designed-not-built. */
function liveRows(): Array<{ job: RelayerJob; state: DegradeState }> {
  return RELAYER_JOBS.flatMap((job) =>
    job.degradeStates.filter((d) => d.answers !== 'not-built').map((state) => ({ job, state })),
  )
}

// ── Harness ───────────────────────────────────────────────────────────────────────────────
//
// Its own copy rather than an import, on the convention `invite.test.ts` already set: the
// harness in `hardening.test.ts` is local to that file, and exporting it would make one test
// file's private scaffolding another's dependency. What is NOT copied is the shape of the
// server — `fullRelayer` below wires all four jobs on purpose, because a scenario that breaks
// one job on a server where the others are absent proves nothing about independence.

const servers: Array<() => Promise<void>> = []
afterEach(async () => {
  while (servers.length) await servers.pop()!()
})

function ledgers(caps: { sponsor?: BudgetCaps; send?: BudgetCaps } = {}) {
  const store = () =>
    new MemorySponsorshipStore({
      salt: A_SALT,
      budget: { utcDay: '', dailyCount: 0, perVisitor: {} },
      claimed: [],
    })
  return {
    sponsorship: new SponsorshipLedger(caps.sponsor ?? { perVisitor: 50, daily: 50 }, store(), T0),
    sendBudget: new SponsorshipLedger(
      caps.send ?? { perVisitor: 50, daily: 50 }, store(), T0, SEND_CAP_NOTICE,
    ),
  }
}

/**
 * A relayer with EVERY JOB WIRED — both budgets, the invite ledger, the quote counter, the room
 * hub, a fee recipient and a healthy funding state. Every scenario starts from this and breaks
 * exactly one thing, so "the others still answer" is a claim about a relayer that could have
 * failed.
 */
async function fullRelayer(over: Partial<RelayerServerOptions> = {}) {
  const base = ledgers()
  const server = createRelayerServer({
    submit: async () => '0xok',
    resolveApproveCeiling: async () => 0n,
    now: () => T0,
    visitorSalt: A_SALT,
    sponsorship: base.sponsorship,
    sendBudget: base.sendBudget,
    invites: new InviteLedger(INVITE_CONFIG, new MemoryInviteStore(emptyInvites(A_SALT)), T0),
    quoteCounter: createQuoteCounter(100, 1_000),
    fetchUpstream: okUpstream(),
    feeRecipient: FEE_RECIPIENT,
    relayerState: () => 'ok',
    rooms: new RoomHub(),
    chainFeed: new ChainFeed({ log: () => {}, warn: () => {} }),
    ...over,
  })
  // A listen() failure — a port that cannot be bound, a permissions problem — must REJECT rather
  // than leave the await pending until the suite times out with no cause named.
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const { port } = server.address() as AddressInfo
  servers.push(() => new Promise<void>((r) => server.close(() => r())))
  return { port }
}

function okUpstream(): typeof fetch {
  return vi.fn(
    async () => new Response(JSON.stringify({ price: '1.02' }), { status: 200 }),
  ) as unknown as typeof fetch
}

function call(
  port: number,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const headers = method === 'POST' ? JSON_HEADERS : {}
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
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
    // A handler that never answers would otherwise hang until vitest's own timeout, which
    // reports the whole test as slow rather than naming the request that stalled.
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`${method} ${path} did not answer within ${REQUEST_TIMEOUT_MS}ms`))
    })
    req.on('error', reject)
    req.end(method === 'POST' ? JSON.stringify(body ?? {}) : undefined)
  })
}

const submit = (port: number) => call(port, 'POST', '/api/submit', { calls: [A_CALL] })
const sponsoredSubmit = (port: number) =>
  call(port, 'POST', '/api/submit', { calls: [A_CALL], sponsored: true })
const quote = (port: number) => call(port, 'POST', '/api/quote', A_QUOTE)
const feeRecipient = (port: number) => call(port, 'GET', '/api/fee-recipient')
const mintInvite = (port: number) => call(port, 'POST', '/api/invite/mint', {})
const claimInvite = (port: number, code: string) =>
  call(port, 'POST', '/api/invite/claim', { code, claimant: 'claimant-token-1234' })
const inviteStatus = (port: number, code: string) =>
  call(port, 'POST', '/api/invite/status', { code })

/** Felts compare as numbers: `0x0a` and `0xA` are the same address written two ways. */
const sameFelt = (a: string, b: string) => BigInt(a) === BigInt(b)

/**
 * Open the chain-feed stream and resolve on its FIRST frame — the hello. The `call` helper
 * cannot read a stream (it waits for `end`, which a live stream never emits), so this reads
 * until the first SSE separator and hangs up: the hello is the claim under test.
 */
function streamHello(port: number): Promise<{ status: number; frame: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/api/chain/stream', method: 'POST', headers: JSON_HEADERS },
      (res) => {
        if (res.statusCode !== 200) {
          let data = ''
          res.on('data', (c) => (data += c))
          res.on('end', () => resolve({ status: res.statusCode ?? 0, frame: data ? JSON.parse(data) : null }))
          return
        }
        let buffer = ''
        res.on('data', (chunk) => {
          buffer += chunk
          const end = buffer.indexOf('\n\n')
          if (end === -1) return
          const frame = buffer.slice(0, end)
          req.destroy()
          if (!frame.startsWith('data: ')) return reject(new Error(`expected an SSE data frame, got ${frame}`))
          resolve({ status: 200, frame: JSON.parse(frame.slice('data: '.length)) })
        })
      },
    )
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error(`the chain stream did not answer within ${REQUEST_TIMEOUT_MS}ms`))
    })
    req.on('error', (e) => {
      // `req.destroy()` above surfaces as an error after resolve; a settled promise ignores it.
      reject(e)
    })
    req.end('{}')
  })
}

// ══ Half one: the topology data, pinned against AD-17 ═════════════════════════════════════

describe('the signer set is four, each with a host and a discipline (AD-17)', () => {
  it('is exactly {deployer, relayer, keeper/scheduler, treasury} — four, not two', () => {
    expect(SIGNERS).toHaveLength(4)
    expect(SIGNERS.map((s) => s.role)).toEqual([
      'deployer',
      'relayer',
      'keeper/scheduler',
      'treasury',
    ])
  })

  it('gives every signer a named host, a key location, a discipline and a monitoring answer', () => {
    for (const s of SIGNERS) {
      expect(s.purpose.length, `${s.role} purpose`).toBeGreaterThan(20)
      expect(s.host.length, `${s.role} host`).toBeGreaterThan(20)
      expect(s.keyLocation.length, `${s.role} key location`).toBeGreaterThan(20)
      expect(s.discipline.length, `${s.role} discipline`).toBeGreaterThan(1)
      for (const line of s.discipline) {
        expect(line.length, `${s.role} discipline line`).toBeGreaterThan(20)
      }
      expect(s.monitoring.length, `${s.role} monitoring`).toBeGreaterThan(20)
      expect(s.owningStory.length, `${s.role} owning story`).toBeGreaterThan(4)
    }
  })

  // The 1-13 fact, on every signer rather than only the two that exist: a key whose account was
  // never deployed answers every free pre-check and then fails the first paid leg.
  it('states the deployed-account rule on every signer, built or not', () => {
    expect(DEPLOYED_ACCOUNT_RULE).toMatch(/getClassHashAt/)
    for (const s of SIGNERS) expect(s.discipline, `${s.role}`).toContain(DEPLOYED_ACCOUNT_RULE)
  })

  // Line numbers rot on the next edit above them; an exported name does not.
  it('cites symbols and package-rooted paths, never line numbers', () => {
    const citations = [
      ...SIGNERS.flatMap((s) => [...s.discipline, s.monitoring, s.host, s.keyLocation]),
      ...RELAYER_JOBS.flatMap((j) => [
        j.summary,
        j.note,
        ...j.degradeStates.flatMap((d) => [d.note, d.noticeSource ?? '']),
      ]),
    ]
    for (const text of citations) {
      expect(text, `must not cite a line number: ${text.slice(0, 60)}…`)
        .not.toMatch(/\.ts:\d+/)
      // Any source path that IS cited is rooted at the repository, not relative to this package.
      for (const path of text.match(/[\w./-]+\.ts(?![:\w])/g) ?? []) {
        if (path.startsWith('.')) continue   // prose like `.env.example`
        expect(path, `path must be repository-rooted: ${path}`)
          .toMatch(/^(packages|scripts|apps|workers)\//)
      }
    }
  })

  it('names keeper and treasury as AD-7-inheriting obligations, honestly not-yet-built', () => {
    const future = SIGNERS.filter((s) => s.role === 'keeper/scheduler' || s.role === 'treasury')
    expect(future).toHaveLength(2)
    for (const s of future) {
      expect(s.builtToday, `${s.role} must not claim to exist`).toBe(false)
      expect(s.deployment, `${s.role} has no account`).toBeNull()
      expect(s.discipline.join(' ')).toMatch(/bounded/i)
      expect(s.discipline.join(' ')).toMatch(/paged/i)
      expect(s.discipline.join(' ')).toMatch(/AD-7/)
      expect(s.owningStory).toMatch(/^4-\d/)
      expect(s.keyLocation).toMatch(/NOT ALLOCATED/)
    }
    // AD-10 is the thing that bounds a treasury compromise, and it is a number, not a hope.
    const treasury = SIGNERS.find((s) => s.role === 'treasury')!
    expect(treasury.discipline.join(' ')).toMatch(/AD-10/)
    expect(treasury.discipline.join(' ')).toMatch(/10%/)
    expect(treasury.discipline.join(' ')).toMatch(/FLOOR/)
  })

  // The two accounts that DO exist are pinned to the banked evidence, not to a copied literal:
  // an address typed twice is an address that can be wrong in one place.
  it('matches evidence/account-deployment.json for the two accounts that exist', () => {
    const banked = JSON.parse(
      readFileSync(new URL('../../../evidence/account-deployment.json', import.meta.url), 'utf8'),
    ) as Record<
      string,
      { address: string; classHash: string; transactionHash: string; verifiedAtBlock: number }
    >

    for (const role of ['deployer', 'relayer'] as const) {
      const signer = SIGNERS.find((s) => s.role === role)!
      expect(signer.builtToday).toBe(true)
      expect(signer.deployment).not.toBeNull()
      expect(signer.deployment!.record).toBe('evidence/account-deployment.json')
      // Felt comparison throughout: a leading zero or a case difference is the same address,
      // and reading one as drift would be a false alarm that teaches people to ignore this test.
      expect(sameFelt(signer.deployment!.address, banked[role]!.address)).toBe(true)
      expect(sameFelt(signer.deployment!.classHash, banked[role]!.classHash)).toBe(true)
      expect(sameFelt(signer.deployment!.transactionHash, banked[role]!.transactionHash)).toBe(true)
      expect(signer.deployment!.verifiedAtBlock).toBe(banked[role]!.verifiedAtBlock)
    }
  })

  // Not a convention: Task 8's identity_key probe needs two distinct callers to prove the pool
  // scopes a handle per user, so one wallet playing both roles would prove nothing.
  it('keeps the deployer and the relayer distinct addresses', () => {
    const [deployer, relayer] = ['deployer', 'relayer'].map(
      (r) => SIGNERS.find((s) => s.role === r)!.deployment!.address,
    )
    expect(sameFelt(deployer!, relayer!)).toBe(false)
  })
})

describe('the relayer has six jobs, each with its own degrade states (AD-17 + B3)', () => {
  //
  // SIX, NOT AD-17's FOUR. `chat transport` is the room bus, which B3 put on this process
  // instead of on the Cloudflare Durable Object AD-17 named — see `RelayerJobName`. `chain feed`
  // is the M1 fan-out poller, on this process for the same one-machine reasons. The list is
  // still pinned exactly, because the point of pinning it is that a job cannot appear or vanish
  // without somebody deciding to change this line.
  //
  it('is exactly {submission, sponsored registration, quote proxy, chat transport, chain feed, stats}', () => {
    expect(RELAYER_JOBS).toHaveLength(6)
    expect(JOB_NAMES).toEqual([
      'submission',
      'sponsored registration',
      'quote proxy',
      'chat transport',
      'chain feed',
      'stats',
    ])
  })

  it('gives every job a summary and at least one degrade state with a unique id', () => {
    const ids = RELAYER_JOBS.flatMap((j) => j.degradeStates.map((d) => d.id))
    expect(new Set(ids).size, 'degrade ids must be unique — they key the scenarios').toBe(ids.length)
    for (const j of RELAYER_JOBS) {
      expect(j.summary.length, `${j.job} summary`).toBeGreaterThan(40)
      expect(j.note.length, `${j.job} note`).toBeGreaterThan(40)
      expect(j.degradeStates.length, `${j.job} degrade states`).toBeGreaterThan(0)
      for (const d of j.degradeStates) {
        expect(d.trigger.length, `${d.id} trigger`).toBeGreaterThan(20)
        expect(d.note.length, `${d.id} note`).toBeGreaterThan(20)
      }
    }
  })

  // The discriminator has to match the wire, or the matrix reads as though everything refuses.
  it('matches each row\'s `answers` kind to a coherent status', () => {
    for (const d of RELAYER_JOBS.flatMap((j) => j.degradeStates)) {
      if (d.answers === 'refusal') {
        expect(d.status, `${d.id}`).toBeGreaterThanOrEqual(400)
      } else if (d.answers === 'normal-service') {
        expect(d.status, `${d.id} keeps serving, so it answers 200`).toBe(200)
        expect(d.reason, `${d.id} is not a refusal, so it carries no reason token`).toBeNull()
      } else {
        expect(d.status, `${d.id} is not built, so it has no status`).toBeNull()
      }
    }
  })

  // Route scope: "the job is degraded" is usually too coarse to be true.
  it('scopes every row to routes the job actually owns', () => {
    for (const j of RELAYER_JOBS) {
      for (const d of j.degradeStates) {
        for (const r of d.affectsRoutes) {
          expect(j.routes, `${d.id} affects ${r}, which is not one of ${j.job}'s routes`).toContain(r)
        }
        // A refusal that affects nothing is a row that is not describing a refusal.
        if (d.answers === 'refusal') expect(d.affectsRoutes.length, `${d.id}`).toBeGreaterThan(0)
        // A row that leaves some of its job's routes alone must say which — that is the
        // funding-floor/fee-recipient case, and leaving it unsaid overstates the outage.
        if (d.answers === 'refusal' && d.affectsRoutes.length < j.routes.length) {
          expect(d.stillServedInThisJob, `${d.id} leaves routes serving and must say so`).toBeTruthy()
        }
      }
    }
  })

  // The per-job half of AD-17 — and a row may never claim its own job is unaffected, which is
  // the reading that made the invites-off row ambiguous before.
  it('never lists a row\'s own job among the jobs it leaves unaffected', () => {
    for (const j of RELAYER_JOBS) {
      for (const d of j.degradeStates) {
        expect(d.otherJobsUnaffected, `${d.id} must not list its own job`).not.toContain(j.job)
        for (const other of d.otherJobsUnaffected) {
          expect(JOB_NAMES, `${d.id} names an unknown job ${other}`).toContain(other)
        }
        expect(new Set(d.otherJobsUnaffected).size).toBe(d.otherJobsUnaffected.length)
      }
    }
  })

  it('gives every BUILT job real routes', () => {
    for (const j of RELAYER_JOBS.filter((j) => j.builtToday)) {
      expect(j.routes.length, `${j.job} routes`).toBeGreaterThan(0)
      for (const r of j.routes) expect(r).toMatch(/^(GET|POST) \//)
    }
  })

  // AD-14 designed it; nobody built it. A matrix row that invented a route would be the exact
  // overclaim this project's claims lint exists to catch, one layer up.
  it('marks stats as designed-not-built, with no route and no invented status', () => {
    const stats = RELAYER_JOBS.find((j) => j.job === 'stats')!
    expect(stats.builtToday).toBe(false)
    expect(stats.routes).toEqual([])
    expect(stats.summary).toMatch(/DESIGNED, NOT BUILT/)
    expect(stats.summary).toMatch(/AD-14/)
    expect(stats.degradeStates).toHaveLength(1)
    expect(stats.degradeStates[0]!.answers).toBe('not-built')
    expect(stats.degradeStates[0]!.trigger).toMatch(/last good/i)
    expect(stats.degradeStates[0]!.trigger).toMatch(/block stamp|as of block/i)
  })

  // Every route named in the matrix must be one the server actually serves.
  //
  // CHECKED BY BODY, NOT BY STATUS, and the reason is a real overlap rather than a convenience:
  // `POST /invite/status` answers 404 for a code it has never heard of, which is the same status
  // the router uses for a path it does not serve. Only the router's flat `{"error":"not found"}`
  // means the route is absent, so that is what this looks for.
  it('names only routes the server really answers', async () => {
    const { port } = await fullRelayer()
    for (const j of RELAYER_JOBS.filter((j) => j.builtToday)) {
      for (const route of j.routes) {
        const [method, spec] = route.split(' ') as ['GET' | 'POST', string]
        // The sponsored spelling is the submit path plus a body flag, not a distinct route.
        const path = spec.replace(/ \(.*\)$/, '')
        const res = await call(port, method, path, { calls: [A_CALL], code: 'aaaaaa' })
        expect(res.body?.error, `${route} must exist`).not.toBe('not found')
      }
    }

    // The probe has to be able to fail, or it is asserting nothing: a path the server genuinely
    // does not serve produces exactly the body the loop above rejects.
    expect((await call(port, 'POST', '/no-such-route', {})).body).toEqual({ error: 'not found' })
  })
})

describe('the demo-critical set and the cold-start caveat ship as data (AD-17)', () => {
  //
  // The set SHRANK when chat's transport moved onto the relayer (B3). One process now serves both
  // demo-critical surfaces, which is one fewer thing that has to be alive during judging.
  //
  it('needs only the relayer for Wallet and Chat', () => {
    expect(DEMO_CRITICAL.surfaces).toEqual(['Wallet', 'Chat'])
    expect(DEMO_CRITICAL.processes).toEqual(['relayer'])
  })

  it('puts the scheduler/keeper/clearer/graduation stack off the demo-critical path', () => {
    expect(DEMO_CRITICAL.offPath).toEqual([
      'market scheduler',
      'settlement keeper',
      'epoch clearer',
      'graduation executor',
    ])
    expect(DEMO_CRITICAL.offPathRationale).toMatch(/permissionless/)
    expect(DEMO_CRITICAL.offPathRationale).toMatch(/never traps a balance/)
  })

  // The dependencies note is a SEPARATE field precisely so that stating it cannot widen AD-17's
  // process set — the assertion above pins that set, and this one pins the honesty beside it.
  it('names the non-process dependencies without adding them to the AD-17 process set', () => {
    expect(DEMO_CRITICAL.alsoRequired.length).toBeGreaterThan(1)
    const all = DEMO_CRITICAL.alsoRequired.join(' ')
    expect(all).toMatch(/JSON-RPC/)
    expect(all).toMatch(/static hosting/i)
    for (const dep of DEMO_CRITICAL.alsoRequired) {
      expect(DEMO_CRITICAL.processes as readonly string[]).not.toContain(dep)
    }
  })

  // Story 1.6 documents Q5. It does not decide it, and the marker is what says so.
  it('carries Q5 open, in the spine wording, with the 1-13 sharpening beside it', () => {
    expect(COLD_START_CAVEAT.status).toBe('[OPEN → Abu]')
    expect(COLD_START_CAVEAT.spineQuestion).toMatch(/Q5/)
    expect(COLD_START_CAVEAT.question).toContain('already hold STRK')
    expect(COLD_START_CAVEAT.question).toContain('no permissionless backstop')
    expect(COLD_START_CAVEAT.question).toContain('second sponsorship channel')
    expect(COLD_START_CAVEAT.notResolvedHere).toMatch(/documents and flags only/i)
    expect(COLD_START_CAVEAT.sharpenedBy1_13).toMatch(/TWO transactions/)
    expect(COLD_START_CAVEAT.sharpenedBy1_13).toMatch(/DEPLOY_ACCOUNT/)
  })

  // SELF-CONTAINED. An earlier draft pointed at a gitignored planning path, which is unreadable
  // to exactly the audience this exists for; the facts have to be here, not behind a pointer.
  it('states the caveat without pointing at anything a reader cannot open', () => {
    const prose = [
      COLD_START_CAVEAT.question,
      COLD_START_CAVEAT.sharpenedBy1_13,
      COLD_START_CAVEAT.deploymentIsUnsponsored,
      COLD_START_CAVEAT.measured,
      COLD_START_CAVEAT.evidence,
      COLD_START_CAVEAT.notResolvedHere,
    ].join(' ')
    // The three facts a reader needs in order to act, stated rather than referenced.
    expect(COLD_START_CAVEAT.sharpenedBy1_13).toMatch(/TWO transactions/)
    expect(COLD_START_CAVEAT.deploymentIsUnsponsored).toMatch(/NOTHING SPONSORS IT TODAY/)
    expect(COLD_START_CAVEAT.measured).toMatch(/STRK/)
    // And no pointer into a path that is not shipped.
    expect(prose).not.toMatch(/_bmad-output|deferred-work|planning-artifacts/)
    // The one reference it does keep is a committed evidence file.
    expect(COLD_START_CAVEAT.evidence).toMatch(/^evidence\/sponsored-registration\.json/)
  })

  // The measured figures are quoted from banked evidence, so they are checked against it.
  it('quotes the banked cost figures rather than remembered ones', () => {
    const banked = JSON.parse(
      readFileSync(new URL('../../../evidence/sponsored-registration.json', import.meta.url), 'utf8'),
    ) as {
      cost: { totalStrk: string }
      accountDeployment: { required: boolean; deployFeeWei: string }
    }
    expect(banked.accountDeployment.required).toBe(true)
    expect(COLD_START_CAVEAT.measured).toContain(banked.cost.totalStrk)
    expect(COLD_START_CAVEAT.measured).toContain(banked.accountDeployment.deployFeeWei)
  })
})

// ══ Half two: cross-job independence, on a live server with all four jobs wired ════════════
//
// One scenario per live degrade row, registered by the row's `id`. The `describe` below
// generates the `it` blocks from the data, so neither half can exist without the other.

type Scenario = () => Promise<void>

const SCENARIOS: Record<string, Scenario> = {
  // ── The funding floor. One condition, two jobs, and NOT a global outage. ─────────────────
  //
  // Submission and sponsored registration are separate jobs on ONE signing wallet, so a breached
  // floor closes both. The scenario's whole job is to show that this is still per-job
  // degradation: each answers its own honest 503, the fee-recipient read of the very same job
  // keeps answering, and everything that does not need the key keeps working.
  'submission/funding-floor': async () => {
    const state = row('submission/funding-floor')
    const { port } = await fullRelayer({ relayerState: () => 'relayer-down' })

    const plain = await submit(port)
    expect(plain.status).toBe(state.status)
    expect(plain.body.reason).toBe(state.reason)
    expect(plain.body.notice).toBe(RELAYER_DOWN_NOTICE)

    // The row says fee-recipient survives, and it is a route of THIS job. If the data claims a
    // narrower scope than the server has, this is where it fails.
    expect(await feeRecipient(port)).toMatchObject({
      status: 200,
      body: { feeRecipient: FEE_RECIPIENT },
    })

    // And the other job the row names. The body is checked, not just the status: a 200 carrying
    // nothing would be a job that is up in name only.
    const q = await quote(port)
    expect(q.status).toBe(200)
    expect(q.body).toEqual({ price: '1.02' })

    // The relayer's balance is an ops fact. A user learns that this route is closed and the
    // other is open, and nothing else.
    expect(JSON.stringify(plain.body).toLowerCase()).not.toMatch(/balance|wei|floor|funding/)
  },

  'sponsored/funding-floor': async () => {
    const state = row('sponsored/funding-floor')
    const { port } = await fullRelayer({ relayerState: () => 'relayer-down' })

    const free = await sponsoredSubmit(port)
    expect(free.status).toBe(state.status)
    expect(free.body.reason).toBe(state.reason)
    expect(free.body.notice).toBe(RELAYER_DOWN_NOTICE)
    expect(JSON.stringify(free.body).toLowerCase()).not.toMatch(/balance|wei|floor|funding/)

    // The row claims the invite routes survive a breach because they burn no gas. That is a
    // claim about a WRITE — a mint and a burn — not merely about a read, so it is proven as one:
    // an invite minted and claimed while the wallet cannot pay a fee stays claimed.
    const minted = await mintInvite(port)
    expect(minted.status).toBe(200)
    expect(await inviteStatus(port, minted.body.code)).toMatchObject({
      status: 200,
      body: { state: 'unclaimed' },
    })
    expect(await claimInvite(port, minted.body.code)).toMatchObject({
      status: 200,
      body: { claimed: true },
    })
    expect(await inviteStatus(port, minted.body.code)).toMatchObject({
      status: 200,
      body: { state: 'claimed' },
    })

    expect((await quote(port)).status).toBe(200)
  },

  // ── The condition that deliberately does NOT close a door. ───────────────────────────────
  //
  // Driven through the REAL monitor rather than by handing the server a literal, because the
  // behavior being pinned belongs to `createFundingMonitor`: the server only ever sees the
  // 'ok'/'relayer-down' that `userState()` maps an unknown health onto. A cast would prove
  // nothing about the wiring that actually runs.
  'submission/funding-unknown': async () => {
    const state = row('submission/funding-unknown')
    const pages: string[] = []
    let readFails = true
    let balanceWei = 0n

    const monitor = createFundingMonitor({
      readBalance: async () => {
        if (readFails) throw new Error('RPC unreachable')
        return balanceWei
      },
      readFeeWei: async () => 1_000n,
      pageOps: (m) => pages.push(m),
    })

    await monitor.check()
    expect(monitor.health()).toBe('unknown')
    expect(monitor.userState()).toBe('ok')
    // Being blind is still worth a page, even though it closes nothing.
    expect(pages.join(' ')).toMatch(/could not be read/)

    const { port } = await fullRelayer({ relayerState: () => monitor.userState() })
    // The row says 200, and it means it: an unreadable balance must not manufacture an outage.
    expect((await submit(port)).status).toBe(state.status)
    expect((await sponsoredSubmit(port)).status).toBe(state.status)
    expect((await quote(port)).status).toBe(200)

    // THE STICKINESS RUNS BOTH WAYS, which is the half that is easy to get wrong. A definite
    // `exhausted` closes the gate; a LATER failed read is an absence of news and must not
    // reopen it. Same monitor, same live server.
    readFails = false
    balanceWei = 0n
    await monitor.check()
    expect(monitor.health()).toBe('exhausted')
    expect((await submit(port)).status).toBe(503)

    readFails = true
    await monitor.check()
    expect(monitor.health()).toBe('unknown')
    expect(monitor.userState()).toBe('relayer-down')
    expect((await submit(port)).status).toBe(503)
  },

  // ── The two budget ledgers, proven separate by spending each one dry in turn. ─────────────
  'submission/send-cap': async () => {
    const state = row('submission/send-cap')
    const { sponsorship, sendBudget } = ledgers({ send: { perVisitor: 1, daily: 1 } })
    const { port } = await fullRelayer({ sponsorship, sendBudget })

    expect((await submit(port)).status).toBe(200)   // spends the only unit
    const refused = await submit(port)
    expect(refused.status).toBe(state.status)
    expect(refused.body.reason).toBe(state.reason)
    expect(refused.body.notice).toBe(SEND_CAP_NOTICE)
    // The copy is the send's own — a refused send must never be told its account creation was
    // paused, which is both false and about a thing the user already has.
    expect(refused.body.notice).not.toBe(BUDGET_EXHAUSTED_NOTICE)

    expect((await sponsoredSubmit(port)).status).toBe(200)
    expect((await quote(port)).status).toBe(200)
    expect(await feeRecipient(port)).toMatchObject({ status: 200 })
  },

  'sponsored/budget-exhausted': async () => {
    const state = row('sponsored/budget-exhausted')
    const { sponsorship, sendBudget } = ledgers({ sponsor: { perVisitor: 1, daily: 1 } })
    const { port } = await fullRelayer({ sponsorship, sendBudget })

    expect((await sponsoredSubmit(port)).status).toBe(200)   // spends the only unit
    const refused = await sponsoredSubmit(port)
    expect(refused.status).toBe(state.status)
    expect(refused.body.reason).toBe(state.reason)
    expect(refused.body.notice).toBe(BUDGET_EXHAUSTED_NOTICE)
    // Fails OPEN into pay-your-own-way: the notice says the other path is there, and it is.
    expect(refused.body.notice).toMatch(/funded Starknet wallet/)

    expect((await submit(port)).status).toBe(200)
    expect((await quote(port)).status).toBe(200)
    // The row says the invite routes keep answering while the budget is spent.
    expect((await mintInvite(port)).status).toBe(200)
  },

  // ── The invite master switch. Scoped to the sub-feature, not to the job. ─────────────────
  'sponsored/invites-off': async () => {
    const state = row('sponsored/invites-off')
    const { sponsorship, sendBudget } = ledgers()
    // `RELAYER_INVITE_ALLOWANCE` unset is what this looks like at the wiring layer: the server
    // is built with no invite ledger at all.
    const { port } = await fullRelayer({ sponsorship, sendBudget, invites: undefined })

    for (const route of state.affectsRoutes) {
      const path = route.replace(/^POST /, '')
      for (const spelling of [path, `/api${path}`]) {
        const res = await call(port, 'POST', spelling, { code: 'aaaaaa' })
        expect(res.status, spelling).toBe(state.status)
        // The ROUTER's 404 — "this deployment does not offer invites" — and not the invite
        // ledger's 404 for a code it has never heard of. The two share a status, so the body is
        // what distinguishes a feature that is off from a code that does not exist.
        expect(res.body, spelling).toEqual({ error: 'not found' })
      }
    }

    // THE JOB ITSELF KEEPS WORKING, which is what the row claims and what makes this a
    // sub-feature outage rather than a job outage.
    expect((await sponsoredSubmit(port)).status).toBe(200)
    expect((await submit(port)).status).toBe(200)
    expect((await quote(port)).status).toBe(200)

    // The switch is not silence: a code presented on /submit gets a typed refusal, because there
    // the client already built a body around it and a 404 would be about the wrong thing.
    const withCode = await call(port, 'POST', '/api/submit', {
      calls: [A_CALL],
      sponsored: true,
      invite: 'aaaaaa',
    })
    expect(withCode.status).toBe(400)
    expect(withCode.body.reason).toBe('invites-not-offered')
    expect(state.stillServedInThisJob).toMatch(/invites-not-offered/)
  },

  // ── A dead or misbehaving upstream. Every shape the row names, proven. ───────────────────
  'quote/upstream-dead': async () => {
    const state = row('quote/upstream-dead')

    // 1. The fetch throws outright.
    {
      const dead = vi.fn(async () => {
        throw new Error('getaddrinfo ENOTFOUND starknet.api.avnu.fi')
      }) as unknown as typeof fetch
      const { port } = await fullRelayer({ fetchUpstream: dead })
      const res = await quote(port)
      expect(res.status).toBe(state.status)
      expect(res.body.error).toMatch(/proxying to avnuQuotes failed/)
      expect((await submit(port)).status).toBe(200)
      expect((await sponsoredSubmit(port)).status).toBe(200)
    }

    // 2. A non-2xx, and 3. something that is not JSON.
    for (const upstream of [
      () => new Response('rate limited', { status: 429 }),
      () => new Response('<html>maintenance</html>', { status: 200 }),
    ]) {
      const { port } = await fullRelayer({
        fetchUpstream: vi.fn(async () => upstream()) as unknown as typeof fetch,
      })
      expect((await quote(port)).status).toBe(state.status)
      expect((await submit(port)).status).toBe(200)
      expect((await sponsoredSubmit(port)).status).toBe(200)
    }

    // 4. A redirect. The server never follows one — `redirect: 'error'` is passed on every
    // upstream call, so the refusal is fetch's, before any second host is contacted. Both halves
    // are checked: that the option really is set, and that the resulting rejection is a 502.
    {
      let seenInit: RequestInit = {}
      const redirecting = vi.fn(async (_url: any, init: any) => {
        seenInit = init
        throw new TypeError('fetch failed: unexpected redirect')
      }) as unknown as typeof fetch
      const { port } = await fullRelayer({ fetchUpstream: redirecting })
      expect((await quote(port)).status).toBe(state.status)
      expect(seenInit.redirect).toBe('error')
      expect((await submit(port)).status).toBe(200)
    }

    // 5. A body past the read cap. Enforced WHILE streaming, so an upstream cannot exhaust this
    // process by ignoring the content-length it advertised.
    {
      const huge = vi.fn(
        async () => new Response('x'.repeat(600 * 1024), { status: 200 }),
      ) as unknown as typeof fetch
      const { port } = await fullRelayer({ fetchUpstream: huge })
      const res = await quote(port)
      expect(res.status).toBe(state.status)
      expect(res.body.error).toMatch(/exceeded/)
      expect((await submit(port)).status).toBe(200)
    }

    // 6. A timeout. The abort signal the server attaches is real, and a hung upstream becomes a
    // 502 rather than a socket the relayer holds open forever.
    {
      const hangs = vi.fn(
        (_url: any, init: any) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener('abort', () => reject(init.signal.reason))
          }),
      ) as unknown as typeof fetch
      const { port } = await fullRelayer({ fetchUpstream: hangs, proxyTimeoutMs: 20 })
      const res = await quote(port)
      expect(res.status).toBe(state.status)
      expect((await submit(port)).status).toBe(200)
    }
  },

  // ── The quote counter, proven to be nobody else's counter. ───────────────────────────────
  'quote/cap-hit': async () => {
    const state = row('quote/cap-hit')
    // Budgets of exactly one each: if a quote ever charged either of them, the submissions after
    // the cap is hit would be refused instead of served.
    const caps = { sponsor: { perVisitor: 1, daily: 1 }, send: { perVisitor: 1, daily: 1 } }

    // The per-visitor cap.
    {
      const { sponsorship, sendBudget } = ledgers(caps)
      const { port } = await fullRelayer({
        sponsorship, sendBudget, quoteCounter: createQuoteCounter(2, 1_000),
      })
      expect((await quote(port)).status).toBe(200)
      expect((await quote(port)).status).toBe(200)
      const refused = await quote(port)
      expect(refused.status).toBe(state.status)
      expect(refused.body.error).toMatch(/00:00 UTC/)
      // NOT the sponsorship pause: a quota refusal must not carry copy about account creation,
      // which is the confusion the separate counter exists to prevent.
      expect(JSON.stringify(refused.body)).not.toContain(BUDGET_EXHAUSTED_NOTICE)
      expect((await sponsoredSubmit(port)).status).toBe(200)
      expect((await submit(port)).status).toBe(200)
    }

    // The global ceiling, which is the one that holds when addresses are cheap.
    {
      const { sponsorship, sendBudget } = ledgers(caps)
      const { port } = await fullRelayer({
        sponsorship, sendBudget, quoteCounter: createQuoteCounter(100, 1),
      })
      expect((await quote(port)).status).toBe(200)
      expect((await quote(port)).status).toBe(state.status)
      expect((await sponsoredSubmit(port)).status).toBe(200)
      expect((await submit(port)).status).toBe(200)
    }
  },

  // ── The chat bus. Every refusal here is a ceiling, and none of them can spend anything. ──
  //
  // THE ROOM IS FILLED THROUGH THE HUB, NOT THROUGH THE ROUTE, and that is forced rather than
  // convenient: `call` resolves when a response ENDS, and a subscription that ends is not a
  // subscription. Filling the room with in-process listeners and then asking the ROUTE what it
  // answers proves the same thing without a helper that would hang by design.
  'chat/room-full': async () => {
    const state = row('chat/room-full')
    const rooms = new RoomHub()
    const { port } = await fullRelayer({ rooms })
    const room = 'a'.repeat(32)

    for (let i = 0; i < MAX_SUBSCRIBERS_PER_ROOM; i += 1) {
      expect(rooms.subscribe(room, { deliver() {}, end() {} }).ok).toBe(true)
    }

    const refused = await call(port, 'POST', '/api/room/stream', { room })
    expect(refused.status).toBe(state.status)
    expect(refused.body.error).toBe(state.reason)

    // What the row says still works: sending into the full room, and every other job.
    const sent = await call(port, 'POST', '/api/room/send', {
      room,
      envelope: { v: 1, iv: 'iv', ct: 'ct', from: '0x1' },
    })
    expect(sent.status).toBe(200)
    expect((await submit(port)).status).toBe(200)
    expect((await sponsoredSubmit(port)).status).toBe(200)
    expect((await quote(port)).status).toBe(200)
  },

  'chat/rate-limited': async () => {
    const state = row('chat/rate-limited')
    const { port } = await fullRelayer()
    const room = 'b'.repeat(32)
    const envelope = { v: 1, iv: 'iv', ct: 'ct', from: '0x1' }

    for (let i = 0; i < MAX_PUBLISH_PER_MINUTE; i += 1) {
      expect((await call(port, 'POST', '/api/room/send', { room, envelope })).status).toBe(200)
    }
    const refused = await call(port, 'POST', '/api/room/send', { room, envelope })
    expect(refused.status).toBe(state.status)
    expect(refused.body.error).toBe(state.reason)

    // Scoped to the ROOM, which is the whole claim of the row: another conversation is untouched.
    const elsewhere = await call(port, 'POST', '/api/room/send', { room: 'c'.repeat(32), envelope })
    expect(elsewhere.status).toBe(200)
    expect((await submit(port)).status).toBe(200)
  },

  // `normal-service`: a restart is not a refusal. What it loses is the backlog, and the row says
  // so rather than implying a conversation survives a deploy untouched.
  'chat/restart-loses-backlog': async () => {
    const state = row('chat/restart-loses-backlog')
    const room = 'd'.repeat(32)
    const envelope = { v: 1, iv: 'iv', ct: 'ct', from: '0x1' }

    const before = new RoomHub()
    const first = await fullRelayer({ rooms: before })
    expect((await call(first.port, 'POST', '/api/room/send', { room, envelope })).status).toBe(200)
    expect(before.stats().buffered).toBe(1)

    // The restart: a new process is a new hub, with nothing carried across and no store to read.
    const after = new RoomHub()
    const second = await fullRelayer({ rooms: after })
    expect(after.stats()).toEqual({ rooms: 0, subscribers: 0, buffered: 0 })

    // And it answers normally — the row's `status`, on a route that is not refusing anything.
    expect((await call(second.port, 'POST', '/api/room/send', { room, envelope })).status).toBe(
      state.status,
    )
    const rejoined = after.subscribe(room, { deliver() {}, end() {} })
    expect(rejoined.ok && rejoined.history).toHaveLength(1)   // only what arrived after the restart
  },

  // ── The chain feed. Public state only, and both rows are about staying honest. ───────────

  'chain-feed/at-capacity': async () => {
    const state = row('chain-feed/at-capacity')
    const feed = new ChainFeed({ log: () => {}, warn: () => {} })
    // The ceiling is reached by holding subscriptions, so hold exactly all of them.
    for (let i = 0; i < MAX_FEED_SUBSCRIBERS; i++) {
      const attached = feed.subscribe({ deliver() {}, end() {} })
      expect(attached.ok).toBe(true)
    }
    const { port } = await fullRelayer({ chainFeed: feed })

    const refused = await streamHello(port)
    expect(refused.status).toBe(state.status)
    expect(refused.frame).toEqual({ error: 'the feed is at capacity' })

    // The row's claim: a full feed costs the feed, nothing else. A submission still signs and a
    // quote still answers in the same process.
    expect((await submit(port)).status).toBe(200)
    expect((await quote(port)).status).toBe(200)
  },

  'chain-feed/source-degraded': async () => {
    const state = row('chain-feed/source-degraded')
    const feed = new ChainFeed({
      markets: '0xM',
      transport: () => Promise.reject(new Error('every RPC host is down')),
      log: () => {},
      warn: () => {},
    })
    await feed.tickApp()
    const { port } = await fullRelayer({ chainFeed: feed })

    // The stream still answers — the row's `status` — and the hello carries the honest sentence
    // rather than pretending the rows it could not read do not exist.
    const hello = await streamHello(port)
    expect(hello.status).toBe(state.status)
    expect(hello.frame.t).toBe('hello')
    expect(hello.frame.problem).toContain('could not be read')

    // And nothing else in the process noticed.
    expect((await submit(port)).status).toBe(200)
  },
}

describe('a down job degrades to its honest state, never to a global outage (AD-17)', () => {
  // GENERATED FROM THE DATA. One `it` per live row, so a row added to `topology.ts` without a
  // scenario fails here rather than passing unnoticed.
  for (const { job, state } of liveRows()) {
    it(`${job.job} — ${state.id}`, async () => {
      const scenario = SCENARIOS[state.id]
      if (!scenario) {
        throw new Error(
          `no live scenario is registered for degrade row "${state.id}". Every row in ` +
            `RELAYER_JOBS that a server can be driven into must be proven against one, or the ` +
            `matrix is claiming behavior nothing checks. Add it to SCENARIOS.`,
        )
      }
      await scenario()
    })
  }

  // The other direction: a scenario whose row was deleted or renamed is dead code that reads
  // like coverage.
  it('has no orphan scenarios', () => {
    const live = new Set(liveRows().map(({ state }) => state.id))
    for (const id of Object.keys(SCENARIOS)) {
      expect(live, `SCENARIOS has "${id}", which is not a live degrade row`).toContain(id)
    }
    expect(Object.keys(SCENARIOS).length).toBe(live.size)
  })

  // ── The composite: several things wrong at once is still not a global outage. ────────────
  //
  // Each scenario above breaks one thing. This breaks FIVE — the invite sub-feature, both budget
  // ledgers, the quote cap, and finally the funding floor, which is the likeliest member of a
  // genuinely bad day and the one whose absence would have made this case unrepresentative.
  it('keeps the surviving routes answering with five failures at once', async () => {
    const { sponsorship, sendBudget } = ledgers({
      sponsor: { perVisitor: 1, daily: 1 },
      send: { perVisitor: 1, daily: 1 },
    })
    let funded = true
    const { port } = await fullRelayer({
      sponsorship,
      sendBudget,
      quoteCounter: createQuoteCounter(1, 1_000),
      invites: undefined,                       // failure 1: the invite sub-feature is off
      relayerState: () => (funded ? 'ok' : 'relayer-down'),
    })

    // Spend everything that can be spent, while the wallet can still pay.
    expect((await submit(port)).status).toBe(200)
    expect((await sponsoredSubmit(port)).status).toBe(200)
    expect((await quote(port)).status).toBe(200)

    // failures 2 and 3: both budgets are now dry. Each refuses in its own words.
    expect(await submit(port)).toMatchObject({ status: 403, body: { reason: 'send-cap-reached' } })
    expect(await sponsoredSubmit(port)).toMatchObject({
      status: 403,
      body: { reason: 'sponsorship-paused' },
    })
    // failure 4: the quote cap.
    expect((await quote(port)).status).toBe(429)
    expect((await call(port, 'POST', '/api/invite/mint', {})).status).toBe(404)

    // failure 5: breach the funding floor on top of all of it. The two signing jobs change their
    // story from "your cap is spent" to "the relayer cannot sign" — both honest, both theirs.
    funded = false
    expect(await submit(port)).toMatchObject({ status: 503, body: { reason: 'relayer-down' } })
    expect(await sponsoredSubmit(port)).toMatchObject({
      status: 503,
      body: { reason: 'relayer-down' },
    })

    // And with five things wrong, the relayer is STILL a live process answering a real question
    // about itself — which is the difference between a bad day and an outage.
    expect(await feeRecipient(port)).toMatchObject({
      status: 200,
      body: { feeRecipient: FEE_RECIPIENT },
    })
    // Not one refusal above is a 5xx that blames us: the only 5xx is the honest 503, which is a
    // statement about funding rather than a crash.
    for (const res of [await quote(port), await call(port, 'POST', '/api/invite/mint', {})]) {
      expect(res.status).toBeLessThan(500)
    }
  })
})
