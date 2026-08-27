# STRK20 — a multi-surface app on Starknet's privacy pool

Starknet has a live privacy pool called STRK20, and almost nobody is building on it. This
repository is one application that does: a single place to hold, send, message, swap, bridge,
bet and launch tokens through that pool. What distinguishes it is not a privacy claim — every
project in this space makes those. It is that each screen names which parties can see what,
before you act, including the parties you did not choose.

That inversion is the product. A privacy tool that overstates what it hides is worse than no
privacy tool at all, because its users act on the difference. Not all of what follows is built
yet, so the inventory of what actually exists today sits above the build instructions rather
than buried under them.

---

## Why privacy is necessary here, specifically

Starknet is public by default. Every balance, every transfer, every counterparty and every
amount is readable by anyone, forever, and attributable to an address that is usually reused.
That is fine for a test transaction and unworkable for the ordinary things people do with
money: paying a contractor, sizing an OTC trade, taking a position before others see it,
holding a treasury a competitor would like to read.

STRK20 is StarkWare's own answer — a pool that breaks the link between an address and what it
does. But the protection it gives is partial in ways that matter, and the parts it does not
cover are exactly the parts most products quietly imply they do. Two of them are structural:

- **Privacy is a crowd property.** A pool with few active users gives little cover no matter
  how good the cryptography is. So the binding design commitment here is to put the real
  anonymity-set number on screen at the moment of decision, rather than the word "private".
  None of the shipped privacy products we checked does this — Railgun, Privacy Pools, Railway.
- **Some things are public and cannot be made otherwise here.** Deposits into the pool are
  public. Amounts in any leg that touches an open note — a swap, a launch, a market bet — are
  public. The section at the bottom of this file states these plainly, and it is not an
  appendix; it is the part of this project we would most like a judge to read.

---

## Surfaces

Six surfaces, one pool. This is the design, not the inventory — the next section says which
parts exist.

| Surface | What it is |
|---|---|
| **Wallet** | The substrate, not a tab. Register a key, publish a receive address, run discovery, send. No new contracts. |
| **Chat** | Key agreement rooted in keys already on the pool, so it costs nothing extra. The chain carries room-open, seals, and money-with-message. |
| **Swap** | A router that approves a pinned venue, executes, measures output by balance delta and returns the deposit. |
| **Bridge** | Outbound only, via CCTP v2, with Circle's Forwarding Service paying destination gas. |
| **Markets** | Binary UP/DOWN FPMM, Pragma-resolved. |
| **Launch** | Epoch-clearing auction with public denominations and router-owned LP on graduation. |

Chat is deliberately first. A zero-deposit invoke sets no compliance-screening subject, which
makes it the one surface immune to the pool's coming default-deny screening policy, and its
zero-value calls cannot revert on a balance mid-demo.

## What is actually built, today

Being precise about this is cheaper than being caught.

| Component | State |
|---|---|
| `packages/protocol` | Live pool reads with RPC fallback, local identity generation with encrypted backup, registration pre-flight with the `ForeignKey` collision guard. Tested. |
| `packages/relayer` | Paymaster, submission server and the chat room bus. **Proven on mainnet** — it signed and broadcast the sponsored registration below. **Hosted** at `passbook-relayer.fly.dev`, one machine, always on; it binds loopback by default and only this deployment does otherwise. |
| `contracts/MessageBook` | **Deployed on mainnet**, class hash verified against the running contract. |
| Mainnet transactions touching the pool | **1 of the 3 the submission gate requires.** |
| Web app | Live at **https://passbook-zeta.vercel.app** — no login, no wallet to connect. |

**What works end to end today.** Open the app and an account is derived in your browser on first
load; nothing is connected and nothing is pasted. The wallet reads your shielded balance straight
from the pool and tells you which of four states it is in — including "the pool could not be read",
which is deliberately not shown as a zero. An account funded in the browser can deploy itself and
then register its viewing key with the pool, both real mainnet transactions the product sends on
its own. Send moves a shielded note to another pool account: the asset list is what this account
actually holds rather than a catalogue, and the recipient's address is checked against the pool
while it is still being typed — for free, before a fee is spent — because a transfer to an address
that never registered a viewing key is one the protocol refuses. Chat derives a room from two
addresses' pool keys with no handshake and no directory, streams sealed messages through a relay
that holds no key and cannot read them, and can attach a real transfer to a message; the payment
card appears only after that transaction has confirmed, so a card in a thread is never a claim
about money that did not move. Swap prices a real route through an on-chain aggregator and executes it in one
transaction: the sell token is withdrawn to the venue's privacy executor, the executor is invoked,
and the proceeds land back in the pool as a note — the value never touches a public address of
yours. Bridge sends shielded USDC out to another chain through StarkWare's own deployed
`OutboundAnonymizer`, on the same withdraw-then-invoke sandwich, with Circle's fee read live and
the exact arriving amount shown before you commit.

**What does not work yet, stated plainly.** There is no invite. An address that has never registered
with the pool is named as exactly that and nothing is offered to fix it — paying a stranger's
registration so they can be paid is a feature this repository has copy for and no implementation of,
and a button that opened nothing would be worse than the sentence. Markets and launch are not built;
each says so on its own screen, along with what is already working underneath it. The bridge is
**outbound only** — bringing value back needs a second
contract, a relayer that has to stay alive, and a fund-stranding failure path nobody here has
rehearsed. And while the bridge's helper has hundreds of successful mainnet burns behind it, the
crossing this app builds has been pinned against a real one felt-for-felt in tests rather than run:
no crossing has been sent from this code. Solana is offered and says on its own row that a
destination with no existing USDC account is a path nobody here has tested.

This app does not claim that your address is hidden from the public record. Depositing into the
pool is public: the depositor and the amount are both visible. What the pool hides is which notes
are yours afterwards. The honest sentence is the one it ships with — the pool sees your
transaction, not your notes.

---

## Running it

Requires Node 24 (see `.nvmrc`), plus `scarb` 2.8.2 and `snforge` 0.31.0 for the contract.
pnpm is the package manager — `corepack enable` provisions the pinned version.

```bash
nvm use
corepack enable
pnpm install

pnpm test                # TypeScript suite

cd contracts && scarb build && snforge test && cd ..
```

### The web app

No browser install, no extra setup step — `pnpm install` gives you everything the gates need.

The build wrapper exists because "`vite build` exited 0" is not evidence the app works: with the
privacy SDK's `/testing` alias missing, the build exits 0, writes a 684 kB bundle, and the page
dies at load with `ReferenceError: Buffer is not defined`. The wrapper catches that by **reading
the artifact** — scanning the emitted chunks for the Node-only module names that put it there,
holding the generated route tree against the route files on disk, and reading the emitted
stylesheet to prove the design system shipped and re-themes. Earlier versions loaded the bundle in
headless Chromium to learn the same things; that cost a 130 MB binary and a postinstall step no
install performs, in exchange for information already written in the output.

```bash
pnpm run typecheck            # root + apps/web; the root config alone does not cover the app
pnpm run build:web            # builds, holds the warning contract, reads the artifact
pnpm run verify:mainnet-guard # flips the tree off mainnet and back, proving the guard both ways
```

`pnpm run build:web` from the repository root is the only supported way to build the app. There is
deliberately no `build` script in `apps/web/package.json`: a bare `vite build` skips the warning
contract, the eager-bundle budget and the artifact reads, and produces something nothing has
checked.

`verify:mainnet-guard` rewrites `packages/protocol/src/constants.ts` in your working tree for a few
seconds. Do not run it alongside other work in the same checkout. If it is killed with `SIGKILL`
mid-run it leaves a `.guard-verify-backup` sidecar; the next run finds it, restores from it, and
says so.

`evidence/` is the audit trail for every number this project asserts, and only a probe that
actually measured something is allowed to write into it.

Proof wall-time has never been measured by anyone on this protocol, and a probe that reported
zeros would put a false number into the audit trail. That is why no duration appears anywhere in
this repository, including in this README.

### Running the relayer, and the one setting you must not skip

The relayer holds a funded key and pays for what it signs, so whatever can reach its port can
spend. It binds `127.0.0.1` by default and refuses anything outside a small allowlist of
`(contract, entrypoint)` pairs, with the STRK approve capped from the live fee.

```bash
cp .env.example .env      # fill in the two relayer values; see that file
npx tsx packages/relayer/src/server.ts
```

**If this server is reachable through a proxy, `RELAYER_AUTH_TOKEN` is mandatory.** The browser
posts to the same-origin relative path `/api/submit`, and the server accepts that path so a proxy
can forward it. The moment that rewrite exists loopback has stopped being a boundary — and nothing
warns you, because the off-host warning keys off `RELAYER_HOST`, which you never changed. Behind a
proxy every internet client arrives with no `Origin` header, which is exactly the shape the other
checks treat as a trusted same-process caller.

Requiring `content-type: application/json` is a CSRF control. It is not authentication.

| Variable | Default | What it does |
|---|---|---|
| `RELAYER_AUTH_TOKEN` | unset | Shared secret required as `x-relayer-auth`. **Required behind a proxy.** |
| `RELAYER_ALLOWED_ORIGINS` | unset | Comma-separated browser origins. Can only refuse — see below. |
| `RELAYER_HOST` | `127.0.0.1` | Interface to bind. Empty is treated as unset. |
| `PORT` | `8787` | Port to listen on. |

`RELAYER_ALLOWED_ORIGINS` **cannot grant access, only withhold it.** A browser request carrying
both an `Origin` and `application/json` is by definition cross-origin, so it is preflighted, and
this server answers no CORS headers — the request never arrives. Setting an origin does not let a
web app in. It is not a substitute for `RELAYER_AUTH_TOKEN`.

In development, `apps/web/vite.config.ts` forwards `/api/*` to `127.0.0.1:8787` and strips the
`Origin` header, so the app's same-origin paths reach a relayer started the ordinary way. Point it
somewhere else with `RELAYER_ORIGIN`.

### The chat bus, and the one deployment rule it imposes

The relayer also routes chat: `POST /room/send` hands it one sealed envelope, and `POST
/room/stream` holds a connection open and streams that room's traffic back. Both are POSTs,
including the streaming one — the room id travels in the body so that every security gate keeps
matching an exact path, and so that the `content-type` and `x-relayer-auth` controls still apply
(an `EventSource` can set neither).

It holds no key and cannot read a message. What it does hold is a short in-memory backlog of
ciphertext per room — 50 messages, dropped 30 minutes after a room goes quiet — so that a message
sent while the other person's tab was shut is still there when they come back. Nothing is written
to disk and nothing survives a restart.

**Rooms live in memory, so the deployment must run exactly one machine.** Two would each hold half
of every conversation and neither would know. `fly.toml` pins that with `auto_stop_machines =
false` and `min_machines_running = 1`; it also mounts a volume at `/data` for the two spend
ledgers, which unlike the chat backlog must survive a deploy.

### No protocol number is hardcoded, in the code or in this file

The pool's fee is mutable and has been changed before, and the pool has no upgrade delay, so it
can change between two page loads. It is read at call time, every time. The most recent
measurement was **6 STRK at block 13,650,965**, recorded in `evidence/constants.json`; if you
are reading this later, re-run the probe rather than trusting that line.

### The claims list, and what enforces it

Ten phrases are false about STRK20 as deployed, and this project does not use them. They live as
data in `packages/protocol/src/forbidden-claims.ts`, each with the reason it is false written beside
it, and the copy modules that ship user-facing sentences are held to that list by tests — a surface
cannot introduce one of them without a test going red.

**There is no lint scanning this file.** A standalone `lint-claims.mjs` used to, and it was removed
on purpose; the list is product knowledge rather than tooling, so it moved into the package the copy
lives in instead of dying with the script. The disclosure section at the bottom carries a
`claims-lint:disable` marker from that era, which is now a note to a human: everything inside it
states a claim in order to refuse it, and it must be read as a whole or not at all.

---

## Mainnet addresses

Network is `SN_MAIN`. Every filled row here is independently checkable with one RPC call.

| What | Address |
|---|---|
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Pool class hash this code was tested against | `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d` |
| `MessageBook` (ours) | `0x3105b6a327ba11f5464335f480046348a4052be2c12df726f37633d50ae35bc` |
| `MessageBook` class hash | `0x52c432b3751ef6e61aa742e6b04a75bd929f2c85e1f2e632df812d424e4460f` |

Every row is filled and every one was read back off the chain rather than copied from a deployment
log — "the transaction succeeded" is a weaker claim than "the class is there now", and only the
second is worth printing here.

**Transactions this project has landed on mainnet**, each checkable on Voyager:

| What | Transaction |
|---|---|
| Sponsored registration, through our own relayer | `0x4fbbf9aa7992a95d313554bc17b2fff311b35a5974271defc6672f57abfe27d` |
| `MessageBook` deploy | `0x1df2698443f4bf7d49f802aae3180674394d3e339c31666780c1e640562569` |

The first is the one that touches the pool. The submission gate asks for three such transactions,
so this project currently meets one third of that requirement — said plainly here because a reader
who checks will find out in thirty seconds either way.

**The pool class hash is pinned on purpose.** The pool is upgradeable with zero delay and can
be paused, including during judging week — StarkWare can swap the implementation instantly and
owes nobody notice. If the running pool's class hash stops matching the pinned one, the
implementation is no longer the one this code was tested against — so the app must say so and
stop, rather than guess. That, and keeping a lane that still works while the pool is paused,
are design requirements here rather than niceties.

---

<!-- claims-lint:disable -->
## What we do not claim, and what you should assume instead

This section names the claims this project refuses, which is why it may write them down. Every
statement here is checkable from mainnet.

**The recipient of a private transfer sees the sender.** Private does not mean anonymous to
your counterparty. It never has here.

**Anonymity sets on this pool are small.** The app shows you the real number at the moment you
decide, because that number — not the cryptography — is what actually determines how much cover
you get.

**Our relayer sees network metadata.** It exists so that its address, rather than yours, is the
visible submitter on the public record. That is a real service and a real trust assumption: it
sees your IP and the timing of your request.

**Your viewing private key is escrowed on-chain, to a StarkWare auditor, permanently.**
Registering encrypts your viewing private key to an auditor public key stored in the pool
contract and writes it on-chain — in storage and in the registration event. Anyone can read
that record with a single permissionless view call, `get_enc_private_key(address)`. The live
auditor key is `0x1eed60b8d483b3bede62d1cc0f32874aea30747e6943437c858359b41801bf7`. It is
written once, and there is **no rotation path and no opt-out**. Whoever holds the matching
private key can recover both parties' keys and therefore every pool-rooted shared secret,
retroactively, without your cooperation. This protocol is compliance-compatible by design, and
so we do not describe anything in it as end-to-end encrypted.

**The same key reads your notes and signs your spending.** There is no watch-only or view-only
version of it to hand to an accountant, and this repository will never offer one, because the
protocol does not have one.

**The audit does not cover the current code.** The OpenZeppelin audit of the underlying
protocol is scoped to commit `c5e2fb5` (May 2026). Anything newer than that commit, including
everything in this repository, is unaudited.

**Compliance is not automatic and not ours.** Deposits are mandatorily screened by a third-party
provider that the pool operator chose. We cannot self-host it, override it, or find out why a
particular address was refused — and a refusal is silent, so it will look like our bug.

We will not say: *fully anonymous* · *untraceable* · *your amounts are private* on any leg that
touches an open note · *your deposit is hidden* · *end-to-end encrypted* · *watch-only* ·
*unlinkable* for a bridge crossing · that a bridge crossing can be timed out and reclaimed ·
that compliance is handled for you.

The sponsor wrote the one-line version of this before we did, and it is the rule we build to:

> *"Claim identity privacy; never claim amount privacy for swaps."*
<!-- claims-lint:enable -->

---

## Licence

MIT. See [`LICENSE`](./LICENSE).
