# MECHANISM DECISION — STRK20 Prediction Market

## 1. Was "order book is structurally impossible" wrong? YES. Plainly wrong. Abu was right.

The old claim confused "one invoke per transaction" with "one value movement per transaction." The governing code says otherwise, and it was verified three independent ways against the **deployed** mainnet class (source tag `CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08`, commit 74841caf, `starkware-libs/starknet-privacy` — cite the tag, not `main`, which has ABI drift):

- `packages/privacy/src/actions.cairo:306` — `assert_and_advance_phase` only advances the phase counter past INVOKE_PHASE (7). Every other phase can repeat freely: N×UseNote, N×CreateOpenNote, M×Withdraw in one transaction, plus exactly one invoke.
- `privacy.cairo:999` (deployed tag) — `for deposit in deposits { self._deposit_to_open_note(...) }` over a `Span<OpenNoteDeposit>`. One invoke may credit **N** notes. Error constants `UNDEPOSITED_OPEN_NOTES` and `TOO_MANY_OPEN_NOTES_DEPOSITED` are both present in the deployed 20,546-felt Sierra program (checked on two RPCs).
- `withdraw` (deployed `privacy.cairo:505-529`) sends to an **arbitrary** `to_addr` with no whitelist, and Withdraw (phase 6) precedes Invoke (phase 7) — fund-a-contract-then-call-it is one legal transaction.
- Proven live at zero cost: `compile_actions` is a public `view` that runs the real client compiler. It compiled `Deposit + 3×CreateOpenNote + Withdraw(to helper) + InvokeExternal` and up to **100 notes + 1 invoke** successfully, with negative controls (`ACTIONS_OUT_OF_ORDER`, `INDEX_NOT_SEQUENTIAL`, `NO_REPLAY_PROTECTION`) confirming the harness was real.

So the custodial CLOB Abu described (Alice escrows in tx1; the contract, already holding her funds, settles both sides inside Bob's single invoke in tx2; Alice claims in tx3) is **legal**. DeepBook's own `BalanceManager` is exactly this custodial pattern.

**What is true instead — two real constraints:**

1. **Economic.** Every place, cancel, and requote is a full pool transaction: measured across 17 real invoke-bearing open-note pool txs, **median 10.13 STRK ≈ $0.285 all-in** (p90 ~$0.41). No batching of invokes, no cancel refunds. DeepBook's live order flow runs **~23–52 order messages per fill** (measured twice on Sui mainnet; it swings by window — quote it as "tens," never "49"). At STRK20 prices that is **$6–$13 of fees per fill** on $5–$50 bets. On Sui the same flow costs ~2 cents, because PTB batching packs 20+ order messages into one tx and storage rebates refund 98.6% on cancel. STRK20 has neither. Also: a maker cannot requote faster than ~22.7 s (10-block finality wait + ~4 s proving), ~159 requotes/hour max, versus Polymarket's 250 ms taker delay — ~90,000× worse latency for the maker.
2. **Privacy.** The taker *can* atomically pay the maker — but only by opening a channel to her, which writes her address as a **plaintext storage key** (`recipient_channels.entry(recipient_addr).push(...)`). That deanonymizes exactly what Idea 07 scores on hiding. So the maker claims separately via ComputeAndInvoke's identity_key — a 3-transaction floor per fill, for privacy reasons, not mechanical ones.

Every serious venue (Polymarket, dYdX, Aevo, Bluefin, LayerAkira, Extended, Paradex) matches off-chain and settles on-chain for exactly this cost reason. And the killer detail: **Mysten built the best on-chain CLOB in existence and did NOT use it for their prediction market** — DeepBook Predict has zero dependency on the deepbook package (`packages/predict/Move.toml`, no `deepbook::` imports; ignore Sui's marketing blog, which claims the opposite).

## 2. What Abu can actually offer — the timeframe menu

The binding constraint is not the pool, it is **Pragma** — the only live oracle on Starknet mainnet (Pyth is 764 days stale and sunsets Starknet **26 Aug 2026, five days before the deadline**; Chainlink is Sepolia-only; Pragma's checkpoints are 23h stale and its documented SummaryStats/TWAP contract is not deployed). Pragma's BTC/USD feed updates in publisher batches: measured gap median **120–220 s** across two independent runs, max **~30 minutes**, and all pairs share the same timestamps.

Fraction of markets whose window contains at least one price update (empirical, both datasets):

| Window | Decidable |
|---|---|
| 1 min | ~13–19% — **dead** (4 in 5 resolve on an unchanged price) |
| 5 min | ~42–53% — **dead** |
| 15 min | ~76–84% — aggressive floor, only with an explicit void-and-refund rule |
| 1 hour | ~100% — **flagship** |
| 1 day / 1 month | trivial |

**The 1-minute market Abu asked for is physically impossible on this stack.** Not because of proofs (17 s note maturity would allow ~one bet), but because the oracle cannot tell you the answer. Only BTC, ETH, and STRK have genuinely fresh feeds (11–12 sources); SOL/XRP/DOGE etc. are not registered at all. Menu: **BTC/ETH/STRK, 1-hour flagship, plus 1-day and 1-month; 15-minute as an explicitly experimental tier with a void rule; nothing shorter.** Settlement: snapshot `get_data_median` + `last_updated_timestamp` at deadline, require freshness within ~120 s, else void and refund. Bonus: Pragma's `set_checkpoint` is verified **permissionless** on the deployed contract (a live call as caller 0 succeeded where admin functions reverted) — Abu can pin a settlement checkpoint himself.

## 3. The mechanism: binary UP/DOWN on a constant-product AMM (FPMM), with a 3-strike ladder of independent binaries batched into ONE pool transaction

**Why not the alternatives:**

- **CLOB** — legal, proven, and economically dead ($6–13/fill, 22.7 s cancel latency, zero makers among ≤239 protocol users). Claim the finding, don't ship the mechanism.
- **Parimutuel** — what the RFP prose sketches and what veilcast built. Fatal at short horizons: the last money in is the best-informed money, and it dilutes early bettors (a $20 early bet can see its payout cut 6× by late piling-in). You never know your payout at bet time — the exact thing Abu found confusing about the $700/$300 explanation is a *real defect*, not a bad explanation. Keep as fallback only.
- **House fixed-odds (Thales Speed Markets model)** — easiest build, but the odds are an admin constant, so "the information aggregation works" — the RFP's central thesis — is unmet. Also unbounded house risk. Emergency fallback only.
- **LMSR** — needs exp/ln in Cairo fixed-point. Days of risk for nothing FPMM doesn't give.

**Why FPMM wins:** price is locked at bet time (fixes the parimutuel defect), odds are visible and move on every trade (RFP's aggregation thesis, demonstrable on camera), it works with **one** bettor (decisive with ~12 active users/day), seeder loss is bounded by the seed (~$200/market), and the math is u256 mul/div plus one ~20-line integer sqrt. Per-bettor balances keyed by ComputeAndInvoke's pool-derived `identity_key` — the sponsor's own shipped mechanism (329 mainnet calls), no bearer keys to lose.

**Real budget:** ~700–1,000 lines of Cairo (earlier "350–500" was ~2× optimistic — veilcast's simpler parimutuel is already 528 lines), ~1,000–1,500 TS for relayer/UI. **4–6 days**, leaving time for mainnet evidence, the video, and the strk20.json traps.

**The differentiator, now proven:** only the invoke phase is once-per-transaction, so a 3-strike ladder ("above $76k? $77k? $78k?" — Kalshi's structure: independent binaries sharing a deadline) is **one transaction, one $0.285 fee**, and "claim all winnings" is one transaction. Across all ~1,248 OpenNoteDeposited events in protocol history the per-tx count is {1: all} — **nobody has ever batch-settled**. Three reverting traps to engineer around: (a) deposits returned must **exactly equal** notes created in the tx; (b) **zero-amount deposits revert** — never include a losing market in a claim batch; (c) note indices must be **sequential per channel**. And one landmine: StarkWare's own shadow_account_anonymizer approves inside the loop, so same-token batches revert on it — approve the **sum** once. Also return a bare `Span<OpenNoteDeposit>` — the HEAD tuple signature reverts on the deployed class.

## 4. The plain-English explanation (the one that must land)

Think of a **ticket machine** with two piles: UP tickets and DOWN tickets. When the hour ends, one pile is worth $1 per ticket, the other is worth $0.

I start the machine with $200, which becomes 200 UP and 200 DOWN tickets (one UP + one DOWN together are always worth exactly $1, whatever happens). The machine has one unbreakable rule: **UP-count × DOWN-count must stay 40,000** (200×200).

The market: "Will BTC be above $77,490 at 16:00?" — one hour out, line taken from Pragma at open.

You bet **$20 on UP**. Before you click, the screen shows exactly what you'll get:
- Your $20 becomes 20 UP + 20 DOWN, all dropped in. Piles: 220 and 220.
- The machine must return to 40,000, so it hands you UP tickets: 40,000/220 = 181.82 stays; you receive 220 − 181.82 = **38.18 UP tickets** at 52.4¢ each.

If BTC finishes above $77,490, your tickets pay $1 each: **$38.18 from $20**. If not, $0.

Three things a pot-style (parimutuel) market can't give you:
1. **Your deal is locked.** Ten minutes later someone bets $100 on UP; the machine gives them 156.8 tickets at 63.8¢ and the on-screen odds jump from ~55% to ~72%. Everyone sees the crowd's opinion move — that's the "information aggregation" the sponsor wants. But **your 38.18 tickets are still 38.18 tickets.** In a pot, that same $100 would have shrunk *your* payout.
2. **You can leave early.** After that move, the machine will buy your tickets back for ~$26.77 — a locked +34% with 40 minutes still on the clock.
3. **It works at 3 AM with one bettor.** The machine is always the counterparty. A pot with one bettor pays nothing; an order book with one bettor never fills.

The price ladder is just three machines side by side on the same deadline — and all three bets fit in **one** transaction and one fee, which nobody on this protocol has ever done.

## 5. Beating the rivals

- **veilcast** (the only real one): 1,320 lines, parimutuel, **35 tests, not 129** (their claim is false — say so with the clone), **zero mainnet transactions, empty strk20.json, no video** as of today. Fatal design flaw with live evidence: it resolves on a raw `get_data_median` spot read, and their own source comment (`pragma.cairo:13`) records them observing a nine-minute-stale price and shipping anyway. Given measured 20–30-minute feed gaps, any short veilcast market resolves on a wrong price. Note they do have a `committee_resolver.cairo` (281 lines) — don't claim "designated resolver" as open ground. **Beat them on:** mainnet evidence, price-locked-at-bet vs. dilution, freshness-guard + void resolution, batch settlement first.
- **blindpool**: 212 lines advertising "the order book is public" while a grep for order/bid/ask across every .cairo file returns **nothing**. Empty strk20.json, repo stale 6 days. Abu's teardown slide — "an on-chain CLOB is legal here, I proved it from the deployed bytecode, and here is the measured arithmetic for why I chose not to" — takes their headline claim off them outright.
- **oju**: 55 lines total, one 31-line health-check contract, no strk20.json. Not a rival; don't dignify it on camera.
- **The field:** of 108 projects, one is score-ready. Mainnet transactions + video + correct strk20.json beat everything. Bank transactions from day one.

## 6. Mandatory disclaimers (anti-overclaiming scoring)

1. **Never claim amount privacy.** Open notes are plaintext by construction; the sponsor scores against this. Claim: identity hidden (own relayer + per-contract identity_key), amounts and odds deliberately public.
2. **State the oracle floor plainly:** "1-minute markets are impossible on Starknet today — Pragma's median update gap is ~2–4 minutes with observed 30-minute dead periods; Pyth leaves Starknet Aug 26. Our floor is 1 hour, 15-minute is experimental with automatic void-and-refund." Honesty here is a scoring asset veilcast forfeited.
3. **Disclose the 1-hour smear:** open and close snapshots can each be up to ~30 min stale, so a nominal 60-minute market measures 30–90 minutes of real movement.
4. Say "first prediction market on ComputeAndInvoke" and "first multi-note batch settlement on mainnet" (prove the latter with one real tx before the video) — never bare "first."
5. Anonymity set is small (~12 active shielders/day); round bet denominations, don't claim strong unlinkability. Fee is **mutable** (6 STRK today, upgrade delay zero) — quote costs as "at today's fee."
6. Numbers that must NOT be quoted from earlier drafts: "49 msgs/fill" (say tens, 23–52), "$12.67/fill" ($6–13), "142 users" (≥239 registered, 76 in last 10 days), "$0.26/tx" ($0.285 median), Kalshi's "20% trimmed mean" and "188 contracts" (fabricated/unsupported — delete), veilcast's "129 tests" (35).

## 7. The one paragraph

You were right and the earlier research was wrong: an on-chain order book is perfectly legal on STRK20 — I have the deployed bytecode and a live compile proving it — but it dies on arithmetic, not physics: tens of order messages per real trade at $0.285 each on a pool with no batching of invokes and a 22-second cancel delay is $6–13 of fees per fill, which is why every real venue from Polymarket to LayerAkira matches off-chain, and why even DeepBook's own team built their prediction market **without** their order book. Your 1-minute BTC market dies on a different fact: Pragma, the only living oracle on Starknet, updates every 2–4 minutes with 30-minute gaps, so four out of five 1-minute markets would end on an unchanged price — the honest floor is one hour, and saying so out loud beats veilcast, who shipped a spot-read resolver their own comments admit was nine minutes stale. Ship the ticket machine: a constant-product UP/DOWN market where your price is locked the instant you bet, the odds move visibly with every trade, you can cash out early, and it works with a single bettor at 3 AM — ~700–1,000 lines of Cairo, 4–6 days, $200 seed per market — and ship the one thing nobody in 1,248 protocol events has ever done: a three-strike ladder placed, and later claimed, in a single $0.285 transaction. Bank mainnet transactions from day one; that alone puts you ahead of 107 of 108 projects.
