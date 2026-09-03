# strk20.run — architecture

The [README](../README.md) says what exists and what we refuse to claim. This page says how the
thing is built, for a reader who wants to check the claims against the code.

![How strk20.run fits together](../assets/architecture.svg)

## The account is an embedded key

The key is derived in the browser on first load — no wallet, no email, no seed phrase before
anything works. That is also what makes the hosted demo work without login: a consequence, not a
waiver. Without a password or a passkey the key sits in `localStorage` in plaintext, which is an
accepted and argued risk written down at `packages/protocol/src/session-key.ts` rather than a
detail nobody mentioned; "Lock" then means a screen lock, and the app says so in those words. With
a password or a passkey the accounts are sealed at rest (`vault.ts`, `vault-envelope.ts`) and the
plaintext is deleted — a passkey wraps the same vault key a password does, and the relayer keeps a
sealed copy it cannot open so a synced passkey can bring the accounts back on another device.

Two balances exist and are never summed: **shielded** (pool notes) and **public** (ERC-20).
An unknown balance renders as `—`, never `0`.

## The relayer

One Node process (`packages/relayer/src/server.ts`) that exists so that **its** address, rather
than yours, is the visible submitter on the public record. That is a real service and a real trust
assumption: it sees your IP and the timing of your request. It holds no viewing key and cannot
read sealed messages.

The browser never talks to it directly. It posts to same-origin `/api/*` paths and the app host
injects the relayer's auth token — the token never ships to the browser. That is also why the
streaming endpoint is a POST: an `EventSource` can set neither a `content-type` nor an auth header.

What bounds a process that holds a funded key:

- It refuses anything outside a small allowlist of `(contract, entrypoint)` pairs
  (`allowlist-calls.ts`).
- The STRK approve on every sponsored call is capped from the **live** pool fee
  (`get_fee_amount`), read at call time — no protocol number is hardcoded anywhere in this
  repository, because the pool's fee is mutable with no upgrade delay.
- It binds `127.0.0.1` by default; widening that is a deliberate act (`RELAYER_HOST`).

Beyond submission it runs the product's background jobs, each answering its own degrade state
rather than taking the process down: the public name directory, the onboarding sponsorship
ledger, the faucet, the chain feed the app streams from, the markets groundskeeper, the
governance teller, and the room hub Chat's messages travel over.

**It carries a chat message and it does not carry a mail.** That asymmetry is the point of having
both surfaces. A mail is a pool transaction, so this process only ever sees one as a transaction it
was asked to submit — sealed, like every other. A chat message never becomes a transaction at all,
which is why it is free, and the price of free is that the relay routes the ciphertext and sees the
metadata around it: who is talking to whom, when, and how often. It holds no key either way, and its
backlog is bounded, in memory, and dropped after a quiet period.

### Running it, and the one setting you must not skip

```bash
cp .env.example .env      # fill in the two relayer values; see that file
npx tsx packages/relayer/src/server.ts
```

**If this server is reachable through a proxy, `RELAYER_AUTH_TOKEN` is mandatory.** The browser
posts to the same-origin relative path `/api/submit`, and the server accepts that path so a proxy
can forward it. The moment that rewrite exists, loopback has stopped being a boundary — and
nothing warns you, because the off-host warning keys off `RELAYER_HOST`, which you never changed.
Behind a proxy every internet client arrives with no `Origin` header, which is exactly the shape
the other checks treat as a trusted same-process caller.

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

**The ledgers are files on one volume, so the deployment must run exactly one machine.** A Fly
volume attaches to a single machine; a second one would have no ledger or a different one.
`fly.toml` pins that with `auto_stop_machines = false` and `min_machines_running = 1`, and mounts
the volume at `/data` for the ledgers and the name directory.

## The invoke sandwich

Swap, Earn and bridge are the same shape: withdraw the input to a privacy executor, invoke it, and
the proceeds land back in the pool as a note. Value never touches a public address of yours in
between. The venues are AVNU's privacy executor (swap), our own `VesuEarn` helper (lending supply
and redeem), and StarkWare's deployed `OutboundAnonymizer` (bridge out via CCTP — an exit only;
there is no inbound leg).

Earn's helper is ours because there was nothing else to point at: the privacy repo's published Vesu
anonymizer class is not declared on mainnet, and the source it was built from redeemed by underlying
amount rather than by share count. Ours redeems an exact share count, is pool-only, holds nothing
between transactions, and was exercised against the real Vesu vTokens on a mainnet fork — all seven
markets, both directions — before it was deployed at `0x3ce7a79c53685ab178bcf36960099bf37bbd16035f0f7e2defefa5153204157`.
The client refuses to prove
an Earn transaction whose compiled action span is not exactly the operation that was reviewed
(`packages/protocol/src/earn-guards.ts`) — which matters more here than elsewhere, because the
relayer does not decode a pool call and there is no second opinion downstream.

## Rehearsal and proving discipline

Rules that were each learned against real mainnet fees, now load-bearing:

- **Every action list is rehearsed against a free view before a funded transaction.** The pool's
  `compile_actions` is a view, so a malformed list is caught for nothing — and it must be, because
  a malformed list burns the fee even when it reverts. What that view does *not* catch is recorded
  in `evidence/day0-markets-launch-checks.json`: an unmatched open note reverts **after** the fee,
  so the client asserts the open-note count equals the expected deposits.
- **The proof and its public facts ride as v3 transaction details, both or neither.** Receipts
  never echo them; the sequencer enforces the pairing.
- **Value-moving proven transactions carry explicit resource bounds**, because fee estimation
  cannot see the proof and reverts without them.
- **Proofs are built at `latest − 10`**, and nothing proves against state younger than ten blocks
  after a deploy or top-up.
- **One pipeline at a time per account.** A `confirmation-unknown` outcome means the transaction
  may have landed; the pipeline treats it that way instead of retrying blind.
- **Bearer position secrets are stored before the transaction is submitted**, never after —
  `poseidon(secret)` is the commitment and the preimage is the money.

## The build gate reads the artifact

`vite build` exiting 0 is not evidence the app works — with the privacy SDK's `/testing` alias
missing it exits 0, writes a bundle, and the page dies at load with `ReferenceError: Buffer is not
defined`. So the build (ordinary options in `apps/web/vite.config.ts`, no wrapper script) scans
the emitted chunks for Node-only module names, holds the generated route tree against the route
files on disk, reads the emitted stylesheet to prove the design system shipped, caps first-paint
bytes, and refuses any bundler warning that is not on an explicit allowlist.

## Evidence, not assertions

`evidence/` is the audit trail, and only a probe that actually measured something may write into
it. `packages/protocol/src/app-contracts.ts` reads `evidence/markets-launch-deployment.json`;
absent or malformed evidence fails closed. No surface substitutes fixture rows or invented price
movement when a chain read is empty or unavailable. Spent bearer secrets stay in `evidence/` on
purpose — once claimed, the preimage buys nothing, and leaving it in lets any reader hash it and
watch the commitment fall out. Anything still claimable lives in gitignored `.secrets/` instead.

## Our contracts

All on `SN_MAIN`, deployed from `contracts/` (Cairo; `scarb build && snforge test`). Addresses
are read back off the chain into `evidence/markets-launch-deployment.json` rather than copied
from deploy logs — "the transaction succeeded" is a weaker claim than "the class is there now".

| Contract | What it stores |
|---|---|
| `Mailbox` | One sealed memo per note, posted by the pool — bodies in events, one-time anchors in storage |
| `VesuEarn` | Pool-only Vesu lending helper: underlying in, shares out, and an exact-share redeem back |
| `Markets` | Market records and bets as bearer commitments — no buyer address |
| `Launch` | Sale records, buys, graduation and refund state — no buyer address |
| `Governance` (Houses) | Houses, proposals, sealed ballots, tallies |

## Mail — a payment that carries a sealed note

A mail is one private transfer with one extra action. The SDK composes the transfer as it always
does — spend notes, create the recipient's encrypted note, return change — and the app appends a
single `InvokeExternal` to the `Mailbox` carrying the sealed memo. The pool proves the whole
action list, applies the notes, and *then* calls `Mailbox.privacy_invoke` itself, so the memo and
the money share one hash, one receipt, and one revert. The Mailbox accepts no other caller:
sender anonymity in the messaging RFP is precisely "the pool is `msg.sender`", and a memo posted
by an account directly would print that account beside its ciphertext.

**The key is the pool's own channel key.** The pool keeps a directional channel between any two
accounts that have transacted; its key is a Poseidon hash the sender derives (it includes the
sender's private viewing key) and the recipient recovers by decrypting the pool's channel record
with theirs — the same material the pool uses to hide note amounts. The memo key is
`HKDF(channel_key, salt = note_id, info = domain ‖ chain ‖ pool ‖ mailbox)` into AES-GCM-256, with
the note id and token in the authenticated data, so a ciphertext moved to another note fails to
open. No second secret is agreed anywhere, and nothing but the two viewing keys — and the auditor
escrow that can recover them — can derive it.

**The anchor is the recipient note's id**, which the sender can compute before compiling
(`compute_note_id(channel_key, token, next_index)`) and nobody else can predict. The app seals the
memo for that id, compiles the transaction *without proving it*, reads the compiled action span,
and refuses to prove unless the SDK created the recipient's note at exactly that index and the
Mailbox calldata is the sealed envelope verbatim (`packages/protocol/src/mail-guards.ts`). A drift
costs nothing; it would otherwise cost the pool fee to learn on chain.

**Reading needs no service.** Discovery already yields every channel this account is on either
end of, so every note id it could have sent or received is recomputable — spent ones included.
One bounded event scan of the Mailbox (our contract; few events) joined on those ids, one key
derivation per hit, one AES-GCM open, and the thread is back. A fresh device holding the account
sees the same threads; this browser keeps only a "seen up to block" cursor for the badge.

**What is visible, and who is trusted.** On chain: that a pool transaction invoked the Mailbox,
the ciphertext and its size, the block, and the note id (already public in the pool's
`EncNoteCreated` event of the same receipt). The submitter, unless a covered transaction is used,
in which case the relayer sees your IP and timing as for any send. The prover, after OHTTP
terminates, sees the actions it proves. The auditor escrow can recover the channel key and read
every memo, old ones included. The channel key is static for the life of the channel, so there is
no forward secrecy, and the words are never called end-to-end encrypted. A memo costs no extra
pool fee — `collect_fee` is flat per `apply_actions` — so a mail costs exactly what a send costs.

## Houses — the sealed-ballot design in one paragraph

A ballot is a Pedersen vector commitment on the Stark curve: the voter's **weight is public**
(that is what makes eligibility checkable), the **choice is sealed**, and no address appears on
the ballot itself. The **Teller** (`packages/relayer/src/teller.ts`) is a *named* trust party —
it can see choices before close and could refuse service, and the app says so instead of
pretending otherwise; what it cannot do is forge an outcome, because the tally must satisfy a
commitment equation the contract itself verifies — the chain rejects a wrong tally. Two modes:
secret-until-close (per-ballot reveal after close) and permanently-private (only the aggregate
ever surfaces). The currently deployed class predates the tally-key and duplicate-exclusion
corrections, so the app fails closed on affected writes until a corrected deployment updates the
evidence.

## Keys and processes

Two keys can sign on behalf of this product, and they are deliberately different shapes:

- **deployer** — non-resident. Loaded by a one-shot run, spends once, exits; no server can be
  reached to make it sign. Never the relayer's key: several probes need two distinct callers of
  the same helper to prove anything.
- **relayer** — resident, bounded by the allowlist and the live-fee approve cap above.

The rule that applies to both: **a Starknet account contract must be deployed on-chain before its
key can sign anything.** A funded but undeployed key passes every free pre-check — the balance
reads fine, `compile_actions` accepts it as a sender — and then fails the first thing that costs
money. Verify with a free `getClassHashAt(address)` read before any spend.
