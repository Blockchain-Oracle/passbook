# Gate, traps, and the facts that change decisions

Produced 21 Aug 2026 by 13 agents (6 deep-dives, each adversarially attacked, plus a contradiction
critic). ~2.0M tokens, 754 tool calls. Everything here was checked against **primary evidence** —
live mainnet RPC at `rpc.starknet.lava.build`, real contract ABIs, real npm packages, the sponsor's
own repo source — not documentation. Where recon and verification disagreed, **verification won** and
the correction is stated.

Read this together with `02-verified-technical-facts.md`, which this file corrects in three places.

---

## 1. The five things that can eliminate you

### 1.1 The gate is STRICTER than we recorded — and the sponsor's own two docs contradict each other

- `README.md` line 86: *"At least three mainnet transaction hashes. Each is checked against the chain:
  it must exist, have succeeded, have touched the STRK20 pool, and — **if you deployed contracts —
  have run through one of yours**."*
- `docs/MAINNET-DAY-0.md` line 15 says only: *"it must exist, have succeeded, and carry a STRK20 pool
  event."*

**Assume the stricter reading.** Once you deploy *any* contract, three plain shield/unshield
transactions may not qualify — each must route through **your own** helper. Plan the three qualifying
transactions as `privacy_invoke` calls through your contract, and list only those hashes.
This is the same trap already zeroing **airlock** (3 real pool txs, 0 through its declared contracts).

**Ask the sponsor directly.** `README.md` line 152 and `MAINNET-DAY-0.md` line 116: *"Open an issue on
this repository — the STRK20 team reads them every day of the sprint."* 14 issues are open; it is live.
This is cheaper than the `cal.com/adithyadinesh` call slot and it timestamps your diligence for the
docs/open-source 15%.

### 1.2 The login-free demo does not work by accident — it must be designed

An anonymous judge with no wallet and no funds **cannot complete any private flow**, because of a
verified bootstrap deadlock (§2.1). The read-only `get_public_key(addr)` call buys you a view of
someone else's key — that is not a working demo.

**The fix, and it is a gate item not polish:** ship a **pre-registered, pre-funded demo persona** whose
viewing key is published in the app and plainly labelled as a demo identity, so a cold visitor
immediately sees a real conversation / balance / position decrypted live from the sponsor's own
discovery service — plus a relayer-sponsored button that submits and pays on the visitor's behalf.

*Softer than feared:* `demo_url` in `strk20.json` is **not required** — the hub auto-discovers
(GitHub Pages → repo Website field → latest deployment). Filling the repo **Website** field is the
one-click certainty. And `README.md` line 114: *"The hub shows which of these you're still missing"* —
so gate compliance is checkable at `strk20.starknet.io/hackathon` rather than guessed.

### 1.3 The ≤3-minute video cannot be a live *full* run — but a single action IS showable live

> **⚠️ CORRECTED 21 Aug by the bridge research — the original claim here was overstated.** It assumed
> ~30 s blocks. **Measured block time is 1.73 s.** So a single action is ONE pool transaction with
> **~17 s of note aging**, and the proof window (`get_proof_validity_blocks()` = **450**) is
> **~13 minutes**, not seconds. **One crossing, one bet, or one message can absolutely be filmed live.**

What remains true: a **full six-surface sequential run is ~25–30 pool transactions** and cannot fit in
three minutes. So the video shows one or two surfaces live and the rest as already-confirmed state.

**The real bottleneck is something nobody has ever measured: client-side STARK proving wall-time.**
Every pass flagged it; none timed it. **Time one real proof before scripting the video** — it is the
only number that decides whether a live take is possible at all.

### 1.4 The pool is upgradeable with ZERO delay, and the next version breaks value-bearing helpers

Live: `get_upgrade_delay()` → `0x0`, `is_paused()` → `0x0`. The deployed ABI carries
`add_new_implementation`, `replace_to`, `pause`, `unpause`. **StarkWare can swap the implementation or
pause the pool instantly, including during judging week.**

Worse: today's pool runs a **default-allow blocklist**. In git `main` @`36eac4e` the blocklist is
**gone**, replaced by `open_note_depositor_screening_policies` whose `#[default]` is **`Required`** —
any helper returning a non-empty `OpenNoteDeposit` span will need a fresh screener-signed attestation
over its own address or the transaction reverts `SCREENING_REQUIRED`.

- **Chat is immune** — a zero-deposit invoke sets no screening subject (verified in
  `_apply_invoke_and_deposits`, `privacy.cairo:1006-1027`). **This is a genuine architectural argument
  for the message-only helper.**
- **Every value-bearing leg is exposed**: swap anonymizer, bridge, bonding curve, prediction payout.

**Mitigation:** pin the class hash `0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d`
in the README, keep a lane that works when the pool is paused, and **re-verify your transaction links
immediately before submission.**

### 1.5 Deposits are mandatorily AML-screened by a third party

`MAINNET-DAY-0.md` line 66: *"A compliance provider screens the depositing address and signs every
deposit; the pool verifies that signature on-chain. It is mandatory, and running your own prover does
not bypass it."*

Traced to `starkware-libs/starknet-privacy` → an **`elliptic-proxy`** package: a GCP Cloud Function
proxying the Elliptic AML API, holding a Stark-curve `signingPrivateKey`, with per-partner HMAC
credentials and a **default 100 req/min per-partner rate limit**. Live
`get_screener_public_key()` → `0x501cc452e5a4370e2f0879c9a863b3efc915005817487460b23a8d6ef88fdb2`.

Consequences: you cannot self-host it; the shield path permanently depends on the sponsor's hosted
signer; **a demo visitor who screens as blocked gets a silent revert that will look like your bug**;
and a viral demo could hit the rate limit. Also: the transaction-prover **doubles as the AML
gatekeeper** — attestations come from the prove response's `additional_data.signature`. Any design
assuming "the prover is a dumb proving service" is wrong.

---

## 2. Facts that change the account model (D18 needs amending)

### 2.1 THE BOOTSTRAP DEADLOCK — a fresh app-native account cannot register itself

Three verified on-chain facts compose into a wall:

1. `open_channel` asserts `recipient_public_key.is_non_zero()`, error **`RECIPIENT_NOT_REGISTERED`**.
   **You cannot pay an address that has not itself registered.**
2. The paymaster's `fee_action` is a **`withdraw` from the user's SHIELDED balance**.
3. `collect_fee()` (`privacy.cairo:845-856`) pulls 6 STRK via
   `checked_transfer_from(sender: get_caller_address())` — **whoever submits pays**.

So a fresh account with zero public funds **has no shielded balance to pay the fee from, cannot be paid
by anyone because it is unregistered, and therefore cannot register.**

**Escapes:** (a) bundle registration with a deposit via `invoke_and_apply_action` — needs an ERC-20
`approve`, therefore a funded public wallet and a signature; or (b) **your own funded account sponsors
it** (see §2.3). "You never install an extension" and "or a locally-generated key if you have nothing"
are **false at step one**. This must be resolved before the account model is final.

**Also:** any *self-submitting* account must hold STRK **and** a standing ERC-20 approval to the pool
for ≥6 STRK before `apply_actions` succeeds. Sponsor confirms it (`demo/src/config.ts:99-104`). A first
mainnet transaction reverts without it — budget one `approve`, or one large approve up front.

### 2.2 Deriving the viewing key from a wallet signature is UNSAFE — do not do it

The registered key is **WriteOnce-immutable with no rotation path**. If the signature ever changes, the
derived key changes, re-registration reverts, and **the user's notes go permanently dark**.

Measured: of 51 mainnet registrants, **46 are Argent/Ready smart accounts split across TWO class
versions** (36 on `0x36078334…45927f`, 10 on `0x663fc01a…bd024`). Two class versions among 46 accounts
is direct evidence that **account upgrades happen in the wild during the lifetime of a registered
viewing key** — the exact event that orphans a signature-derived key. Roughly **35% already have a
guardian** (4-felt signature), and `change_owner` / `escape_owner` / upgrade all mutate the signature.

The remaining **5 registrants are OpenZeppelin accounts** exposing `AccountABI` + SRC9_V2
outside-execution — almost certainly app-native/derived accounts of the privacy-bridge shape.
**That is the pattern that actually works.**

**Consequence:** recovery must be a **locally-generated key with an explicit user-held backup**
(encrypted export / seed), **never** wallet-signature derivation. The convenient "reconnect and it
re-derives" story is false.

### 2.3 THE UNBLOCKER — you can be your own paymaster, and the sponsor's code is built for it

Three verified facts compose the other way:

1. `apply_actions(actions, screening)` (`privacy.cairo:784-803`) has **ZERO caller access control** —
   reentrancy guard, pause check, proof validation, fee collection, and nothing about who is calling.
2. `collect_fee()` pulls from `get_caller_address()` — **the submitter paying is the only requirement.**
3. AVNU's "sponsorship" **is not sponsorship**: `sdk-wallet.ts:70-78` shows the fee is reimbursed by an
   ordinary `{type:'withdraw', token, amount, recipient: feeAction.recipient}` folded into the proven
   action chain — **and the recipient is an arbitrary address.**

The sponsor ships an **injectable `Paymaster` interface** (`client/src/paymaster.ts`: *"Paymaster is
injected into SdkWallet via its constructor config, so a dapp can swap providers"*).

**So: ~150 lines of TypeScript + one funded hot account gives you full sender anonymity, with no AVNU
whitelist, no API key, and no rate limit — and it is a real integration-depth differentiator.**
Idea 03 (`private-otc-settlement`) confirms the sponsor's position that *"paymaster submits, no address
link"* is **the** mechanism for sender anonymity — so shipping a relayer is **on-spec for a 30%-weighted
criterion, not a workaround.**

**This is the single most important thing to test on mainnet, in week one, before committing any
architecture.**

### 2.4 The AVNU API key would ship in your public bundle

The sponsor's own demo reads it as **`VITE_AVNU_API_KEY`** (`demo/src/config.ts:235`) — a Vite
client-side env var **inlined into browser JavaScript at build time**, set via the
`x-paymaster-api-key` header on a client-side fetch. The gate demands a **public login-free demo**.
Any key you ship is readable in devtools and **burnable by a rival during judging week**.
This alone decides the architecture: **self-hosted relayer, credential server-side.**

---

## 3. The honesty facts — overclaiming here is falsifiable in one RPC call

### 3.1 The viewing PRIVATE key is escrowed on-chain to a StarkWare auditor. There is no opt-out.

Every `SetViewingKey` registration forces the pool to **ECDH-encrypt the user's viewing private key to
a contract-stored auditor public key and persist it on-chain forever** — in storage *and* in the
`ViewingKeySet` event. `get_enc_private_key(addr)` is a **permissionless live view**.

- Live auditor key: `0x1eed60b8d483b3bede62d1cc0f32874aea30747e6943437c858359b41801bf7`
- Confirmed against a real registrant's stored `get_enc_private_key` field[0] — exact match.
- **WriteOnce-immutable: no rotation path.**

The auditor can recover both parties' private keys and therefore **every pool-rooted pairwise ECDH
secret, retroactively, with no user action** — for every message the product will ever carry, on-chain
or off.

**Never say "only you can read your notes", "the key never leaves your device", or "end-to-end
encrypted".** A judge finds this with one `starknet_call`. **Turn it into the feature:** an honest,
visible "who can see what" panel scores on Innovation and Docs precisely because no rival shows it.

### 3.2 The viewing key is also the SPENDING authenticator

`open_channel` asserts `sender_public_key == derive_public_key(sender_private_key)`, error
`SENDER_NOT_AUTHENTICATED`. **The same scalar that decrypts your notes authorises every pool action.**
The name understates the blast radius, and **any "watch-only viewing key" affordance is offering a key
that is not watch-only at the protocol level.** Do not ship one without verifying this.

### 3.3 Sender anonymity is relative to the HELPER, not to a chain observer

The RFP's table says *"Sender identity | Hidden — pool is the msg.sender"*. **That is only true of what
the invoked contract sees.** Every pool transaction has a fully public Starknet `sender_address` — in a
live sample of 10 recent pool transactions, **10 distinct public senders**. Unless a relayer submits,
the submitter is visible and must hold and approve 6 STRK, itself a strong public signal.

**Until your relayer demonstrably works on mainnet, the UI must NOT say "your address never appears."**
Correct sentence for the self-submitted fallback:

> The pool sees your transaction, not your notes. Your wallet address is the visible submitter of this
> transaction; the link between your address and the specific note being spent stays hidden.

### 3.4 The sponsor wrote your disclosure sentence for you — quote it back

`MAINNET-DAY-0.md` line 108, verbatim:

> *"Private DeFi routes through shared anonymizer contracts into public venues, so a swap's amounts and
> timing are visible — the anonymity comes from the shared address and the mixing set, not from hiding
> the amount. A distinctive amount executed shortly after a distinctive deposit is correlatable.
> **Claim identity privacy; never claim amount privacy for swaps.**"*

Line 100: *"Be precise about this in your README — overclaiming is the fastest way to lose points on
integration depth."* Line 67: *"Don't build a product whose privacy claim depends on the deposit being
hidden."* **Quoting the sponsor's own words back at the judges is the cheapest possible defence.**

---

## 4. Structural constraints nobody had budgeted for

- **Channels must open in strict sequential index order.** `open_channel` asserts
  `index.is_zero() || previous outgoing channel exists`, error `INDEX_NOT_SEQUENTIAL`. Anything fanning
  out to many recipients — chat, payments, the prediction market — needs a per-sender monotonic channel
  index and **cannot open channel N+1 before N lands.** Interacts badly with optimistic UI.
- **Every invoke-bearing transaction must also carry a WriteOnce action.** An invoke-only transaction is
  illegal — every atomic action needs a 1-wei note or an `OpenSubchannel`. Cheap but non-optional.
- **Nobody has ever settled more than one note in one transaction.** Across all **1,242**
  `OpenNoteDeposited` events ever, the per-transaction count is `{1: 1242}`. Any "claim a whole
  portfolio in one transaction" or "batch 50 messages" economics is **unproven**. Cannot be tested with
  the free `compile_actions` harness — needs one real mainnet transaction. **Test before promising a
  batched cost in a README.**
- **`identity_key` is scoped per `contract_address`.** The same user gets a *different* identity_key at
  the swap router, the prediction market, and the launchpad. Great for cross-surface unlinkability —
  but it means **no unified cross-surface portfolio can be built from the pool primitive.** A "one
  private account across all six surfaces" view is a **client-side illusion over six unlinkable on-chain
  identities**, reconstructed from the viewing key. Say that honestly or don't say it.
- **The unlinkable claim leg collides with itself.** Claiming N positions in one transaction publicly
  links them (one invoke passes all N nonces together), destroying the per-item unlinkability you paid
  for. Claiming separately costs a full pool transaction each. **This tradeoff belongs in the UI, not
  discovered on camera.**
- **Gas is understated for the transaction types you use most.** The `~9.1 STRK` figure holds for simple
  actions; measured: **~7.3 STRK gas** for ComputeAndInvoke, 4–6.3 for swap, avg 4.82 up to 8.6 for
  launch. **Budget 12–14 STRK for heavy custom-helper transactions.**

**Money is not the constraint.** A full six-surface demo is ~25–30 pool transactions ≈ **300–400 STRK ≈
$8–11**. *Time* is the constraint (§1.3).

---

## 5. Corrections to earlier claims

| Earlier claim | Corrected |
|---|---|
| AVNU Forwarder `0x1270…584f` exposes `execute_private` (implied available) | **Whitelist-gated, reverts "Caller is not whitelisted"** even for the pool. Use `0x426dcd1a…`, the permissionless helper with 73 live invokes |
| `privacy_invoke` is dispatched by **one** hardcoded selector | **Two.** `privacy_invoke_with_computation` also exists and is the more interesting surface |
| "Enclave" appears only in one RFP's marketing prose | **8 of 26 RFPs mention it** (Ideas 14, 16, 19, 20, 21, 24, 25, 26) — all from the Aug-3 wave. It still ships nowhere. ~⅓ of published RFPs are unbuildable as written; **18 of 26 are Enclave-free** |
| Private sub-accounts are SDK-route only, "coming soon" | Wallet-API shadow accounts are **already landing**: `@starknet-io/starknet-types-0104` (0.10.4-beta.2) adds `STRK20_SHADOW_ACCOUNT_INVOKE_ACTION` and a **fifth** wallet method `wallet_strk20ShadowAccountCommitment`. Still no viewing-key method in any version, so chat stays SDK-route-only |
| types-js latest is 0.11.0-beta.2 | **0.11.0-beta.1.** npm dist-tags for `starknet`: latest=**10.0.2** (STRK20-less), next=10.7.0, beta=11.0.0-beta.4. **The pin remains mandatory** |
| Braavos does not support STRK20, Ready only | Stands (sponsor's own docs disagree with each other). But `llms-full.txt` line 61 names **"a Ready or Xverse wallet"** — **Xverse is a candidate second wallet**, worth a 15-minute check for demo robustness |
| ComputeAndInvoke is virgin territory, ~2 uses | **329 calls across 7 helpers all-time.** You would be ~8th. Claim "first *launchpad/prediction market* on it", never "first" |
| Registered STRK20 users: 62 / 51 | **≥142** `ViewingKeySet` (scan from block 12,627,041). The low counts came from truncated RPC windows. **Do not put "62 users" in a README** — a judge disproves it with one call. The set is still small; the *number* was wrong |
| Swap-then-unshield is impossible in one transaction | **Refuted.** If you own the helper it can pay the output straight to a public address inside the phase-7 invoke — the live OutboundAnonymizer does exactly this. **swap → public payout IS one transaction**; swap → reshield-then-withdraw is two |
| StarkWare's `EkuboSwapAnonymizer` is the reference to fork | True, but **it has NEVER been invoked on mainnet**, and it is **single-hop, full-fill-or-revert only** (hardcoded `sqrt_ratio_limit = 0`, asserts `IN_TOKEN_NOT_CLEARED`). A real WBTC→USDC mainnet route was multi-leg — this contract could not have executed it |

---

## 6. Field intel updates

- **`registry.json` now holds 110 projects** and has an optional **`inspired_by`** field taking an ID
  from `IDEAS.md`. **70 are unset.** Most crowded: RFP-11 (private payroll) ×5, IDEA-11 (merchant
  checkout) ×5, RFP-07 (prediction markets) ×3, IDEA-09 ×3. **Everything else is a singleton.**
  **IDEA-23 (open note indexer) and IDEA-24 (local dev environment) are claimed by NOBODY.**
  Set `inspired_by` deliberately — it is how the sponsor's hub categorises you.
- **The swap lane is genuinely uncrowded.** Only **9 of 110** projects mention swap/dex/amm/trading at
  all. IDEA-01 is claimed by one project (`VINSS`) which is an *"agentic private deal room"*, **not a
  swap** — so the swap lane is uncontested at the idea level.
- **Closest architectural rival: `Jalin`** — *"a programmable execution router for the STRK20 pool:
  arbitrary multi-step, multi-token."* That is the same one-helper-many-modes thesis. Per the standing
  rule this is **intelligence, not a veto** — and it has **shipped zero Cairo**. Watch the repo.
- **"Other teams depending on you" is an OFFICIAL judging criterion**, not flavour text. `README.md`
  line 127, directly under the weighted table: *"If another team depends on something you published,
  that counts in your favour."* This materially raises the value of publishing a small reusable
  package — and of the two unclaimed IDEAS.
- Registration is a single PR adding `{repo_url, telegram}`, auto-merging on check pass, and
  **stays open the whole sprint.**

---

## 7. The paragraph that matters most

Building a wallet locks you to the SDK route with a self-custodied in-browser key, and that one fact
runs through three gates nobody has closed. **(1)** A walletless judge cannot register, hold STRK, or
derive a key — so a **pre-registered, pre-funded demo persona with a published viewing key is the
elimination gate, not polish.** **(2)** The SDK-wallet route cannot self-submit without exposing the
user's address and forcing them to hold STRK — so **run your own relayer** (verified possible, untested;
do it in week one) and **never claim sender anonymity in the UI until it works on mainnet.**
**(3)** The viewing private key is escrowed on-chain to StarkWare's auditor, and every amount in an
open-note swap/launch/bet leg is plaintext public — **claim identity privacy only.** Finally, the
one-invoke-per-transaction rule means a merged six-mode monolith buys **zero** atomicity while
destroying per-surface unlinkability: build **separate stateless helpers**, unify only where two effects
must land in a single invoke. And **bank ≥3 mainnet transactions through your own contract this week**,
before writing the interesting version — exactly **one** of ~110 entrants has cleared the gate.
