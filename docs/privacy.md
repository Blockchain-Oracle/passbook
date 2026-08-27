# What Passbook hides, and what it does not

**Design authority:** DESIGN §7.5, EXPERIENCE §4.3. **Requirement:** FR-058. **Story:** 6.7.
**Source of truth:** [`packages/protocol/src/visibility-matrix.ts`](../packages/protocol/src/visibility-matrix.ts).

Every table on this page is **generated** from that module by `scripts/render-privacy-matrix.mjs`,
and it is the same module the app renders its disclosure panel from. Do not hand-edit inside a
`<!-- generated:… -->` block — change the module and run `pnpm run render:privacy`. The prose
between the blocks is hand-written and owned by whoever is editing it.

**This page cannot go stale.** `pnpm run build:web` re-renders these sections and fails the build
if they do not match what is committed here, naming the command to run. That is FR-058's actual
requirement: the app and the document cannot ship apart, and a test would only prove they agreed at
the moment the suite ran.

<!-- generated:source -->
*Generated from `packages/protocol/src/visibility-matrix.ts` and `packages/protocol/src/disclosure-copy.ts` — sha256 aa0590efa8b83a06384c2b5b54750844f1af26978b17430fe5ce00bb968b954b. Regenerate with `pnpm run render:privacy`; do not hand-edit anything between the generated markers.*
<!-- /generated:source -->

---

## The claim this product makes, in one sentence

Your six surfaces are **unlinkable to other users**. That is the whole claim and it is deliberately
narrower than the one every product in this category makes: the account view is assembled in your
browser and is not stored on chain, so there is nothing on the chain for another user to follow.

**Two parties see more, and they are named rather than footnoted.** StarkWare's auditor holds an
escrowed copy of every viewing key — `get_enc_private_key` is permissionless — so there is a third
party by construction. The relayer that submits transactions on your behalf sees the network
address a request came from and the moment it arrived. Both appear as their own column below, in
every table, permanently.

**Amount privacy is not claimed for open-note legs.** Swaps, launches and market bets touch open
notes, and every leg that does is public. Where a table says the amount is visible, it is visible.

---

## How to read the tables

<!-- generated:legend -->
| Reads as | Shape in the app | What it means |
|---|---|---|
| **Sees** | filled | This party can read it. |
| **Hidden** | hollow | This party cannot read it. |
| **Conditional** | half filled | Not a plain yes or no — the qualifier is printed with the table, and it is part of the claim. |
| **Not applicable** | a dash | This action has no such fact, so there is nothing here to read and nothing being hidden. |

**Columns:** You · Relayer · Everyone · Auditor.
**Rows:** Amount · Sender · Recipient · Timing · Network address.
<!-- /generated:legend -->

Colour is never the first channel in the app: each state renders as a shape as well as a word, so
the matrix survives greyscale, colour vision deficiency, and a screenshot.

---

## Sending

<!-- generated:pool-send -->
### Sending through the relayer

> The pool sees this transaction, not your notes.

|  | You | Relayer | Everyone | Auditor |
|---|---|---|---|---|
| **Amount** | Sees | Hidden | Hidden | Sees |
| **Sender** | Sees | Hidden | Hidden | Sees |
| **Recipient** | Sees | Hidden | Hidden | Sees |
| **Timing** | Sees | Sees | Sees | Sees |
| **Network address** | Sees | Sees | Hidden | Hidden |
<!-- /generated:pool-send -->

This is the **baseline** — what is true of any pool transaction. A receipt for a transaction this
browser did not originate shows exactly this table and nothing more specific, because the chain
cannot say which surface an action came from and guessing would falsify the claim above it.

<!-- generated:self-submit -->
### Submitting it yourself

> The pool sees this transaction, not your notes. Submitting it yourself puts your own address on it as the sender.

|  | You | Relayer | Everyone | Auditor |
|---|---|---|---|---|
| **Amount** | Sees | Not applicable | Hidden | Sees |
| **Sender** | Sees | Not applicable | Sees | Sees |
| **Recipient** | Sees | Not applicable | Hidden | Sees |
| **Timing** | Sees | Not applicable | Sees | Sees |
| **Network address** | Sees | Conditional [1] | Hidden | Hidden |

1. No relayer carries this, so nothing about it reaches us — but your wallet still hands the transaction to a Starknet node, and that node sees the request and the network address it came from.
<!-- /generated:self-submit -->

Self-submission is the fallback for when the relayer cannot carry a transaction. It costs the
sender slot: the relayer's address is what appears on a relayed submission, and your own address is
what appears on one you send yourself. The relayer column reads "not applicable" rather than
"hidden" because there is no relayer in this path at all.

---

## Registering

<!-- generated:registration -->
### Registering with the pool

> Registering writes your account address and a public key to the pool, so this account is publicly registered from then on. Anyone can look it up.

|  | You | Relayer | Everyone | Auditor |
|---|---|---|---|---|
| **Amount** | Not applicable | Not applicable | Not applicable | Not applicable |
| **Sender** | Sees | Sees | Sees | Sees |
| **Recipient** | Not applicable | Not applicable | Not applicable | Not applicable |
| **Timing** | Sees | Sees | Sees | Sees |
| **Network address** | Sees | Sees | Hidden | Hidden |
<!-- /generated:registration -->

Registration is public by construction and there is no version of it that is not: the pool stores a
key against an account address, and anyone can look that address up with a free view call. It moves
no tokens, which is why two whole rows have nothing in them.

---

## Chat

<!-- generated:chat-payment -->
### Paying inside a chat room

> The relay that carries this room sees who is talking to whom, when, how often, and how big each message is — and, because your conversation list rides one connection, which conversations share you. What is inside them stays ciphertext.

|  | You | Relayer | Everyone | Auditor |
|---|---|---|---|---|
| **Amount** | Sees | Hidden | Hidden | Sees |
| **Sender** | Sees | Sees | Hidden | Sees |
| **Recipient** | Sees | Sees | Hidden | Sees |
| **Timing** | Sees | Sees | Sees | Sees |
| **Network address** | Sees | Sees | Hidden | Hidden |
<!-- /generated:chat-payment -->

Chat is the one place the relay we run sees more than it does anywhere else. Messages travel
off-chain through it, so it sees who is talking to whom, when, and how often. What is inside the
messages stays ciphertext to us — and is legible to the auditor escrow, which can derive a room's
secret from keys that are already on chain.

Your conversations are kept in your own browser and nowhere else. The relay holds a short buffer so
a dropped connection can catch up; it is not a record, and nothing restores a conversation once the
browser storing it has been cleared. Anything sent while that browser was closed for more than half
an hour was never stored anywhere it could be fetched from later.

**The name directory is opt-in, and it is public.** Claiming a name publishes name → address on our
relay for anyone to read; that is its entire function, and it is the one thing here that links a
handle somebody chose to an address. Registration is already publicly enumerable on chain, so what
a claim adds is the label, not the address. Two things make it narrower than it could be: nobody has
to claim one — addresses work whether or not their owner did — and SEARCH is private, because a
client fetches the whole list and matches inside the browser, so the relay never learns who anyone
looked for. Taking a name back removes it from the list rather than from anyone who already read it.

---

## Swapping

<!-- generated:swap -->
### Swapping

> Visible on-chain: both amounts, both tokens, the timing. Hidden: which account owns them.

|  | You | Relayer | Everyone | Auditor |
|---|---|---|---|---|
| **Amount** | Sees | Sees | Sees | Sees |
| **Sender** | Sees | Hidden | Hidden | Sees |
| **Recipient** | Not applicable | Not applicable | Not applicable | Not applicable |
| **Timing** | Sees | Sees | Sees | Sees |
| **Network address** | Sees | Sees | Hidden | Hidden |
<!-- /generated:swap -->

A swap's amounts are public and that is not a defect being apologised for: the output re-enters the
shielded pool in the same transaction, so what is hidden is which account owns the amounts, not the
amounts. There is no recipient row to protect, because the output comes back to you.

---

## Crossing to another chain

<!-- generated:bridge-exit -->
### Crossing to another chain

> The crossing hides which shielded note funded the withdrawal. It does not hide the amount, the destination address, the destination chain, or the timing.

|  | You | Relayer | Everyone | Auditor |
|---|---|---|---|---|
| **Amount** | Sees | Sees | Sees | Sees |
| **Sender** | Sees | Hidden | Hidden | Sees |
| **Recipient** | Sees | Sees | Sees | Sees |
| **Timing** | Sees | Sees | Sees | Sees |
| **Network address** | Sees | Sees | Hidden | Hidden |
<!-- /generated:bridge-exit -->

The destination address is public to everyone, including us. Two facts belong beside this table and
are stated on the review screen itself: the crossing cannot be reversed once the burn lands, and
the receiving address arrives with no gas — topping it up from an address you control recreates
exactly the link the crossing removed.

---

## Markets

<!-- generated:markets-bet -->
### Placing a bet

> Visible on-chain: the amount and the timing. Who bet is hidden — as long as your denomination has company; if you are the only one at this size, your bet is identifiable.

|  | You | Relayer | Everyone | Auditor |
|---|---|---|---|---|
| **Amount** | Sees | Sees | Sees | Sees |
| **Sender** | Sees | Hidden | Conditional [1] | Sees |
| **Recipient** | Not applicable | Not applicable | Not applicable | Not applicable |
| **Timing** | Sees | Sees | Sees | Sees |
| **Network address** | Sees | Sees | Hidden | Hidden |

1. Stated in full in the line above this table.
<!-- /generated:markets-bet -->

The conditional cell is the honest one and it is the reason this table has four states rather than
three. A bet at a denomination other people are also betting is hidden in that crowd; a bet at a
size nobody else is using is not hidden at all, and the app prints the live count beside the
denomination picker so the condition can be checked rather than assumed.

<!-- generated:markets-exit -->
### Selling a position early

> **Nobody has written this one down.** Nobody has written the disclosure for an early market exit. EXPERIENCE §M2.3 drafts it under [ASSUMPTION] and gap G4 sends it to an FR-051 hand review, because a market-priced exit is a unique amount with none of the denomination cover an entry has — so the cells that would make it look like a bet are exactly the claim nobody has checked.
<!-- /generated:markets-exit -->

---

## Launches

<!-- generated:launch-buy -->
### Buying into a launch

> Your identity is hidden. Your amount is not. Every buy is a plaintext event; the pool hides who, and fixed denominations hide which one is you.

|  | You | Relayer | Everyone | Auditor |
|---|---|---|---|---|
| **Amount** | Sees | Sees | Sees | Sees |
| **Sender** | Sees | Hidden | Conditional [1] | Sees |
| **Recipient** | Not applicable | Not applicable | Not applicable | Not applicable |
| **Timing** | Sees | Sees | Sees | Sees |
| **Network address** | Sees | Sees | Hidden | Hidden |

1. Your buy looks identical to the other buys at the same size in this launch. If yours is the only one at that size, you are alone.
<!-- /generated:launch-buy -->

Every buy is a plaintext event. The pool hides who bought; fixed denominations are what hide which
buy is yours, and the same condition applies as it does to a bet — a size you are alone at is a
size that identifies you.

<!-- generated:launch-sell -->
### Selling before graduation

> **Nobody has written this one down.** Nobody has written the disclosure for selling before graduation. FR-046 pins the mechanism and EXPERIENCE §L6 records every sell-side sentence as unwritten, flagged for the sell spec when it is sequenced. Until then the product says the true thing instead: selling before graduation is not yet available.
<!-- /generated:launch-sell -->

---

## What is not on this page

The **linkability meter** — the live count of how much company an exit has, and the thresholds it
reads from the real distribution — is a separate component and a separate document. It consumes the
severity ladder these tables are built on; it does not replace them.
