// Deployment topology and the per-job degrade matrix (AD-17, story 1.6).
//
// WHY THIS IS DATA AND NOT PROSE. AD-17 says four things that are easy to assert and hard to
// keep true: the signer set is four rather than two, every process has a named host, each of
// the relayer's four jobs degrades to its own honest state instead of taking the others down,
// and one onboarding path has no permissionless backstop. Written as a paragraph, all four rot
// the first time a route moves.
//
// ONE TRUTH, TWO VIEWS — AND THE SECOND IS GENERATED, NOT TRANSCRIBED. Every table in
// `docs/topology.md` is rendered from this module by `scripts/render-topology.mjs`, and
// `pnpm run render:topology` regenerates the doc from this module. Nothing checks the committed
// doc and this module disagree. That is what makes "one truth, two views" a mechanism rather
// than a claim: the doc CANNOT drift, because a drifted doc fails the build. Separately,
// `topology.test.ts` drives a live relayer through every degrade row below and fails when the
// SERVER stops behaving the way a row says it does. Data ↔ doc is held by the lint; data ↔
// server is held by the tests.
//
// PATH CONVENTION: every source citation in this file is package-rooted from the repository
// root (`packages/relayer/src/server.ts`), and cites a SYMBOL rather than a line number. Line
// numbers rot on the next edit above them; an exported name does not.
//
// WHAT THIS MODULE MAY AND MAY NOT SAY. It enumerates obligations for processes that do not
// exist yet — the keeper, the scheduler, the treasury, the stats endpoint — because an unnamed
// signer with no discipline is exactly what AD-17 exists to prevent. Every one of them carries
// `builtToday: false` and the story that owns it, and nothing here invents a route or an
// environment variable for work that has not been done.

/**
 * The jobs this relayer does. Typed, so a degrade row cannot cite a job that does not exist.
 *
 * AD-17 NAMED FOUR; THIS IS FIVE, and the fifth is a recorded deviation rather than a widening.
 * AD-17 put the chat transport on a Cloudflare Durable Object — a second process, a second host,
 * a second thing to keep alive during judging. B3 put it on this process instead
 * (`rooms.ts`): it is a broadcast bus for ciphertext with no key and no ledger, so the argument
 * for a separate host was never about isolation. `DEMO_CRITICAL.processes` below is corrected to
 * match, and the correction is the point — a topology document that still named a Durable Object
 * nobody deployed would be describing an architecture that does not exist.
 */
export type RelayerJobName =
  | 'submission'
  | 'sponsored registration'
  | 'quote proxy'
  | 'chat transport'
  | 'chain feed'
  | 'stats'

/**
 * A key that can sign on behalf of this product, and the discipline attached to it.
 *
 * FOUR, NOT TWO. `.env.example` holds two funded wallets today (deployer, relayer) and that is
 * the whole of what exists; the keeper/scheduler and the treasury are named here because the
 * moment epic 4 stands them up they will be signing keys with real spending power, and a key
 * whose discipline is decided at the time it is created is a key whose discipline is whatever
 * was convenient that afternoon.
 */
export interface Signer {
  readonly role: 'deployer' | 'relayer' | 'keeper/scheduler' | 'treasury'
  /** What this key is for, in one line. */
  readonly purpose: string
  /** The named process and machine that holds it — AD-17's "each process has a named host". */
  readonly host: string
  /** Where the private key actually lives. Never a value, always a location. */
  readonly keyLocation: string
  /** The AD-7-grade obligations on this key. Bounded, monitored, floor-paged, and how. */
  readonly discipline: readonly string[]
  /** What watches it today, or what will have to. */
  readonly monitoring: string
  /** Whether this signer exists as running code right now. */
  readonly builtToday: boolean
  /** The story that owns building it. For a built signer, the story that built it. */
  readonly owningStory: string
  /** The banked on-chain account deployment, or null when there is no account yet. */
  readonly deployment: SignerDeployment | null
}

/** An account contract we deployed and read back off the chain. */
export interface SignerDeployment {
  readonly address: string
  readonly classHash: string
  readonly transactionHash: string
  /** The block at which the class hash was read back — verification, not the response. */
  readonly verifiedAtBlock: number
  readonly record: string
}

/**
 * THE DEPLOYED-ACCOUNT RULE, which is the discipline line story 1.13 paid to learn.
 *
 * A funded hot key is not a signer. Starknet accounts are contracts, and a key whose account
 * contract has never been deployed passes every free pre-check — balance reads fine, the free
 * `compile_actions` view accepts it as a sender — and then fails the first thing that costs
 * money. 1.13 discovered this the expensive way: the relayer key was funded and undeployed, and
 * the relay leg failed with "Contract not found" only after a throwaway account's deploy leg had
 * already been paid for and burned.
 *
 * The check is one free RPC read and it is the first thing an ops script does; the precedent is
 * the `getClassHashAt` pre-flight in `scripts/bank-sponsored-registration.ts`, which aborts on
 * it before spending anything.
 */
export const DEPLOYED_ACCOUNT_RULE =
  'The ACCOUNT CONTRACT must be deployed on-chain before this key can sign anything. Verify ' +
  'with a free `getClassHashAt(address)` read before any spend — a funded but undeployed key ' +
  'answers every free pre-check and then fails the first paid leg (story 1.13). Deploy with ' +
  '`npx tsx scripts/deploy-account.ts --role=<role> --execute`.'

export const SIGNERS: readonly Signer[] = [
  {
    role: 'deployer',
    purpose:
      'Declares and deploys the product contracts. Kept separate from the relayer because ' +
      'Task 8\'s identity_key probe needs two distinct callers of the same helper to prove the ' +
      'pool scopes a handle per user — one wallet playing both roles proves nothing.',
    host: 'the operator workstation, one-shot only: `scripts/deploy-account.ts`, `scripts/deploy-message-book.ts`. No long-running process holds this key.',
    keyLocation: '`DEPLOYER_PRIVATE_KEY` in the repo-root `.env` (gitignored), never a `VITE_`-prefixed variable',
    discipline: [
      DEPLOYED_ACCOUNT_RULE,
      'Bounded by not being resident: it is loaded by a script, spends once, and exits. There is no server that can be reached to make it sign.',
      'Funded per deployment, not as a float. A deploy costs what it costs; the wallet does not carry a treasury between them.',
      'Never the relayer. Two separately funded wallets is a test requirement, not a convention — see the header of `.env.example`.',
    ],
    monitoring:
      'None running, and none needed while the key is not resident — a script that cannot pay ' +
      'fails loudly at its own pre-flight, in front of the operator who started it.',
    builtToday: true,
    owningStory: 'pre-sprint ops; account banked 2026-08-22',
    deployment: {
      address: '0x10fe91ce9947fdfb2b8dbfcb146560176ab3bf5ec15f3fc501170a5880f4b97',
      classHash: '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f',
      transactionHash: '0x7775f789a9ac5035026af78fdc110d3ee263294b002ae52a27c89040a157f3a',
      verifiedAtBlock: 13673020,
      record: 'evidence/account-deployment.json',
    },
  },
  {
    role: 'relayer',
    purpose:
      'The one signer that runs continuously and the only one a stranger can reach. Pays the ' +
      'pool fee for a cold visitor\'s first registration, and the execution gas for a relayed ' +
      'send; lends its address to the public record so the user\'s does not appear.',
    host: '`packages/relayer/src/server.ts`, a single Node process bound to 127.0.0.1:8787 by default (`RELAYER_HOST`/`PORT` widen it, deliberately)',
    keyLocation: '`RELAYER_PRIVATE_KEY` in the repo-root `.env`, read once at boot by this server process and never sent anywhere',
    discipline: [
      DEPLOYED_ACCOUNT_RULE,
      'Bounded by balance: fund it with what the current batch needs, not a treasury, so a mistake in any control costs a batch rather than a balance (see the operating rule in the `packages/relayer/src/server.ts` header).',
      'Bounded by the allowlist before the key is touched — `assertSubmittable` in `packages/relayer/src/allowlist.ts` decides what may be signed at all, and `approveCeiling` caps an approve against the LIVE pool fee, per submission.',
      'Bounded by three durable ledger FILES, one per concern — the sponsorship budget and the plain-send cap (both `SponsorshipLedger` in `packages/relayer/src/sponsorship.ts`) and the invite ledger (`InviteLedger` in `packages/relayer/src/invite.ts`) — plus one in-memory quote counter (`createQuoteCounter` in `packages/relayer/src/server.ts`). Separate files on purpose: resetting a stuck send counter must not hand out a fresh day of free registrations, nor un-burn every claimed code.',
      'Floor-paged: `createFundingMonitor` in `packages/relayer/src/funding-monitor.ts` pages ops at `WARNING_FEE_MULTIPLE` (five) live fees and refuses to sign below `REFUSAL_FEE_MULTIPLE` (two), so the warning always arrives before the door shuts.',
      'Authenticated when reachable off-loopback: with `RELAYER_AUTH_TOKEN` set, every request must carry a matching `x-relayer-auth` or the server answers `401 {"error":"missing or invalid x-relayer-auth"}` before touching the key, compared in constant time. Content-type is a CSRF control, not authentication, and behind a proxy every internet client arrives Origin-less — so a proxied deployment MUST set the token.',
    ],
    monitoring:
      'A `FundingMonitor` polling `STRK.balanceOf(relayer)` against the live pool fee every ' +
      '`RELAYER_FUNDING_INTERVAL_MS` (default 300000ms) plus one awaited check at boot. Pages to ' +
      '`RELAYER_OPS_WEBHOOK`, or to the log under the greppable prefix `relayer: OPS`. A failed ' +
      'read is `unknown`, never `exhausted` — an RPC blip must not manufacture an outage — and ' +
      '`unknown` does not reopen a gate a real measurement closed.',
    builtToday: true,
    owningStory: '1-5-relayer-product-hardening; account banked 2026-08-24 by 1-13',
    deployment: {
      address: '0x6e1c309456733fa40d17a560e4802b4ca65464cec172571b8883881bb6a0389',
      classHash: '0x061dac032f228abef9c6626f995015233097ae253a7f72d68552db02f2971b8f',
      transactionHash: '0x12cc3719ca0cf0d905a6e5230f547b88d660087529d2d250141db1ecfaf90c4',
      verifiedAtBlock: 13800832,
      record: 'evidence/account-deployment.json',
    },
  },
  {
    role: 'keeper/scheduler',
    purpose:
      'Two market workers sharing one signing identity: the catalog scheduler mints the next ' +
      'market instance, and the settlement keeper snapshots the oracle and settles. Both spend ' +
      'gas on a timer with nobody watching, which is what makes the discipline load-bearing.',
    host: 'NOT BUILT. Planned as `workers/scheduler` and `workers/settlement-keeper` (the spine\'s seed tree); the `workers/*` workspace does not exist yet — the root `package.json` still lists only `packages/*`.',
    keyLocation:
      'NOT ALLOCATED. It belongs to the worker process that will own it, not to this relayer\'s ' +
      '`.env`; story 1.6 deliberately adds no key for a process that does not run.',
    discipline: [
      DEPLOYED_ACCOUNT_RULE,
      'INHERITS AD-7 IN FULL — bounded, monitored, floor-paged — on the same reasoning as the relayer: it is a key that spends unattended.',
      'Bounded: a per-run spend ceiling and a small working balance, because a keeper that can drain a wallet on a loop is a bug with a timer attached.',
      'Floor-paged before it stalls, not after: a keeper that quietly runs out of gas looks exactly like a keeper with nothing to do.',
      'Its liveness is NOT a fund-safety dependency. Settlement has a permissionless `settle` and a permissionless void-after-timeout (AD-9); the scheduler pre-mints one instance ahead. A dead keeper delays, it does not trap.',
    ],
    monitoring:
      'None yet. When built it takes the relayer\'s shape — a balance poll against the live cost ' +
      'of its own action, paging on a transition rather than on every tick.',
    builtToday: false,
    owningStory:
      '4-3-catalog-scheduler-worker-treasury-mint-gate (scheduler) and 4-5-settlement-keeper-worker (keeper)',
    deployment: null,
  },
  {
    role: 'treasury',
    purpose:
      'Holds and disburses the market seed capital. The scheduler asks it to fund the next ' +
      'instance; it is the only shared pot in a design that otherwise isolates reserves per market.',
    host: 'NOT BUILT. An off-contract operator treasury gating `workers/scheduler`\'s mint (AD-10); no process holds it today.',
    keyLocation:
      'NOT ALLOCATED, and deliberately not in this relayer\'s `.env` — a treasury key alongside a ' +
      'hot relayer key on a single reachable host would put the largest balance behind the ' +
      'smallest boundary.',
    discipline: [
      DEPLOYED_ACCOUNT_RULE,
      'INHERITS AD-7 — bounded, monitored, floor-paged — and is the one where the bound is a real number: AD-10 caps any single seed at 10% of treasury, and the scheduler may mint only while `free_treasury >= seed + FLOOR` (FLOOR = one full catalog cycle, about $2k).',
      'Compromise is therefore bounded by that 10%/FLOOR pair rather than by the balance: the blast radius of one bad mint is at most one seed.',
      'Underfunding is a NAMED BOARD STATE, not an outage: dark the 15-minute tier, then pause 1d/1mo minting, and drop the flagship 1h last (AD-10).',
      'Per-market reserves stay isolated, so treasury trouble cannot reach a market that is already seeded.',
    ],
    monitoring:
      'None yet. `free_treasury` against `seed + FLOOR` is the reading that matters, and the ' +
      'scheduler is the natural place to take it because it is the process that spends against it.',
    builtToday: false,
    owningStory: '4-3-catalog-scheduler-worker-treasury-mint-gate (the mint gate that spends it)',
    deployment: null,
  },
] as const

/**
 * One way a relayer job can be in a non-nominal state, and what a client sees when it is.
 *
 * `answers` is the discriminator, and it exists because not every row is a refusal:
 *
 *   - `refusal` — the job answers a 4xx/5xx. `status` and usually `reason` are the wire facts
 *     `topology.test.ts` drives the live server to reproduce.
 *   - `normal-service` — a condition that LOOKS like it should close a door and deliberately
 *     does not. The funding monitor's `unknown` health is the only one today, and writing it
 *     down as a row is the point: a reader who finds only refusal rows would reasonably assume
 *     an unreadable balance closes the gate, and it must not.
 *   - `not-built` — designed, no route today. `status` is null and the live tests skip it
 *     rather than pretending to exercise it.
 *
 * `affectsRoutes` is a SUBSET of the job's routes, because "the job is degraded" is usually too
 * coarse to be true: a breached funding floor closes `POST /submit` and leaves
 * `GET /fee-recipient` — a route of the same job — answering 200.
 */
export interface DegradeState {
  /** Stable key. The doc renderer and the test scenario registry both address rows by this. */
  readonly id: string
  readonly trigger: string
  readonly answers: 'refusal' | 'normal-service' | 'not-built'
  /** The HTTP status the affected routes answer. Null only for a `not-built` row. */
  readonly status: number | null
  /** The token a client branches on. Null when the answer carries none. */
  readonly reason: string | null
  /** The exported symbol holding the byte-exact user sentence, or null when there is none. */
  readonly noticeSource: string | null
  /** Which of this job's own routes enter this state. */
  readonly affectsRoutes: readonly string[]
  /** What this SAME job still serves meanwhile, or null when every route of it is affected. */
  readonly stillServedInThisJob: string | null
  /** OTHER jobs that keep answering. Never contains this row's own job — pinned by test. */
  readonly otherJobsUnaffected: readonly RelayerJobName[]
  /** One line of why, for the operator reading the matrix. */
  readonly note: string
}

/** One of the relayer's four jobs (AD-17), with every non-nominal state it can be in. */
export interface RelayerJob {
  readonly job: RelayerJobName
  readonly summary: string
  /** Every route that serves this job. Empty only for a job with no route today. */
  readonly routes: readonly string[]
  readonly degradeStates: readonly DegradeState[]
  readonly builtToday: boolean
  readonly note: string
}

const SUBMIT_ROUTES = ['POST /submit', 'POST /api/submit'] as const
const FEE_RECIPIENT_ROUTES = ['GET /fee-recipient', 'GET /api/fee-recipient'] as const
const SPONSORED_SUBMIT_ROUTES = [
  'POST /submit (with `sponsored: true`)',
  'POST /api/submit (with `sponsored: true`)',
] as const
const INVITE_ROUTES = [
  'POST /invite/mint',
  'POST /invite/claim',
  'POST /invite/status',
  'POST /api/invite/mint',
  'POST /api/invite/claim',
  'POST /api/invite/status',
] as const
const QUOTE_ROUTES = ['POST /quote', 'POST /api/quote'] as const
// Both are POSTs, including the one that streams — see ROOM_STREAM_PATHS in server.ts for why.
const ROOM_ROUTES = [
  'POST /room/send',
  'POST /room/stream',
  'POST /api/room/send',
  'POST /api/room/stream',
] as const
// A POST that streams, ROOM_ROUTES' rule — see CHAIN_STREAM_PATHS in server.ts.
const CHAIN_FEED_ROUTES = ['POST /chain/stream', 'POST /api/chain/stream'] as const

/**
 * The four relayer jobs and their per-job degrade matrix (AD-17).
 *
 * THE ONE ROW THAT LOOKS LIKE A CONTRADICTION IS THE FUNDING FLOOR. Submission and sponsored
 * registration are separate jobs that share one signing wallet, so a breached floor closes both.
 * That is still per-job degradation and not a global outage: each answers its own honest 503 from
 * its own gate, the fee-recipient read of the very same job keeps answering, and the quote proxy
 * and invite routes keep answering in the same process. The distinction is what
 * `topology.test.ts` proves — "two jobs cannot sign" and "the relayer is down" are different
 * sentences, and only the first one is true.
 *
 * These rows name states that already exist in shipped code. Story 1.6 does not restyle a status,
 * a token or a sentence; it enumerates them and proves they are independent.
 */
export const RELAYER_JOBS: readonly RelayerJob[] = [
  {
    job: 'submission',
    summary:
      'Signs and broadcasts a plain submission — a sealed send or any allowlisted batch. The fee ' +
      'comes back to the relayer through a `Withdraw` leg inside the user\'s own proven action ' +
      'chain, so what this job actually gives away is the execution gas.',
    routes: [...SUBMIT_ROUTES, ...FEE_RECIPIENT_ROUTES],
    degradeStates: [
      {
        id: 'submission/funding-floor',
        trigger:
          'Funding floor breached — the relayer wallet holds less than `REFUSAL_FEE_MULTIPLE` ' +
          '(two) times the live pool fee, so the next fee transfer would revert.',
        answers: 'refusal',
        status: 503,
        reason: 'relayer-down',
        noticeSource: 'RELAYER_DOWN_NOTICE (`packages/protocol/src/relayer-wire.ts`)',
        affectsRoutes: [...SUBMIT_ROUTES],
        stillServedInThisJob:
          '`GET /fee-recipient` still answers 200 with the address — it signs nothing and reads ' +
          'nothing off-chain, so there is no reason for it to close.',
        otherJobsUnaffected: ['quote proxy', 'chat transport'],
        note:
          'Sponsored registration is closed too, by its own gate on the same shared wallet. Two ' +
          'jobs cannot sign; the relayer is not down.',
      },
      {
        id: 'submission/funding-unknown',
        trigger:
          'Funding health UNKNOWN — the balance read failed, or the live fee read as zero or ' +
          'negative, so the monitor cannot judge the wallet at all.',
        answers: 'normal-service',
        status: 200,
        reason: null,
        noticeSource: null,
        affectsRoutes: [],
        stillServedInThisJob: 'Everything. This row exists to say that nothing closes.',
        otherJobsUnaffected: ['sponsored registration', 'quote proxy', 'chat transport'],
        note:
          'DELIBERATELY NOT A REFUSAL, and 1-5 reviewed code. `userState()` reports from the last ' +
          'DEFINITE measurement, so an unreadable balance is an absence of news rather than bad ' +
          'news — classifying an RPC blip as exhausted would turn every read failure into a ' +
          'self-inflicted outage. The failure still pages ops. The stickiness runs the other way ' +
          'too: a failed read after a definite `exhausted` does NOT reopen the gate.',
      },
      {
        id: 'submission/send-cap',
        trigger:
          'Plain-send cap spent — this visitor or this UTC day has used the send ledger up ' +
          '(`RELAYER_SEND_PER_VISITOR` / `RELAYER_SEND_DAILY`).',
        answers: 'refusal',
        status: 403,
        reason: 'send-cap-reached',
        noticeSource: 'SEND_CAP_NOTICE (`packages/protocol/src/relayer-wire.ts`)',
        affectsRoutes: [...SUBMIT_ROUTES],
        stillServedInThisJob: '`GET /fee-recipient` still answers.',
        otherJobsUnaffected: ['sponsored registration', 'quote proxy', 'chat transport'],
        note:
          'A separate ledger in a separate file from the sponsorship budget, so a busy day of ' +
          'sends cannot spend the day\'s free account creations.',
      },
    ],
    builtToday: true,
    note:
      'The fee-recipient read belongs to this job: it is the address a reimbursement `Withdraw` ' +
      'must name. It answers 503 with prose and no reason token when unconfigured — a ' +
      'misconfiguration, not a degrade state, which is why it is not a row above.',
  },
  {
    job: 'sponsored registration',
    summary:
      'Pays a cold visitor\'s first registration out of the relayer\'s own balance — the one ' +
      'thing this product actually gives away. Same route as submission, distinguished by ' +
      '`sponsored: true` in the body, and charged to a different ledger because of it.',
    routes: [...SPONSORED_SUBMIT_ROUTES, ...INVITE_ROUTES],
    degradeStates: [
      {
        id: 'sponsored/funding-floor',
        trigger:
          'Funding floor breached — the same shared signing wallet as submission, so the same ' +
          'condition closes this door through this job\'s own gate.',
        answers: 'refusal',
        status: 503,
        reason: 'relayer-down',
        noticeSource: 'RELAYER_DOWN_NOTICE (`packages/protocol/src/relayer-wire.ts`)',
        affectsRoutes: [...SPONSORED_SUBMIT_ROUTES],
        stillServedInThisJob:
          'The invite routes still mint, claim and report — they burn no gas, so a wallet that ' +
          'cannot pay a fee can still hand out and account for codes.',
        otherJobsUnaffected: ['quote proxy', 'chat transport'],
        note:
          'This is the row the cold-start caveat is about: see COLD_START_CAVEAT. An invite ' +
          'claimed during a breach stays claimed, and the registration it buys waits for funding.',
      },
      {
        id: 'sponsored/budget-exhausted',
        trigger:
          'Sponsorship budget exhausted — the per-visitor cap or the UTC-daily budget is spent ' +
          '(`RELAYER_SPONSOR_PER_VISITOR` / `RELAYER_SPONSOR_DAILY`).',
        answers: 'refusal',
        status: 403,
        reason: 'sponsorship-paused',
        noticeSource: 'BUDGET_EXHAUSTED_NOTICE (`packages/relayer/src/sponsorship.ts`)',
        affectsRoutes: [...SPONSORED_SUBMIT_ROUTES],
        stillServedInThisJob: 'The invite routes still answer; a code minted today keeps for tomorrow.',
        otherJobsUnaffected: ['submission', 'quote proxy', 'chat transport'],
        note:
          'Fails OPEN into pay-your-own-way rather than into a locked door, and the notice says ' +
          'so. A burned invite waives the per-visitor cap and never the daily budget.',
      },
      {
        id: 'sponsored/invites-off',
        trigger:
          'Invites off — `RELAYER_INVITE_ALLOWANCE` unset, the master switch for the whole ' +
          'invite sub-feature. There is no defensible default for how many free registrations ' +
          'one address may hand strangers, so absent means off.',
        answers: 'refusal',
        status: 404,
        reason: null,
        noticeSource: null,
        affectsRoutes: [...INVITE_ROUTES],
        stillServedInThisJob:
          'THE JOB ITSELF IS UNAFFECTED. Sponsored registration keeps working on ' +
          '`POST /submit` with `sponsored: true`; only the invite sub-feature is absent. A code ' +
          'presented on the submit path gets a typed 400 `invites-not-offered`, not a 404, ' +
          'because there the client has already built a body around it.',
        otherJobsUnaffected: ['submission', 'quote proxy', 'chat transport'],
        note:
          'Scoped to the invite routes, not to the job. The switch removes a door; it does not ' +
          'close the building. Setting any other `RELAYER_INVITE_*` knob without the allowance ' +
          'is a startup error, not a silent no-op — see `resolveInviteConfig` in ' +
          '`packages/relayer/src/server.ts`.',
      },
    ],
    builtToday: true,
    note:
      'Not a separate submit route from submission, and that is deliberate: one signing path, ' +
      'one allowlist, one place every gate lives. What makes it a separate JOB is that it draws ' +
      'on a separate budget, owns the invite routes, and fails with separate copy.',
  },
  {
    job: 'quote proxy',
    summary:
      'Fetches third-party prices and bridge attestations server-side (FR-029), so an aggregator ' +
      'sees this host and a bare path instead of the visitor\'s address next to their intent. ' +
      'The allowlist in `packages/relayer/src/quote-proxy.ts` doubles as the SSRF guard.',
    routes: [...QUOTE_ROUTES],
    degradeStates: [
      {
        id: 'quote/upstream-dead',
        trigger:
          'Upstream dead or misbehaving — the fetch throws or times out, answers a non-2xx, ' +
          'answers something that is not JSON, answers ANY redirect (the request is made with ' +
          '`redirect: \'error\'`, so no redirect is ever followed — not merely off-host ones), ' +
          'or exceeds the read cap while streaming.',
        answers: 'refusal',
        status: 502,
        reason: null,
        noticeSource: null,
        affectsRoutes: [...QUOTE_ROUTES],
        stillServedInThisJob: null,
        otherJobsUnaffected: ['submission', 'sponsored registration', 'chat transport'],
        note:
          'A per-request failure against an outside party with no shared state behind it — one ' +
          'bad quote does not poison the next. The read cap is enforced WHILE streaming, not by ' +
          'trusting a content-length the sender chose.',
      },
      {
        id: 'quote/cap-hit',
        trigger:
          'Quote cap hit — the per-visitor daily cap or the global daily ceiling ' +
          '(`RELAYER_QUOTE_DAILY_PER_VISITOR` / `RELAYER_QUOTE_DAILY_GLOBAL`). A visitor here is ' +
          'the same salted, day-scoped hash of the client address the budgets use, not a raw IP.',
        answers: 'refusal',
        status: 429,
        reason: null,
        noticeSource: null,
        affectsRoutes: [...QUOTE_ROUTES],
        stillServedInThisJob: null,
        otherJobsUnaffected: ['submission', 'sponsored registration', 'chat transport'],
        note:
          'Its own counter, and never a budget: charging quotes against the sponsorship budget ' +
          'would let anyone burn a visitor\'s free registration by asking for prices. The ' +
          'counter also stops tracking NEW visitors past `MAX_TRACKED_QUOTE_VISITORS` so a ' +
          'rotating address range cannot grow the map without bound.',
      },
    ],
    builtToday: true,
    note:
      'Its counter is in memory, unlike the durable ledgers, because a quote is egress rather ' +
      'than money — handing out fresh quota on restart is cheaper than inheriting a failure mode ' +
      'where an unwritable disk stops price lookups.',
  },
  {
    job: 'chat transport',
    summary:
      'A broadcast bus for chat rooms. It routes sealed envelopes by an opaque 128-bit room id ' +
      'and holds a short ciphertext backlog in memory for a peer whose tab was shut. It has no ' +
      'signing key, no ledger and no store path, so it is the one job here that cannot spend ' +
      'anything or lose anything durable.',
    routes: [...ROOM_ROUTES],
    degradeStates: [
      {
        id: 'chat/room-full',
        trigger:
          'A room already holds `MAX_SUBSCRIBERS_PER_ROOM` connections, or the host already holds ' +
          '`MAX_ROOMS` rooms. Both are concurrency ceilings, not lifetime ones — the idle sweep ' +
          'returns the slots.',
        answers: 'refusal',
        status: 503,
        reason: 'room-full',
        noticeSource: null,
        affectsRoutes: ['POST /room/stream', 'POST /api/room/stream'],
        stillServedInThisJob:
          'Sending into an existing room still works: a publish does not need a subscription, and ' +
          'the backlog is what the other side reads when it reconnects.',
        otherJobsUnaffected: ['submission', 'sponsored registration', 'quote proxy'],
        note:
          'A ceiling reached by an attacker opening rooms, not by a crowd. Two people talking use ' +
          'one room and a handful of sockets.',
      },
      {
        id: 'chat/rate-limited',
        trigger:
          'More than `MAX_PUBLISH_PER_MINUTE` publishes into one room inside a rolling minute. The ' +
          'window rolls rather than resetting on the minute, so a burst cannot be banked by ' +
          'waiting for a clock boundary.',
        answers: 'refusal',
        status: 429,
        reason: 'rate-limited',
        noticeSource: null,
        affectsRoutes: ['POST /room/send', 'POST /api/room/send'],
        stillServedInThisJob:
          'Streams stay open and keep delivering. The room is not closed; one sender is asked to ' +
          'slow down.',
        otherJobsUnaffected: ['submission', 'sponsored registration', 'quote proxy'],
        note:
          'Scoped to a room rather than to a visitor, because the room id is the only identifier ' +
          'this job has — and giving it a visitor identity would mean learning who is in a ' +
          'conversation, which is the one thing the design refuses to know.',
      },
      {
        id: 'chat/restart-loses-backlog',
        trigger:
          'The process restarts — a deploy, a crash, a host move. Every room, every open stream ' +
          'and the whole ciphertext backlog go with it; clients reconnect on their own backoff.',
        answers: 'normal-service',
        status: 200,
        reason: null,
        noticeSource: null,
        affectsRoutes: [],
        stillServedInThisJob: null,
        otherJobsUnaffected: ['submission', 'sponsored registration', 'quote proxy'],
        note:
          'NOT A FAULT, AND NOT SILENTLY FINE EITHER. Nothing durable is lost because nothing here ' +
          'is durable by design, and a message sent while the peer was away during a restart is ' +
          'genuinely gone — the transport can drop, and no receiver can detect a drop. Rooms ' +
          're-derive from the chain on the next load, so the conversation itself survives.',
      },
    ],
    builtToday: true,
    note:
      'Ships in this process rather than on a Durable Object (a deviation from AD-17, recorded on ' +
      '`RelayerJobName`). Because the rooms are in memory, the deployment must run exactly ONE ' +
      'machine: two would each hold half of every conversation and neither would know. ' +
      '`fly.toml` pins that with `auto_stop_machines = false` and `min_machines_running = 1`.',
  },
  {
    job: 'chain feed',
    summary:
      'One poller for every open tab. This process reads markets, launches, oracle prices and ' +
      'the app contracts\' own events on a timer, and fans the answers out over the same ' +
      'SSE-over-POST framing the chat transport proved. It signs nothing and serves only public ' +
      'chain state; what it adds is a bounded price history (`RELAYER_CHAIN_FEED_STORE`) that a ' +
      'browser could not have witnessed for itself.',
    routes: [...CHAIN_FEED_ROUTES],
    degradeStates: [
      {
        id: 'chain-feed/at-capacity',
        trigger:
          'The feed already holds `MAX_FEED_SUBSCRIBERS` open streams. A concurrency ceiling, ' +
          'not a lifetime one — slots return the moment a tab closes.',
        answers: 'refusal',
        status: 503,
        reason: null,
        noticeSource: null,
        affectsRoutes: [...CHAIN_FEED_ROUTES],
        stillServedInThisJob: null,
        otherJobsUnaffected: ['submission', 'sponsored registration', 'quote proxy', 'chat transport'],
        note:
          'The browser treats the refusal as "poll for yourself": its store runs the same reads ' +
          'directly, visibility-aware, so a full feed degrades to slower — never to blank.',
      },
      {
        id: 'chain-feed/source-degraded',
        trigger:
          'An upstream read fails — the RPC hosts, the oracle, the event scan. The poller keeps ' +
          'its last good rows and says so; nothing closes.',
        answers: 'normal-service',
        status: 200,
        reason: null,
        noticeSource: null,
        affectsRoutes: [],
        stillServedInThisJob:
          'The stream itself. Every hello and every health frame carries the problem sentence, ' +
          'so a degraded feed answers its own honest state rather than presenting an outage.',
        otherJobsUnaffected: ['submission', 'sponsored registration', 'quote proxy', 'chat transport'],
        note:
          'The degrade doctrine\'s load-bearing sentence, applied: a degraded job answers its own ' +
          'honest state; it does not take the relayer down. The rows it last read were true when ' +
          'read, and the sentence beside them says why they may be stale.',
      },
    ],
    builtToday: true,
    note:
      'In this process rather than beside it for the chat transport\'s reason: one always-on ' +
      'machine already holds the RPC path and the timers, and a second host would be a second ' +
      'thing to keep alive during judging. The JSONL price store lives on the volume because its ' +
      'whole value is the past this process witnessed; losing it costs a chart its history, ' +
      'never anyone a cap.',
  },
  {
    job: 'stats',
    summary:
      'DESIGNED, NOT BUILT (AD-14). Cached protocol-wide aggregates — the unbounded-range ones ' +
      'a browser cannot compute over a capped block window, such as bridge "largest ever" and ' +
      'protocol-wide shielder counts. Everything market- or launch-scoped is drawn client-side ' +
      'from on-chain events instead and never touches this job.',
    routes: [],
    degradeStates: [
      {
        id: 'stats/stale',
        trigger:
          'Aggregate refresh fails or is stale. The designed behavior is to serve the last good ' +
          'value with its block stamp — the caption already reads "as of block N", so a stale ' +
          'answer stays honest without new copy.',
        answers: 'not-built',
        status: null,
        reason: null,
        noticeSource: null,
        affectsRoutes: [],
        stillServedInThisJob: null,
        otherJobsUnaffected: ['submission', 'sponsored registration', 'quote proxy', 'chat transport'],
        note:
          'By construction it cannot take a paying job down: a cache over public reads, with no ' +
          'signing key and no ledger behind it.',
      },
    ],
    builtToday: false,
    note:
      'NO ROUTE EXISTS TODAY and story 1.6 does not invent one. It is enumerated because AD-17 ' +
      'names four relayer jobs and a matrix with three rows would read as though the fourth had ' +
      'been forgotten. It is not a new worker either (AD-14) — it is a cache inside the relayer ' +
      'we already run.',
  },
] as const

/**
 * The surfaces that must be live for the demo, and the processes they actually need.
 *
 * `surfaces` and `processes` are AD-17 verbatim and are pinned as such — the demo-critical
 * PROCESS SET is an architecture decision and this story does not get to widen it.
 *
 * `alsoRequired` is a different kind of fact and is kept in a different field for that reason:
 * these are not processes we run, they are things the demo nonetheless cannot happen without.
 * Leaving them unsaid would make the demo-critical set read as a complete pre-flight, which it
 * is not.
 */
export const DEMO_CRITICAL = {
  surfaces: ['Wallet', 'Chat'],
  //
  // ONE PROCESS, NOT TWO — CORRECTED, NOT WIDENED. AD-17 named a Cloudflare Durable Object as the
  // chat relay and this field was pinned to it. That Durable Object was never built: B3 put the
  // room transport on the relayer itself (`rooms.ts`), which is a process this list already
  // required. So the demo-critical set SHRANK. Leaving the old value would have kept a green test
  // asserting a dependency on something nobody deployed, which is the failure mode a pinned list
  // is supposed to prevent rather than cause.
  //
  processes: ['relayer'],
  offPath: ['market scheduler', 'settlement keeper', 'epoch clearer', 'graduation executor'],
  offPathRationale:
    'permissionless backstops protect funds regardless: permissionless `settle` and ' +
    'void-after-timeout (AD-9), permissionless `clear_epoch` plus auto-clear on the next-epoch ' +
    'interaction (AD-2/AD-11), permissionless `graduate()` (AD-2). A stalled worker delays ' +
    'something; it never traps a balance.',
  alsoRequired: [
    'Browser-direct Starknet JSON-RPC reads. The app reads chain state from the RPC hosts in ' +
      '`packages/protocol/src/constants.ts` directly, not through the relayer, so an RPC outage ' +
      'degrades the surfaces even while every process we run is healthy. This is one of the two ' +
      'disclosed browser-direct exceptions, not an oversight.',
    'Static hosting for the web app itself. It is not a process with a signer or a backstop, ' +
      'but nothing loads without it.',
  ],
} as const

/**
 * Q5, unresolved and marked as such (AD-17, spine open question 5).
 *
 * THIS STORY DOES NOT ANSWER IT. It is here so that the one onboarding path with no
 * permissionless backstop is written where an operator or a reviewer will actually meet it,
 * rather than living in a planning document nobody opens during an outage.
 *
 * SELF-CONTAINED ON PURPOSE. Every fact needed to act on this is stated here and in the banked
 * evidence file beside it. An earlier draft pointed at a planning path that is gitignored and
 * therefore unreadable to exactly the audience this exists for.
 */
export const COLD_START_CAVEAT = {
  status: '[OPEN → Abu]',
  spineQuestion: 'Q5 (AD-17)',
  /** The spine's own wording, so the flag and the source cannot drift apart. */
  question:
    'when the relayer is down, sponsored onboarding degrades to self-pay which requires the ' +
    'visitor to already hold STRK — the one onboarding path with no permissionless backstop; ' +
    'decide whether that is acceptable for the judge path or needs a second sponsorship channel.',
  sharpenedBy1_13:
    'Cold start is TWO transactions, not one: DEPLOY_ACCOUNT then registration. The prove leg ' +
    'authenticates the registering user through the pool\'s `assert_valid_signature`, whose SRC5 ' +
    '`supports_interface` probe hard-reverts on an undeployed address, so a sponsored ' +
    'registration can never be a counterfactual account\'s first act. The free `compile_actions` ' +
    'view accepts an undeployed sender, which is why no earlier probe caught it.',
  /** The half of the sequence nobody sponsors — the part that makes Q5 bite when we are healthy. */
  deploymentIsUnsponsored:
    'DEPLOY_ACCOUNT is self-paid and NOTHING SPONSORS IT TODAY. The visitor must therefore ' +
    'already hold STRK even when the relayer is perfectly healthy, so this caveat is not only ' +
    'about relayer-down. Whether the relayer should sponsor the deployment is an open product ' +
    'decision owned by epic 6 or a later relayer story; it was explicitly out of scope for 1.13 ' +
    'and is out of scope for 1.6.',
  measured:
    'DEPLOY_ACCOUNT estimated at 0.126 STRK; the banked deployment cost 54911450842067264 wei ' +
    'and the sponsored registration beside it cost the relayer 8.59427093855343896 STRK ' +
    '(pool fee 6 STRK + 2.594270938553438960 STRK gas).',
  evidence: 'evidence/sponsored-registration.json (`accountDeployment`, `cost`)',
  notResolvedHere:
    'Story 1.6 documents and flags only. No second sponsorship channel, no cold-start redesign.',
} as const
