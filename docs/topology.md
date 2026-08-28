# Deployment topology, signers, and the per-job degrade matrix

**Architecture authority:** AD-17 (`ARCHITECTURE-SPINE.md`). **Story:** 1.6.
**Source of truth:** [`packages/relayer/src/topology.ts`](../packages/relayer/src/topology.ts).

Every table on this page mirrors that module. When the module changes, update the tables here to
match.

`packages/relayer/test/topology.test.ts` holds the other half: it drives a live relayer through
every degrade row below and fails when the **server** stops behaving the way a row says it does.
Data-to-server is held by those tests; data-to-doc is held by whoever remembers to re-run the renderer.

If you read nothing else: **a degraded job here answers its own honest state, it does not take
the relayer down.** The only sentence on this page that is still an open question is the
[cold start caveat](#cold-start-caveat), and it is open on purpose.

---

## 1. The signer set is four, not two

Four keys can sign on behalf of this product. Two exist today; two are named here before they are
built, because a key whose discipline gets decided the afternoon it is created has whatever
discipline was convenient that afternoon.

<!-- generated:signers -->
| Signer | Exists today | Host — the process that holds it | Key location |
|---|---|---|---|
| deployer | Yes | the operator workstation, one-shot only: `scripts/deploy-account.ts`, `scripts/deploy-message-book.ts`. No long-running process holds this key. | `DEPLOYER_PRIVATE_KEY` in the repo-root `.env` (gitignored), never a `VITE_`-prefixed variable |
| relayer | Yes | `packages/relayer/src/server.ts`, a single Node process bound to 127.0.0.1:8787 by default (`RELAYER_HOST`/`PORT` widen it, deliberately) | `RELAYER_PRIVATE_KEY` in the repo-root `.env`, read once at boot by this server process and never sent anywhere |
| keeper/scheduler | **No** | NOT BUILT. Planned as `workers/scheduler` and `workers/settlement-keeper` (the spine's seed tree); the `workers/*` workspace does not exist yet — the root `package.json` still lists only `packages/*`. | NOT ALLOCATED. It belongs to the worker process that will own it, not to this relayer's `.env`; story 1.6 deliberately adds no key for a process that does not run. |
| treasury | **No** | NOT BUILT. An off-contract operator treasury gating `workers/scheduler`'s mint (AD-10); no process holds it today. | NOT ALLOCATED, and deliberately not in this relayer's `.env` — a treasury key alongside a hot relayer key on a single reachable host would put the largest balance behind the smallest boundary. |
<!-- /generated:signers -->

### The rule that applies to all four

> **The account contract must be deployed on-chain before a key can sign anything.** Verify with a
> free `getClassHashAt(address)` read before any spend.

A funded hot key is not a signer. Starknet accounts are contracts, and a key whose account was
never deployed passes every free pre-check — the balance reads fine, the free `compile_actions`
view accepts it as a sender — and then fails the first thing that costs money. Story 1.13 learned
this the expensive way: the relayer key was funded and undeployed, and the relay leg failed with
`Contract not found` only *after* a throwaway account's deploy leg had been paid for and burned.

The check costs one RPC read and is the first thing an ops script should do; the precedent is the
`getClassHashAt` pre-flight in
[`scripts/bank-sponsored-registration.ts`](../scripts/bank-sponsored-registration.ts), which
aborts before spending anything. Deploy with
`npx tsx scripts/deploy-account.ts --role=<deployer|relayer> --execute`.

### Discipline, per signer

<!-- generated:discipline -->
#### deployer

Declares and deploys the product contracts. Kept separate from the relayer because Task 8's identity_key probe needs two distinct callers of the same helper to prove the pool scopes a handle per user — one wallet playing both roles proves nothing.

- The ACCOUNT CONTRACT must be deployed on-chain before this key can sign anything. Verify with a free `getClassHashAt(address)` read before any spend — a funded but undeployed key answers every free pre-check and then fails the first paid leg (story 1.13). Deploy with `npx tsx scripts/deploy-account.ts --role=<role> --execute`.
- Bounded by not being resident: it is loaded by a script, spends once, and exits. There is no server that can be reached to make it sign.
- Funded per deployment, not as a float. A deploy costs what it costs; the wallet does not carry a treasury between them.
- Never the relayer. Two separately funded wallets is a test requirement, not a convention — see the header of `.env.example`.

*Monitoring:* None running, and none needed while the key is not resident — a script that cannot pay fails loudly at its own pre-flight, in front of the operator who started it.

#### relayer

The one signer that runs continuously and the only one a stranger can reach. Pays the pool fee for a cold visitor's first registration, and the execution gas for a relayed send; lends its address to the public record so the user's does not appear.

- The ACCOUNT CONTRACT must be deployed on-chain before this key can sign anything. Verify with a free `getClassHashAt(address)` read before any spend — a funded but undeployed key answers every free pre-check and then fails the first paid leg (story 1.13). Deploy with `npx tsx scripts/deploy-account.ts --role=<role> --execute`.
- Bounded by balance: fund it with what the current batch needs, not a treasury, so a mistake in any control costs a batch rather than a balance (see the operating rule in the `packages/relayer/src/server.ts` header).
- Bounded by the allowlist before the key is touched — `assertSubmittable` in `packages/relayer/src/allowlist.ts` decides what may be signed at all, and `approveCeiling` caps an approve against the LIVE pool fee, per submission.
- Bounded by three durable ledger FILES, one per concern — the sponsorship budget and the plain-send cap (both `SponsorshipLedger` in `packages/relayer/src/sponsorship.ts`) and the invite ledger (`InviteLedger` in `packages/relayer/src/invite.ts`) — plus one in-memory quote counter (`createQuoteCounter` in `packages/relayer/src/server.ts`). Separate files on purpose: resetting a stuck send counter must not hand out a fresh day of free registrations, nor un-burn every claimed code.
- Floor-paged: `createFundingMonitor` in `packages/relayer/src/funding-monitor.ts` pages ops at `WARNING_FEE_MULTIPLE` (five) live fees and refuses to sign below `REFUSAL_FEE_MULTIPLE` (two), so the warning always arrives before the door shuts.
- Authenticated when reachable off-loopback: with `RELAYER_AUTH_TOKEN` set, every request must carry a matching `x-relayer-auth` or the server answers `401 {"error":"missing or invalid x-relayer-auth"}` before touching the key, compared in constant time. Content-type is a CSRF control, not authentication, and behind a proxy every internet client arrives Origin-less — so a proxied deployment MUST set the token.

*Monitoring:* A `FundingMonitor` polling `STRK.balanceOf(relayer)` against the live pool fee every `RELAYER_FUNDING_INTERVAL_MS` (default 300000ms) plus one awaited check at boot. Pages to `RELAYER_OPS_WEBHOOK`, or to the log under the greppable prefix `relayer: OPS`. A failed read is `unknown`, never `exhausted` — an RPC blip must not manufacture an outage — and `unknown` does not reopen a gate a real measurement closed.

#### keeper/scheduler (not built)

Two market workers sharing one signing identity: the catalog scheduler mints the next market instance, and the settlement keeper snapshots the oracle and settles. Both spend gas on a timer with nobody watching, which is what makes the discipline load-bearing.

- The ACCOUNT CONTRACT must be deployed on-chain before this key can sign anything. Verify with a free `getClassHashAt(address)` read before any spend — a funded but undeployed key answers every free pre-check and then fails the first paid leg (story 1.13). Deploy with `npx tsx scripts/deploy-account.ts --role=<role> --execute`.
- INHERITS AD-7 IN FULL — bounded, monitored, floor-paged — on the same reasoning as the relayer: it is a key that spends unattended.
- Bounded: a per-run spend ceiling and a small working balance, because a keeper that can drain a wallet on a loop is a bug with a timer attached.
- Floor-paged before it stalls, not after: a keeper that quietly runs out of gas looks exactly like a keeper with nothing to do.
- Its liveness is NOT a fund-safety dependency. Settlement has a permissionless `settle` and a permissionless void-after-timeout (AD-9); the scheduler pre-mints one instance ahead. A dead keeper delays, it does not trap.

*Monitoring:* None yet. When built it takes the relayer's shape — a balance poll against the live cost of its own action, paging on a transition rather than on every tick. — owned by `4-3-catalog-scheduler-worker-treasury-mint-gate (scheduler) and 4-5-settlement-keeper-worker (keeper)`

#### treasury (not built)

Holds and disburses the market seed capital. The scheduler asks it to fund the next instance; it is the only shared pot in a design that otherwise isolates reserves per market.

- The ACCOUNT CONTRACT must be deployed on-chain before this key can sign anything. Verify with a free `getClassHashAt(address)` read before any spend — a funded but undeployed key answers every free pre-check and then fails the first paid leg (story 1.13). Deploy with `npx tsx scripts/deploy-account.ts --role=<role> --execute`.
- INHERITS AD-7 — bounded, monitored, floor-paged — and is the one where the bound is a real number: AD-10 caps any single seed at 10% of treasury, and the scheduler may mint only while `free_treasury >= seed + FLOOR` (FLOOR = one full catalog cycle, about $2k).
- Compromise is therefore bounded by that 10%/FLOOR pair rather than by the balance: the blast radius of one bad mint is at most one seed.
- Underfunding is a NAMED BOARD STATE, not an outage: dark the 15-minute tier, then pause 1d/1mo minting, and drop the flagship 1h last (AD-10).
- Per-market reserves stay isolated, so treasury trouble cannot reach a market that is already seeded.

*Monitoring:* None yet. `free_treasury` against `seed + FLOOR` is the reading that matters, and the scheduler is the natural place to take it because it is the process that spends against it. — owned by `4-3-catalog-scheduler-worker-treasury-mint-gate (the mint gate that spends it)`
<!-- /generated:discipline -->

### Banked deployments

<!-- generated:deployments -->
| Signer | Address | Deploy transaction | Class verified at block |
|---|---|---|---|
| deployer | [`0x10fe91…f4b97`](https://voyager.online/contract/0x10fe91ce9947fdfb2b8dbfcb146560176ab3bf5ec15f3fc501170a5880f4b97) | [`0x7775f7…57f3a`](https://voyager.online/tx/0x7775f789a9ac5035026af78fdc110d3ee263294b002ae52a27c89040a157f3a) | 13673020 |
| relayer | [`0x6e1c30…a0389`](https://voyager.online/contract/0x6e1c309456733fa40d17a560e4802b4ca65464cec172571b8883881bb6a0389) | [`0x12cc37…f90c4`](https://voyager.online/tx/0x12cc3719ca0cf0d905a6e5230f547b88d660087529d2d250141db1ecfaf90c4) | 13800832 |

Class `0x061dac…71b8f`, read back off the chain rather than trusted from the response. Record: `evidence/account-deployment.json`.
<!-- /generated:deployments -->

---

## 2. The relayer's four jobs, and how each one degrades

AD-17 names four relayer jobs. Three are built; `stats` is designed and not built, and no route
is invented for it below.

Two columns carry the weight. **Routes affected** is there because "the job is degraded" is
usually too coarse to be true — a breached funding floor closes `POST /submit` while
`GET /fee-recipient`, a route of the *same* job, keeps answering 200. **Other jobs unaffected**
is the per-job half of AD-17, and it never lists the row's own job.

One row is not a refusal at all. The funding monitor's `unknown` health is written down as
`normal-service` precisely because a reader who found only refusal rows would reasonably assume
an unreadable balance closes the gate — and it must not.

<!-- generated:matrix -->
#### submission

Signs and broadcasts a plain submission — a sealed send or any allowlisted batch. The fee comes back to the relayer through a `Withdraw` leg inside the user's own proven action chain, so what this job actually gives away is the execution gas.

*Routes:* `POST /submit` · `POST /api/submit` · `GET /fee-recipient` · `GET /api/fee-recipient`

| Trigger | Answer | Routes affected | Same job still serves | Other jobs unaffected |
|---|---|---|---|---|
| Funding floor breached — the relayer wallet holds less than `REFUSAL_FEE_MULTIPLE` (two) times the live pool fee, so the next fee transfer would revert. | `503` `relayer-down` | `POST /submit` · `POST /api/submit` | `GET /fee-recipient` still answers 200 with the address — it signs nothing and reads nothing off-chain, so there is no reason for it to close. | quote proxy, chat transport |
| Funding health UNKNOWN — the balance read failed, or the live fee read as zero or negative, so the monitor cannot judge the wallet at all. | `200` | *nothing* | Everything. This row exists to say that nothing closes. | sponsored registration, quote proxy, chat transport |
| Plain-send cap spent — this visitor or this UTC day has used the send ledger up (`RELAYER_SEND_PER_VISITOR` / `RELAYER_SEND_DAILY`). | `403` `send-cap-reached` | `POST /submit` · `POST /api/submit` | `GET /fee-recipient` still answers. | sponsored registration, quote proxy, chat transport |

- **Funding floor breached:** Sponsored registration is closed too, by its own gate on the same shared wallet. Two jobs cannot sign; the relayer is not down.
- **Funding health UNKNOWN:** DELIBERATELY NOT A REFUSAL, and 1-5 reviewed code. `userState()` reports from the last DEFINITE measurement, so an unreadable balance is an absence of news rather than bad news — classifying an RPC blip as exhausted would turn every read failure into a self-inflicted outage. The failure still pages ops. The stickiness runs the other way too: a failed read after a definite `exhausted` does NOT reopen the gate.
- **Plain-send cap spent:** A separate ledger in a separate file from the sponsorship budget, so a busy day of sends cannot spend the day's free account creations.

*The fee-recipient read belongs to this job: it is the address a reimbursement `Withdraw` must name. It answers 503 with prose and no reason token when unconfigured — a misconfiguration, not a degrade state, which is why it is not a row above.*

#### sponsored registration

Pays a cold visitor's first registration out of the relayer's own balance — the one thing this product actually gives away. Same route as submission, distinguished by `sponsored: true` in the body, and charged to a different ledger because of it.

*Routes:* `POST /submit (with `sponsored: true`)` · `POST /api/submit (with `sponsored: true`)` · `POST /invite/mint` · `POST /invite/claim` · `POST /invite/status` · `POST /api/invite/mint` · `POST /api/invite/claim` · `POST /api/invite/status`

| Trigger | Answer | Routes affected | Same job still serves | Other jobs unaffected |
|---|---|---|---|---|
| Funding floor breached — the same shared signing wallet as submission, so the same condition closes this door through this job's own gate. | `503` `relayer-down` | `POST /submit (with `sponsored: true`)` · `POST /api/submit (with `sponsored: true`)` | The invite routes still mint, claim and report — they burn no gas, so a wallet that cannot pay a fee can still hand out and account for codes. | quote proxy, chat transport |
| Sponsorship budget exhausted — the per-visitor cap or the UTC-daily budget is spent (`RELAYER_SPONSOR_PER_VISITOR` / `RELAYER_SPONSOR_DAILY`). | `403` `sponsorship-paused` | `POST /submit (with `sponsored: true`)` · `POST /api/submit (with `sponsored: true`)` | The invite routes still answer; a code minted today keeps for tomorrow. | submission, quote proxy, chat transport |
| Invites off — `RELAYER_INVITE_ALLOWANCE` unset, the master switch for the whole invite sub-feature. There is no defensible default for how many free registrations one address may hand strangers, so absent means off. | `404` | `POST /invite/mint` · `POST /invite/claim` · `POST /invite/status` · `POST /api/invite/mint` · `POST /api/invite/claim` · `POST /api/invite/status` | THE JOB ITSELF IS UNAFFECTED. Sponsored registration keeps working on `POST /submit` with `sponsored: true`; only the invite sub-feature is absent. A code presented on the submit path gets a typed 400 `invites-not-offered`, not a 404, because there the client has already built a body around it. | submission, quote proxy, chat transport |

- **Funding floor breached:** This is the row the cold-start caveat is about: see COLD_START_CAVEAT. An invite claimed during a breach stays claimed, and the registration it buys waits for funding.
- **Sponsorship budget exhausted:** Fails OPEN into pay-your-own-way rather than into a locked door, and the notice says so. A burned invite waives the per-visitor cap and never the daily budget.
- **Invites off:** Scoped to the invite routes, not to the job. The switch removes a door; it does not close the building. Setting any other `RELAYER_INVITE_*` knob without the allowance is a startup error, not a silent no-op — see `resolveInviteConfig` in `packages/relayer/src/server.ts`.

*Not a separate submit route from submission, and that is deliberate: one signing path, one allowlist, one place every gate lives. What makes it a separate JOB is that it draws on a separate budget, owns the invite routes, and fails with separate copy.*

#### quote proxy

Fetches third-party prices and bridge attestations server-side (FR-029), so an aggregator sees this host and a bare path instead of the visitor's address next to their intent. The allowlist in `packages/relayer/src/quote-proxy.ts` doubles as the SSRF guard.

*Routes:* `POST /quote` · `POST /api/quote`

| Trigger | Answer | Routes affected | Same job still serves | Other jobs unaffected |
|---|---|---|---|---|
| Upstream dead or misbehaving — the fetch throws or times out, answers a non-2xx, answers something that is not JSON, answers ANY redirect (the request is made with `redirect: 'error'`, so no redirect is ever followed — not merely off-host ones), or exceeds the read cap while streaming. | `502` | `POST /quote` · `POST /api/quote` | *nothing — every route of this job is affected* | submission, sponsored registration, chat transport |
| Quote cap hit — the per-visitor daily cap or the global daily ceiling (`RELAYER_QUOTE_DAILY_PER_VISITOR` / `RELAYER_QUOTE_DAILY_GLOBAL`). A visitor here is the same salted, day-scoped hash of the client address the budgets use, not a raw IP. | `429` | `POST /quote` · `POST /api/quote` | *nothing — every route of this job is affected* | submission, sponsored registration, chat transport |

- **Upstream dead or misbehaving:** A per-request failure against an outside party with no shared state behind it — one bad quote does not poison the next. The read cap is enforced WHILE streaming, not by trusting a content-length the sender chose.
- **Quote cap hit:** Its own counter, and never a budget: charging quotes against the sponsorship budget would let anyone burn a visitor's free registration by asking for prices. The counter also stops tracking NEW visitors past `MAX_TRACKED_QUOTE_VISITORS` so a rotating address range cannot grow the map without bound.

*Its counter is in memory, unlike the durable ledgers, because a quote is egress rather than money — handing out fresh quota on restart is cheaper than inheriting a failure mode where an unwritable disk stops price lookups.*

#### chat transport

A broadcast bus for chat rooms. It routes sealed envelopes by an opaque 128-bit room id and holds a short ciphertext backlog in memory for a peer whose tab was shut. It has no signing key, no ledger and no store path, so it is the one job here that cannot spend anything or lose anything durable.

*Routes:* `POST /room/send` · `POST /room/stream` · `POST /api/room/send` · `POST /api/room/stream`

| Trigger | Answer | Routes affected | Same job still serves | Other jobs unaffected |
|---|---|---|---|---|
| A room already holds `MAX_SUBSCRIBERS_PER_ROOM` connections, or the host already holds `MAX_ROOMS` rooms. Both are concurrency ceilings, not lifetime ones — the idle sweep returns the slots. | `503` `room-full` | `POST /room/stream` · `POST /api/room/stream` | Sending into an existing room still works: a publish does not need a subscription, and the backlog is what the other side reads when it reconnects. | submission, sponsored registration, quote proxy |
| More than `MAX_PUBLISH_PER_MINUTE` publishes into one room inside a rolling minute. The window rolls rather than resetting on the minute, so a burst cannot be banked by waiting for a clock boundary. | `429` `rate-limited` | `POST /room/send` · `POST /api/room/send` | Streams stay open and keep delivering. The room is not closed; one sender is asked to slow down. | submission, sponsored registration, quote proxy |
| The process restarts — a deploy, a crash, a host move. Every room, every open stream and the whole ciphertext backlog go with it; clients reconnect on their own backoff. | `200` | *nothing* | *nothing — every route of this job is affected* | submission, sponsored registration, quote proxy |

- **A room already holds `MAX_SUBSCRIBERS_PER_ROOM` connections, or the host already holds `MAX_ROOMS` rooms. Both are concurrency ceilings, not lifetime ones:** A ceiling reached by an attacker opening rooms, not by a crowd. Two people talking use one room and a handful of sockets.
- **More than `MAX_PUBLISH_PER_MINUTE` publishes into one room inside a rolling minute. The window rolls rather than resetting on the minute, so a burst cannot be banked by waiting for a clock boundary.:** Scoped to a room rather than to a visitor, because the room id is the only identifier this job has — and giving it a visitor identity would mean learning who is in a conversation, which is the one thing the design refuses to know.
- **The process restarts:** NOT A FAULT, AND NOT SILENTLY FINE EITHER. Nothing durable is lost because nothing here is durable by design, and a message sent while the peer was away during a restart is genuinely gone — the transport can drop, and no receiver can detect a drop. Rooms re-derive from the chain on the next load, so the conversation itself survives.

*Ships in this process rather than on a Durable Object (a deviation from AD-17, recorded on `RelayerJobName`). Because the rooms are in memory, the deployment must run exactly ONE machine: two would each hold half of every conversation and neither would know. `fly.toml` pins that with `auto_stop_machines = false` and `min_machines_running = 1`.*

#### chain feed

One poller for every open tab. This process reads markets, launches, oracle prices and the app contracts' own events on a timer, and fans the answers out over the same SSE-over-POST framing the chat transport proved. It signs nothing and serves only public chain state; what it adds is a bounded price history (`RELAYER_CHAIN_FEED_STORE`) that a browser could not have witnessed for itself.

*Routes:* `POST /chain/stream` · `POST /api/chain/stream`

| Trigger | Answer | Routes affected | Same job still serves | Other jobs unaffected |
|---|---|---|---|---|
| The feed already holds `MAX_FEED_SUBSCRIBERS` open streams. A concurrency ceiling, not a lifetime one — slots return the moment a tab closes. | `503` | `POST /chain/stream` · `POST /api/chain/stream` | *nothing — every route of this job is affected* | submission, sponsored registration, quote proxy, chat transport |
| An upstream read fails — the RPC hosts, the oracle, the event scan. The poller keeps its last good rows and says so; nothing closes. | `200` | *nothing* | The stream itself. Every hello and every health frame carries the problem sentence, so a degraded feed answers its own honest state rather than presenting an outage. | submission, sponsored registration, quote proxy, chat transport |

- **The feed already holds `MAX_FEED_SUBSCRIBERS` open streams. A concurrency ceiling, not a lifetime one:** The browser treats the refusal as "poll for yourself": its store runs the same reads directly, visibility-aware, so a full feed degrades to slower — never to blank.
- **An upstream read fails:** The degrade doctrine's load-bearing sentence, applied: a degraded job answers its own honest state; it does not take the relayer down. The rows it last read were true when read, and the sentence beside them says why they may be stale.

*In this process rather than beside it for the chat transport's reason: one always-on machine already holds the RPC path and the timers, and a second host would be a second thing to keep alive during judging. The JSONL price store lives on the volume because its whole value is the past this process witnessed; losing it costs a chart its history, never anyone a cap.*

#### stats — designed, NOT built

DESIGNED, NOT BUILT (AD-14). Cached protocol-wide aggregates — the unbounded-range ones a browser cannot compute over a capped block window, such as bridge "largest ever" and protocol-wide shielder counts. Everything market- or launch-scoped is drawn client-side from on-chain events instead and never touches this job.

*Routes:* none today.

| Trigger | Answer | Routes affected | Same job still serves | Other jobs unaffected |
|---|---|---|---|---|
| Aggregate refresh fails or is stale. The designed behavior is to serve the last good value with its block stamp — the caption already reads "as of block N", so a stale answer stays honest without new copy. | *not built* | *nothing* | *nothing — every route of this job is affected* | submission, sponsored registration, quote proxy, chat transport |

- **Aggregate refresh fails or is stale. The designed behavior is to serve the last good value with its block stamp:** By construction it cannot take a paying job down: a cache over public reads, with no signing key and no ledger behind it.

*NO ROUTE EXISTS TODAY and story 1.6 does not invent one. It is enumerated because AD-17 names four relayer jobs and a matrix with three rows would read as though the fourth had been forgotten. It is not a new worker either (AD-14) — it is a cache inside the relayer we already run.*
<!-- /generated:matrix -->

### The third-party proxy allowlist

The allowlist is also the SSRF guard: an unlisted host is refused before anything is built, and
no redirect is ever followed.

<!-- generated:proxy -->
| Target | Host | Credential |
|---|---|---|
| `avnuQuotes` | `starknet.api.avnu.fi` | keyless |
| `circleIris` | `iris-api.circle.com` | keyless |
| `pinataUploads` | `uploads.pinata.cloud` | server-side credential attached |
| `geminiImages` | `generativelanguage.googleapis.com` | server-side credential attached |

Calls the browser still makes **directly**, and what each costs the user:

- **Starknet JSON-RPC reads (starknet_call and class-hash lookups) go straight to the RPC hosts** — the RPC provider sees the visitor IP alongside which contracts they read, though not which note or key the read is about.
- **Explorer links open Voyager in the user’s own browser** — the explorer sees the visitor IP together with the transaction they clicked, so a link followed is a link attributed. Copy the hash instead to avoid it.
- **Token logos render straight from the public IPFS gateway (gateway.pinata.cloud)** — the gateway sees the visitor IP alongside which token logos their browser loaded — which pages they LOOKED at, never anything they did. Uploading goes through the relay; only viewing is browser-direct, because proxying every image render would make this process a CDN.
<!-- /generated:proxy -->

"Everything is proxied" would be the easy sentence and it would be false, which is why the
exceptions above are enumerated rather than assumed. The list is generated from
`packages/relayer/src/quote-proxy.ts`, so adding a browser-direct host means declaring what it
leaks in the same edit.

### What the independence tests actually prove

`packages/relayer/test/topology.test.ts` stands up a relayer with **all four jobs wired**, breaks
exactly one thing, and then asks the routes that should still work to answer in the same process.
Every live row in the matrix has such a scenario: the test blocks are generated *from* the matrix
data, so a row cannot exist without a scenario proving it, and a scenario cannot exist without a
row it belongs to.

The existing suites prove each refusal one job at a time, which cannot distinguish "the
sponsorship budget is spent" from "the relayer fell over". That distinction is what these add.
There is also a composite case with five things wrong at once — the invite sub-feature off, both
budget ledgers spent, the quote cap hit, and the funding floor breached — where the fee-recipient
read still answers and the only 5xx is the honest `503`. That is the failure AD-17 actually
fears: the day several things go wrong together and the whole relayer reads as dead.

**No cross-job coupling was found, and `packages/relayer/src/server.ts` is unchanged by this
story.**

---

## 3. Every process that runs, and its permissionless backstop

The full cast list from AD-17. Each row's backstop is what makes a dead worker a delay rather
than a trap.

| Process | Surface | If it stops | Backstop |
|---|---|---|---|
| Market scheduler (mint next instance, treasury mint-gate) | Markets | Market cadence stalls | Any user interaction can be made to trigger it; markets are pre-minted one ahead |
| Settlement keeper (snapshot + settle) | Markets | Settlement delayed | **Permissionless `settle`** (rung A/B) and **permissionless void-after-timeout** (rung C) — AD-9 |
| **Relayer** (server + allowlist + paymaster) | All | Submission down | Degraded self-submit path (AD-7 / FR-053); the gate does not depend on it (AD-13) |
| **Chat relay** (Cloudflare Durable Object) | Chat | Chat transport down | Independent of pool and RPC by construction; sealed messages are on-chain permanently |
| Epoch clearer (lazy) | Launch | Clearing delayed | **Permissionless `clear_epoch`** plus auto-clear on next-epoch interaction (AD-2 / AD-11) |
| Graduation executor | Launch | Graduation delayed | **Permissionless `graduate()`** (AD-2) |
| Relayer stats endpoint (cached aggregates) | Bridge / global | Stale aggregates | Block-stamped, degrade to last good. Not a new worker (AD-14) |
| Charts | Markets / Launch / Bridge | — | Client-side, no worker (AD-14) |

---

## 4. The demo-critical set

<!-- generated:demo-critical -->
**Surfaces:** Wallet and Chat. **Processes they need:** `relayer`.

**Off the demo-critical path:** market scheduler, settlement keeper, epoch clearer, graduation executor — permissionless backstops protect funds regardless: permissionless `settle` and void-after-timeout (AD-9), permissionless `clear_epoch` plus auto-clear on the next-epoch interaction (AD-2/AD-11), permissionless `graduate()` (AD-2). A stalled worker delays something; it never traps a balance.

**Also required, though not processes we run:**

- Browser-direct Starknet JSON-RPC reads. The app reads chain state from the RPC hosts in `packages/protocol/src/constants.ts` directly, not through the relayer, so an RPC outage degrades the surfaces even while every process we run is healthy. This is one of the two disclosed browser-direct exceptions, not an oversight.
- Static hosting for the web app itself. It is not a process with a signer or a backstop, but nothing loads without it.
<!-- /generated:demo-critical -->

Writing this down is what stops a demo *looking* dead because a worker is down. A judge on the
Wallet or Chat path never touches the market or launch stack. If one of those workers is stalled,
the honest board state says so and nothing in the deep path notices.

### Pre-demo check

**There is no health endpoint, and this story did not add one.** What follows uses only what
exists today.

1. **The relayer answers, and knows its own payout address.** With the server running on its
   default loopback binding:

   ```
   curl -fsS http://127.0.0.1:8787/api/fee-recipient
   ```

   A `200` with a `feeRecipient` address means the process is up and configured. A `503` means it
   is running but has no recipient set, so relayed sends cannot address their reimbursement leg.
   Connection refused means it is not running. If `RELAYER_AUTH_TOKEN` is set, add
   `-H "x-relayer-auth: $RELAYER_AUTH_TOKEN"` — without it the answer is a `401`.

2. **The funding state is not `exhausted`.** The relayer prints `funding: STRK balance <state>` in
   its boot banner, and warns explicitly when submissions are being refused. For anything after
   boot, pages go to the log under a greppable prefix:

   ```
   grep 'relayer: OPS' <the relayer's log>
   ```

   No output means no page has fired since the process started. A page names the balance, the
   refusal floor and the warning threshold.

3. **The chat Durable Object is reachable.** No check exists yet — the chat relay arrives with
   epic 2 (`2-2-the-websocket-relay-durable-objects-versioned-envelope-print`). Until then this
   step is a placeholder, and saying so is more useful than a command that tests nothing.

Nothing else is on the critical path.

---

## Cold start caveat

**This is an open question, recorded here rather than answered here.**

<!-- generated:cold-start -->
**[OPEN → Abu] — spine Q5 (AD-17).** Story 1.6 documents and flags only. No second sponsorship channel, no cold-start redesign.

> when the relayer is down, sponsored onboarding degrades to self-pay which requires the visitor to already hold STRK — the one onboarding path with no permissionless backstop; decide whether that is acceptable for the judge path or needs a second sponsorship channel.

**Sharpened by story 1.13.** Cold start is TWO transactions, not one: DEPLOY_ACCOUNT then registration. The prove leg authenticates the registering user through the pool's `assert_valid_signature`, whose SRC5 `supports_interface` probe hard-reverts on an undeployed address, so a sponsored registration can never be a counterfactual account's first act. The free `compile_actions` view accepts an undeployed sender, which is why no earlier probe caught it.

**The unsponsored half.** DEPLOY_ACCOUNT is self-paid and NOTHING SPONSORS IT TODAY. The visitor must therefore already hold STRK even when the relayer is perfectly healthy, so this caveat is not only about relayer-down. Whether the relayer should sponsor the deployment is an open product decision owned by epic 6 or a later relayer story; it was explicitly out of scope for 1.13 and is out of scope for 1.6.

**Measured.** DEPLOY_ACCOUNT estimated at 0.126 STRK; the banked deployment cost 54911450842067264 wei and the sponsored registration beside it cost the relayer 8.59427093855343896 STRK (pool fee 6 STRK + 2.594270938553438960 STRK gas).

Record: `evidence/sponsored-registration.json (`accountDeployment`, `cost`)`.
<!-- /generated:cold-start -->

Every other liveness risk on this page has a permissionless backstop. This one does not: if the
relayer cannot sign, the only remaining way in is a wallet that already holds STRK, and a cold
visitor by definition does not have one.
