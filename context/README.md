# Context

Everything established before building. Read these in order.

| File | What it holds |
|---|---|
| `01-hackathon-brief.md` | The event: sponsor, rules, deadline, judging, the submission gate |
| `02-verified-technical-facts.md` | Live-verified protocol facts. Contradicts the public docs in places — trust this file |
| `03-field-intel.md` | The competitive field, verified by replaying transactions on mainnet |
| `04-product-vision.md` | What Abu wants. **Abu's words and agent inference are separated.** |
| `05-decision-log.md` | What was decided, what was reversed, and why |
| `06-uniswap-reference.md` | How Uniswap makes many primitives feel like one app — the design reference. Also: monorepo layout, state approach, the account model, and per-surface LOC so scope can be calibrated |
| `07-gate-and-traps.md` | **What can eliminate you, and the facts that change decisions.** Corrects `02` in three places. Read §7 if you read nothing else |
| `12-prediction-mechanism.md` | Why the "order book is impossible" claim was wrong, why an order book still should not ship, why 1-minute markets are impossible, and the FPMM design. **Contains a time-critical oracle deadline** |
| `11-product-experience.md` | **The product, not the demo.** First ninety seconds, the invite flow, key backup and recovery, every failure state with its exact copy, the premium checklist, and the docs-package structure. Companion to `08` — that one owns colour and motion, this one owns sequence and words |
| `10-designer-prompt.md` | Cold-start brief for a designer or design tool. Carries the chosen **Ledger** direction |
| `09-bridge.md` | RFP Idea 22 against shipped reality. **§0 corrects three claims made in `07` and the decision log** — read it before trusting either on Solana, the video, or sub-accounts |
| `08-design-brief.md` | **For the designer.** Real token values — hexes, type scale, spacing ramp, radii, shadows, motion durations and easing curves — every one tagged by provenance and verified against Uniswap's source *and* its shipped production CSS. Plus the privacy-UX grammar, which has no prior art anywhere |
| `rfps-full/` | **All 26 published RFPs**, scraped verbatim, + `_OFFICIAL-HACKATHON-IDEAS.md` — the sponsor's *second* idea list from their own repo, which Abu had never seen |
| `design-refs/` | Live screenshots of `app.uniswap.org` — `/swap`, `/explore`, `/launches`, captured 21 Aug 2026 |
| `../rfps.md` | The five RFPs Abu originally selected. **Superseded in coverage by `rfps-full/`** — kept because these five are the chosen ones |

## Provenance

Research was done 20–21 Aug 2026 across four agent workflows (27 agents, ~2.5M tokens,
~900 tool calls). Facts marked **VERIFIED** were confirmed by live Starknet mainnet RPC calls,
GitHub API reads of actual source, or transaction replays — not by reading documentation.
Anything not confirmed that way is marked **UNVERIFIED** and must be treated as a guess.

The full prior dossier lives at
`/Users/abu/Documents/Codex/2026-08-20/https-strk20-starknet-io-hackathon-https-2/outputs/STRK20-hackathon-research.md`
(note: its Sibyl Labs section is irrelevant — see `05-decision-log.md`).
