# Field intel

Verified 21 Aug 2026: `projects.json` pulled fresh, **48 repos opened** via GitHub API, **45 demo URLs
resolved**, **30+ claimed transaction hashes replayed against mainnet RPC**.

## Snapshot

108 indexed projects · 45 live demos · 12 with ≥3 verified mainnet txs · **1 fully score-ready**
(`philoxenia`) · 57 with nothing at all.

Categories: Payments 23 · DeFi 17 · Infra 11 · Consumer 8 · Tooling 6 · Gaming 4 · **Other 39**

## Corrections to earlier assumptions

| Believed | Verified |
|---|---|
| 5 projects have a video | **Exactly ONE.** Three entries are literal placeholders (`REPLACE_WITH_YOUTUBE_URL`, `TODO_3min_video_url`, `CHAOSKEY_DEMO_VIDEO`); one is a homepage URL. Only `philoxenia` has a real `.mp4` |
| Anonymizer contracts in only 2 projects | Indexer undercounts. GitHub code search `"fn privacy_invoke" language:cairo` → **62 files**; ~15 indexed entrants have a real anonymizer |
| `doom` has the most Cairo | 3,020 lines confirmed, but **`vinss` has 43 Cairo files / ~5,700 LOC** |
| Bridges are crowded | 7 registered (excluding the organizers' own reference repo, which was miscounted as a competitor). **Shipped a working cross-chain private transfer: 0. Score-ready bridges: 0** |
| Bonding curves / launchpads exist | **Genuinely zero.** `bonding`=0, `curve`=0, `pump`=0, `launchpad`=0, `presale`=0, `fair launch`=0 across all 108. (One nuance: `veyl` shipped a 457-line *sealed-bid* fair-launch anonymizer — so "token launches" are not empty; **bonding curves are**) |

## The structural fault line — the most important finding

**Mainnet evidence and contract depth are almost perfectly anti-correlated.**

- 3+ verified txs, **zero Cairo**: cutout (4 txs), mirage (3), cloakra (3), whisperpay (3), neobank (3),
  veilpay (6 — field high, 1 Cairo file)
- Real anonymizers, **zero verified txs**: vinss (43 Cairo files), veyl, atrum, envelope (126 commits),
  adyton, crewkill, cipherpay, xence, sevrin, veilcast, blindpool, oju

**Only five of 108 hold both ends: `doom`, `philoxenia`, `nightshift`, `morok-pay`, `offbook`.**
That is the real competitive set.

## The entries that matter

| Project | Evidence | Strength | Weakness to beat |
|---|---|---|---|
| **philoxenia** | 3/3 txs verified on L1, real 61.2s MP4, live demo | The only complete entry. Own 131-line Cairo anonymizer. 245 commits | **Single-vertical** — every primitive welded to friend-to-friend room booking. README opens with a red warning box demanding Ready X + Chrome. Leads on completeness, not depth (3 txs is the floor) |
| **nightshift** | 4 pool txs, all 10 route through own contracts | Best Cairo in the field (574-line vault). Mine-rule safe | Deployed demo is an **869-byte Vite shell** with zero wallet-connect. The real console isn't deployed. **No video** |
| **doom** | 4/4 verified, mine-rule safe | 3,020 lines of Cairo. Already ships a 2-variant mode enum | 14 declared contracts vs 4 txs. **No video.** Thin starter-kit UI |
| **morok-pay** | 3/3 txs, live demo, Cairo | Closest to a unified payments product; 3 QR flavours | **No video.** Only 684 lines Cairo. **Manual reconciliation** — "the merchant refreshes their balance and marks a request paid" |
| **offbook** | 6/6 txs — only proven direct-SDK mainnet path | Proves the SDK route works | Empty demo_url and demo_video, **no licence**, 0 tests, stale since 18 Aug. Evidence came from a script, not the product |
| **veilpay** | 6 txs (field high) | — | **Empty demo_url and demo_video.** 99 lines of Cairo, 0 tests |
| **kese** | demo + placeholder video | The agent/MCP idea, already specced | `verified_txs: 0` — architecturally stuck behind a key-holding design |

## Fabricated evidence exists in this field

- `starkwhisper`: all 3 listed transactions return **NOT_FOUND** on mainnet
- `tacit`: same
- **Six projects list someone else's already-deployed helper** (`0x78ae662e…`, PhilippeR26's reference
  echo contract) as their own. `doom` is honest about it and labels the row "upstream reference"

The copy-paste tell: `GET /search/code?q="privacy_invoke" "BAD_POOL" language:cairo` → 9 hits, all
tracing to the same 99-line upstream echo helper.

## What this means

The bar is lower than the project count suggests. The winning move is to hold **both ends** —
real contract depth *and* complete evidence — plus a video, which almost nobody has.
