# Product vision

> **Rule for this file:** what Abu said and what the agent inferred are kept separate. If a line is in
> the inference section, it is a guess and Abu can strike it.

---

## Part 1 — What Abu said (his words, his framing)

### The core thesis: one app

- *"I'm just putting them into a single app."*
- *"There's no idea complementing each other. They can complement each other, but I don't want you to
  make a compromise."* — the pieces do **not** have to justify each other.
- *"Wallet is wallet. It does all this wallet stuff, the other stuff too I told you about."*
- *"If it's a messaging app, you can just go message your friends."* — each piece should be itself, not
  bent to serve another piece.

### The Uniswap analogy, in his words

- *"I'm taking inspiration from Uniswap: see how that works."*
- *"Some stuff might exist in Uniswap, like this swapping, bridging these tokens, these pools, all of
  those things. That works and everything, **but you can launch your own token. I also want to have
  that, so confidentially**."*
- *"Why Uniswap? Uniswap has lending, yes... he has everything that you can think of... I think that
  that does solve a problem."*
- Reference links he gave: <https://github.com/Uniswap/interface> · <https://app.uniswap.org/>

### What goes in the app

Selected by Abu from the sponsor RFPs (pasted verbatim in `../rfps.md`):

| Piece | RFP | His words |
|---|---|---|
| **Umbrella / Umbra-style privacy wallet** | Idea 10 | *"the umbrella-style wallet style that receives private stake freely with an existing Stark pool, no protocol change"* |
| **Private cross-chain bridge** | Idea 22 | *"since this is a wallet, bridging also counts as part of wallets"*, *"I would like us to do the bridge too"* |
| **Bonding-curve token launch, hidden buyers, visible price action** | Idea 04 | *"you can launch your own token. I also want to have that, so confidentially"* |
| **Confidential token launch** | Idea 17 | *"I'm also thinking another one is confidential. So it's confidential token launch too"* |
| **Swap** | — | implied by the Uniswap analogy: *"this swapping, bridging these tokens, these pools"* |
| **Encrypted on-chain messaging** | Idea 01 | *"more of a chat app"*; unsure where it fits — *"just brainstorm, okay?"* |
| **Prediction market** | Idea 07 | raised by him earlier; **later questioned** — see open questions |
| **Confidential voting** | — | *"I would like us to also have votes in too... that can be an MVP... maybe later, because at least let all this stuff be in place first"* |

### What Abu explicitly dropped

- *"Forget about those yield and everything I told you earlier on. I've said a lot of stuff that are
  actually even confusing."* → **yield, savings, the card, and the AI-agent/MCP framing are out** of
  the current direction unless he reinstates them.
- On private savings, earlier: *"If I wanted to save, why would I be saving in a private listing?...
  No one really gives a fuck like that."*

### On depending on other protocols

- *"We don't need to pull ecosystem tools. It's not really worth it because why do I have to be
  bringing ecosystem stuff into my own application in a single place? It doesn't really make sense."*
  → **build our own helper contracts rather than integrate Vesu / Endur / Troves.**

### How Abu wants the agent to work

These are standing instructions, not preferences for one task:

1. **Competitor presence is intelligence, never a veto.** *"I hate when you tell me that someone is
   building and I cannot build... are you giving the ring over to them?"* Report what rivals built, how,
   where they are weak, and what beats it. The only valid reason to drop a direction is that we cannot
   execute it better.
2. **Participants ≠ ecosystem infrastructure.** Rival entrants compete with us. Sponsor protocols are
   integration targets. Never present the second as a collision.
3. **Research before asserting.** *"Research is a very, very good thing."* Two agent claims were
   overturned by verification (see `05-decision-log.md`) — one of them could have cost the sprint.
4. **Do not pre-conclude, and do not scale the work down unilaterally.** Scope decisions are his.
5. **Document as we go.** Context must live in the repo, not in chat.

---

## Part 2 — Agent inference (guesses — Abu can strike any of these)

- **The product is "the Uniswap of private Starknet":** one app where you hold, send, swap, bridge, and
  launch a token, all confidentially. Voting later.
- **Novelty per-piece is not the pitch.** Uniswap's swap was not novel either. The bet is coherence and
  execution — being the one place all of it lives.
- **Idea 04 is buildable and Idea 17 is not** (Enclave does not exist; see `02-verified-technical-facts.md`).
  Inference: build 04, and document *why* 17 cannot ship today as a depth argument.
- ~~**The messaging piece is cheapest as a memo mode**, not a chat tab — because the 6 STRK pool fee is
  per *transaction*, not per action, so a memo riding an existing transfer is free while standalone
  chat costs ~9 STRK per message.~~ **STRUCK BY ABU, 21 Aug — see D13.** He wants a real chat
  application. The cost figure stands as a fact; using it to shrink the product was the error.
- **A wallet cannot be built on the Wallet API** (no registration, no history, no viewing key), so the
  app is an SDK-route in-browser derived account. This also makes the demo login-free.

---

## Part 3 — Open questions

**Resolved 21 Aug** — see `05-decision-log.md` D13–D17:
~~2. Prediction market in or out~~ → **IN** (D14) · ~~3. Messaging chat or memo~~ → **CHAT APP** (D13)
~~5. Scope vs deadline~~ → **not a constraint** (D16) · ~~1. Center of gravity~~ → **deferred to the
designer** (D17)

### Still unresolved

1. **The account model — Abu's live question.** In his words: *"we have a wallet and we also have some
   stuff that might not be dependent on our own wallet… in a DApp application you don't have to
   connect wallet… Same way you go to Uniswap and you connect a wallet. And in fact, we're also doing
   an umbrella wallet style… you could log in via passkey, or I don't know however the fuck you're
   thinking about that too. Everything is all blurry."*
   Four sub-questions: (a) is it custodial? (b) connect-wallet, app-native account, or both?
   (c) where does passkey fit? (d) does the Umbra-style wallet survive as a distinct thing or fold in?
   **Hard constraint on any answer:** the elimination gate requires a demo that **works without login**.
2. **Swap** — is there a private-swap RFP Abu never saved? *"I know I didn't document all the RFPs…
   I think there's a private swap. You have to go look for it."* Being checked against the live site.
3. **Paymaster** — the D9 exception, now also read against D15.
