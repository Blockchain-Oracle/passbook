# strk20.run: Demo Video Script

*Rebuilt 2026-08-31 after Abu's note that the first cut read like bullet points spoken aloud.*

## How the two skills were merged

| From `direct-demo-video` | From `failure-first-demo-video` |
| --- | --- |
| The sponsor-aware greeting, presenter identity, product name inside 10 seconds | **The shape**: familiar failure → reveal → action → explanation inside the behaviour → quiet close |
| The independent-proof beat (Voyager) | **The voice**: calm, one idea per sentence, 145–175 wpm — not 178 |
| Face camera and the closing tagline | **Fewer demonstrations.** One hero task, one escalation. The breadth montage is cut |

`failure-first`'s slower word rate is what forced the simplification: at 160 wpm a sub-3:00 video
holds about **380 words**, not 460. The previous cut had eleven beats and 455 words. This one has
seven beats and 386, and the account setup is an actual one-two-three.

**Abu's sign-off is now the last line: *"So that's all I wanted to say."***

---

## Cut Summary

- **Audience:** the StarkWare / `starkience` team judging the STRK20 Private Sprint.
- **Target runtime:** **02:39–02:54.** Hard ceiling 03:00 — the hackathon gate is "demo video ≤ 3 minutes" (`context/01-hackathon-brief.md`). A 3:20 video is not scored at all.
- **Spoken words:** 386, counted from the timeline.
- **The failure:** not onboarding friction — **absence**. The pool is live on mainnet with real money in it; there is nothing a normal person can open. The sponsor said this themselves.
- **Hero task:** a clean browser becomes a registered STRK20 account holding shielded STRK on mainnet, in three spoken steps.
- **The flex, and it lands in the reveal:** we fund them. Three transactions covered, and they arrive already holding shielded STRK — on mainnet, not a testnet faucet. Most of the field cannot say that sentence and mean it.
- **Hero proof:** Voyager shows the relayer's address as the sender, not the user's.
- **The escalation — and the actual pitch:** the disclosure panel. Straight from `docs/index.mdx`: *"It is not the privacy claim. Every product in this category claims privacy. It is that each screen names which parties can see what, before you act."*
- **Closing tagline:** *"So that's all I wanted to say."*

---

## Project Truth

### Verified live (checked 2026-08-31)

- `app.strk20.run`, `strk20.run`, `strk20.run/docs` all 200.
- Relayer address `0x6e1c309456733fa40d17a560e4802b4ca65464cec172571b8883881bb6a0389` — from `GET /api/fee-recipient`, and the same `submitter` in `evidence/sponsored-registration.json`.
- A sponsored registration puts the relayer on chain as the sender, not the user: registered `0x2bf7264a…563533`, submitter `0x6e1c…a0389`, tx [`0x4fbbf9aa…bfe27d`](https://voyager.online/tx/0x4fbbf9aa7992a95d313554bc17b2fff311b35a5974271defc6672f57abfe27d). Measured cost 8.594 STRK.
- Starter shielded balance is **3 STRK** (`STARTER_WEI`), and it rides inside the registration's own proof — the account arrives holding value rather than empty.
- **Three transactions are covered**, registration being the first (`SPONSORED_OFFER`, landing `Offer` band). A *covered* submission folds no reimbursement leg, so the pool fee comes out of our wallet and not the holder's — which is what makes "on us" literally true rather than a discount.
- First screen reads exactly `No wallet. / No email. / No seed phrase.` (`FORK_TITLE`).
- Backup cannot be skipped (`BACKUP_GATE_NOTE`); the key is set once and never rotated (`CUSTODY_BODY`).
- The disclosure panel names the auditor before the action (`AUDITOR_ESCROW`, `CHAT_AUDITOR_DERIVES`).
- Money attaches to a chat message; the amount rides on the send button (`composer.tsx`).
- 11 declared mainnet transactions, 4 declared contracts (`strk20.json`).
- **`/health` is live and public** (added and deployed 2026-08-31) — `curl https://api.strk20.run/health`.

### Verify before you narrate it

- **Houses writes in the deployed build.** The corrected Governance `0x731207e6…4babc5` landed 2026-08-30; the production bundle was not confirmed to carry it. The close says "vote" — open `/houses` and press a vote door first. If it is blocked, say "read a House's sealed ballots" instead.
- **The shielded starter has never landed on mainnet.** The banked registration (`0x4fbbf9aa…`, 24 Aug) cost 6 fee + 2.594 gas with no starter line — it predates this model. So the first cold-start take is the first live execution of a starter deposit *paid by the relayer, owned by the user*.

  **Probed free on 2026-08-31 and it looks good:** `compile_actions` on the deployed pool accepted `register + deposit(recipient = user)`, and `assertRegistrationWithStarter` confirmed the compiled note is owned by the registering account with the right token and amount. The prover then reverted only on `supports_interface` against an undeployed throwaway — the known cold-start case, unrelated to the deposit.

  **A revert costs gas, not the pool fee.** `evidence/tx-a-attempt-1-reverted.json` records `poolFeeCharged: false`, `actualFeeStrk: 2.536`, and the state read back afterwards. So a failed take costs ~2.5–2.9 STRK, not 8.6.

  **The prover is a free full dry run.** It executes the virtual transaction, so any revert surfaces there before a broadcast, at zero cost. Worth one pass with the real deployed account before recording.

### Do not say

- **Any duration.** No "in about a minute". `onboarding-copy.ts` states *"No duration renders anywhere"* and the settle rung counts blocks, not seconds. A clock in the video contradicts the app on screen.
- **Any test count.** README says 109; `surfaces.ts` claims 87 + 47 for two contracts alone. Unsettled — leave it out.
- `end-to-end`, `fully anonymous`, `untraceable`, `amounts are private`, `watch-only`, `unlinkable` — the refused list (`forbidden-claims.ts`, and `/docs/privacy/refused-claims`).
- That the deposit is hidden. Deposits are public: depositor and amount. What the pool hides is **which notes are yours afterwards**.

---

## Final Timeline Script

Calm and unhurried. One idea per sentence. Read it aloud once — if a line makes you stumble, change
the line, not your delivery.

| Time | Spoken script | Screen | Note |
| --- | --- | --- | --- |
| 00:00–00:11 | "Howdy StarkWare. Howdy `starkience`. It's Blockchain Oracle, and I'm bringing you **strk20.run**. But before I show it to you, look at this." | Two fast cuts — the hackathon repo, our `registry.json` row — then straight to a Voyager tab. Face cam lower right. | Product name lands at ~00:08. Then get out of the way. |
| 00:11–00:31 | "This is your pool. Live, on Starknet mainnet. Real money moving through it right now. The cryptography is done — you said so yourselves. So here is my honest question. If I am a normal person, and I want to use this today, what do I open? That is the part that is missing." | **The pool contract on Voyager**, scrolling its live transaction list, ~10s. Then a beat on an empty browser new-tab page while you ask the question. | The pool on Voyager is the whole cold open: it proves the cryptography is real, which is what makes the missing half land. **No third-party app pages** — don't rate other teams' work on camera. |
| 00:31–00:44 | "That is what we built. strk20.run. One page. No wallet, no seed phrase, nothing to install. And you do not arrive empty-handed — your first three transactions are on us, and you land holding shielded STRK. Real money, on mainnet. Not testnet play money. Let me make an account right now, while you watch. Three steps." | Reveal the `strk20.run` hero, hold 2s. Scroll once to the **"Your first three transactions are on us — real STRK, on SN_MAIN"** band and stop on `SN_MAIN`. Then cut to a clean browser profile, empty URL bar. | One restrained reveal cue here — the only one in the video. Hold 1s on `SN_MAIN`: that word is what makes the offer a flex instead of a coupon. **Do not say the 3 STRK figure here** — beat 5 reveals it on the balance tile, and the number lands harder unspoken. |
| 00:44–01:19 | "One. I open the page. That is it, I have an account. The key was made in my browser just now, and it never leaves. **Two.** I save it. This is the one step it will not let me skip, because you only ever get to set this key once. And watch what it does here. It tells me that when I register, StarkWare's auditor gets a copy of my key. It says that to my face, before I agree to it. **Three.** I press go, and it does the rest on mainnet." | Type `app.strk20.run` → fork screen (hold, let it read) → Create → name `oracle` → **custody screen, hold 3s on the auditor sentence** → backup ceremony, download, confirm → press start, ladder runs. | The three numbers are the spine — land each one with a beat of silence before it. **Never show the key or the recovery file.** Cut the settle wait: keep 2s of the block countdown, hard cut, 1s of it lower. |
| 01:19–01:41 | "And there it is. Three STRK, shielded, sitting in the pool. Now let us check that. Here is the transaction on Voyager. Look at who sent it. That is not my address, that is our relayer. My account is in the transaction, but it never signed it. And the app told me that before I pressed anything." | Wallet home, hold 2s on the two balance tiles. Open receipt → Voyager. **Zoom the Sender field, hold 3s.** Cut back to the app's disclosure line naming the relayer. | **HERO PROOF.** Expect `0x6e1c3094…a0389`. Retake if the sender is the user's address. Music out — the held frame is the proof. |
| 01:41–02:05 | "Now the part I actually care about. Every product in this space claims privacy. So here is ours. This is chat, with money inside the message. Before it sends, it tells me who can read it. The relay sees who I am talking to. The auditor can read the room. We put that on screen, because it is true." | `/chat`, open a thread. Attach 0.5 STRK. Open the **Who can read this** panel — hold 3s on the auditor line. Send; the amount is on the button; the money chip lands. | The escalation, and the real pitch. Don't read the whole panel — let two lines land. |
| 02:05–02:24 | "Swap, bet, launch, vote, bridge out. Same account, and every transaction is in the README to check. And a whole page of things we refuse to say about ourselves, because you told us overclaiming costs us. It's Blockchain Oracle. strk20.run. **So that's all I wanted to say.**" | Five fast cuts under the first sentence, ~1.5s each, no clicks that spend. Then the README record table → **"What we do not claim"**, hold on the refusal list → the `strk20.run` hero for the last 4s. Face cam expands on the sign-off. | Breadth is a **visual only** — it is not a section any more. If Houses is blocked, change "vote" to "read a sealed ballot". Hold 1.5s of silence after the last word. |

**386 spoken words.** At 145–175 wpm that is 2:12–2:39 spoken; with the ~15s of marked holds the
cut lands **02:27–02:54**. Under the gate even at your slowest, calmest read.

---

## Capture Runbook

### Before you roll — four checks

1. **Top the relayer up. You have two takes, not three.**
   `curl -s https://api.strk20.run/health` — public, no token, added 2026-08-31. It last read **31.12 STRK**; one cold-start take costs **8.59** (6 pool fee + 2.594 gas).

   | | balance after | state |
   |---|---|---|
   | now | 31.12 | healthy |
   | take 1 | 22.53 | low — ops paged |
   | take 2 | 13.94 | low — ops paged |
   | **take 3** | **5.34** | **refuses to sign** |

   Refusal floor is 12 STRK (2 × the live fee). A third take does not just cost STRK — the relayer stops signing, mid-recording. **Send it 30–50 STRK and shoot without counting.**
2. `curl -s https://app.strk20.run/api/fee-recipient` returns `0x6e1c…a0389` — that address is your hero proof.
3. `app.strk20.run/houses` — press a vote door. Decides one word at 02:05.
4. The drip wallet is funded (the ~2 STRK that buys the account deploy).

### Preflight

- 16:9, record at 2560×1440+, browser zoom **110%**.
- Face cam lower right, ~20% frame width — move it lower **left** for the Voyager beat; the Sender field sits low right.
- Captions lower centre, one line. Fix `strk20.run`, `starkience`, `Voyager`, `STRK` — auto-transcription mangles all four.
- A **brand-new browser profile**, zero extensions. A second, already-registered account in another profile as the chat counterparty.
- Hide: the recovery file, any `.env`, the relayer auth token, bookmarks bar, profile avatar, all notifications.

### Tab order

1. `github.com/starkience/strk20-hackathon` + our `registry.json` row
2. **Voyager — the pool contract** (the cold open)
3. `strk20.run` — the reveal
4. `app.strk20.run` — clean profile, the hero task
5. Voyager — the registration transaction (the proof)
6. `github.com/Blockchain-Oracle/strk20-run` — record table and refusal list
7. Back to `strk20.run` — the closing frame

### Retake triggers

- The Voyager **Sender** shows the user's address instead of `0x6e1c…a0389`.
- Any part of the key or recovery file is legible.
- The ladder fails at a rung — cut, fix, restart with a new account (and check the relayer balance first).
- A balance renders `—` where the take needs a number, or the two balances appear summed.
- The face camera covers the Sender field, the send button, or the disclosure headline.
- The assembled cut crosses **02:55**.

---

## Edit Map

- **Cold open:** two fast cuts, then let Voyager run. No music under the question at 00:25.
- **One reveal cue** at 00:31. Nothing else.
- **Waits removed:** the settle countdown (keep head and tail), the download dialog, prove/relay latency, Voyager page load, chat socket connect.
- **Hold:** the fork screen's three lines (2s) · the custody auditor sentence (3s) · the shielded tile (2s) · **the Voyager Sender field (3s)** · the chat auditor line (3s) · the refusal list (2s).
- **Silence under the Voyager proof.** The frame does the work.
- **Face cam:** lower right throughout; expands once, on the sign-off.
- **Closing frame:** the hero, mark and motto, 1.5s after the last word.

---

## Three repo fixes before you publish

A judge will have the README open while watching, and it currently disagrees with the app.

1. **The README's record table names superseded contracts** — Markets `0x7905…` and Governance `0xdbe2…`. The app runs MarketsV2 `0x30b4…` and the corrected Governance `0x731207e6…`, which the evidence file explicitly says *supersedes* the printed one. (`strk20.json` is fine as-is — its 11 txs came from the old addresses and must keep matching them.)
2. **The README still says Houses writes are blocked.** Commit `c15dc95` turned them on.
3. **`109 tests` is unsettled.** Run `snforge test` and print the real number, or drop the count.

**After export:** Vimeo can replace the file behind `vimeo.com/1222296410`, which keeps `strk20.json`'s `demo_video` and the README thumbnail valid. A new URL means editing both — and the hub re-reads the repo every 30 minutes.
