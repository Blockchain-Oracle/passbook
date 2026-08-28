# Houses — private DAO governance and delegation for Passbook

**Status:** research + architecture spec from the governance worktree (walk 3). No code here; this
document is the deliverable, written to be merged into main and argued with. **RFP:**
`private-governance-delegation` (site "Idea 26"; registry tag **IDEA-27** — the sponsor's `IDEAS.md`
numbers it 27, and `inspired_by` takes IDEAS.md IDs. Note the site number and the IDEAS number
differ; use IDEA-27).

**Abu's ask (28 Aug, voice):** understand the RFP; study how real governance products work — his
reference "Knoxville / Knox votes" is identified below as **Nouns votes** (nouns.wtf/vote and the
Nouns Camp client: proposals that, when passed, execute on-chain); get creative on add-ons (user
tokens, usernames, invite-only, delegation, quality-of-life); redesign the token surfaces to the
Uniswap explore / token-detail standard, from source; bring IPFS in for logos and metadata.
His answers to the open questions, from the same notes: voting weight — *"anything that works"*
(decided in §9.4); scope — settled here as one story, stretch marked.

Provenance: `context/02-verified-technical-facts.md` and `context/07-gate-and-traps.md`
(live-mainnet-verified), a 28-Aug web research pass (Nouns/Tally/Snapshot/Shutter/MACI/Cicada/
Snapshot X/OZ Cairo/IPFS providers), the sponsor's registry (`reference/hackathon/projects.json`),
OpenZeppelin Cairo docs via Context7, a full sweep of this repo's shipped primitives, and a full
sweep of the `reference/uniswap-interface` source. Items marked **PROBE** must be proven with one
cheap transaction before the architecture is final.

---

## 1. What the sponsor is actually asking for

The RFP, compressed to its five checkable demands:

1. **Secret-until-close voting** — ballots sealed while the window is open; only the aggregate is
   revealed at close. Kills bandwagon voting and whale signaling.
2. **Permanently-private mode** — for sensitive votes, *only* the aggregate is ever surfaced; the
   per-voter breakdown never becomes public.
3. **Private delegation** — a holder lends weight to a delegate; the public never learns the
   holder→delegate edge. *"A holder delegates 5M tokens; the delegate votes with that weight; the
   public never learns the source."*
4. **Verifiable outcomes without a trusted counter** — anyone can check the revealed result is a
   correct aggregation of eligible, non-double-counted ballots.
5. **Sybil-resistant eligibility** — one holder cannot split into many voters or vote twice, even
   though ballots stay confidential.

Plus, verbatim: *"Viewing keys let a governance committee or auditor reconstruct the full ballot
book under authorization without exposing it publicly."* The RFP itself blesses an authorized-audit
lane — that matters for §6.2.

**The differentiation the sponsor hands us:** Shutter (881+ DAOs, 372,914 votes encrypted) is
threshold-encryption *timelock* — after reveal, every voter's address, choice, and weight is public,
and the delegation graph stays fully transparent. Shutter has *announced* permanent shielded voting
via homomorphic encryption; it is blog-stage, not shipped. **Both gaps the RFP names — permanent
privacy and private delegation — are still open in the wild.**

## 2. The verified facts that shape the whole design

From `context/02` / `context/07`; they override the RFP's prose where they conflict.

1. **The Enclave does not exist.** Zero occurrences across the sponsor's 595-file protocol tree;
   8 of 26 RFPs share the same unbuildable prose. The sponsor's *shipped* substitute is
   **`ComputeAndInvoke`**: the pool derives `identity_key = f(user_addr, user_key, helper_addr)`
   and injects it as argument 0 of the helper's `privacy_compute`. A per-user, per-helper handle
   that the House does not store beside an address, is unforgeable, and is scoped to our contract.
   **That is a native address-disconnected voter-registration primitive** — for governance, better
   than an enclave, but not a reason to call the whole transaction anonymous.
   329 mainnet calls across 7 helpers all-time; zero in this repo so far (§10.4, PROBE-1).
2. **Open-note amounts are public by construction; identity is what the pool hides.** The sponsor's
   own line: *"Claim identity privacy; never claim amount privacy."* So ballot *weights* can be
   public per-ballot while the House record omits the voter's address. The shipped relayer remains
   the visible transaction submitter and sees the request's network metadata.
3. **`identity_key` is scoped per contract.** The same user is a different handle at Launch,
   Markets, and the Governor — votes can't be linked to launch buys even by us, and weight cannot
   be *proven* across helpers. Weight must therefore arrive as real value (notes), not as a
   cross-contract balance claim.
4. **Structure:** at most one invoke-phase action per transaction; every invoke needs a WriteOnce
   companion; a phase-6 withdraw can fund the phase-7 invoked contract in the same transaction
   (the shipped Markets bet leg does exactly this); helpers are permissionless (default-allow
   blocklist today — future screening-policy risk for value-bearing legs, §15).

## 3. Prior art, and the tradeoff we accept — named, not hidden

Every private-voting system in production or research accepts at least one of four tradeoffs:

| System | Mechanism | The tradeoff it accepts |
|---|---|---|
| **Shutter** (live, 881+ DAOs) | threshold encryption, reveal at close | committee can decrypt early; **everything public after reveal**; no delegation privacy |
| **MACI** (live for QF rounds) | encrypted messages + trusted coordinator + zk tally proof | **coordinator sees every ballot** (but cannot forge the tally) |
| **Cicada** (a16z, research) | homomorphic time-lock puzzles | trustless but only running-tally privacy; ballots computable after close |
| **Nouns sprint / Aragon+Aztec zk-POPVOTE** (PoC) | storage-proof census + encrypted ballots + zk aggregation | heavy proving, executor reveal role; never productionized |
| **Vocdoni / DAVINCI** | zk census on own chain / zkRollup | trust their chain; civic-scale, not token DAOs |

**Ours: MACI's trust shape on STRK20's primitives, with the tally check moved on-chain.** A
**Teller** (our service, a sibling of the shipped relayer) holds the per-proposal tally key. The
Teller *can peek early*, and in permanently-private mode it *learns* individual sealed ballots
(keyed to per-contract handles rather than addresses in House storage). It **cannot forge a
tally** — the contract itself verifies the published sums against an elliptic-curve accumulator
and rejects anything else (§6.3). It **cannot censor** — ballots enter through the permissionless
pool, not through us. Disclosed in the product's who-sees-what panel like every other Passbook
boundary (`packages/protocol/src/visibility-matrix.ts` pattern). This is strictly more honest than
the RFP's enclave prose, and stronger than Shutter on both axes the sponsor names.

**Why not OpenZeppelin's Cairo Governor** (`openzeppelin_governance` v4.0.1, Cairo ^2.18 — real;
`GovernorComponent`, `VotesComponent`, timelock, counting extensions): its entire model keys votes
to `get_caller_address()` and ERC20Votes checkpoints — the two things we exist to hide. We do not
extend it. We **do** adopt its *vocabulary* — the Tally-standard lifecycle and `Span<Call>`-shaped
executable actions — so judges and users read our governance in the industry's standard grammar.
(Also noteworthy: our repo pins Cairo/starknet 2.8.2; OZ governance 4.x wants ^2.18 — a second,
independent reason not to import it.)

## 4. The mechanism in one paragraph

**Your tokens are the ballot.** To vote, you move governance-token value through the pool into the
proposal's ballot box (our Governor helper) with a sealed choice attached. The pool proves the
value is real and injects your per-contract voter handle (`identity_key`); the funding leg makes
your *weight* public while the House record omits your account address; your *choice* travels
sealed. The relayer still sees request metadata and is the public transaction submitter. Locked
tokens cannot vote twice — sybil resistance by conservation: ten sybil handles splitting the same
tokens still sum to the same weight. No snapshot blocks, no census Merkle trees, no balance proofs.
At close, the box opens (or never opens, by mode), the tally publishes only if the contract's own
accumulator equation accepts it, the proposal executes on-chain if it passed, and your tokens come
back to you as a fresh unlinkable note.

### 4.1 A ballot, precisely

One pool transaction (`privacy_invoke_with_computation` — the selector is already pinned in
`packages/protocol/src/constants.ts`), carrying:

- **`identity_key`** (arg 0, pool-injected) — the per-contract voter handle. Groups re-votes and
  top-ups; the House stores the handle rather than an account address.
- **A phase-6 withdraw of `w` governance tokens to the Governor** — the ballot's weight, public,
  escrowed until close, booked through the shipped custody-ledger pattern
  (`take_custody`, `contracts/src/markets.cairo:789`).
- **A reclaim commitment** — a client-minted bearer secret's Poseidon commitment, exactly the
  shipped position pattern (`mintPositionSecret`/`commitmentFor`,
  `packages/protocol/src/commitment.ts`). The secret later redeems the escrow (§4.3).
- **Calldata:** `house_id`, `proposal_id`, `sealed_choice` (choice + blinding factors, encrypted to
  the proposal's tally key), and a **commitment vector** `C = (C_1 … C_k)`, one STARK-curve
  Pedersen commitment per option: the chosen option's `C_j = w·G + r_j·H`, every other option's
  `C_j = 0·G + r_j·H`. The contract stores the ballot and **adds the vector into the proposal's
  running accumulators `ACC_j`** (native `core::ec` point math — the same curve account signatures
  use; cheap).

**Re-vote rule (covers top-up and change of mind in one sentence):** a new ballot from the same
`identity_key` **replaces** the old one — the contract subtracts the previous commitment vector
from `ACC`, adds the new one, and requires the new ballot's committed weight to equal the
identity's full cumulative escrow. Voting again with more tokens = top-up; voting again with zero
new tokens = changing your mind (a zero-value invoke is legal — verified; it costs only the pool
fee). Replacement is also what makes vote-buying receipts *deniable*: a voter can show a briber
their opening, then silently supersede it — the shown receipt proves nothing about the final ballot
(MACI's anti-collusion property, inherited without MACI's coordinator; caveat, same as MACI's: a
sale executed after the window closes cannot be undone — one honest sentence in the disclosure).

**Malformed commitments** (a hostile custom client committing garbage): detectable by the Teller at
decryption, excluded at publication as a public, per-ballot list the contract subtracts from `ACC`
before checking the equation — and an excluded voter can always *publicly* prove their ballot was
well-formed by revealing their opening, which makes wrongful exclusion self-incriminating. The
shipped app always builds valid ballots; exclusion exists so one vandal cannot brick a tally.

### 4.2 What each party sees (the honest table, drafted for `visibility-matrix.ts`)

| Observer | During voting | After close (secret-until-close) | After close (permanently-private) |
|---|---|---|---|
| Public / other voters | # ballots, each ballot's weight, total escrow (→ **live quorum**), countdown, and the transaction submitter. Never sealed choices or account addresses in House storage | full handle-keyed ballot book: (handle, weight, choice) — recomputable by anyone from chain data | per-option sums, contract-verified. Nothing per-ballot, ever |
| The Teller (us) | choices as they arrive (early peek — disclosed), plus request metadata | same as public | ballot book keyed to per-contract handles |
| StarkWare's auditor (escrowed viewing keys, `context/07 §3.1`) | each user's own note history under the escrowed key — as on every surface | same | same |
| House committee (optional, per-proposal) | — | — | ballot book under an authorized audit key (the RFP's own sentence) |

The quorum row is a UX gift no transparent system has: **participation is provable live while the
direction stays sealed.** "Quorum reached, outcome sealed" is a state Snapshot cannot render and
Shutter renders only as a blank. It kills bandwagon voting while keeping the one number voters
legitimately need — is this vote real yet? — public.

### 4.3 Reclaim

After close (and, for the winning treasury math, independent of execution), each ballot's escrow is
redeemed by its bearer secret into a fresh open note — the exit as unlinkable as the entry, the
claim leg copied from the shipped Markets claim (`op_claim` shape: pool-only, batch
`[n, (secret, note_id) × n]`, position-state machine as replay protection, approve-batch-totals).
Reclaims are per-ballot transactions (the "nobody has ever settled more than one note per
transaction" economics stands until probed) — the UI says so up front.

## 5. Proposal lifecycle

Tally's standard states, restricted to what we ship, one new sealed state added:

```
Draft (off-chain) → Active → Closed·Tallying → Succeeded | Defeated → Executed
                      │
                      └── Canceled (proposer, before first ballot only)
```

- **Active** — the Sealed Ballot Box state: ballots visibly accumulating (count, weights, quorum
  bar filling), choices sealed. Badge colors and card grammar follow Tally/Nouns conventions so the
  surface reads instantly.
- **Closed·Tallying** — window over, Teller has not yet published. Normally seconds long. If the
  Teller is dark, the state is visible and named, never faked (the topology doc's degrade
  discipline applies; §11.3).
- **Succeeded / Defeated** — determined by the contract from the accepted tally + the proposal's
  quorum and threshold parameters, not by the Teller's opinion.
- **Executed** — §7. Permissionless.

## 6. Modes, tally, and verification

### 6.1 Secret-until-close (the default)

At close the Teller publishes the proposal's tally key **on-chain** (one cheap direct call — the
reveal is then permanent, public chain data, not a URL we host). From that moment the entire ballot
book decrypts from on-chain events alone: anyone can recompute the tally; the Teller cannot lie,
drop, or reorder. Residual trust: the Teller alone could have peeked early (Shutter's committee has
the same power; we print ours in the disclosure panel instead of a footnote). What the House still
does not record, unlike Shutter, is the voter's account address: the book is keyed to per-contract
handles. That is narrower than transaction anonymity because the public submitter and the relayer's
request metadata still exist.

### 6.2 Permanently-private

The tally key is never published. The Teller submits per-option sums `(S_j, R_j)` plus the (normally
empty) excluded-ballot list; the contract verifies (§6.3) and only then flips the proposal to
Succeeded/Defeated. Optional per-proposal **committee audit key**: sealed choices encrypted to
Teller and committee jointly, so a named committee can reconstruct the ballot book under
authorization — the RFP's viewing-key sentence, shipped. When StarkWare ships a real Enclave, it
replaces the Teller inside this mode and nothing else changes; the spec says so and the contract
interface doesn't move.

### 6.3 The verification equation — the chain rejects a wrong tally

Pedersen commitments on the STARK curve are additively homomorphic, and the contract has been
summing every accepted ballot's vector into `ACC_j` as they arrived. At publication the contract
asserts, per option:

```
S_j·G + R_j·H == ACC_j   (after subtracting the excluded list)
Σ_j S_j == Σ valid ballots' public weights
```

`G` is the curve generator; `H` is a nothing-up-my-sleeve second generator (hash-to-curve over a
fixed tag, pinned as a constant in Cairo and in `packages/protocol` with a cross-test, the
`commitment.ts` discipline). A Teller that shifts weight between options, invents weight, or drops
a ballot cannot produce numbers the contract will accept — **a wrong tally is not "detectable",
it is unpublishable.** The second line closes the missing-lane hole because every ballot's weight
is public. Verification costs a handful of native-curve operations per option — the same math
account signature checks use. This upgrades the RFP's "no trusted counter" from an aspiration
resting on a nonexistent Enclave to an on-chain property of the shipped pool + 
a few lines of `core::ec`.

*(Secret-until-close mode gets the same accumulator for free; there the published key additionally
lets anyone recompute everything offline.)*

## 7. Proposals that actually do something

Abu's Nouns instinct, kept: a proposal is not a poll. At creation it carries (OZ/Tally grammar) a
list of `Call`s — target, selector, calldata — rendered human-readably, raw behind a toggle.
After the tally is accepted, **`execute()` is permissionless** (same doctrine as Launch's
permissionless `graduate()`; our relayer keeper fires it, anyone can — the keeper allowlist
pattern at `packages/relayer/src/allowlist.ts:76` extends by one entry).

**v1 action set (settled):**
1. **Treasury spend.** Every House has a treasury pot inside the Governor, fundable through an
   open-note deposit represented by a bearer commitment. The deposit amount and transaction
   submitter are public; the House pot does not store the funder's account address. A passed spend
   proposal pays the recipient through the shipped approve-and-open-note release. This also plants
   our flag on IDEA-28 (treasury OS) without building it.
2. **Text / signal.** No calls; the tally is the outcome.
3. **House parameters.** Voting period, quorum, threshold, default mode, membership policy —
   executed by the Governor on itself.

Arbitrary external calls are deliberately out of v1 (screening-policy exposure + unbounded audit
surface); the `Call` encoding means adding them later is data, not architecture.

## 8. Delegation — the RFP's second half, which no rival ships

**Delegate profiles are public; delegators never are.** A delegate is a *published role*: a
Passbook username (the shipped directory: `directory-name.ts`, claim signed by the viewing key,
avatars, local-match search) plus a **delegation pot** at the Governor.

- **Delegate registers** (one tx, ComputeAndInvoke): binds their `identity_key` to their directory
  name. Creates the pot.
- **Holder delegates** (one tx): escrow deposit of `w` tokens into the pot, tagged with the
  delegate's handle, carrying a bearer reclaim commitment. Public: *the pot grew by `w`*. Never
  public: whose tokens. The holder needs no handle at all — maximum privacy on the quiet side of
  the edge. The RFP's "5M tokens, source never learned," literally.
- **Delegate votes**: their ballot draws own escrow + pot balance at vote time; the contract
  snapshots the drawn amount into the ballot (and its commitment must cover it, §4.1).
- **Holder revokes** (one tx): presents the bearer secret, reclaims into a fresh note — entry and
  exit both unlinkable; the delegate never learns who left. **Timing rule:** revocation is
  immediate for weight not bound into an open ballot; weight already cast stays locked until that
  proposal closes (no double-count race), then drains.

The public sees delegate leaderboards with real power and real voting records — accountability —
while the delegation *graph* (today a whale-doxxing map on every chain) does not exist on-chain.
Lobbying or threatening the source of a delegate's power requires knowing who it is; nobody does,
including the delegate.

## 9. Houses — the product layer (Abu's add-ons, settled in)

Product name candidate: **Houses** (Abu: *"invite-only the house kinda works"*; it reads right next
to Passbook's ledger identity — every token gets a House). Name is Abu's call; nothing below
depends on it.

### 9.1 One-tap DAO on your token
Every Passbook-launched token gets **Activate House** on its token page — one transaction anchoring
the House (token address, params, metadata CID). Launched tokens are plain ERC-20s deployed at
`graduate()` (`contracts/src/launch_token.cairo`), and the pool has **no token allowlist**
(verified live: `evidence/day0-markets-launch-checks.json`, `a1ArbitraryDepositToken.verdict:
"YES"`) — so holders shield them and vote. Any external Starknet ERC-20 can activate a House too;
that makes this infrastructure, not a walled garden — and the RFP's category *is* Infrastructure.

### 9.2 Sealed Ballot Box
The Active state's visual: a box filling with envelopes — count, weights, quorum bar — never a
leaderboard. The anti-bandwagon claim, drawn instead of asserted.

### 9.3 Delegate by username · profiles
§8 through the existing directory. Delegate cards are profile pages: power, participation rate,
statement, vote history (in secret-until-close Houses). Avatars already ship.

### 9.4 Voting weight — Abu's question, answered
Default: **weighted by escrowed tokens** (coherent with "your tokens are the ballot", and what
token DAOs expect). Invite Houses additionally support **one-member-one-vote**: eligibility is the
membership roll (identity_keys enrolled via invite), each member's ballot counts once, token escrow
not required — this is the mode a small crew of friends actually wants, and `identity_key`
uniqueness is what makes it sybil-safe without tokens. Both are a per-House parameter; the
counting module is data, not a fork (OZ's "counting extension" idea, kept).

### 9.5 Invite-only Houses
Membership `open | invite`. Joining an invite House presents an invite secret (the product's
existing invite-link primitive, `context/11 §2`) in a **zero-value ComputeAndInvoke** — which
enrolls the joiner's `identity_key` on the roll without any deposit, and is therefore immune to
the future screening flip, like chat. The public sees a member *count*, never a member *list* — a
private members' club whose decisions still verify publicly.

### 9.6 Talk where you are
Each proposal gets a discussion thread on its page through the existing chat rail (message-only
invokes: cheap, screening-immune). Threads die with the proposal's close by default.

### 9.7 Receipts, privately
Ballots, delegations, reclaims, and executions land in the owner's activity feed as new
`TransactionType` members (the one-union/one-renderer pattern) — visible only to the key holder.
No public receipt exists; §4.1 explains why the deniability is a feature.

## 10. Contract design — `contracts/src/governance.cairo`

One new stateless helper beside `markets.cairo` and `launch.cairo`, reusing the house patterns
verbatim: `IPrivacyInvoke` + raw payload dispatch, `read_batch_len` payload validation, the
custody ledger (`take_custody` / `release_custody` / `accounted`), bearer commitments
(`poseidon_hash_span([secret])`), `approve_batch_totals`, `assert(caller == pool)` only on legs
where the pool must be mid-transaction, permissionless keeper entrypoints, direct calls for
fee-free operator/creator actions. Estimated size: between MessageBook (95) and Markets (893) —
**~600–750 lines** plus tests.

### 10.1 Operations

| Op | Entry | Caller | Shape |
|---|---|---|---|
| `create_house` | direct call | anyone (relayer-sponsorable, creator = commitment — the `create_launch` precedent) | writes HouseInfo, params, metadata CID |
| `propose` | direct call | creator/member per policy (commitment-gated) | writes proposal, Calls, mode, tally pubkey, windows |
| `OP_BALLOT` | `privacy_compute` | pool only | identity_key + escrow + commitment vector + sealed choice; `ACC` update; replace semantics |
| `OP_DELEGATE` | `privacy_invoke` | pool only | escrow into pot, handle tag, reclaim commitment |
| `OP_JOIN` | `privacy_compute` | pool only | zero-value; enrolls identity_key via invite secret |
| `OP_RECLAIM` / `OP_REVOKE` | `privacy_invoke` | pool only | settling leg, bearer secrets, open-note span out |
| `publish_tally` | direct call | anyone carrying valid `(S, R, excluded)` — the contract, not the caller, is the authority (§6.3) | flips to Succeeded/Defeated |
| `publish_key` | direct call | Teller key (or anyone with the preimage) | secret-until-close reveal, on-chain forever |
| `execute` | direct call | **permissionless** after Succeeded | performs the Calls; keeper fires it |
| `fund_treasury` | `privacy_invoke` | pool only | public-amount open-note deposit represented by a bearer commitment |

### 10.2 Return-shape rules (the ones that revert if wrong)
Funding legs (`BALLOT`, `DELEGATE`, `FUND`) return an **empty span** — money in. Settling legs
(`RECLAIM`, `REVOKE`) return exactly n `OpenNoteDeposit`s — the batch README's three rules apply
(approve the sum once per token; exactly n deposits; never zero-amount). `JOIN` returns empty and
deposits nothing — the MessageBook immunity argument applies to it word for word.

### 10.3 Storage sketch
`houses: Map<u64, HouseInfo>` · `proposals: Map<u64, Proposal>` (windows, mode, params, tally
pubkey, `Span<Call>` hash, state) · `ballots: Map<(u64, felt252), Ballot>` keyed by
(proposal, identity_key) — weight, commitment vector, reclaim commitment, seq · `acc: Map<(u64, u8),
EcPoint-as-felts>` · `pots: Map<felt252, u256>` per delegate handle · `members: Map<(u64, felt252),
bool>` · `treasury: Map<u64, u256>` · metadata `ByteArray` maps (the launch `logo_uri` precedent,
IPFS CIDs, length-checked only).

### 10.4 PROBE-1 — the one genuinely new mechanic
**`privacy_compute` has never been implemented in this repo** (the selector constant exists,
unused; `encodeClientActions` handles three variants, not `ComputeAndInvoke`). Before any other
governance code: a ~40-line stub helper + one mainnet transaction proving (a) the pool calls
`privacy_compute` with `identity_key` as arg 0, (b) a phase-6 withdraw can fund the same
transaction's ComputeAndInvoke leg (the Markets bet shape under the other selector), (c) measured
gas (~7.3 STRK expected, `context/07 §4`). The 329 all-time mainnet calls say this works; our
claim, per the standing correction, is **"first governance on ComputeAndInvoke"**, never "first".
Fallback if the probe surprises us: ballots ride `InvokeExternal` with a bearer-chain identity
(each re-vote presents the prior ballot's secret) — strictly worse (no one-member-one-vote mode),
but nothing else in this spec moves.

## 11. Protocol, relayer, and app integration — the compile-error checklist

> **Freshness caveat:** this worktree forked from `master` at `0349529`, *before* the STUDIO
> reskin and the live Markets/Launch panels landed on the mainline (`try-pnpm`:
> `d8be098..f385bbf`, `0d39ad4` — `app-reads.ts`, `useMarkets`/`useLaunches`, `MarketsPanel`,
> `LaunchPanel`, `invokeDirect`, bearer secrets via `use-positions`). Re-verify this section
> against the merge target: the app-invoke groundwork the sweep reported as missing likely
> already exists there, which *shrinks* the governance story. The checklist below is the
> superset as seen from this fork.

The repo makes a seventh surface a *deliberate* multi-file compile error. The full list, so
nobody discovers it at 2am:

### 11.1 `packages/protocol`
- `send.ts`: three shapes exist today — funding (withdraw+invoke, empty span) and settling
  (open notes + invoke). Ballot/delegate/fund are funding-shaped; reclaim/revoke settling-shaped;
  **`JOIN` and zero-new-weight re-votes are a third, value-less shape** `planSend` currently
  refuses (`amount <= 0n` guard) — one new branch, plus `SendKind` members `gov-ballot ·
  gov-delegate · gov-join · gov-reclaim · gov-revoke · gov-fund`.
- `message-book.ts` `encodeClientActions`: add the `ComputeAndInvoke` variant (index 9, already in
  `CLIENT_ACTION`); mirror `predictMessageBookRevert` as `predictGovernorRevert` — the pool's free
  `compile_actions` cannot catch payload mistakes (evidence rows prove it).
- New pure modules, split per the build gate (`APP_FORBIDDEN_IN_CHUNK`): `governance-calldata.ts`
  (the `market-calldata.ts` refuse-don't-throw pattern), `governance-commitment.ts` (EC vector +
  `H` constant + cross-test against Cairo), `governance-copy.ts`, tally-verify in
  `governance-tally.ts` (client-side recomputation for the UI and for anyone auditing us).
- `visibility-matrix.ts`: new `VisibilityContext` rows (ballot, delegate, reclaim, join) — the
  §4.2 table is written to drop in. `forbidden-claims.ts`: add governance phrases ("anonymous
  voting" is banned — *voting requires a registered pool account*; "nobody can see your vote
  early" is banned in Teller modes).
- `app-contracts.ts` `parseAppContracts`: a `Governance` key; evidence file gains the address.

### 11.2 `packages/relayer`
- `allowlist.ts`: `SubmissionPolicy.governance` + `assertCallAllowed` branch (`privacy_invoke`,
  `privacy_invoke_with_computation`) + keeper entrypoints `['publish_tally', 'execute']` — and
  **never** `publish_key` from user submissions (Teller-signed only; the `sweep` exclusion
  precedent: no bearer material through the relayer wire).
- **The Teller** is a relayer subsystem, not a new deployable: per-proposal keypair minted at
  `propose`, sealed-ballot decryption at close, `(S, R)` computation, `publish_tally` +
  `publish_key` submission, and a topology row in `topology.ts` with an honest degrade state
  ("Closed·Tallying, Teller unreachable — ballots safe on-chain, tally resumes when it does").
  Key custody follows the four-signer doctrine in `docs/topology.md` — the Teller key is signer
  five, named before it exists, never in a `VITE_` var.

### 11.3 `apps/web`
- Seventh mode: `MODES`/`MODE_ROUTES`/`MODE_LABELS` (`shell/modes.ts`), route files, and every
  `route-contract.ts` pin: `ActivitySurface`, `VisibilityContext`, `CONTEXT_SURFACE`,
  `SURFACE_CONTEXT`, `MATRICES`. This is a checklist, not a risk — the contracts were built to
  make the omission loud.
- State: module singletons + `useSyncExternalStore` (the house pattern — **no Redux/Zustand/React
  Query here**, whatever Uniswap does); a `governance-store.ts` beside `chat-bus.ts`.
- Reads: proposal/ballot state from contract views + events via the `crowd-rpc.ts` browser-safe
  reader pattern (no chain client in the eager bundle; the build gate again).

## 12. The token surfaces — Uniswap from source, applied

Abu's second ask: launched tokens deserve Uniswap-grade explore cards and a token detail page —
today Passbook has a token *list* (AVNU-sourced, on-chain-verified decimals) and **no token page at
all**. The Uniswap sweep gives exact mirrors and sizes; their whole explore+TDP layer is ~18k LOC,
but the parts worth mirroring are small:

| Ours | Mirror (in `reference/uniswap-interface`, apps/web unless noted) | Their LOC |
|---|---|---|
| Explore shell + tabs (Tokens · Houses · Activity) | `pages/Explore/index.tsx` — tabs are real routes | 425 |
| Card rail | `components/TokenCardCarousel/*` (generic `<T>` scroller + snap + edge fades + arrows) | ~370 |
| Token card w/ sparkline | `packages/uniswap/…/TokenCard/*` (vertical: logo, name, price, 1d delta, 64×32 sparkline) | ~200 |
| Launch card | `pages/Launches/TrendingLaunchCard.tsx` — extracted-color glow, floating sparkline, FDV+delta, **progress bar** | 213 |
| Launch/token data model | `pages/Launches/launchesModel.ts` — `progressPct`, `graduated`, `detailPath` switching by phase | 185 |
| Token table | `pages/Explore/tables/Tokens/TokensTable.tsx` (`# · Token · Price · 1H · 1D · FDV · Volume · Sparkline`) | 485 |
| **Token detail page** | `pages/TokenDetails/` — breadcrumb → sticky header → two columns: left (chart, stats grid, About + link pills, activity tabs), right rail 360px (action widget, always mounted) | shell ~580, stats 314, about 169+322, activity tabs 88 |
| DAO tab | `activity/ActivitySection.tsx` — heading-text tabs, local state; **adding a Governance tab is ~20 lines in their own grammar**. Proposal detail mirrors the Toucan auction page: left rail sections + right rail action panel (`BidForm` → our BallotForm) | 88 + pattern |
| Live ticker | `QuickLaunchMarquee` — duplicated strip, 60s `translateX(-50%)` keyframes, edge fade | inside 194 |

Decisions this settles:

- **Token page routes**: `/explore` (tabs as routes) and `/token/$address`, with `detailPath`
  switching launch-phase → curve page, graduated → token page (Uniswap's exact
  auction-vs-TDP switch). Rows navigate with `state: { from: pathname }` so the breadcrumb knows
  its entry point.
- **The launch card gets the bonding-progress bar** (`LaunchProgressBar`: 6px pill, glow knob,
  reduced-motion-guarded) — our epoch curve has `sold/tranche` on-chain; the card also carries
  FDV, 24h volume, holders-ish count, age — all computable from our own events (the crowd reader),
  no indexer.
- **Token page left column** for a launched token: price/epoch chart, stats grid (raised, sold,
  epoch, holders, treasury), About (description + link pills), Activity tabs
  (Trades · **Governance** · Holders-lite), right rail: Buy widget pre-graduation, Swap after,
  **Ballot form during any active proposal**.
- **Logos**: keep Passbook's shipped seeded-disc fallback (`TokenLogo.tsx` — name-seeded palette;
  it matches Uniswap's `useColorSchemeFromSeed` monogram pattern almost exactly). Add
  **extracted-accent color** from the logo driving the card glow and chart stroke (their
  `useSrcColor`) — per-token identity, not palette drift, so it composes with the ratified
  design direction (STUDIO — Anton/lime/near-black — shipped on the mainline *after* this
  worktree forked; this worktree still shows SPORE. Design tokens flow through
  `apps/web/design/tokens.yaml` either way).
- **IPFS via Pinata** (the alive option in 2026 — NFT.Storage's free pinning is dead;
  web3.storage is now Storacha with heavier auth): Uniswap's own upload pipeline is the template
  (`useTokenImageUpload`: blob preview instantly → upload → retry-backoff on fresh-CID 500s →
  gateway URL). We store `ipfs://CID` in the launch's existing `logo_uri ByteArray` (≤256 chars,
  fits) and House metadata JSON (description, links, committee key) as a CID on the House record.
  The relayer proxies the Pinata JWT server-side (the D-35a keyless-quote discipline; no
  credential in the bundle). Fallback when IPFS is slow: the seeded disc, never a broken image.

**One story, Uniswap-calibrated:** their coherence spine is ~2.5k lines and a single surface costs
5× that; our explore-redesign + token page + governance tab, reusing their exact component grammar
at Passbook scale, is a **~3–4k line web story** — in range of every surface shipped so far.

## 13. Costs and the gate

ComputeAndInvoke-class transactions ≈ 12–14 STRK all-in (`context/07 §4`). A full demo journey —
activate House → 3 ballots → delegate + delegated ballot → tally + execute (direct calls, gas only)
→ 2 reclaims — is **7–8 pool transactions ≈ 90–120 STRK ≈ $3.** Money is not the constraint.

Gate mechanics: every ballot/delegation/join/reclaim routes through the Governor → each is a
qualifying mine-rule transaction. The Governor address enters `strk20.json` **in the same commit**
as the first transactions through it (the airlock trap), alongside the three contracts already
listed. `inspired_by: IDEA-27`.

## 14. The field — intel, not a veto

**Aperture** (`OoJae/aperture-strk20`, registry `IDEA-27`) is the direct rival: "sealed-ballot
governance and a shielded treasury," 4 verified mine-rule mainnet txs, live Vercel demo, no video,
last push 20 Aug in our clone (re-pull before submission). What beats it, concretely: **delegation**
(their one-liner has none — it is half the RFP's title), **one-tap Houses on tokens launched in the
same product** (they have no launchpad; nobody else has ours), **contract-verified tallies** (§6.3
— "the chain rejects a wrong tally" is a sentence a sealed-ballot demo cannot say without the
accumulator), **one-member-one-vote invite Houses** (identity_key personhood), and the whole-app
coherence thesis. tx404 tagged IDEA-26 but builds a shielding API — no collision. Nobody else in
119 registry entries touches governance.

## 15. Honesty, claims, and deviations — write these down before the code

**Sentences we ship** (into `governance-copy.ts` + the disclosure panel):
- "Your ballot's weight is public. Your ballot's choice is sealed. Your identity is neither on the
  ballot nor derivable from it."
- "Until close, our Teller can read choices early; it cannot forge, drop, or miscount them — the
  contract checks the math before a tally can publish." (Teller = named party in the who-sees-what
  panel, next to the relayer and StarkWare's auditor.)
- "Voting requires a registered pool account. This is privacy, not anonymity from the protocol —
  StarkWare's auditor escrow applies here as everywhere."
- The sponsor's own swap sentence, adapted: identity privacy claimed, amount privacy never.

**Claims we never make:** "anonymous voting" · "nobody can see your vote" (Teller modes) · "your
address never appears" (until the relayer path is the only path) · "trustless" unqualified ·
"first on ComputeAndInvoke" (we are ~8th; "first *governance*" is the defensible form).

**Deviations from the RFP's prose, defended:**
1. *No Enclave* → Teller + on-chain-verified accumulator (§3, §6.3). The RFP's enclave does not
   exist; ours is the strongest verifiable substitute available on the shipped pool, and the
   permanently-private mode is exactly the slot a future Enclave fills.
2. *No snapshot-block eligibility proofs* → escrow ballots (§4). No shipped primitive proves
   private-note balances at a historical block to a third contract (Snapshot X does this with
   Herodotus storage proofs over *public* balances — the opposite of our holders). Escrow is
   sybil-proof by conservation and needs no census. Cost, stated plainly: tokens lock during the
   vote; weight is per-ballot-public.

**Risk register:** the future screening flip (`context/07 §1.4`) exposes the value-bearing legs
(ballot, delegate, fund, reclaim) exactly as it exposes swap/launch/markets — `JOIN`, chat threads,
and all direct calls are immune; class hash pinned; disclosure ready. Pool pause mid-vote: windows
are block-based; a paused pool freezes new ballots but never the count or close — the degrade copy
exists in `context/11 §4`'s table. Teller key loss before close of a permanently-private vote =
tally impossible → the contract needs a `void_after` escape (the Markets `VOID_AFTER` precedent):
past it, anyone can void the proposal and reclaims open. **No vote can ever strand tokens.**

## 16. Probes and open items

| # | What | Why | Cost |
|---|---|---|---|
| PROBE-1 | ComputeAndInvoke stub on mainnet: identity_key arrives, withdraw funds it, gas measured | §10.4 — the one new mechanic under everything | ~14 STRK |
| PROBE-2 | `H` generator + EC accumulator: Cairo `core::ec` add/mul in an snforge test, cross-checked byte-for-byte against the TS verifier | §6.3 soundness; the `commitment.ts` cross-test discipline | free (local) |
| PROBE-3 | Shield-a-LaunchToken → ballot in the *same* transaction (deposit phase 3 + withdraw 6 + invoke 7)? | collapses first-vote UX from 2 txs to 1; `SHIELD_WITH_INVOKE` refusal exists in our validator — confirm against the pool, not our own guard | ~14 STRK |
| PROBE-4 | Pinata upload → `ipfs://` in `logo_uri` → gateway render round-trip | §12 pipeline | free tier |
| open | `docs/*` is **gitignored** (`.gitignore:40`); this file needs a `!docs/governance.md` exception to merge — done in this worktree's commit | the deliverable must survive the merge | — |
| open | House naming (Houses?), and whether the Governance tab lives on the token page only or also as a top-nav surface — Abu's call after seeing the design | product voice | — |

## 17. The demo beat (for the video plan, not shot yet)

Two Houses, ninety seconds. **House one (secret-until-close, token-weighted):** a proposal to pay a
grant from the treasury; three ballots land on camera — the box fills, quorum bar crosses, outcome
sealed; close; the Teller's key hits the chain; the tally appears *with* the on-chain check green;
`execute()` pays the grant — a real recipient's balance moves on mainnet. **House two
(permanently-private, invite-only, one-member-one-vote):** five members, a sensitive comp decision;
only the aggregate ever appears; the camera shows the contract accepting the tally equation and —
the kicker — *the block explorer showing nothing about any voter.* Delegation runs between the two:
a whale delegates 5M to @mia on camera; @mia's pot grows; the chain shows no source. Every one of
those is a qualifying gate transaction banked as a byproduct (D37).
