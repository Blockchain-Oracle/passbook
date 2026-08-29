<p align="center">
  <img src="https://raw.githubusercontent.com/Blockchain-Oracle/strk20-run/main/assets/brand/strk20-mark.svg" width="96" alt="The strk20.run mark — an asterisk that runs" />
</p>

<h1 align="center">strk20.run</h1>

<p align="center"><strong>A private account on Starknet's STRK20 pool.</strong></p>

<p align="center">
  Open the app and you have an account — no wallet to connect, nothing to install, nothing to paste.<br/>
  Hold and send shielded value, chat with money attached, swap, bet, launch, bridge out.
</p>

<p align="center">
  <a href="https://app.strk20.run"><b>▶&nbsp; Open the app</b></a>
  &nbsp;·&nbsp;
  <a href="docs/architecture.md"><b>Architecture</b></a>
  &nbsp;·&nbsp;
  <a href="#mainnet-record"><b>Mainnet record</b></a>
  &nbsp;·&nbsp;
  <a href="#what-we-do-not-claim-and-what-you-should-assume-instead"><b>What we refuse to claim</b></a>
  &nbsp;·&nbsp;
  <a href="https://strk20.run/docs"><b>Documentation</b></a>
  <!-- when it exists, add here:
  &nbsp;·&nbsp; <a href="DEMO_VIDEO_URL"><b>Demo video</b></a>
  -->
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Blockchain-Oracle/strk20-run/main/assets/brand/strk20-banner.svg" width="960" alt="strk20.run — a private account on Starknet. Hold, send, chat, swap, bridge, bet, launch." />
</p>

The key is generated in your browser on first load, and everything below runs from it.

What distinguishes this from every other privacy product is not the privacy claim. It is that
each screen names which parties can see what, **before** you act — including the parties you did
not choose. A privacy tool that overstates what it hides is worse than none at all, because its
users act on the difference.

So the inventory of what actually exists sits above the build instructions rather than under them,
and the section listing what this project refuses to claim is the one we would most like a judge
to read.

---

## Where each surface actually stands

Seven modes, one pool. This table is the inventory, not the design.

| Surface | State today |
|---|---|
| **Wallet** | **Live end to end.** Balance read from the pool, four honest states, send, deploy, register, QR receive, account lifecycle (create / import / unlock / lock / switch), history. |
| **Chat** | **Live end to end.** Multi-conversation, one multiplexed socket, sealed messages, money attached to a message, opt-in public name directory. |
| **Swap** | **Live end to end.** Real route priced through an on-chain aggregator, executed in one transaction, proceeds land back in the pool. |
| **Bridge** | **Live, outbound only.** Shielded USDC to another chain through StarkWare's deployed `OutboundAnonymizer`. See the limits below — they are real. |
| **Markets** | **Deployed on Starknet mainnet.** Live Pragma prices, real market records, bets, cash-out while eligible and terminal claims/refunds. |
| **Launch** | **Deployed on Starknet mainnet.** Real sale records, buys, graduation redemption and failed-raise refunds. |
| **Houses** | **Readable on Starknet mainnet; affected writes blocked.** The deployed class predates the tally-key and duplicate-exclusion corrections, so the app fails closed until a separately authorized corrected deployment updates the evidence. |

`packages/protocol/src/app-contracts.ts` reads `evidence/markets-launch-deployment.json`; absent or
malformed evidence still fails closed. No surface substitutes fixture rows or invented price
movement when a chain read is empty or unavailable.

### Market price provenance

Pragma's `get_data_median` is a free view call on a contract that has been on mainnet for years,
so the price strip and the chart are real reads from first paint. A live read taken while writing
this: **BTC/USD 80,025.38, 10 sources, last updated 342 seconds earlier.**

That staleness is why the strip has a stale state at all. The day-0 probe watched this feed hold
one value for eleven minutes, so a surface that always renders a bright number would be claiming
an immediacy the oracle does not have.

### What does not work, stated plainly

- **There is no invite.** An address that has never registered with the pool is named as exactly
  that and nothing is offered to fix it. Paying a stranger's registration so they can be paid is a
  feature this repository has copy for and no implementation of, and a button that opened nothing
  would be worse than the sentence.
- **The bridge is outbound only.** Bringing value back needs a second contract, a relayer that has
  to stay alive, and a fund-stranding failure path nobody here has rehearsed.
- **No crossing has been sent from this code.** The helper has hundreds of successful mainnet
  burns behind it; the crossing this app builds has been pinned against a real one felt-for-felt
  in tests rather than run. Solana says on its own row that a destination with no existing USDC
  account is a path nobody here has tested.
- **Depositing into the pool is public** — depositor and amount are both visible. What the pool
  hides is which notes are yours afterwards.

---

## The honesty machinery

This is the part that is actually unusual, and it is enforced rather than promised.

**One privacy row, not four widgets.** Every review used to stack a disclosure panel, a visibility
matrix, a linkability meter and a 320px dot-canvas, permanently open, above the confirm button.
Four privacy widgets shown at once do not add up to four times the understanding — they add up to
noise a reader scrolls past, which means the honest disclosure gets skipped along with the
decoration. `PrivacyRow` collapses them into a headline sentence and a chevron. The collapsed
headline **is** `disclosure.lines[0]`, reproduced byte-for-byte; expanding renders the same panel
and the same meter, unmodified. Severity stays visible while collapsed, because a row that hid a
warning until you opened it would be worse than the noise it replaced.

**User-facing sentences live in the protocol package, with tests.** Copy is not written inline in
components. It lives in `packages/protocol/src/*-copy.ts` and is pinned byte-exact, so rewording a
claim is a diff a reviewer sees rather than a string somebody edited in a component.

**Ten phrases are false about STRK20 as deployed, and a test enforces their absence.** They are
data in `packages/protocol/src/forbidden-claims.ts`, each with the reason it is false written
beside it. This is not decorative: it caught a sentence in this very sprint. The Launch surface
first said *"your address never appears on the launch"* — which is on the list, and correctly,
because the address **does** appear on the deposit and on any public withdrawal. The true claim is
narrower and still worth making: *the launch records no buyer address.*

**What the relayer sees, said on the surface.** It exists so that its address rather than yours is
the visible submitter. That is a real service and a real trust assumption: it sees your IP and the
timing of your request. For chat it holds a short in-memory backlog of ciphertext — 50 messages
per room, dropped 30 minutes after a room goes quiet — and it holds no key and cannot read them.
Your conversations live in your browser and nowhere else; the app says so, and says that anything
sent while that browser was closed past the window was never stored anywhere it could be fetched
from later.

**One socket carries every conversation, and that is disclosed.** A multiplexed subscribe tells the
relayer explicitly that those rooms share one participant. It could already infer that from N
subscribes arriving on one IP at one instant — so the copy says what is true now rather than
pretending the previous shape was hiding it.

**The name directory is public by construction.** Claiming a name publishes name → address for
anyone to read; that is its entire function. Two things make it narrower than it could be: nobody
has to claim one, and **search is private** — the client fetches the whole (small) list and matches
locally, so the relayer never learns who you looked for. A claim is signed with the viewing key
registration already anchored on chain and verified against `get_public_key`, so a name cannot be
pointed at an address whose key the claimant does not hold. Taking a name back removes it from the
list rather than from anyone who already read it, and the copy says that too.

---

## Architecture

![How strk20.run fits together](https://raw.githubusercontent.com/Blockchain-Oracle/strk20-run/main/assets/architecture.svg)

The shape in five sentences — **[docs/architecture.md](docs/architecture.md)** carries the full
page, including the relayer's security model and the discipline rules that were each learned
against real mainnet fees:

- **The account is an embedded key**, derived in the browser on first load; the accepted risk is
  argued at `packages/protocol/src/session-key.ts`, not hidden.
- **The relayer is reached only through a same-origin proxy** — the browser never holds its auth
  token, and the relayer refuses anything outside a small `(contract, entrypoint)` allowlist.
- **Swap and bridge are the same invoke sandwich**: withdraw to the venue's privacy executor,
  invoke it, proceeds land back in the pool as a note — value never touches a public address of
  yours in between.
- **Every action list is rehearsed against a free view** (`compile_actions`) before a funded
  transaction, because a malformed list burns the fee even when it reverts.
- **The build gate reads the emitted artifact**, because `vite build` exiting 0 is not evidence
  the app works.

`evidence/` is the audit trail, and only a probe that actually measured something may write into
it. Proof wall-time has never been measured by anyone on this protocol, so no duration appears
anywhere in this repository — including in this file.

---

## Running it

Node 24 (see `.nvmrc`), pnpm 11.24.0 (pinned in `packageManager`), plus `scarb` 2.8.2 and
`snforge` 0.31.0 for the contracts.

```bash
nvm use
corepack enable
pnpm install

pnpm run typecheck             # packages + apps/web
pnpm run build:web             # tsc -b && vite build; refuses an off-mainnet tree
```

The app is a stock `create-vite` + `shadcn init` project — see `apps/web/README.md` for the
folder structure. The mainnet guard and the warning contract are ordinary options in
`apps/web/vite.config.ts`; there is no wrapper script and nothing to run around it.

The privacy SDK installs from `vendor/` (`file:` in the lockfile) — it is not on npm, so that
tarball is part of the tree on purpose.

### The contracts

```bash
export PATH="$HOME/.foundry/bin:$HOME/.local/bin:$PATH"
cd contracts && scarb build && snforge test    # 109 tests
```

`contracts/README.md` carries the toolchain pins, the constructor arguments, and the known failure
signatures — including one worth reading before a fresh machine: the snforge plugin build fix lives
in scarb's global **cache**, not in this repository, so a cache wipe hits it again.

### The relayer

```bash
cp .env.example .env      # fill in the two relayer values; see that file
npx tsx packages/relayer/src/server.ts
```

The relayer holds a funded key and pays for what it signs, so whatever can reach its port can
spend. **If this server is reachable through a proxy, `RELAYER_AUTH_TOKEN` is mandatory** — the
full security model, the environment table, and the reason loopback stops being a boundary the
moment a proxy rewrite exists are in
[docs/architecture.md](docs/architecture.md#running-it-and-the-one-setting-you-must-not-skip).

### No protocol number is hardcoded, in the code or in this file

The pool's fee is mutable, has been changed before, and the pool has no upgrade delay — so it can
change between two page loads. It is read at call time, every time. The most recent measurement was
**6 STRK at block 13,650,965**, recorded in `evidence/constants.json`; if you are reading this
later, re-run the probe rather than trusting that line.

---

## Mainnet record

Network is `SN_MAIN`. Every filled row is independently checkable with one RPC call, and every one
was read back off the chain rather than copied from a deployment log — "the transaction succeeded"
is a weaker claim than "the class is there now". `strk20.json` is the submission manifest; each
hash below resolves on Voyager (`https://voyager.online/tx/<hash>`).

| What | Address |
|---|---|
| STRK20 pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| Pool class hash this code was tested against | `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d` |
| `Markets` (ours) | `0x7905ba4e7535a3e7c1f9f4045762cc7ce83cfb120fe916f97a0dc512d72a783` |
| `Launch` (ours) | `0x3fc07897f657b184ff9b0dab28939bb5a175d7cff9290406a1bd4b3d032eb54` |
| `MessageBook` (ours) | `0x3105b6a327ba11f5464335f480046348a4052be2c12df726f37633d50ae35bc` |
| `Governance` — the Houses (ours) | `0xdbe265829e0f1c859f3a8c1bd8fcfb0a774836b9e07191c6a624a59e37f9bf` |
| Pragma oracle (read live by Markets) | `0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b` |

**The eight declared transactions**, each with the evidence file that recorded it:

| What happened | Evidence | Transaction |
|---|---|---|
| The ladder — 3 bets on market 0, one transaction, one fee | `seq-bet.json` | `0x16933dd6edd5ade29c3b3cb3954da2c3b5bb806f85040fe42810f73acd72523` |
| The batch claim — 3 of 4 positions settled in one transaction | `seq-claim.json` | `0x15eb0939a124cbe8fc6a0e5825004f665f031e0d6abb80088bab0a8466561c0` |
| The hidden buy — 4 units on launch 0, buyer never named | `seq-buy.json` | `0x84a59651f14c6c995eac59ce0598e9cb58a7b1d02334870db9494acf3871d4` |
| House 0 activated — "Passbook Founders" | `seq-gov-house.json` | `0x11981995373bac3baf023588bb60e0e09652de7bda335decf54dee2bb3be3c5` |
| A proposal, sealed until close | `seq-gov-propose.json` | `0x237a47cbb3e88194b8e684351f0709cdfff44898f9c5e06cca3b650ecca2726` |
| A sealed FOR ballot, weight escrowed through the pool | `seq-gov-ballot.json` | `0x448ed7fc67b968b829d0e5cf8f7946fbb0fc47ef48903b33b8cd7be4dd6e7df` |
| The tally the curve accepts | `seq-gov-tally.json` | `0x16bd3806cab40f1628e25c62ab8453d7af487b2c7006f0820f0d63405cbff0b` |
| The tally key, on-chain forever | `seq-gov-tally.json` | `0x475b97c46df69c24fbf92429a9ce03a0df3779a4a23415b2d51960b36c25227` |

**The mine rule, and why the registration is not on that list.** The judges' indexer applies a
rule that has already zeroed real projects: *if `strk20.json` declares any `contracts`, every
declared transaction must also run through one of them.* Our contracts are declared, so every
declared transaction above touches our contracts. The sponsored registration this project landed
through its own relayer (`0x4fbbf9aa7992a95d313554bc17b2fff311b35a5974271defc6672f57abfe27d`,
`evidence/sponsored-registration.json`) touches the pool rather than our contracts — it is real,
it is on chain, and declaring it would zero the submission, so it is history rather than manifest.

**The pool class hash is pinned on purpose.** The pool is upgradeable with zero delay and can be
paused, including during judging week — StarkWare can swap the implementation instantly and owes
nobody notice. If the running pool's class hash stops matching the pinned one, the implementation
is no longer the one this code was tested against, so the app must say so and stop rather than
guess. That, and keeping a lane that still works while the pool is paused, are design requirements
here rather than niceties.

---

<!-- claims-lint:disable -->
## What we do not claim, and what you should assume instead

This section names the claims this project refuses, which is why it may write them down. Every
statement here is checkable from mainnet.

**The recipient of a private transfer sees the sender.** Private does not mean anonymous to your
counterparty. It never has here.

**Anonymity sets on this pool are small.** The app shows you the real number at the moment you
decide, because that number — not the cryptography — is what determines how much cover you get. A
bet or a send at a size nobody else is using is identifiable by its amount, and the app says so
where you choose the amount.

**Our relayer sees network metadata.** It exists so that its address, rather than yours, is the
visible submitter on the public record. That is a real service and a real trust assumption: it sees
your IP and the timing of your request.

**Your viewing private key is escrowed on-chain, to a StarkWare auditor, permanently.**
Registering encrypts your viewing private key to an auditor public key stored in the pool contract
and writes it on-chain — in storage and in the registration event. Anyone can read that record with
a single permissionless view call, `get_enc_private_key(address)`. The live auditor key is
`0x1eed60b8d483b3bede62d1cc0f32874aea30747e6943437c858359b41801bf7`. It is written once, and there
is **no rotation path and no opt-out**. Whoever holds the matching private key can recover both
parties' keys and therefore every pool-rooted shared secret, retroactively, without your
cooperation. Chat room keys are derived from those same viewing keys, so the auditor can read any
conversation here without asking. This protocol is compliance-compatible by design, and so we do
not describe anything in it as end-to-end encrypted.

**The same key reads your notes and signs your spending.** There is no watch-only or view-only
version of it to hand to an accountant, and this repository will never offer one, because the
protocol does not have one.

**Amounts are public on any leg that touches an open note.** A swap, a launch buy and a market bet
all publish their size. Markets and Launch store bearer commitments instead of buyer addresses,
but the public transaction still identifies its submitter and the relayer sees request metadata.

**The audit does not cover the current code.** The OpenZeppelin audit of the underlying protocol is
scoped to commit `c5e2fb5` (May 2026). Anything newer than that commit, including everything in
this repository, is unaudited.

**Compliance is not automatic and not ours.** Deposits are mandatorily screened by a third-party
provider that the pool operator chose. We cannot self-host it, override it, or find out why a
particular address was refused — and a refusal is silent, so it will look like our bug.

We will not say: *fully anonymous* · *untraceable* · *your amounts are private* on any leg that
touches an open note · *your deposit is hidden* · *end-to-end encrypted* · *watch-only* ·
*unlinkable* for a bridge crossing · that a bridge crossing can be timed out and reclaimed · that
compliance is handled for you.

The sponsor wrote the one-line version of this before we did, and it is the rule we build to:

> *"Claim identity privacy; never claim amount privacy for swaps."*
<!-- claims-lint:enable -->

---

## Licence

MIT. See [`LICENSE`](./LICENSE).
