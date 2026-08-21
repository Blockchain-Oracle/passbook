# STRK20 PRODUCT EXPERIENCE BRIEF

Companion to the visual design brief (`context/08-design-brief.md`). That document owns colour, type, motion and component anatomy. This one owns sequence, words, and what happens when things go wrong. Every flow here survives the verified protocol constraints; where a number or claim is invented rather than sourced, it is tagged ADAPTED or GUESS. Runtime rule that governs everything below: **no STRK amount, no user count, no duration, and no fee ever appears as a hardcoded string.** Fees come from `get_fee_amount()` at render, counts come from chain/indexer reads stamped with their block height, and durations do not render until one real proof has been timed against the hosted prover (see §9, Q1).

---

## 1. THE FIRST NINETY SECONDS

One flow that is simultaneously the real first-run and the login-free demo. There is no demo mode, because the demo persona is not a mode — it is an ordinary account occupying the ordinary account slot. (Architecture: Uniswap's landing mounts its real swap widget; the honest version of that move here is the whole app mounted on a real account.)

**0:00–0:05 — First paint.** URL is `/wallet`. No splash, no "Launch app", no marketing route, no cookie interstitial, no modal. The full shell renders: six nav items (Wallet · Chat · Swap · Bridge · Markets · Launch), all enabled, none badged. The account chip top-left reads `open`, and beneath it: `This key is published — it reads and it spends`. The chip is the calm grey Blocked-style treatment from the design brief, not a banner. Critically, this is the same account switcher a returning user has; converting later is an ordinary account switch, not an exit from a mode.

**The cold open is read-heavy, not balance-heavy.** The published viewing key IS the spending key and `apply_actions` has zero caller access control, so anyone can drain `open` for ~$0.25 and no relayer-side refusal is enforceable (verified). Therefore the persona's value is its *history*, which cannot be stolen: a decrypted conversation, a sealed thread that verifies client-side, receipts, a resolved market position, a completed bridge exit with a live explorer link — six surfaces of real state. The balance tile shows dust and says so:

> `open · 0.42 USDC — anyone holding the published key can spend this, and someone probably will. A zero here is expected, not broken.`

The persona's history renders from a pinned block-range snapshot, with anything arriving after the pin in a separate labelled lane — so a rival cannot write content into the screen a judge is reading. Ops: 3–5 personas pre-registered in week one (~$0.25 each), the published one a runtime config value, so a drained or defaced persona is a one-line redeploy. The key is WriteOnce; a persona cannot be repaired, only replaced.

**0:05–0:20 — The first thing the visitor does.** One row at the top of the activity list is deliberately left undecrypted: mono ciphertext `0x8f2ac1d0…c104`, caption `Encrypted note · block 13,412,880`, one small button `Decrypt`. Pressing it runs real ECDH in the visitor's browser against the published key, over real ciphertext from the sponsor's open discovery service. The row resolves into an ordinary activity row (`−25.00 USDC · to sam · 3 days ago`), mono→sans per the design brief. If decryption returns in under 120ms, hold the transition to 120ms so the eye catches it; never fake longer (ADAPTED). Caption fades in:

> `Decrypted in your browser. The chain stored only the ciphertext above.`

This is free, needs no identity, touches real chain state, and teaches the whole thesis in one gesture. It is also the only first act the bootstrap deadlock permits.

**0:20–0:40 — The standing honesty line.** One permanent body-copy line under the balance, furniture not alarm:

> `You are reading a public account. Its key is printed in the open, so anyone can decrypt this history — or spend this balance. Nothing on this screen is simulated.` — `View the key`

The "nothing is simulated" sentence ships only if literally every value is chain-read; if any element is seeded, scope it or cut it. `View the key` opens the visibility panel (You / Relayer / Everyone / Auditor), headed by:

> `Every key on this protocol is escrowed on-chain, encrypted to a StarkWare auditor key, when its owner registers. Anyone can read that record with one call. This account's key is published to everyone instead of to one auditor. That is the only difference.`

with the live auditor key in mono and a `Check this yourself` link that runs `get_enc_private_key()` and prints the three felts.

**0:40–0:90 — Everything is interactive, and conversion triggers on intent.** The visitor can open the chat, type in the swap form, read a market. Nothing asks who they are. Exactly three triggers open conversion: pressing any primary action CTA, pressing `Receive`, or arriving on an invite link. The trigger renders an inline bordered row above the button — never a scrimmed modal, the page stays interactive, the composed form stays filled:

> `You are reading a public account. Sending needs one of your own.` — `Create an account` · `one transaction`

(The chip says `one transaction`, not "about 20 seconds" — no duration ships until proving is timed.)

**Conversion panel, five screens, over the still-visible dimmed form:**

1. **Name.** One field; the derived address materialises in mono as they type; live availability. Caption: `This is the address people send to. It is the only address this app will ever show you. The name resolves only inside this app.` Free, local, reversible.
2. **Custody, stated before the key exists.** `Your key is made here, in this browser. It is not derived from a wallet signature — this protocol records your key once and never lets you change it, and a wallet upgrade would change the signature and orphan your funds permanently. The same key reads your history and signs your spending; there is no watch-only version. When you register, an encrypted copy is escrowed on-chain to StarkWare's auditor. That is not optional.` CTA `Generate my key`. The registration prove request starts here, in the background, so the read time on screens 2–4 hides the prover round-trip.
3. **Backup — and it gates registration, not spending.** `Save your key before we write anything on-chain. The key we register can never be replaced — the protocol writes it once.` Recovery Code (generated, four groups of six, `Save to password manager` writing a credential named `STRK20 Recovery Code`) → paste-to-confirm → download the encrypted Recovery File (plaintext header: receive address, registration block, auditor key as of that block). A skipped backup here would create an unrecoverable account with a sponsored transaction; the gate is the point, and the copy above is its justification.
4. **The deadlock, named.** `Registering costs one pool transaction — currently ~[live] STRK. We are paying it. A new account cannot pay this fee itself: the fee is taken from a shielded balance, and nobody may give you a shielded balance until you are registered. Someone has to go first.` Fee row: `Submitted by [App] relayer · [live] STRK · paid by us`, and the sanctioned sentence until the relayer is proven on mainnet: `The pool sees this transaction, not your notes.` (The string "your address never appears" is banned until then — verified prohibition.)
5. **Register.** The pipeline row: Build → Prove → Relay → Confirmed. Prove renders the 750ms indeterminate ring with an elapsed counter — proving runs on StarkWare's hosted service, not ours, so a determinate fill would be a lie. Ladder: `Proving…` → 20s `Still proving. Don't close this tab.` → 10min `This is taking longer than normal. [Prover status ↗]`. Registration mints no spendable note, so there is no maturity step here. Before offering registration, the app calls `get_public_key(addr)` directly against RPC — if non-zero, skip registration or route to the ForeignKey state (§3).

**Return.** The panel closes onto the exact form the visitor composed on `open`, still filled, now under their own account (context-scoped stores, Uniswap's mechanism). The CTA reads its true state, usually `Not enough shielded USDC` — a relabelled button, not a banner. The empty wallet is honest: `You can receive now. You cannot send yet.` with two action cards (share receive address; fund from a Ready wallet, labelled `Funding source — never your identity here`). Funding is two transactions (approve + deposit), the deposit is public and screened, and the screen says so before it happens: `Your deposit is public. This address and this amount are visible on Starknet. Privacy starts after the deposit, not at it.`

---

## 2. THE INVITE FLOW

`open_channel` asserts `RECIPIENT_NOT_REGISTERED`; only ~a-hundred-odd addresses are registered protocol-wide (read the number live; never bake it). A new user's first real action is usually impossible because their counterparty does not exist. The invite is therefore not growth marketing — it is the fix for the app's most common hard error, and per the decision log, possibly the highest-value feature in the product.

**Door A — the reverse invite (where the user actually is).** They paste an address into Send. On blur — not on submit, before any proof is built — the app calls the free `get_public_key` view. If zero, the form transforms instead of erroring:

> `This address has no account on this protocol. Private funds cannot reach it — the protocol rejects transfers to an unregistered key.` — `Send them an invite` · `we pay their registration`

(WhatsApp's "not on WhatsApp → Invite" converted into a payments primitive.)

**Door B — deliberate.** Account menu: `Invite · 3 left · 1 more in 19h` (allowance numbers ADAPTED from Bluesky's model, tuned to the sprint). Exhausted → onDisabledPress: `No invites left. One returns in 19 hours.`

**Composer.** `They cannot receive private funds until they register. This invite pays their registration.` Optional amount field; if filled: `Held as your intent until they claim it. Take it back any time — taking it back is free, because nothing has moved yet.`

**Link.** `strk20app.xyz/i/7f3a2b` — six opaque characters, one-time, no key material, no note data. Prefilled share text, plain, editable: `I set up an account for you on [App]. It is already paid for. strk20app.xyz/i/7f3a2b`

**Recipient.** The invite landing is the cold open from §1 with one row added at the top: `abu invited you. Creating an account costs one Starknet transaction, about $0.25. abu's invite covers it once.` Primary `Create your account`; text link `Look around first` (dismisses the row, invite stays valid). If money is attached: `abu also sent you 25.00 USDC. It is waiting for you.` The path must work on a cold phone with no wallet, no extension, no STRK — it is a local key plus our sponsored transaction. Conversion screen 4's title becomes `abu is covering your registration.` — attribution is the accountability mechanism.

**Settlement — corrected, no relayer escrow.** The relayer must not open the funding channel itself: every release from one relayer identity would serialize globally on `INDEX_NOT_SEQUENTIAL`, one stuck release would block all others, and the row `from abu` would be a provenance lie. Instead the attached amount is a client-side intent held by the sender. When the recipient's registration lands, the sender's app is notified and **abu opens the channel himself** — correct sender on-chain, correct index space, and take-back genuinely free. Invitee copy while waiting: `abu is sending you 25.00 USDC. It lands once abu's app is open.` Fallback for offline senders, if ever built: a pool of N registered escrow identities, rows labelled truthfully `released by [App] on behalf of abu`.

**Sender's view.** An ordinary activity row with slot-swaps: `Invite 7f3a2b · not opened` (static neutral ring — the clock runs, nothing is stuck) → `opened, not registered` → `abu → mia · registered` → or `Invite expired. Nothing had moved.` No toast; the 1.2s row highlight.

**Abuse limits, five layers.** (i) Scarce allowance, named inviter, and a public invite line on every profile — `Invited by abu` — because Bluesky proved scarcity alone gets defeated by resale; a visible tree lets an abusive subtree be disabled in one operation. (ii) Sponsorship covers registration only, never balance; a farmed account can receive but cannot send, so it is worth zero. (iii) One sponsorship per code, burned server-side under a lock *before* submission; a losing simultaneous claimant sees `This invite was already used. abu can send another, or you can create an account from a funded wallet.` (iv) A global daily sponsorship budget that fails into the pay-your-own-way path, never a locked door: `Sponsored registrations are paused until 00:00 UTC. You can still create an account from a funded Starknet wallet.` (v) The relayer credential lives server-side, never in the bundle.

**Why this is economically sane.** Registration is a zero-deposit `SetViewingKey`; a zero-deposit action sets no screening subject, so a sponsored registration should be AML-immune — verified in source for the invoke path, **LIKELY only** for the registration phase. One sponsored registration must be banked on mainnet in week one before this flow ships (§9, Q2).

---

## 3. KEYS, BACKUP AND RECOVERY

**The model.** One locally generated Account Key. The UI word is "Account Key" everywhere; "viewing key" appears only inside technical disclosures. A fixed definition travels with every rendering of it: `Reads your notes. Signs your spends. There is no read-only version.` Never derived from a wallet signature — 46 of 51 measured registrants are Ready smart accounts across two class versions; upgrades happen, and a signature-derived key would orphan funds forever. A passkey may WRAP the key for device lock; it must never DERIVE it (same trap).

**The ceremony** is the two-secret split shipped by Railway and 1Password: a generated Recovery Code (we never see it; not user-chosen — we have no vault to backstop a weak password) plus an encrypted Recovery File that is useless alone. It runs at conversion screen 3 and gates registration (§1). Done-screen copy is an inventory, not a congratulation:

> `What this protects against: a new laptop, a cleared browser, a lost phone. What it doesn't: anyone who gets both the file and the code has your balance, your history and your messages, permanently. There is no revoke and no rotation.`

**Periodic verification** (Signal's cadence, 3d → 7d → 14d → 28d, advancing only on sessions with a shielded balance; a failed check steps the interval backward): a file-drop plus code field, decrypted locally, compared to `get_public_key(addr)`. `This happens in your browser. Nothing is uploaded.` On failure: `That file and code don't open your key. Your notes are fine — the backup isn't. Make a new one now.` Re-wrapping copy must never imply revocation: `Your Account Key stays the same — it cannot be changed. Your old Recovery File still opens it with its old code, and nothing can invalidate that. Delete the old file yourself.` A value-escalation re-confirm fires when shielded value crosses a threshold (25 USDC — GUESS), gated on amount changes, not price moves.

**The four footguns, answered honestly:**

**No rotation.** Exhaustively verified: all 45 deployed pool functions enumerated; no rotate, replace, revoke, or delete exists. Settings carries a plain text link `I think my key is exposed`, opening on what we cannot do first: `Your key can't be rotated. The pool's own source says: "The key is immutable once set; re-registration reverts via WriteOnce enforcement." What we can do is move you: a new key, a new address, every spendable note swept across.` Then, same weight: `Whoever holds the old key can still read every note ever sent to the old address, including future ones. Moving stops new money landing where they can watch. It takes nothing back.` Cost screen quotes high per the brief's buffer rule: ~14 STRK per leg, ~6 minutes for 8 notes (sweep legs are heavy `ComputeAndInvoke` transactions; maturation alone is 8 × ~17s), fee read live, queue strictly serial (`INDEX_NOT_SEQUENTIAL` makes parallelism a revert, not an optimisation), largest notes first (`If someone already has your key, they can spend these too. Move the largest first.`), pausable between notes, with proof-expiry (Failed→Replaced, history never rewritten), `SCREENING_REQUIRED` (the git-main policy flip) and relayer-balance-precheck all in the failure set. Retiring the old address is the one place the full GitHub/Railway ceremony is earned: three specific acknowledgements, type the last four characters, critical button. Afterwards the old address renders with a calm grey `Retired` chip forever — still decryptable, never offered for copying.

**The registration collision (ForeignKey).** The `get_public_key` pre-flight is free and runs before every create and restore, because the alternative is a paid revert surfacing as the raw string `NON_ZERO_VALUE` after the relayer has spent the fee. Screen: `This address already has a STRK20 key — registered at block N. One key per address, written once. Notes sent here are encrypted to the other key; this app would show you an empty account forever.` A detail row shows the registered key with `Check this yourself ↗` re-running the call live. Two equal exits: `I have that key — paste it` (verified locally via `derive_public_key` before anything submits; the paste field carries a phishing warning in MetaMask's register first — `If anyone asked you to paste a key here, you're being scammed`) and `Use a fresh address instead`. If the RPC is down, block — never proceed on an unknown.

**No watch-only.** `open_channel` asserts the viewing key is the spending authenticator; any read-only affordance would hand over spend authority. The three things people want watch-only for get real replacements: bookkeeping → `Export activity` (client-side CSV/statement, with a per-column include toggle and its own disclosure block: `Your Account Key can also spend, so never hand it over. Hand over this file instead.`); a second device → restore the wallet there (`There's no watch-only key on STRK20. To see this account elsewhere, restore it there.`); the demo → the published persona, labelled as a real spending key on purpose (§1). Never ship: a read-only toggle, an observer link, a padlock icon.

**Auditor escrow.** Told once, at the registration review, as a permanent row in the fee-row anatomy — grey chip, no acknowledgement checkbox, because a warning implies a choice and there is none. Expanded: `Every STRK20 registration writes an encrypted copy of your key on-chain, readable by anyone, decryptable by whoever holds StarkWare's auditor key. Written once, no opt-out, no rotation. Because StarkWare can change the auditor key later, yours stays encrypted to the key live at your registration block — for you, block N.` With `Check this yourself ↗` printing the three stored felts. (Empirically the auditor key has never rotated; the registration-block pinning is stated as a fact, not sold as a discovery.) Thereafter it is the fourth column in every visibility matrix. The dead-end screen for a user with nothing (`Nothing here can be restored`) carries the one correction no other product needs: `An encrypted copy of your key does sit on-chain, encrypted to StarkWare's auditor key. StarkWare could decrypt it. We can't, we can't compel them, and there is no process to ask. So it isn't a route back — it's just why we won't tell you nobody can ever read this.` After that screen, `backupTriggerPolicy` flips to the conservative trigger for the new identity. A build-time lint fails on eight strings: `end-to-end`, `E2EE`, `only you can`, `zero-knowledge` (as a privacy claim), `watch-only`/`view-only`/`read-only`, `your address never appears`, `amounts are private`, `unlinkable across surfaces`.

---

## 4. EVERY NON-HAPPY STATE

Colour discipline throughout: the most common error gets no colour (relabelled button); recoverable failures are amber with inline retry; grey is for facts and administrative stops; red is spent only on the irreversible (bridge burn). Classification precedes copy: an unreachable service and a negative determination must never share a string.

| State | Trigger | What is shown | User can do | Copy (exact) |
|---|---|---|---|---|
| Empty (ACTION class) | Zero balance, new account | 2–3 action cards, no illustration | Receive / fund | `No private balance yet. When you shield tokens, or someone pays your receive address, your notes appear here.` |
| Empty (STRUCTURAL) | Protocol forbids the act | Education + a path, never a failing CTA | Invite (→ §2) | `0x04f2…9c1a hasn't registered a key. You can't open a room with them yet — the pool requires both sides to be registered.` — `Copy invite link` |
| Empty (NOTHING) | Genuinely nothing | One left-aligned neutral sentence; Activity defaults to the Global tab so the app is never blank | — | `No activity yet. Actions you take appear here as they confirm.` |
| Insufficient balance | Amount > shielded balance | Typed number, symbol and balance line turn critical; button relabels; zero reflow, no banner | Lower amount / fund | Button: `Not enough shielded USDC` |
| Proving | Any pool action submitted | Indeterminate 750ms ring + elapsed counter (hosted third-party prover — never a determinate fill, never phase names we can't observe) | Navigate freely (pipeline detaches to shell row); cancel any time pre-submit | `Proving — 0:14 elapsed` → 20s `Still proving. Don't close this tab.` → 10min `This is taking longer than normal. [Prover status ↗]` |
| Prover down / rate-limited | Health check or prove call fails | Full strip; all six surfaces' actions stop; confirmed state stays readable | Wait; visible backoff | `We can't reach the proving service. Proving and compliance screening both run on StarkWare's hosted service — it isn't ours and we can't route around it. Your notes and history are unaffected; they decrypt locally from your key.` |
| Maturing | Note < 10 blocks old | Chip `maturing (6/10)`, static ring, never a percentage; quote 12, deliver in 10 | Wait; everything else usable | `Spendable in 4 more blocks (about 7 seconds).` At zero: `Available shortly` — never a negative |
| Proof expiring | Block 400 of 450 | Amber chip `expiring`, quiet countdown row | Submit or let lapse | `Proof valid for 50 more blocks (~1 min 30s).` |
| Proof expired | Block 450 (~13 min) | Inline re-consent row in the fee row's slot, identical height; dead Prove step stays greyed as Replaced; if terms moved, the delta renders for re-consent | `Regenerate` | `Proof expired at block 13,412,556` — `Regenerate`. Clock-skew variant: `Proof expired immediately. Your device clock may be wrong.` |
| Pool paused | `is_paused()` flips (two consecutive positive reads — never from a failed RPC call) | Reflowing hairline strip, grey; CTAs → onDisabledPress; detail panel lists WORKS (balance, history, Global feed, open chat rooms, drafts, browsing) and STOPPED (every pool transaction) as a list, not prose | Read everything; queued actions never auto-fire on resume | `The pool is paused by its operator. Reading works; new actions resume when it does.` Chat line renders only for users with ≥1 open room AND healthy transport: `Chat still works — messages travel off-chain.` Else: `New rooms can't open while the pool is paused.` |
| Pool upgraded | Pinned class hash mismatch (upgrade delay is zero) | Distinct, more serious strip; both hashes in mono | Wait for re-verification | `The pool was upgraded at block N. We've stopped new actions until we've verified our contracts still work with it. Your notes are unaffected.` |
| Screening declined | Prove response returns no attestation (fails at Prove, not on-chain — nothing was ever submitted) | Prove → Failed; Relay/Mature never activate; grey, no shield icon, no "flagged", subject is the deposit never the person | Different funding address (only while the pinned class hash matches the tested version); ask the operator; keep receiving | `This deposit wasn't approved to enter the pool. Nothing was submitted — no transaction was created, no tokens moved, no fee was charged. Every deposit is screened by a compliance provider the pool operator chose; we don't receive a reason and can't override it.` + `You can still receive privately — anyone already inside the pool can pay you.` |
| Screener unreachable / rate-limited | Timeout / 100 req-min limit | Amber, retryable — never merged with declined; ambiguous classification defaults here | `Try again` | `We couldn't reach the compliance screener. Nothing was submitted and nothing was charged. Try again in a minute.` |
| Relayer down | Submit fails after visible retry ladder | Amber strip, backoff counter; only after the ladder: Signal-shaped trust-boundary modal offering self-submit, safe option primary, visibility-matrix delta showing exactly which cells change | Wait (default) / self-submit from a connected wallet (checklist: ≥14 STRK p90, one-time ERC-20 approval — checked live) | `Our relayer isn't responding. Nothing can be submitted right now. Retrying — next attempt in 0:14.` Self-submit consequence row, permanent on that transaction's history: `self-submitted`. Fee-safety copy derives from mode: self-submitted failures add `Your wallet paid network gas for the failed attempt.` Cold visitor with no wallet: `There's no way to submit this yourself without a funded wallet. We'll run it as soon as the relayer is back.` |
| Relayer allowance exhausted | Healthy relayer, `apply_actions` reverts on the standing ERC-20 approval | Detected and monitored server-side against a floor; user sees the relayer-down state, ops gets paged | — | (internal state; never surfaces as a distinct user string) |
| Insufficient anonymity | Set below tier threshold (thresholds from the real distribution, not round numbers) | Never blocked. Tier 0: one neutral line. Tier 1: amber CTA + two named alternatives. Tier 2: critical headline, CTA relabels `Exit anyway`. Exact integers, denominator named, never rounded | Proceed / wait / split | Tier 1: `Your exit is one of 12 possible sources. Twelve is not enough to hide you.` — `[Wait for more deposits] [Split the amount]`. Time axis: `[live] addresses shielded USDC in the last 24 hours.` Amount axis: `The largest crossing this pool has ever carried is [live] USDC. A larger exit would be the largest ever made and trivially identifiable.` |
| Unregistered recipient | `get_public_key` = 0 on blur | Form transforms; not an error state | Invite (§2) | See §2 Door A |
| System notes | Any message-only action (every invoke must carry a WriteOnce action) | 1-wei notes labelled in Activity, filterable with visible filter state | — | `System note — the pool requires one per message-only transaction.` |
| Second tab / device | BroadcastChannel detects a peer | Key persisted before any submission, so both tabs share one key (a race is a harmless duplicate, never two divergent identities); leader lock owns channel-open submission | Continue in the owning tab | `This account is open in another tab. That tab is submitting.` |
| No backup + balance > 0 | The one persistent nag | Reflowing hairline strip, not red, not dismissible, gone forever once a backup exists | Back up | `This account has no backup. Save it.` |

---

## 5. THE MOMENT AFTER SUCCESS

No confetti, no "Success", nowhere. Every success notification restates the operands (Uniswap's grammar — its only bare "Transaction confirmed" is the fallback for an undecodable transaction).

**Wallet (send/receive).** The row gains its timestamp in the slot the ring occupied — no reflow — and plays the 1.2s highlight once. If the tab is backgrounded, `document.title` becomes `1 note ready — [App]` and the favicon swaps until refocus (gated by a setting, default on, because it fires during screen-shares). Clicking the row opens `/activity/<id>` — an addressable receipt: amount, counterparty, block, note commitment in mono, the fee actually charged (runtime read), and the four-column visibility matrix. Actions: `Copy receipt link` (redacted by default — amount, block, payment-proof hash; the full version including the commitment is a second explicit action with a critical disclosure line), `Download receipt` (sender-only, Wise's asymmetry — only the holder of the note secret can generate it), and `Send back` — the send form pre-filled with counterparty and amount, the highest-value next step in any payments app. One standing line on the Activity header, per the accepted decision: `This list is assembled in your browser from your key. On-chain, your six surfaces are six unlinkable identities — nobody else can join them up.`

**Chat (Sealed Send).** The filmable unit is the per-message on-chain seal (decision log D23), with the whole-conversation Merkle seal as the deeper option. After a seal lands, the thread gains a permanent divider: `Sealed at block 13,601,204 · [Copy proof] [Verify ↗]`. Verify re-derives the root client-side from the local transcript and shows match or mismatch — distinguishing `your local transcript differs` from `no such root on chain`. Every room header carries the disclosure the surface's expectations make mandatory: `Encrypted in transit. Free key agreement uses keys already on-chain — which means StarkWare's auditor escrow can derive this conversation's secret and read these messages, including old ones, without asking you. We don't call this end-to-end. [Who can read this ↗]`

**Swap.** Notification: `Swapped 25.00 USDC for 91.4382 STRK.` The output token moves to the FROM slot (the natural next act), the balance rolls only the changed digits, and one card appears: `Your STRK is shielded. [Send it privately] [Bridge it out] [Receipt]`. The review that preceded it stays deliberately anticlimactic — the only loud element is the disclosure block: `Visible on-chain: both amounts, both tokens, the timing. Hidden: which account owns them.` Venue named in the collapsible detail: `Routed through <venue> — this build is pinned to one venue.`

**Bridge.** Receipt at `/activity/<exit-id>`: destination hash linked out, amount, fee, matrix — and the row every demo skips: `The receiving address has USDC but no gas. It can hold and receive; it cannot send anything onward until it has gas — and topping it up from an address you control recreates exactly the link this exit removed. [How to spend from a fresh address ↗]` Next actions: `Bridge again to a different address` (the repeat is also the privacy advice) and `Copy receipt link`. A stalled crossing is a distinct resumable state, never an error: `Waiting on Circle's attestation. This will land. It cannot be cancelled or refunded. [Resume] [Circle status ↗]` — Resume is an idempotent re-poll, never a re-burn. Before any of this: the self-link detector, the one feature no rival has (accepted decision D25d) — if the pasted destination is the connected funding wallet, critical severity: `This is the wallet you funded from. Sending here republishes exactly the link you just paid to break. [Use a fresh address instead]`. Solana ships with an ATA fork, never the words "fresh wallet with no history": ATA exists → `This address already holds USDC on Solana. Delivery is proven: 9–16 seconds.`; no ATA → `This Solana address has no USDC account yet. We ask Circle to create one in flight (~+$0.19). Creating it writes a transaction on Solana, so this destination has on-chain history from the moment it is funded.` The submission calls our own ValueRouter — the deployed OutboundAnonymizer fails the "one of yours" gate and structurally cannot request ATA creation; it may appear only as a labelled upstream reference.

**Markets.** At resolution, a role-aware panel that renders only when there is real content for this viewer (Uniswap's PostAuctionPanel discipline — never a disabled bid frame): `You won — 41.20 USDC available to claim`, or `This market resolved against you. Nothing to claim.`, or nothing. The receipt shows the oracle reading or jury signatures and the pot arithmetic in a help tooltip. **With ≥2 claimable positions, the claim is a stated choice, defaulting private** — the tradeoff the traps file says must not be discovered on camera: `Claim separately — 3 transactions, ~[live×3] STRK. These positions stay unlinked.` (selected) vs `Claim together — 1 transaction, ~[live] STRK. This publicly links these 3 positions to each other.` (critical headline). Stake disclosure states the truth for open notes: `Visible on-chain: the amount and the timing. Hidden: that it was you.` — unless stakes are denominated, in which case show the per-tier count.

**Launch.** Same role-aware panel: buyer → `3,204 SYM to claim`, then the constraint stated as a constraint: `SYM must be redeemed to trade` — `Redeem now`. Creator → sweep/migrate cards that self-gate to null. Failure names where the money is: `This launch did not reach its threshold. You will not receive any SYM. The funds you committed are available to withdraw.` Every denomination button carries its live anonymity count — `4x · 37 buys this epoch` — and a count of one says so: `1x · you would be the only buyer at this size this epoch. Your buy is identifiable.` The intro modal (one screen, 440px, three numbered lines, Uniswap's shape) includes `Being first inside an epoch is worth nothing` — it defuses the gas-race instinct. The same multi-position claim choice applies here.

---

## 6. THE PREMIUM CHECKLIST

Ordered by impact per hour. Cut from the bottom.

1. **onDisabledPress everywhere** — blocked CTAs look disabled, stay interactive, explain why on tap with the 300ms shake. One component; it is the entire progressive-disclosure mechanism for five legitimate block reasons. (Design brief, verified pattern.)
2. **Key persisted before submission + BroadcastChannel leader lock** — prevents divergent-identity generation races and `INDEX_NOT_SEQUENTIAL` double-submits. Correctness, not polish; Uniswap itself has no general solution, this app cannot ship without one.
3. **Runtime reads for every number** — fee from `get_fee_amount()`, counts with block stamps, no baked durations. A judge disproves a hardcoded number with one `starknet_call`; three prior research passes had wrong counts.
4. **CI lint on the eight banned strings** — one stray "end-to-end" in a README costs more than any feature gains. (Sponsor scores against overclaiming.)
5. **Copy feedback that names what was copied, plus the failure string** — `Receive address copied`, `Encrypted key copied`, `Couldn't copy to clipboard`. Uniswap ships eleven named variants and the failure case; `Copied!` is the single cheapest tell.
6. **Success notifications restating operands** — `Swapped X for Y`, never `Success`. (Uniswap: the bare string is reserved for undecodable transactions.)
7. **Three distinct offline strings** — `You're offline` / `Our indexer is unreachable` / `The pool is paused by its operator`. Conflating the user's connection, our backend and the protocol is the tell. (Uniswap separates all three.)
8. **URL-as-state** — every surface, receipt, market and launch is a link; filters and chain choices sync with `replace: true` so Back leaves the page instead of replaying clicks (Uniswap, 19 call sites); `/pay/<address>` pre-fills the send form (Across's `/?to=` pattern).
9. **Optimistic rollback, three concurrent paths** — confirm on match (value + 20s submission-time window), clear on failed tx, absolute 30s timeout computed from elapsed so remounts don't restart it; timed-out rows become `Submitted, not yet indexed — [check on Voyager ↗]`, never vanish. Plus the `initialized` flag so empty is never confused with unloaded. (Uniswap `useLoadUserBids`, every constant verified.)
10. **Poll at block cadence, keep polling 200 blocks past an event's end** — indexers lag; a bid landing in the final block must not disappear. (Uniswap.)
11. **Command palette on `/`** — visible as a real-text chip in the search affordance (Polymarket ships it live), bound on KEYUP, never inside inputs, Escape works even inside inputs; palette scoped to the active identity and labelled when that identity is the persona.
12. **Checksum-cased truncation `0xae2F…aE13`** and full, chunked, never-truncated addresses at the one place ellipsis is unacceptable — the bridge destination. (Uniswap live DOM.)
13. **Per-digit number rendering with tabular-nums** — only changed digits animate; `prefers-reduced-motion` honoured at every animated-number, loader and progress call site. (Uniswap, seven verified call sites.)
14. **Footer legitimacy cluster** — `Docs · Status · Contracts · GitHub <sha> · Build <cid> · Report a bug`, with the Contracts page generated at build time from the same constants the app imports so it cannot drift, listing ValueRouter with the free checkable sentence: `ValueRouter holds no storage, no balance, and never leaves a standing allowance.` (Privacy Pools, Polymarket, Across all ship this cluster.)
15. **Telemetry anonymization** — the `anonymizeLink` pattern extended to Voyager/Starkscan, note commitments, nullifiers and the persona key, before anything reaches Sentry or a log. (Uniswap ships the utility.)
16. **Static OG pre-render per route + client-side metatag hook** — works on IPFS/GitHub Pages (middleware does not), and the client hook covers Safari's share sheet, which reads `og:url` instead of the actual URL. (Uniswap's documented reason.)
17. **Dismissible one-line announcement bar** that reflows layout via a height variable — the incident/changelog surface. (Privacy Pools ships one, currently carrying a security note.)
18. **Scroll key per page type + header hysteresis (compact at 100px, expand at 60px)** and skeletons as shape-matched invisible placeholder strings so nothing reflows. (Uniswap.)
19. **Skip-to-main link and a notifications live region with a documented hotkey.** (Polymarket and Uniswap, live.)
20. **Deterministic avatars** hashed from the canonical address form, curated palette with light/dark pairs. (Uniswap's Unicon, ~30 lines.)

---

## 7. THE DOCS PACKAGE

Documentation is 15% of the score and the sponsor scores against overclaiming, so the highest-value page is the one no rival will write.

Structure (Privacy Pools' five tiers, organised inside Diátaxis's reader-need quadrants, built on Docusaurus or equivalent):

1. **Overview** — what this is, in Aztec's register: describe the data structure and who can read it, never the maths. ("Notes are encrypted records on-chain; your Account Key is what turns them into money.")
2. **What is and is not private** — the flagship page: the identical You / Relayer / Everyone / Auditor matrix the app renders on every review, published as a table, per surface, including the auditor escrow, the public deposit, public swap/launch/market amounts, the client-side-portfolio disclosure, and the Solana ATA caveat. Generated from the same source of truth as the in-app component so app and docs cannot drift.
3. **Using the app** (how-to guides) — first account, invite someone, backup and restore, retire and move, bridge out, each mirroring the in-app copy.
4. **Protocol components** (explanation) — the six surfaces, the relayer, the bootstrap deadlock and how sponsorship resolves it, the one-action-per-transaction constraint and what it forbids (order books, batching — nothing has ever settled more than one note per transaction, and no batch economics are claimed until one real transaction proves them).
5. **Technical reference** — contract addresses with explorer links (ValueRouter as the invoked contract; the sponsor's OutboundAnonymizer only as a labelled upstream reference), the fee read, the error-string translations (`NON_ZERO_VALUE`, `INDEX_NOT_SEQUENTIAL`, `RECIPIENT_NOT_REGISTERED`, `SENDER_NOT_AUTHENTICATED`, `SCREENING_REQUIRED`), and Deployments.
6. **Reproduce it** — licence, build instructions, the pinned pool class hash, and how to verify the running build against the repo (IPFS CID in the footer).

The README carries the paragraph explaining why there is no viewing key in the UI, with the `privacy.cairo` line numbers for the spending-authenticator assert.

---

## 8. WHAT WOULD MAKE THIS FEEL LIKE A DEMO

The explicit anti-pattern list. Any one of these reintroduces the demo nature Abu rejected.

- A splash screen, a "Launch app" button, or a marketing route in front of the product.
- A "Demo mode" banner, watermark, or "Exit demo" button. The persona is an account, not a mode.
- `Initializing...` as an unstyled paragraph — the leading Ethereum privacy pool's actual cold open, and the exact bar to clear.
- "Connect wallet" as the primary CTA or the only thing on screen. The wallet is a funding rail; the primary CTA is `Create your account`.
- Unlock ceremonies, tours, checklists, progress rings, "3 of 5 steps completed". Surfaces are ranked, never unlocked; day ten differs from day one because the user's data accumulated, not because the software decided they were ready.
- Confetti, celebration screens, exclamation marks, emoji.
- Scrimmed modals at the identity moment. Exactly one modal exists in the first week: the bridge trust boundary, and it earns its force by being alone.
- Greyed-out buttons that don't explain themselves. Every blocked CTA is onDisabledPress.
- `Copied!`, `Success`, `Error`, `Something went wrong` — copy that doesn't name the object or operands.
- Percentage bars for block waits; countdowns that go negative; determinate progress on someone else's computation (the hosted prover gets a ring and an elapsed counter, never a fill).
- Red for recoverable failures. A relayer hiccup rendered red looks broken on camera.
- Hardcoded fees, counts, or durations — including "about 20 seconds" before proving is timed, and any user count a judge can disprove with one call.
- Padlock icons, "end-to-end encrypted", "fully anonymous", "your address never appears" (banned until the relayer is proven), "watch-only", "no history" for Solana.
- Sad empty-state illustrations and desperate filled CTAs. Empty states are a line icon, one teaching sentence, one link — and only the Launch surface earns a filled "create the first one".
- Optimistic money. Balances never move before confirmation; escrow-pending amounts render as their own labelled state; a phantom balance is the one place this app cannot be optimistic.
- Dead links: an empty status page, a support link with nothing behind it, a `/nfts`-style residue route.
- History rewritten. Failed steps stay visible as Replaced; self-submitted transactions keep their tag forever.

---

## 9. OPEN QUESTIONS

Ordered by how much of this brief each one gates.

1. **Prover round-trip wall time — unmeasured, gates everything.** Proving runs on StarkWare's hosted service; nobody has timed a real prove from a browser. It decides the conversion moment, the invite (a stranger on a phone will not wait minutes), the copy ladder, and whether the 3-minute video can show a live registration. Hard ceiling: 450 blocks ≈ 13 minutes, past which proving isn't slow, it's impossible. **Time one real proof, laptop and phone, before any first-run code.** The free mitigation — start the prove at conversion screen 2 — ships regardless.
2. **Is a sponsored `SetViewingKey` screening-immune?** Verified in source for the invoke phase; registration is a different phase. LIKELY. Bank one sponsored registration through the relayer on mainnet in week one; if screening applies, the entire invite economy changes.
3. **Can the pool register a key for an undeployed (counterfactual) address, and what does account deployment cost?** The sponsorship arithmetic covers the pool transaction only. Either answer changes conversion screen 4's copy.
4. **Is the receive address a pure function of the Account Key?** Pins whether a pre-registration key is genuinely free to abandon, and therefore where the backup trigger can safely sit. Design requirement to fix in the account-contract spec.
5. **Restore-time channel index recovery.** `get_num_of_channels` is recipient-side (verified wrong for this use). The proposed primitive — probe `get_outgoing_channel_info(compute_outgoing_channel_id(addr, key, i))` upward — is a GUESS until tested on mainnet.
6. **The relayer's standing ERC-20 allowance** — the most likely real relayer failure is allowance exhaustion presenting as a silent revert. Needs monitoring with a floor before judging week.
7. **Chat transport ownership.** Who hosts the off-chain relay? The pause banner's `Chat still works` is conditional on transport health, and the claim must be exercised against a paused pool and a stopped relay before it ships.
8. **Solana ATA creation through our ValueRouter's extended hook** — the ~$0.75 day-one probe. No Solana word ships before it passes; the EVM copy ships either way.
9. **Sealed Send vs whole-conversation Merkle seal** — D23 specifies the per-message on-chain seal as the filmable evidence path; this brief carries both, with Sealed Send as the video's spine. Confirm with Abu before the chat spec freezes.
10. **Fee-on-revert semantics** — the "no fee was charged" family rests on screening failing at the prover (verified path) plus Starknet revert rollback (platform semantics, not re-executed on mainnet). One deliberate reverted transaction would close it. Self-submit mode already carries its own gas-honest variant.
11. **Xverse** — the sponsor's docs name Ready or Xverse; Braavos is unsupported and has its named failure state. A 15-minute Xverse check buys demo robustness.
12. **Invite allowance numbers** (3 per account, 19h regen, 7-day intent expiry, 25 USDC backup-reconfirm threshold) — all ADAPTED/GUESS. Defensible product decisions; they are not sourced values and must not be presented as such.
