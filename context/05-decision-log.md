# Decision log

Chronological. Each entry records what changed and what caused it, so nothing gets silently reversed.

---

### D1 · Sibyl Labs is not connected to this hackathon — **CLOSED**
*21 Aug.* "Sibyl Labs" entered an early prompt by copy-paste from an unrelated brief. Abu confirmed the
mistake and asked it never be associated with STRK20. The sponsor is **StarkWare**; the event repo is
maintained by the **starkience** account. The prior Codex dossier has a long Sibyl section — **ignore
it, do not re-research it.** "Their ecosystem" always means Starknet/STRK20.

### D2 · Competitor presence is intelligence, not a veto — **STANDING RULE**
*21 Aug, Abu's correction.* Never recommend dropping a direction because a rival is building it.
Produce a teardown instead. See `04-product-vision.md` Part 1.

### D3 · Participants ≠ ecosystem infrastructure — **STANDING RULE**
*21 Aug, Abu's correction.* An earlier ecosystem list presented Troves/ForgeYields/Vesu/Endur as if
they crowded out a private-yield feature. They are sponsor protocols — integration targets, and a
scoring plus under the 30% depth criterion.

### D4 · REVERSED: "the direct-SDK route is blocked on a missing mainnet prover"
**Asserted, then proven false.** The prover exists and is healthy:
`https://transaction-prover.alpha-mainnet.sw-dev.io`. `offbook` produced **6 real mainnet pool
transactions** through it. A rival, `aperture`, **self-blocked on this same false belief** and lost
days. *Cost of the original error: potentially the sprint.*

### D5 · REVERSED: "a real card is not buildable, only simulatable"
**Refuted, high confidence.** Gnosis Pay allows individual signup with no KYB, SIWE auth, and instant
free virtual cards; Privacy.com covers the US; Holyheld has a native Starknet top-up leg. Issuer
sandboxes (Stripe Issuing, Lithic) run the *production* authorization-decisioning contract, so they are
not mocks. Root error: **absence from the sponsor's toolkit was treated as absence from the world.**
*(Moot for now — Abu has since dropped the card. Kept for the reasoning lesson.)*

### D6 · REVERSED: "cross-chain bridges are ~7 deep and too crowded"
**Refuted on its operative word.** 7 registered, **0 shipped a working cross-chain private transfer,
0 score-ready.** The organizers' own reference repo had been miscounted as a competitor. Root error:
**registrations were counted as competitors without opening a single repo.**

### D7 · REVERSED: "the Wallet API is the lowest-risk route"
True for a dapp, **false for a wallet.** `types-js` has no registration action, no note listing, no
history, and never exposes the viewing key. A wallet must use the SDK route with a self-custodied
in-browser derived account.

### D8 · Abu dropped yield, savings, the card, and the AI-agent/MCP framing
*21 Aug, Abu's call.* *"Forget about those yield and everything I told you earlier on."*
Not to be reinstated unless he says so.

### D9 · Abu rejected depending on third-party ecosystem protocols
*21 Aug, Abu's call.* Build our own helper contracts rather than integrate Vesu/Endur/Troves.
**Noted exception the agent flagged and Abu has not yet ruled on:** the **paymaster** is not an
optional integration — Ideas 04 and 07 both stake their core privacy claim on it
(*"Buyer identity — Hidden: Yes — paymaster submits all tx"*). Without it the buyer's address is the
transaction sender. **OPEN.**

### D10 · Idea 17 is not buildable; Idea 04 is — **SETTLED BY EVIDENCE**
Idea 17 names Enclave, Chain Abstraction and Private Sub-Accounts — none shipped. **"Enclave" does not
exist anywhere in the protocol.** Idea 04 names only shipped primitives, and its own hidden/visible
table honestly admits open notes are plaintext. The two RFPs contradict each other on the same
mechanic. Idea 04 was written against the shipped protocol; Idea 17 against a roadmap.

### D11 · Process: superpowers, architectural path — **AGREED**
*21 Aug, Abu's call.* Brainstorming → written spec → writing-plans. Not BMAD.
Classification: **architectural** (greenfield, multiple surfaces).

### D12 · Agent failure: no documentation until now — **CORRECTED**
Four workflows and 27 agents of research produced zero files in the repo. Abu flagged it three times
before it was fixed. Every round also ended in proposed amputations, when he had repeatedly said the
scope decision was his. **The `context/` folder exists as of this entry.**

### D13 · Messaging is a real CHAT APPLICATION, not a memo field — **ABU'S CALL, SETTLED**
*21 Aug.* The agent had inferred memos on cost grounds (~9.1 STRK/tx makes standalone messages
expensive). Abu rejected it, three times in one message: *"I don't want this to be like a memo…
It needs to be like a standard stuff"*, *"it's more of a chat application, not just a memo."*
The RFP backs him: Idea 01 says **"persistent channels"**, **"encrypted on-chain mail between any two
privacy-pool participants"**, and **"a reusable substrate"** — a memo field is the *second* bullet in
that RFP, not the product. **The cost problem is now an engineering problem to solve, not a reason to
shrink the product.** Closes open question 3.

### D14 · Prediction market is IN — **ABU'S CALL, SETTLED**
*21 Aug.* *"The prediction market is not left out of it, of course."* His earlier doubt (*"he didn't
even talk about the prediction markets in the RFP"*) was mistaken — Idea 07 is one of the five RFPs in
`../rfps.md`. He also leans toward oracle-priced resolution: *"I don't know how the prediction market
would be by oracle prices, which I probably recommend it"* — which matches the RFP's own line,
*"Per-market oracle binding (Pragma for prices, designated resolver or DAO vote for non-price
outcomes)."* Closes open question 2.

### D15 · D9 AMENDED: improvising with third-party tools IS allowed where the sponsor's primitive
does not exist — **ABU'S CALL**
*21 Aug.* Verbatim: *"I know for a fact that some stuff might not exist… We can improvise in those
ways and use other ecosystem, use other tools or something, other libraries, even aside from this
thing. That's allowed too… and it definitely works."*
**But with a hard limit, also his:** *"I don't want you making compromises in the sense that you will
not now use their tools, like at all, at all, where we're supposed to be relevant. For instance now in
the wallet part."*
So the rule is now two-sided: **substitute where the sponsor shipped nothing; never substitute where
the sponsor's own tool is the relevant one.** Integration depth is 30% of the score.
This reopens Idea 17 (blocked in D10 on the non-existent "Enclave") for re-examination under
substitution. **It does NOT reinstate anything dropped in D8.**

### D16 · Deadline is not a scoping constraint — **ABU'S CALL**
*21 Aug.* *"Deadline is not an issue. I'm already locked in with this project."* Closes open
question 5. Scope decisions remain his (see D12). Do not propose amputations on time grounds.

### D17 · Design and "what does the app open on" are DEFERRED — **ABU'S CALL**
*21 Aug.* *"For the screen now, our novice design part, you don't need to really worry about it yet…
I'll have a designer once we have talked all these projects through."* Open question 1 (center of
gravity: wallet-first vs venue-first) is **deferred, not answered** — it is a design decision for the
designer, downstream of settling what the app contains.

### D18 · Account model: app-derived account is the DEFAULT, Ready is an optional upgrade —
**ABU'S CALL**
*21 Aug.* A cold visitor gets a browser-derived account on arrival and can transact immediately.
Connecting Ready wallet is an **upgrade path for people who already hold funds there**, never a
turnstile.

> **⚠️ AMENDED SAME DAY — "and can transact immediately" is FALSE, and this is not a detail.**
> Verification found a **bootstrap deadlock** on live mainnet: `open_channel` asserts
> `RECIPIENT_NOT_REGISTERED`, so an unregistered address **cannot be paid**; the paymaster's fee is a
> withdraw from your **shielded** balance, which a fresh account does not have; and `collect_fee` pulls
> 6 STRK from **whoever submits**. A brand-new account therefore cannot register, cannot be funded, and
> cannot bootstrap itself. The *choice* Abu made stands — app-derived account as the default identity —
> but it needs a **sponsored first transaction** (Abu's own relayer paying the registration), not a
> self-service one. See `07-gate-and-traps.md` §2.1 and §2.3. **Unresolved: exactly how the first
> transaction gets paid for a cold visitor.** Rejected: "Ready required" (collides with the login-free elimination gate; Braavos users
are locked out since Braavos verifiably does not support STRK20) and "app-native only" (forfeits the
works-with-your-existing-wallet point).

Three consequences that follow and are now settled with it:

1. **Never custodial.** Not taste — scoring. Idea 01 sells *"no trusted server"*; a key-holding
   design hands judges a free hit against the 30% integration-depth criterion. Live evidence: field
   intel records rival `kese` as *"architecturally stuck behind a key-holding design"*, `verified_txs: 0`.
2. **"Connect wallet" and "passkey login" are not alternatives.** They are two doors into the same
   room, and the room is the **viewing key**. Model it once as data, on the shape of Uniswap's 860-LOC
   accounts store (`AccessPattern {Native, Injected, SDK}` × `SigningCapability {None, Interactive,
   Immediate}`). Every feature then asks *"do I have a viewing key, and can I sign?"* and never
   *"which wallet is this?"*
   **⚠️ AMENDED 21 Aug by verification — the mechanism was wrong.** The viewing key must **NOT** be
   derived from a wallet signature. The registered key is **WriteOnce-immutable with no rotation path**,
   and 46 of 51 measured mainnet registrants are Ready smart accounts spread across **two class
   versions** — proof that account upgrades happen while a viewing key is registered, which would
   permanently orphan the user's notes. ~35% already have a guardian, and `change_owner` /
   `escape_owner` / upgrade all mutate the signature. **Use a locally-generated key with an explicit
   user-held backup.** The two-doors framing survives; "derive it from the signature" does not.
   See `07-gate-and-traps.md` §2.2.
3. **Idea 10 is not the sixth piece — it is the floor the other five stand on.** Its four deliverables
   (register a viewing key on first use · publish a receive address · run discovery against the
   viewing key · send as Withdraw/CreateEncNote) are each a *precondition* for private swap, betting,
   launch participation, bridging and chat. So "remove the umbrella wallet" was never really on the
   table. What remains open is only whether it gets a loud tab or is simply the substrate — and that
   is a **design** question, deferred under D17.

### D19 · Bank the elimination gate FIRST, in week one, with a small helper — **ABU'S CALL**
*21 Aug.* Deploy a small contract early, push **≥3 real mainnet transactions through it**, and close
the gate before the interesting version is written. Rejected: building the real product first and
banking transactions as they come (unscoreable until the first real helper works, and the gate is
all-or-nothing).
Rationale from evidence: exactly **one of ~110** entrants has cleared the gate; **airlock** has 3 real
pool transactions that route through none of its declared contracts and therefore **scores 0**; and
`README.md` line 86 requires that once you deploy any contract, qualifying transactions must have
*"run through one of yours."*
**Mine-rule procedure:** keep `contracts: []` until transactions are banked, then add the router
address **in the same commit** as the transactions routed through it. The verifier passes a transaction
matching **any** declared contract, so listing two router versions is safe.

### D20 · Next artifact: full sectioned design, then the written spec — **ABU'S CALL**
*21 Aug.* Follow the agreed architectural path (D11): sectioned design with approval per section →
spec at `docs/superpowers/specs/` → implementation plan. Rejected for now: reading all 26 RFPs together
first, and speccing only the risky bits.

### D21 · Foundation layer approved; `MessageBook` is the week-one gate helper — **ABU'S CALL**
*21 Aug.* Design Section 1 accepted: (a) identity is a **locally-generated key with explicit encrypted
backup**, never wallet-signature-derived, with a `ForeignKey` state guarding the
already-registered-elsewhere collision; Ready is a **funding rail, never an identity**, and the UI shows
**exactly one address** — the private receive address. (b) We run **our own relayer** (~150 LOC TS + one
funded account) implementing the sponsor's injectable `Paymaster` interface — it simultaneously fixes
the bootstrap deadlock, delivers sender anonymity, keeps any third-party API key out of the public
bundle, and is on-spec per Idea 03. (c) A **pre-registered, pre-funded demo persona** with a published,
clearly-labelled viewing key is a **gate item**, and it turns the auditor-escrow disclosure into the
demo mechanic.

**Refinement to D19, accepted:** the week-one gate contract is the **real `MessageBook`
(~130–170 Cairo lines)**, not throwaway scaffolding — it is the only surface **immune to the coming
default-deny screening flip** (a zero-deposit invoke sets no screening subject), its zero-value invokes
cannot revert on balances or allowances mid-demo, and the chat app needs it regardless.

**Two things must be proven on mainnet before anything is built on them:** the relayer, and a
`ComputeAndInvoke` round-trip through our own helper.

### D22 · Contract architecture: FOUR separate contracts, minimal unification — **ABU'S CALL**
*21 Aug.* Design Section 2 accepted. **A six-mode unified router was rejected on evidence**, reversing
the natural reading of `02-verified-technical-facts.md`: merging contracts does **not** merge invokes
(the pool allows one invoke-phase action per transaction either way), so a monolith buys **zero**
atomicity while costing (a) **unlinkability** — `identity_key` is scoped per `contract_address`, so one
contract means one stable pseudonym across every merged mode — and (b) **blast radius** — a stateful
multi-mode contract holding balances or standing allowances is drainable by an anonymous caller.

| Contract | Cairo LOC | State | Caller guard |
|---|---:|---|---|
| `MessageBook` | ~170 | append-only ciphertext by tag | permissionless OK |
| `ValueRouter` | ~330–400 | **none** | — (stateless) |
| `PredictionMarket` | ~450–640 | per-identity positions | **`assert(caller == pool)`** |
| `LaunchRouter` | ~380–620 | per-identity allocations | **`assert(caller == pool)`** |

**Unify only where two effects must land in a single invoke** — exactly two combinations exist:
`TRANSFER_WITH_MEMO` (Idea 01's payment memo, which separate helpers provably cannot do) and
`BRIDGE_FORWARD` (verified: swap → public payout **is** one transaction).

**Non-negotiable security rules:** stateless helpers keep no storage, no balance, **never leave a
standing allowance**, and assert own end-of-call balance is zero; any helper with per-user state must
`assert(get_caller_address() == pool)`.

**Honest consequence to publish, not hide:** because `identity_key` is per-contract, **no unified
cross-surface portfolio exists on-chain**. The "one private account" view is a client-side
reconstruction from the viewing key. That is also the *correct* design — the alternative is a stable
cross-surface pseudonym, which is what users come here to avoid.

### D23 · All six surface designs approved; bridge research pass commissioned — **ABU'S CALL**
*21 Aug.* Design Section 3 accepted in full:

| Surface | Design | RFP |
|---|---|---|
| **Wallet** | The substrate, not a product. Register → publish receive address → discovery → Withdraw/CreateEncNote. No new contracts | Idea 10 |
| **Chat** | **"Free Room"** — pool-rooted ECDH costs **nothing** (both public keys are already on-chain); off-chain encrypted transport; chain does open / seal / pay. Plus **"Sealed Send"**, one on-chain message ~$0.25, as the evidence path and the thing filmed | Idea 01 |
| **Swap** | `ValueRouter.SWAP` — canonical sandwich, **venue pinned at deployment** (an arbitrary `Span<Call>` is the drain hole), AVNU routing API for multi-hop. **Not** `EkuboSwapAnonymizer` (single-hop, full-fill-or-revert, never invoked on mainnet) | IDEAS.md IDEA-01 |
| **Prediction** | **Parimutuel + Pragma + `ComputeAndInvoke`.** No market maker, no liquidity bootstrap, no losable coupon. Ownerless resolution. CLOB **named in the README as rejected**, citing the phase rule | Idea 07 |
| **Launch** | **Denominated epoch clearing.** ~30-block epochs, one clearing price each, six public denominations. Being first inside an epoch is worth nothing. Router-owned LP on graduation | Ideas 04 + 17 |
| **Bridge** | `ValueRouter.BRIDGE_FORWARD` via OutboundAnonymizer + CCTP v2. ~~EVM only — Solana unreachable~~ **CORRECTED, see D24: Solana IS reachable and proven in production** | Idea 22 |

**Two honesty items that ship in the UI, not just the README:** launch privacy is
**indistinguishability, not encryption** — so the per-denomination anonymity-set count is displayed on
screen; and amounts in any open-note leg are public.

**Bridge research pass commissioned** — it was the one surface with no dedicated research, and speccing
it from imagination was refused. 11 agents on CCTP v2 mechanics and failure modes, the two anonymizers'
real source and ABIs, a hostile-analyst unlinkability teardown, the EVM-side UX, and a rival teardown
with a line-by-line deliverability verdict on Idea 22.

### D24 · Bridge: OUTBOUND-ONLY, with the fresh-Solana exit as the differentiator — **ABU'S CALL,
21 Aug**
*21 Aug.* The commissioned bridge pass (11 agents) returned, and it **overturned three things this
repo previously asserted** — recorded in `09-bridge.md` §0:

1. **Solana is NOT unreachable.** 270 all-time Starknet→Solana CCTP burns, 8 with the byte-identical
   `cctp-forward` hook, **all `forwardState=COMPLETE`**, delivering in **9–16 s**. The real gap is
   narrow: a *fresh* Solana wallet has no USDC Associated Token Account and delivery reverts without
   one. StarkWare's own contract hardcodes a zero-payload hook and **structurally cannot** request ATA
   creation — **Abu's own helper can**, via Circle's 65-byte extended V0 hook (+~$0.185).
2. **The "live video is impossible" claim was overstated** — block time is **1.73 s**, so a single
   crossing is filmable live. A full six-surface run is not.
3. **A live `ShadowAccountAnonymizer` is deployed** (`0x4f33230d…`, 39 mainnet calls) — but it is an
   auth primitive, and unlinkability does **not** come from it.

**StarkWare ships a public Apache-2.0 reference implementation** at `starkware-libs/privacy-bridge`,
pushed 20 Aug. Do not reinvent it.

**Recommended scope:** outbound only. Marginal cost is **~90–115 Cairo lines** on top of the
`ValueRouter` already being built, plus ~400 TS. It is proven, demoable **login-free** (type an
address, press send, watch real USDC land — no wallet needed), gas-free at the destination because
Circle's Forwarding Service pays it, and a Solana-first fresh-wallet exit **beats every rival and
StarkWare's own deployment, which has only ever exited to Polygon.**

**INBOUND is explicitly OUT of the minimum** — it needs a forked contract for the mine rule, mandatory
relayer liveness, a live fund-stranding footgun, ~1,700 LOC of pending-state recovery, and it **cannot
be demoed login-free.** Stretch goal only, after the five surfaces and the three gate transactions are
banked. Verdict's words: *"it is where the week dies."*

**The pitch must change with it.** Sell **"a private, chain-abstracted exit with honest linkability
disclosure"** — never "an unlinkable bridge." At current pool volume the unlinkability claim is
genuinely weak: **26 addresses shielded USDC in the last 10 days, 6 in the last 24h, median 1 candidate
funder in the hour before an exit, and the largest crossing ever through the reference helper was
45 USDC.** A crossing above ~50 USDC is a unique fingerprint by itself. **Putting that real number on
screen as a "linkability meter" converts the worst finding into the most differentiated surface.**

### D25 · Clarifications from Abu's walkthrough review — **ABU'S CALL / ANSWERED**
*21 Aug.* Abu asked for a plain-language walkthrough before any spec was written, and raised four
things. Recorded so they are not re-litigated:

**(a) Prediction market — what kind of betting, answered.** Abu asked directly what "order book" means
and what we are actually building. **We build parimutuel** — everyone backing an outcome pays into
that outcome's pot; winners split the whole pot; the odds *are* the pot split. No market maker, no
liquidity to fund, bettors are each other's counterparty. **An order book is structurally impossible
here** and this is not a research gap: a fill needs two parties' value to move in the same instant, and
the pool permits **one app-action per transaction**, so a match cannot be atomic — plus resting orders
would need a paid transaction to post *and* to cancel. (Rival `blindpool` advertises a public order
book its 212-line contract does not implement.) **Abu's own instinct was correct**: price questions
— *"will BTC be above X at time T"* — are the primary mode, resolved automatically by **Pragma** with
no human in the loop; a named public jury panel is a clearly-labelled second tier for event questions.

**(b) "Overclaiming" explained.** It means claiming more privacy than the product delivers. It matters
because StarkWare scores against it *by name* — *"Be especially precise about what is and isn't
private — overclaiming costs you on integration depth"* — and integration depth is **30% of the
score**. Precision is worth points; it is not a compliance chore. Abu's own plan for a **separate docs
package** (architecture, diagrams, end-to-end, readable by developers and non-developers) is the right
home for most of it — with the addition that the disclosure must **also appear in the interface at the
moment of action**, which is where no rival is operating.

**(c) Bridge "in" vs "out" is about DIRECTION, not which wallet.** *Out* = value already private inside
the pool exits to an address on another chain (proven, 432+ mainnet burns). *In* = value on another
chain enters the pool and becomes private (technically live, but for us needs a forked contract,
relayer liveness, a fund-stranding footgun, and **cannot be demoed login-free**).

**(d) NEW — Abu's bridge-destination UX question exposed a real privacy trap, and the answer is now a
feature.** He asked whether the destination should default to the user's connected EVM wallet, since
it is the same address. **It must not.** A user who bridges to their own connected wallet destroys the
privacy they just paid for — they deposited publicly, and value now arrives publicly at an address
known to be theirs. **Design decision: default to a fresh address, allow pasting any address, and —
because the app knows which wallet was connected — actively detect and warn when the pasted
destination would self-link.** This goes in the disclosure panel. No rival has it.

### D26 · PRODUCT, not demo — a standing requirement — **ABU'S CALL**
*21 Aug.* Verbatim: *"Normally, I build my application like a product, not a demo… for every
first-time user we'll have an onboarding flow… I also think that you should think about even where I
do not mention onboarding, more stuff like that, so everything does all kinds of feel premium. It makes
out of that demo nature and into a product."*

**This reframes the login-free requirement.** It had been treated as a gate to pass; Abu treats it as a
**first-time user experience**, which is a different and harder design problem. The same flow must be
simultaneously a real product's first-run **and** the login-free demo, **and must not feel like a demo
mode.**

Scope explicitly extends beyond what Abu named: onboarding, empty states, error recovery, key loss,
first-run education, waiting states, and **the invite flow** — which may be the single highest-value
feature in the product, because only ~142 addresses are registered protocol-wide and **you cannot pay
an address that has not registered**. A user's first real action is often impossible because their
counterparty does not exist yet.

**Confidential voting / DAO remains a STRETCH**, consistent with Abu's earlier *"that can be an MVP…
maybe later, because at least let all this stuff be in place first."* Two relevant RFPs exist
(`private-governance-delegation`, `private-dao-treasury-os`) and a rival already has a live governance
helper on mainnet. Parked unless Abu reinstates it.

**Deliverables Abu asked for, without further questions:** a **design artifact** he can react to, and a
**detailed project prompt** he can hand to a design tool cold. He said explicitly: *"I don't want you
to disturb me"* — produce them, then talk.

### D27 · Visual direction: **LEDGER** — **ABU'S CALL**
*21 Aug.* Chosen from four rendered directions (Graphite / Ledger / Vault / Clinic).

| Role | Light | Dark |
|---|---|---|
| Ground | `#FCFAF6` warm paper | `#14110D` |
| Raised | `#FFFDF9` | `#1C1813` |
| Inset | `#F4F0E8` | `#221E17` |
| Ink | `#211A12` ink-brown, never pure black | `#F5EEE4` |
| **Accent** | **`#8C2F1E` oxblood** | `#E87B60` |
| Settled | `#2E6B35` | — |
| Exposed | `#7A5A00` | — |
| Irreversible | `#A32318` | — |

**Why it works:** it reads as a private bank statement rather than as software, which is the correct
register for a product about money and discretion — and warm paper with oxblood is a register almost
nobody in this space uses, so it cannot be mistaken for a Uniswap fork.

**The risk, stated up front:** this was flagged as *"highest ceiling, and the highest risk if the type
is wrong."* A warm editorial palette is unforgiving of a poorly-chosen typeface in a way that a neutral
grey one is not. **Typography is now the single highest-leverage design decision left** — it should be
the first thing settled with the designer, ahead of layout.

**Standing rules carried with it (Abu's):**
- **Real brand logos everywhere** a token or chain appears — Bitcoin, USDC, Ethereum, Base, Arbitrum,
  Polygon, Solana — drawn as vector. A fabricated token icon is the fastest way to make a product read
  as a mockup.
- **Light mode is the default**; dark ships alongside it, not as an afterthought.

**Disclosure panel, rebuilt and accepted:** three parts — *what leaks* (plain sentences with a
red ↗ / green ✓ marker) · *who can read it* (the matrix, including the auditor column) · **a way out**
("Use a fresh address") as a real button. The v1 panel delivered bad news and left the user there; a
disclosure that offers the safer path is a feature, an obstacle is not.

**Also accepted:** the market card now prints the payout in words — *"$10 on yes returns $33.33"* —
which explains pot-split betting better than any label.

**Kept unchanged from v1** on Abu's explicit approval: the five-step send progression, the `SETTLED`
tag, and money rendered inside the chat thread.

Artifacts: v1 direction `https://claude.ai/code/artifact/326d58cb-50bc-4947-bc98-f83cb327e924` ·
four directions `https://claude.ai/code/artifact/2d124854-f0ae-4f30-8289-5e974acb5850`

### D28 · Prediction market: **FPMM binary UP/DOWN, 1-hour flagship** — Abu's challenge was correct
**twice** — *PROPOSED, awaiting Abu*
*21 Aug.* Abu pointed at DeepBook and rejected the "order book is structurally impossible" claim. He
was right, and the research also vindicated his confusion about parimutuel. Full detail in
`12-prediction-mechanism.md`.

**(a) The "structurally impossible" claim was PLAINLY WRONG.** It confused *one invoke per transaction*
with *one value movement per transaction*. Verified three ways against the **deployed** mainnet class
(tag `CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08`, commit `74841caf` — cite the tag, not `main`, which has
ABI drift): `assert_and_advance_phase` only gates phase 7, so N×UseNote / N×CreateOpenNote / M×Withdraw
are all legal in one transaction; `privacy.cairo:999` loops `for deposit in deposits` over a
`Span<OpenNoteDeposit>`, so **one invoke may credit N notes**; and `compile_actions` — a free public
view running the real client compiler — successfully compiled **100 notes + 1 invoke**, with negative
controls confirming the harness was real. The custodial CLOB Abu described is **legal**.

**(b) But DeepBook itself settles the argument.** **Mysten Labs built the best fully on-chain CLOB in
existence and did NOT use it for their own prediction market.** `packages/predict/Move.toml` has zero
`deepbook::` imports. DeepBook Predict is peer-to-pool and oracle-priced — 1-minute BTC up/down, which
is precisely the product Abu described. *(Sui's marketing blog claims otherwise; the source does not.)*

**(c) The real blockers are economic and privacy, not structural.** Measured on live DeepBook mainnet:
**~23–52 order messages per fill** (quote as "tens", never "49"). At STRK20's **median 10.13 STRK ≈
$0.285 all-in** per transaction that is **$6–$13 of fees per fill** on $5–$50 bets — versus ~2¢ on Sui,
which has PTB batching and 98.6% storage rebates on cancel. STRK20 has neither. A maker also cannot
requote faster than **~22.7 s**, about 90,000× worse than Polymarket's 250 ms. Separately, a taker
paying a maker atomically requires opening a channel, which writes the maker's address as a
**plaintext storage key** — deanonymising exactly what Idea 07 scores on hiding.

**(d) ⚠️ The 1-minute market is physically impossible — because of the ORACLE, not the proofs.**
Pragma's BTC/USD updates in publisher batches with a **median 120–220 s gap** (max ~30 min). Share of
windows containing at least one update: **1 min ≈ 13–19%** · 5 min ≈ 42–53% · 15 min ≈ 76–84% ·
**1 hour ≈ 100%**. Menu: **BTC / ETH / STRK, 1-hour flagship**, plus 1-day and 1-month; 15-minute as an
explicitly experimental tier with a void-and-refund rule; **nothing shorter**. Other pairs are not
registered.

**(e) 🚨 TIME-CRITICAL: Pyth sunsets Starknet on 26 AUG 2026 — five days before the deadline.**
Chainlink is Sepolia-only. **Pragma is the only live oracle**, its checkpoints are 23 h stale, and its
documented SummaryStats/TWAP contract **is not deployed**. Settlement must snapshot
`get_data_median` + `last_updated_timestamp`, require freshness within ~120 s, else void and refund.
Useful: `set_checkpoint` is **verified permissionless**, so Abu can pin his own settlement checkpoint.

**(f) Mechanism: FPMM (constant-product AMM), not parimutuel.** **Abu's confusion about the $700/$300
explanation was a real defect, not a bad explanation** — in a pot, late money dilutes early bettors
(a $20 early bet can lose 6× of its payout to late piling-in) and you never know your payout when you
bet. FPMM fixes exactly that: **your price is locked at bet time**, odds still move visibly on every
trade (the RFP's aggregation thesis, demonstrable on camera), **you can exit early**, and it works with
**one** bettor — decisive at ~12 active users/day. Seeder loss is bounded by the seed (~$200/market)
and the math is u256 mul/div plus a ~20-line integer sqrt. Rejected: CLOB (economically dead), LMSR
(needs exp/ln in Cairo for no gain), house fixed-odds (odds become an admin constant, killing the RFP's
thesis). Parimutuel retained only as fallback.

**(g) The differentiator, now proven.** Because only the *invoke* phase is once-per-transaction, a
**3-strike ladder** (Kalshi's structure — independent binaries sharing one deadline) is **one
transaction, one $0.285 fee**, and "claim all winnings" is one transaction. **Across all ~1,248
`OpenNoteDeposited` events in protocol history the per-transaction count is 1 — nobody has ever
batch-settled.** Four traps to engineer around: deposits returned must **exactly equal** notes created;
**zero-amount deposits revert** (never batch a losing market into a claim); note indices must be
sequential per channel; and return a **bare `Span<OpenNoteDeposit>`** — the HEAD tuple signature reverts
on the deployed class.

**Budget correction:** **~700–1,000 Cairo lines**, not the earlier 350–500 (~2× optimistic; veilcast's
*simpler* parimutuel is already 528 lines), plus ~1,000–1,500 TS. **4–6 days.**

### D29 · Design spec APPROVED — **ABU'S CALL**
*21 Aug.* *"The specs looks good to me."* The written spec at
`docs/superpowers/specs/2026-08-21-strk20-design.md` is **accepted** and is now the authority for
implementation. It consolidates D13–D28 across twelve sections: product and surfaces · identity ·
relayer · contracts · markets · bridge · app shell · design · product experience · evidence and the
gate · claims never to make · open questions.

One clarification was requested and folded in as **§3.1**: Abu flagged *"the UI must not say 'your
address never appears'"* as unclear. Rewritten to explain that every Starknet transaction publicly
shows its submitter, so the claim is only true once the relayer works — with the honest interim
sentence to ship instead, and the general rule stated: **never promise a privacy property in the
interface before the mechanism that delivers it is proven.**

**Next step:** implementation plan (D11's agreed path — brainstorm → spec → writing-plans).

**Repo note:** `stacks-20` is **not yet a git repository**. The competition requires a public
repo with an OSS licence as an elimination-gate item, so `git init` is a prerequisite, not a
nicety — and history should exist before any contract is deployed.

### D30 · Networks: build-time constant, config not env vars — **ABU'S CALL**
*21 Aug.* Abu asked for mainnet/testnet support and corrected the approach twice: **(i)** don't build
before the spec covers it — *"we have to have a conversation about this. You don't go ahead and start
building"*; **(ii)** *"instead of environment variables like that, you do it as a constant and a config.
That's a much cleaner approach instead of bombarding every with environment variables."* Both correct;
an earlier draft task had `process.env.*` scattered through the deploy script.

**Settled:** network **selection is a build-time constant**; there is **no runtime network switch in
the shipped app**, because the gate depends on a judge seeing real mainnet state. Network *parameters*
live in a typed constant object per network (facts about a network, reviewable and diffable in version
control). **Environment variables are reserved for secrets only** — the deployer key and the relayer
key, nothing else. Spec §3.2.

**Verified about Sepolia, 21 Aug — after Abu pushed back on a weak first answer.** An initial pass
concluded "the address is unpublished, ask the sponsor via GitHub issue." Abu challenged it directly:
*"have you done enough research in that aspect just to make sure that you found them?"* He was right —
that was giving up, not exhausting the avenues, and several of the "empty" results were **`timeout`
not existing on macOS**, so the shell was failing silently rather than the data being absent.

**Corrected finding: there is NO publicly-addressable STRK20 pool on Sepolia, and asking the sponsor
would not have produced one.** Evidence: the entire `sdk/` + `client/` source contains **exactly one
long hex constant** — the STRK fee token `0x04718f5a…c938d`, identical on every network; `poolAddress`
and `poolClassHash` are **runtime parameters** (`requireEnv("VITE_POOL_ADDRESS")`), never constants;
the sponsor's demo ships **`demo/src/hooks/useDeployPool.ts`**; the Sepolia discovery service **404s**;
and their own dev chain decodes to `SN_INTEGRATION_SEPOLIA` with localhost services. The changelog's
"pinned class hashes for SN_MAIN and SN_SEPOLIA" describes behaviour where **the application supplies
them**. The Sepolia **prover** is genuinely live (POST → 200).

**Consequence — the recommendation inverts.** We could deploy our own Sepolia pool via the sponsor's
`e2e/scripts/`, but we would then be testing against **our** pool rather than the one being scored.
**Keep the config layer; do not stand up a pool.** `compile_actions` validates against the real
deployed mainnet contract for free — no drift risk, no setup day — and real transactions cost ~$0.25
on the network that counts.

**Four testing layers, cheapest first:** `snforge` (free) → **`compile_actions` on mainnet (free — a
public view running the real client compiler against the actual contract being scored)** → Sepolia →
mainnet. `compile_actions` is *strictly better than Sepolia* for action-list validity.

**Two guards, both mechanical:** refuse to write a non-mainnet address into `strk20.json` (rival `veyl`
scores zero for exactly this), and fail the build if `ACTIVE_NETWORK !== 'mainnet'` in a production
bundle. **Oracle asymmetry:** Chainlink on Starknet is **Sepolia-only**, so anything oracle-touching is
validated against mainnet reads even during development.

---

## Still open
- Swap: which venue, and is it first-class? Abu believes there is a **private-swap RFP he never
  saved** — *"I know I didn't document all the RFPs"*. Being checked against the live site.
- Paymaster exception to D9 (now also read against D15)
