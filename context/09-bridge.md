# The bridge — RFP Idea 22

Research 21 Aug 2026: 11 agents (5 recon deep-dives, each adversarially verified, plus a synthesis
verdict). ~2.0M tokens, 655 tool calls, 110 min. Primary evidence only — live `starknet_getEvents` and
`starknet_getClassAt` against `rpc.starknet.lava.build`, decoded real mainnet calldata, Circle's Iris
API, and a full read of StarkWare's own bridge repo.

**This file corrects three claims made earlier in `07-gate-and-traps.md` and the decision log.
See §0.**

---

## 0. Corrections to what we previously believed

| Previously stated | Corrected by primary evidence |
|---|---|
| **"Solana is unreachable; Idea 22's Solana promise cannot be honoured."** | **WRONG.** Starknet→Solana CCTP is **proven in production**: 270 all-time Starknet→Solana burns, 8 carrying the byte-identical `cctp-forward` hook, **all `forwardState=COMPLETE`**, delivering in 9–16s. Both ends are registered on-chain (domain 5 → the real Solana CCTP V2 program; Solana's registry mints for remote domain 25 = Starknet USDC). The genuine gap is narrower and specific: a **fresh** Solana wallet has no USDC Associated Token Account and delivery **reverts** without one. Settle it with one ~$0.75 mainnet probe |
| **"A ≤3-min live video is physically impossible."** | **Overstated.** It assumed ~30s blocks. Measured block time is **1.73s**, so a single crossing is ONE pool transaction (~17s aging) and the proof window is 450 blocks ≈ **13 minutes**. **A single crossing IS showable live.** A 25–30-transaction round trip is not. The real bottleneck is **client-side STARK proving wall-time, which nobody has ever timed** — time it before scripting the video |
| **"Private sub-accounts are not shipped."** | A **live `ShadowAccountAnonymizer` is deployed** at `0x4f33230d…` with **39 mainnet calls** and first-class SDK support. But it is an auth/arbitrary-call primitive — **unlinkability does not come from it**; it comes from the note/nullifier set plus the relayer-as-submitter. Do not build a privacy claim on it |
| `~9.1 STRK` all-in per pool transaction | **~9.2 STRK median, up to ~14.3 at p90.** And the 6-STRK protocol fee is **mutable** (it was 4 STRK earlier in history, and upgrade delay is zero). **Read `get_fee_amount()` at runtime; never hardcode it** |
| "Route through AVNU's forwarder instead of running a relayer" (asserted twice in recon) | **Refuted in three independent places.** `is_whitelisted(pool)` = 0, arbitrary = 0, `execute_private_sponsored` reverts `"Caller is not whitelisted"`. **Abu's own ~150-LOC relayer is MANDATORY, not optional** |

---

## 1. The single most useful find: StarkWare ships a public reference implementation

**`github.com/starkware-libs/privacy-bridge`** — public, **Apache-2.0**, created 1 Jul 2026, last pushed
**20 Aug 2026 (the day before this research)**. It is the extracted engine of a private-Polymarket
trading app. Three workspace members:

- `packages/bridge-anonymizers` — the Cairo
- `packages/bridge-core` — the TS engine, published as `@starkware-libs/starknet-privacy-bridge` v0.1.21
- `apps/bridge` — a Vite + React 19 demo

**Do not reinvent this.**

## 2. Both directions work on mainnet — inbound is not vapour

| | Address | Mainnet evidence |
|---|---|---|
| **OutboundAnonymizer** | `0x009067f35d2cab3cb933f3d78793660402026f8fa31e041ca2cab4a8e9a49092` | **432+ successful `BurnInitiated` events.** 165 lines of Cairo |
| **InboundAnonymizer** | `0x03a7e7f34e530f8ec00b1ff7eaca90a136311d9da7cb17a73203f813b56c86cb` | **486 events** (221 `Claimed`). Most recent success **2026-08-21T09:55:20Z** — two hours before this research ran |

**OutboundAnonymizer's entire external surface is one function**, `privacy_invoke(params: BuyParams)`,
whose calldata is exactly **8 felts**: `mint_recipient.low/.high`, `amount.low/.high`,
`max_fee.low/.high`, `min_finality_threshold` (u32), `destination_domain` (u32).

Exactly **three revert paths**, nothing else: `CALLER_NOT_POOL`, `ZERO_AMOUNT`, `AMOUNT_LE_MAX_FEE`.
No token whitelist, no recipient check, no per-caller state, no reentrancy guard, no pause, no owner,
no upgrade path. It holds zero storage beyond three constructor-baked addresses.

**Constraints that matter:**
- **USDC-only, hard-baked.** The caller cannot pass a token.
- **Amounts must be exact.** The pool `Withdraw` amount and `BuyParams.amount` are separate numbers and
  nothing reconciles them — **any excess withdrawn to the contract is stranded and burnable by the next
  caller to their own address.** Both anonymizers currently hold 0 USDC.
- **`hook_data` is NOT caller-controllable.** The contract always appends the fixed 32-byte
  `cctp-forward` payload. **You cannot attach custom destination hookData with StarkWare's contract —
  which is exactly why the fresh-Solana ATA case needs your own helper.**
- Destination domains exercised live: Polygon ×29, Base ×2, Ethereum ×1 in a 32-tx sample, all at
  `min_finality_threshold=1000` (CCTP Fast). **StarkWare's own deployment only ever exits to Polygon.**

---

# HONEST DELIVERABILITY VERDICT — RFP Idea 22 (Private Cross-Chain Bridge)

Solo builder, 10 days, 6th of six surfaces, BRIDGE_FORWARD = one mode of an already-planned stateless ValueRouter.

---

## 1. CONTRADICTIONS BETWEEN TOPICS

**Solana deliverability — the biggest cross-topic mess.**
- `unlinkability` recon: "riskiest claim, unproven, need one test crossing before it hits a README."
- `cctp` recon: measured 3 crossings at 23/41/56s — then its OWN verification refuted itself, finding 8 *forwarded* Starknet→Solana burns at 9-16s.
- `rivals` recon: "0 of 432, unrehearsed by anyone" — refuted by its own verification (270 all-time Starknet→Solana burns, 8 with the byte-identical `cctp-forward` hook, all `forwardState=COMPLETE`).
- `evm-side` recon: leaned on the Iris fee quote as proof — its verification showed the quote endpoint ignores source domain entirely, so that "proof" was non-probative.
- **Evidence favors: Starknet→Solana CCTP is PROVEN in production for recipients with an existing USDC ATA.** Both ends are registered on-chain (domain 5 → real Solana CCTP V2 program; Solana's registry mints for remote domain 25 = Starknet USDC). What is genuinely unobserved is the *fresh-wallet ATA-creation* path from a Starknet source. That narrower gap is real and is the only thing the day-one probe needs to settle.

**Relayer availability — a claim that was wrong twice.**
- `rivals` recon: "MATERIAL CORRECTION — Abu does NOT need his own relayer, route through AVNU's forwarder" (marked VERIFIED).
- `anonymizers` recon made the same mistake.
- Refuted in THREE places (rivals verification, anonymizers verification, unlinkability): the AVNU Forwarder `0x127021a1…584f` enforces an owner-gated whitelist; `is_whitelisted(pool)=0`, arbitrary=0, and `execute_private_sponsored` reverts `"Caller is not whitelisted"`.
- **Evidence favors: Abu's own ~150-LOC relayer + a funded hot account is MANDATORY, not optional.** `apply_actions` has no caller ACL and `collect_fee` pulls from `get_caller_address()`, so a self-run relayer works — but there is no free ride.

**Starknet→Solana latency:** 23/56s (heuristic amount-matching of non-forwarded txs) vs 9-16s (deterministic via Iris `forwardTxHash`). **Favors 9-16s.** The cross-chain leg is NOT the demo bottleneck if `min_finality_threshold=1000`.

**"user_private_key = viewing key, not spending key":** `evm-side`/`anonymizers` recons framed it as a two-key confusion; the pool source shows there is ONE pool identity key that is simultaneously viewing and spending, and a *separate* ordinary Starknet account signing key. **Favors: one pool identity key; the stranding footgun is feeding the account key into the commitment.** Operational advice is unchanged, the mental model was wrong.

**Fee model:** "12 bps," "1.21%," "5.38%" flat — refuted repeatedly. **Favors: `feeExecuted == maxFee` always (78/78 messages); cost = flat destination-specific `forwardFee` + proportional bps (12 for most domains, 3 for domain 26); delivered = amount − maxFee, deterministic at signing.**

**"6 STRK per tx":** mutable (was 4 STRK earlier in history, zero upgrade delay) AND incomplete — real all-in is **~9.2 STRK median (6 protocol + ~3.2 gas), up to ~14.3 p90**. Every STRK budget in the recons is ~55% low.

**"Private sub-accounts not shipped":** the brief's premise and three recons say substitute with ComputeAndInvoke — but `unlinkability` verification found a **deployed live ShadowAccountAnonymizer** (`0x4f33230d…`, 39 mainnet calls) with first-class SDK support. **Favors: shipped.** But it's an auth/arbitrary-call primitive, and the unlinkability does NOT come from it — it comes from the note/nullifier set plus the relayer-as-submitter.

**Demo "physically impossible":** brief assumed ~30s blocks. Measured block time is **1.73s**; a single crossing is ONE pool tx (~17s aging) and the proof window is 450 blocks ≈ 13 min. **Favors: a single crossing is showable live; a 25-30-tx round trip is not.** The real, still-unmeasured bottleneck is client-side STARK proving wall-time — nobody in any pass timed it. Time it before scripting the video.

---

## 2. THE FRESHNESS PARADOX

**Verdict: SOLVED on the EVM outbound leg. SOLVABLE on Solana, but only with Abu's own helper. NOT fatal.**

Circle's Forwarding Service submits the destination mint and pays destination gas out of the minted USDC (the `cctp-forward` hook + `destination_caller=0`). A fresh EVM address receives real USDC with **zero native gas, zero actions, zero prior history, and never signs anything.** This is verified 45/45 complete on live Starknet-origin burns. The paradox — "a fresh wallet must pay gas to receive" — is genuinely dissolved for EVM: the recipient pays nothing and does nothing.

Two honest caveats:
- **Receive ≠ spend.** The fresh EVM wallet still has zero native ETH, so it can receive but not move funds onward. Any later gas top-up is exactly the linkage the product exists to break. The RFP promises "receives" and "no path back to the funding source" — both hold. It does not promise the wallet can immediately transact, so this is a caveat, not a breach.
- **Solana is the exception.** A genuinely fresh Solana wallet has no USDC Associated Token Account, and delivery **reverts** without one. The sponsor's deployed OutboundAnonymizer hardcodes a zero-payload hook and *structurally cannot* request ATA creation. Abu's own helper CAN, via Circle's 65-byte extended V0 hook (flag byte + 32-byte owner, +~$0.185). Then Circle creates the ATA in-flight and delivers. The ATA is a real created account with a creation tx, so "no history" is literally false on Solana — say "no on-chain path back to the funding source" instead.

The paradox does not sink the RFP. What weakens the central promise is not gas — it's **amount + timing correlation** (Section 4).

---

## 3. THE MINIMUM WORKING CROSSING

The smallest thing that genuinely works end-to-end AND clears the gate: **private note in pool → fresh Base address, one pool transaction, through Abu's OWN ValueRouter in BRIDGE_FORWARD mode.**

(Using StarkWare's deployed OutboundAnonymizer is 0 Cairo and works in hours — do it day one as a spike — but it fails README line 86's "run through one of yours," so it cannot be the submission.)

- **Cairo:** ~70-90 LOC as ONE mode of the already-planned ValueRouter (the standalone OutboundAnonymizer is 165 lines incl. boilerplate Abu already has). +15-25 LOC for variable `hook_data` if he wants the fresh-Solana differentiator. Net marginal Cairo over the ValueRouter he's building anyway: **~90-115 lines.**
- **TS:** ~400 LOC — chain/domain registry (~80), live Iris fee quote with finality-tier guard (~70), one-tx action-list builder (~60), delivery poll against `/v2/messages/25` (~40), relayer (~150).
- **STRK:** ~9.2 STRK median per pool tx all-in. Deploy/declare (~2-5), 3 gate txs, ~20-30 rehearsals → **budget 250-350 STRK.** Re-read `get_fee_amount()` at runtime; never hardcode 6.
- **Days:** 2-3 for outbound-EVM; +0.5 and one ~$0.75 mainnet probe for fresh-Solana.

**Exact action sequence (one `apply_actions`, submitted by Abu's relayer):**
1. `WriteOnce` — a 1-wei note or `OpenSubchannel` (an invoke-only tx is illegal)
2. `UseNote` — spend the existing private note (appears on-chain as nullifier + EmitNoteUsed)
3. `CreateEncNote` — change back to self
4. `Withdraw` → `TransferTo(ValueRouter, USDC, amount)` + `EmitWithdrawal`
5. (optional) `Withdraw` → `TransferTo(relayer, USDC, fee reimbursement)` — the reusable "reimburse my own relayer in USDC" pattern, needs no one's permission
6. `Invoke` → `ValueRouter.privacy_invoke(BRIDGE_FORWARD, {mint_recipient, amount, max_fee ≥ live Iris quote, min_finality_threshold=1000, destination_domain=6})`

Inside step 6 the helper approves *exactly* `amount` to the TokenMessengerMinter, calls `deposit_for_burn_with_hook` (`cctp-forward` hook, `destination_caller=0`), asserts its own end-of-call balance is zero, returns an empty span. Circle mints on Base ~15s later. Delivered = `amount − max_fee`.

**Prerequisite (one-time, if no note exists):** account deploy + `SetViewingKey` + AML-screened `Deposit` = 2-3 more pool txs.

**Do NOT include the inbound leg in the minimum.** It needs a forked InboundAnonymizer (own contract for the mine rule), a relayer liveness obligation, the `proof_facts` tx field that JSON-RPC 0.10.2 doesn't surface, ~1,700 LOC of pending-state recovery in the reference, a live fund-stranding footgun, and it cannot be demoed login-free. It is a stretch goal, not the MVP.

---

## 4. WHAT MUST BE DISCLAIMED

Zero rivals shipped a crossing; the sponsor scores against overclaiming on a 30%-weighted criterion and has already published a threat model that refuses these exact claims. Use these precise sentences.

- **Never** "the A-B relationship is not publicly observable on either side" or "fully anonymous." **Say:** "The crossing hides which shielded note funded the withdrawal. It does not hide the amount, the destination address, the destination chain, or the timing."
- **Never** any claim that depends on amount privacy. **Say:** "Amounts are public — three times on Starknet (Withdrawal, BurnInitiated, DepositForBurn) and again at the destination mint. A distinctive amount is a 1:1 fingerprint across the crossing. We follow StarkWare's own guidance and make no unlinkability claim that depends on amount privacy."
- **Never** "the deposit is hidden." **Say:** "Deposits are public. A Starknet shield publishes the depositor and amount; a CCTP inbound publishes the source EVM address inside the Starknet calldata that mints the note. Every deposit is AML-screened."
- **Never** "end-to-end encrypted." **Say:** "Your viewing private key is escrowed on-chain, encrypted to a StarkWare auditor key, readable permissionlessly via `get_enc_private_key`. Authorized tracing needs no cooperation from you and is retroactive. This is compliance-compatible by design, not end-to-end encrypted."
- **Never** "timeout-and-reclaim covers the failure path." CCTP burns are irreversible. **Say:** "Once burned, USDC can only arrive at the destination — never be refunded. A stuck crossing is resumable (the attestation re-attests indefinitely and is single-use), so it will land; it cannot be reclaimed."
- **Never** "fresh wallet with no history" for Solana. **Say:** "a fresh destination with no on-chain path back to the funding source."
- **Never** "the user signs once on the source chain" for the inbound leg. The EVM approve + burn are user-signed and user-gas-paid; the paymaster does not reach them.
- **Never** "Chain Abstraction." It is an unbuilt sponsor RFP. **Say:** "CCTP v2."
- **Anonymity set — state the real number.** 26 addresses shielded USDC in the last 10 days; 6 in the last 24h; median 1 candidate funder in the hour before an exit; the largest crossing ever through the reference helper was 45 USDC. A crossing above ~50 USDC is, by itself, a unique fingerprint. Put this on screen. A "Linkability Meter" that shows the user their true crowd size is the honest version of the pitch AND the strongest innovation surface.

---

## 5. IN OR OUT

**Case for OUT:**
- The headline promise — unlinkable A→B — is structurally weak at current pool volume. Amount + timing correlation resolves a quarter of historical crossings to a single funder with a ten-line public script; a large crossing has an anonymity set of 1-3. You cannot honestly sell "unlinkable."
- The inbound leg (needed for the full "Ethereum in → Solana out" sentence) is the single hardest, riskiest thing in the whole six-surface app: mandatory relayer liveness, a documented mainnet fund-stranding bug, own-contract fork for the gate, and no login-free demo.
- The pool is zero-delay upgradeable and the sponsor commits daily; repo HEAD replaces the open-note blocklist with a screening policy that would kill an unregistered inbound helper mid-judging.
- It is the 6th surface. Every hour here is off five surfaces that are already designed.

**Case for IN:**
- BRIDGE_FORWARD is ONE mode of a ValueRouter Abu is already building. Marginal cost is ~90-115 Cairo lines and ~400 TS lines, not a standalone project.
- Zero of seven registered rivals shipped a working crossing; the sponsor's own deployment only ever exits to Polygon. A Solana-first, fresh-wallet exit is a checkable first that beats the entire field including the reference.
- Circle's Forwarding Service genuinely solves the freshness paradox on the outbound leg — no rival and not even the sponsor delivers gas-free fresh-wallet delivery to a non-EVM chain.
- Satisfies "One deposit, any chain out" *literally* for 18 chains. Login-free outbound demo works: type an address, press send, watch real USDC land, no wallet.
- Directly feeds the 30% integration-depth and 25% innovation weights; publishing the reusable Solana-ATA helper earns the "other teams depend on you" bonus.

**Recommendation: IN — but scope it to OUTBOUND-ONLY BRIDGE_FORWARD with the fresh-Solana ATA differentiator, and treat INBOUND as an explicit stretch goal that starts only after the five surfaces and the three gate transactions are banked.** The economics justify it precisely because it is not a standalone build. Outbound is the leg that is proven, demoable login-free, gas-free at the destination, and genuinely novel (Solana). Sell it as "a private, chain-abstracted *exit* with honest linkability disclosure," not as an unlinkable bridge — the disclosure/meter is the innovation, and it converts your worst finding (amount correlation) into your most differentiated surface. Do the Solana probe on day one; if it fails for fresh wallets, fall back to Base/Arbitrum (proven) and Sei (proven, non-EVM-flavored) and drop nothing else. Do not build inbound unless everything else is done — it is where the week dies.

---

## 6. THE ONE PARAGRAPH HE MUST READ

The outbound half of Idea 22 is real, proven on mainnet, and cheap because it's one mode of a router you're already writing — a private note exits to a fresh address on any of 18 chains including Solana, with Circle paying the destination gas so the recipient needs no gas and no wallet, and a Solana-first crossing beats every rival and the sponsor's own deployment. Build that. But three facts are load-bearing and non-negotiable: you must run your own relayer (the AVNU forwarder is whitelist-gated and refuses you — every "you don't need a relayer" note was refuted), every STRK budget you've seen is ~55% low (real cost is ~9.2 STRK all-in per pool tx, and the 6-STRK fee is mutable — read it at runtime), and you cannot claim unlinkability, amount privacy, hidden deposits, end-to-end encryption, or timeout-and-reclaim, because amounts are public three times, the deposit is public, your viewing key is escrowed to StarkWare's auditor, and CCTP burns are irreversible. The inbound leg (EVM→pool) is the one that will eat your week — relayer liveness, a fund-stranding footgun, an own-contract fork, and no login-free demo — so leave it out of the minimum and treat it as a stretch goal only after your five surfaces and your three gate transactions are on chain. Ship the honest exit, put the real anonymity-set number on screen, and run the ~$0.75 Solana probe before a single Solana word reaches your README or your video.
