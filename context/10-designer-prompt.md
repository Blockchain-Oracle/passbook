# Designer prompt — paste this whole file

*A cold-start brief for a designer or a design tool. Assumes no prior knowledge of the project,
of Starknet, or of privacy technology. Everything factual here was verified against live mainnet or
real source between 20–21 Aug 2026.*

---

## What you are designing

A web app that lets people **hold, send, swap, bridge, message, bet and launch tokens — privately.**
One app, six things, on a privacy layer called STRK20 that runs on the Starknet blockchain.

The closest reference for *shape* is Uniswap: many separate financial tools that somehow feel like one
coherent product rather than six apps stapled together. The reference for *tone* is a precision
instrument — calm, dense, exact.

**It is not a marketing site, a casino, or a crypto-bro product.** No hype, no rocket emoji, no neon.

---

## How the technology works, in plain terms

You do not need to understand cryptography, but these five facts drive nearly every screen.

1. **It is a shared safe.** Putting money in is public — everyone can see who deposited and how much.
   What you do *inside* is private. Taking money out is public again. **The privacy is in the middle,
   not at the ends.**

2. **Your money inside is a set of "notes"** — receipts only you can read. A note is not spendable the
   instant it is created; it needs about **17 seconds** to settle first.

3. **Everything is slow and multi-step.** Every single action goes: build → generate a mathematical
   proof → submit → wait for settling → done. The proof **expires after about 13 minutes** if the user
   walks away. This waiting state is the most-used screen in the entire product and deserves the most
   design attention.

4. **Every action costs about 25 cents.** Not free. This shapes what should be one action versus many.

5. **Privacy here is partial, and being honest about that is the product's main differentiator.**
   Specifically: deposit amounts are public; transaction amounts are public whenever private money
   touches a normal app; and a copy of the user's viewing key is stored on the blockchain for a
   regulator, permanently, with no way to opt out. **The app must never claim to be "fully anonymous"
   or "end-to-end encrypted", because both are false and checkable in ten seconds.**

---

## The core insight the design must carry

Privacy is not a padlock icon. **Privacy is how many other people are doing the same thing at the same
time.** If you are the only person withdrawing $500 today, everyone knows it was you, no matter how
much cryptography sits underneath.

Right now that crowd is **tiny**: about 142 people have ever registered, and only **6 addresses** moved
USDC in the last 24 hours.

Competing products hide this. **This one shows it** — the real number, on screen, while the user is
still deciding. Research checked Railgun, Privacy Pools and Railway: **not one of them shows a user
their anonymity set.** There is no prior art. This is the thing to design.

---

## The signature element

**A field of small points. Each point is somebody else's note. One warm point is yours.**

It does two jobs with one image:
- It is the **privacy explanation** — your crowd, drawn, at its true size.
- It is the **waiting screen** — during a transaction the field fills in and your point begins to glow.

Thirty seconds of a spinner teaches nothing. Thirty seconds of a crowd assembling teaches the user
exactly what they bought. **Prototype this first — everything else is downstream of it.**

---

## The six surfaces

| Surface | What a person does | Design note |
|---|---|---|
| **Wallet** | Sees their private balance, an address to receive at, and history | Not a separate product — the floor everything else stands on |
| **Chat** | Real encrypted messaging. Send money attached to a message | Messages are **free**; only sealing a conversation or attaching money costs anything |
| **Swap** | Trade one token for another privately | Hides *who*, not *how much*. Never imply otherwise |
| **Bridge** | Send money out to a fresh address on Base, Arbitrum, Polygon, Ethereum or Solana | The recipient needs **no wallet and no gas** — it just arrives |
| **Markets** | Bet on outcomes. Everyone sees odds and volume; nobody sees who bet | Pot-split (like a racetrack tote). Odds **are** the split. Price questions settle automatically |
| **Launch** | Launch a token. Price public, buyers hidden | Sells in timed rounds at one clearing price, so being fast is worth nothing |

**Send, swap, shield and bridge are the same form with the destination changed.** They should be one
component with a mode, not four screens. Learning one teaches all four.

---

## Screens to design, in priority order

1. **The waiting state** — five named steps (Built, Proved, Relaying, Settling, Spendable), a block
   counter, and a proof-expiry countdown. Most-used screen in the product.
2. **The disclosure panel** — shown before signing. What this action reveals, and who can see it.
   Includes a visibility matrix: *You / Relay / Everyone / Auditor* × amount, address, note, destination.
3. **The linkability meter** — the real crowd size, right now, for this action.
4. **The amount form** — one component serving send, swap, shield and bridge.
5. **First run** — a brand-new person's first 90 seconds. See the constraint below; it is unusual.
6. **The note field**, at 142 points and at 10,000.
7. **Chat thread**, including a money-attached message.
8. **Market card** and **launch card**.
9. **Activity feed** — one list showing all six surfaces' actions chronologically.
10. **Empty, error and recovery states** — no contacts, key lost, proof expired, service paused.

---

## Unusual constraints that will surprise you

- **The demo must work with no login at all** — a competition requirement. A first-time visitor with no
  wallet must see real, live, decrypted content immediately and be able to *do* something.
  **It must not feel like a "demo mode".** It has to read as a real product's first run.
- **You cannot send money to someone who has not registered.** So "no contacts" is a structural state,
  not an empty list — and an invite flow that pays for a friend's registration may be the single most
  valuable feature in the app.
- **There is no read-only mode.** The key that reads your history is the same key that spends your
  money. Any "watch-only" affordance would be a lie.
- **Keys cannot be rotated, ever.** If a user thinks their key is compromised, there is no reset. The
  interface has to offer something honest instead.
- **A regulator holds a copy of every user's viewing key**, on-chain, permanently, with no opt-out.
  This must be disclosed — and because it is unavoidable, **it must be styled as structure, not as a
  warning.** A warning implies a choice. Render it like a line item, calm and factual.
- **Bridging to your own connected wallet destroys your privacy.** The app knows which wallet is
  connected, so it can detect this and warn. Default the destination to a fresh address.
- **The service can be paused without notice**, including mid-session.

---

## Visual direction — "LEDGER" (chosen, not a proposal)

Selected from four rendered directions. **Light mode is the default**; dark ships alongside it.

The register is **a private bank statement, not software.** Warm paper, ink-brown text, oxblood accent.
This is deliberate: it is the correct tone for a product about money and discretion, and warm paper
with oxblood is a palette almost nobody in this space uses — so it cannot be mistaken for a fork of
anything.

| Role | Light | Dark |
|---|---|---|
| Ground | `#FCFAF6` | `#14110D` |
| Raised | `#FFFDF9` | `#1C1813` |
| Inset | `#F4F0E8` | `#221E17` |
| Ink | `#211A12` — **never pure black** | `#F5EEE4` |
| **Accent** | **`#8C2F1E`** | `#E87B60` |
| Settled | `#2E6B35` | — |
| Exposed | `#7A5A00` | — |
| Irreversible | `#A32318` | — |

**The accent marks the next thing to do, and nothing else.** It is not a brand colour to sprinkle.

**⚠️ The one thing that can sink this direction: the typeface.** A warm editorial palette is
unforgiving of a badly-chosen face in a way a neutral grey one is not. **Settle typography before
layout** — it is the highest-leverage decision left. It wants a grotesque with genuine tabular figures
and a real book weight; the warmth in the palette means it should not also be a warm humanist face, or
the whole thing tips into "artisanal coffee".

**Real brand logos are a hard rule.** Bitcoin, USDC, Ethereum, Base, Arbitrum, Polygon, Solana — real
marks, drawn as vector, everywhere a token or chain appears. A fabricated token icon is the single
fastest way to make a product read as a mockup.

**There is no colour for "pending."** The app is 90% waiting; if waiting is amber, everything is amber
and the one real warning dies. Waiting gets motion and grey.

**Type:** one grotesque, two weights. Label small and grey *above*, value big and white *below* — one
rule, every surface. Tabular figures on every number in a column. Monospace for hashes and addresses
only, **never for money**.

**Motion:** chrome responds in 80–100ms precisely *because* the protocol is slow — the user must always
be able to tell "the app is fast and the chain is working" from "this is stuck". Exits are faster than
entrances. Colour never animates. Three different waits get three different motions: proving strains,
relaying is steady, settling is a still ring with a counter.

---

## Do not

- Purple-to-blue gradients, glassmorphism, glowing shadows, decorative blur
- Display type inside the app — 36px is the ceiling
- Padlock and shield iconography as decoration
- Red for anything recoverable — red means irreversible, and almost nothing is
- Raw addresses, unformatted decimals, "Loading…", alert boxes, numbers that jump
- A dead end after a successful action
- Any copy claiming full anonymity, hidden amounts, hidden deposits, or end-to-end encryption

---

## The one sentence

**Every competitor will claim privacy and hope nobody checks. This one shows you the truth about how
private you actually are, at the moment you are deciding — and that honesty is the product.**
