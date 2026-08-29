<p align="center">
  <img src="https://raw.githubusercontent.com/Blockchain-Oracle/strk20-run/main/assets/brand/strk20-mark.svg" width="96" alt="The strk20.run mark — an asterisk that runs" />
</p>

<h1 align="center">strk20.run</h1>

<p align="center"><strong>A private account on Starknet's STRK20 pool.</strong></p>

<p align="center">
  Open the app and you have an account — no wallet to connect, nothing to install, nothing to paste.<br/>
  Hold and send shielded value, chat with money attached, swap, bet, launch, bridge out.
</p>

<p align="center">
  <a href="https://app.strk20.run"><b>▶&nbsp; Open the app</b></a>
  &nbsp;·&nbsp;
  <a href="https://vimeo.com/1222296410"><b>Demo video</b></a>
  &nbsp;·&nbsp;
  <a href="https://strk20.run/docs"><b>Documentation</b></a>
  &nbsp;·&nbsp;
  <a href="docs/architecture.md"><b>Architecture</b></a>
  &nbsp;·&nbsp;
  <a href="#mainnet-record"><b>Mainnet record</b></a>
  &nbsp;·&nbsp;
  <a href="#what-we-do-not-claim"><b>What we refuse to claim</b></a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/Blockchain-Oracle/strk20-run/main/assets/brand/strk20-banner.svg" width="960" alt="strk20.run — a private account on Starknet. Hold, send, chat, swap, bridge, bet, launch." />
</p>

The key is generated in your browser on first load, and everything runs from it. Every screen
names who can see what — before you act — including the parties you did not choose. The full
model is in the **[documentation](https://strk20.run/docs)**; this page is the record.

## Demo video

<p align="center">
  <a href="https://vimeo.com/1222296410">
    <img src="https://raw.githubusercontent.com/Blockchain-Oracle/strk20-run/main/assets/launch/demo-thumbnail.png" width="720" alt="Watch the strk20.run 3-minute demo" />
  </a>
</p>

<p align="center">
  <a href="https://vimeo.com/1222296410"><b>▶ Watch the 3-minute demo</b></a>
</p>

---

## Mainnet record

Network `SN_MAIN`. Every row was read back off the chain, not copied from a deployment log.
`strk20.json` is the submission manifest.

| What | Address |
|---|---|
| STRK20 pool | [`0x040337b1…fe812a`](https://voyager.online/contract/0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a) |
| Pool class hash this code was tested against | [`0x67dddd89…6b554d`](https://voyager.online/class/0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d) |
| `Markets` (ours) | [`0x7905ba4e…72a783`](https://voyager.online/contract/0x7905ba4e7535a3e7c1f9f4045762cc7ce83cfb120fe916f97a0dc512d72a783) |
| `Launch` (ours) | [`0x3fc07897…32eb54`](https://voyager.online/contract/0x3fc07897f657b184ff9b0dab28939bb5a175d7cff9290406a1bd4b3d032eb54) |
| `MessageBook` (ours) | [`0x3105b6a3…ae35bc`](https://voyager.online/contract/0x3105b6a327ba11f5464335f480046348a4052be2c12df726f37633d50ae35bc) |
| `Governance` — the Houses (ours) | [`0xdbe26582…37f9bf`](https://voyager.online/contract/0xdbe265829e0f1c859f3a8c1bd8fcfb0a774836b9e07191c6a624a59e37f9bf) |
| Pragma oracle (read live by Markets) | [`0x2a85bd61…fa875b`](https://voyager.online/contract/0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b) |

**Eleven declared transactions** — every successful mainnet transaction that ran through one of
our contracts, found by sweeping their events — each with the evidence file that recorded it:

| What happened | Evidence | Transaction |
|---|---|---|
| Market 0 created — BTC/USD, priced off Pragma | `seq-market.json` | [`0x77fceec7…16f978`](https://voyager.online/tx/0x77fceec7b1dab186b6f6121db07aca62c727dedae35b3a9db22c17b9716f978) |
| The ladder — 3 bets on market 0, one transaction, one fee | `seq-bet.json` | [`0x16933dd6…d72523`](https://voyager.online/tx/0x16933dd6edd5ade29c3b3cb3954da2c3b5bb806f85040fe42810f73acd72523) |
| Launch 0 created — a confidential sale on the epoch curve | `seq-launch.json` | [`0x13b246bd…4e4c93`](https://voyager.online/tx/0x13b246bd1ce1eb11af8ae5cbe3b2aa9ab8b458fe472b92511302048a74e4c93) |
| The hidden buy — 4 units on launch 0, buyer never named | `seq-buy.json` | [`0x84a59651…3871d4`](https://voyager.online/tx/0x84a59651f14c6c995eac59ce0598e9cb58a7b1d02334870db9494acf3871d4) |
| Market 0 resolved against the oracle | `seq-claim.json` | [`0x6dc4d81c…0ab73d`](https://voyager.online/tx/0x6dc4d81c7e1e7b03b1e5b78f50541c8a1998bdd6281c8fe6f722ca9600ab73d) |
| The batch claim — 3 of 4 positions settled in one transaction | `seq-claim.json` | [`0x15eb0939…6561c0`](https://voyager.online/tx/0x15eb0939a124cbe8fc6a0e5825004f665f031e0d6abb80088bab0a8466561c0) |
| House 0 activated — "Passbook Founders" | `seq-gov-house.json` | [`0x11981995…3be3c5`](https://voyager.online/tx/0x11981995373bac3baf023588bb60e0e09652de7bda335decf54dee2bb3be3c5) |
| A proposal, sealed until close | `seq-gov-propose.json` | [`0x237a47cb…ca2726`](https://voyager.online/tx/0x237a47cbb3e88194b8e684351f0709cdfff44898f9c5e06cca3b650ecca2726) |
| A sealed FOR ballot, weight escrowed through the pool | `seq-gov-ballot.json` | [`0x448ed7fc…d6e7df`](https://voyager.online/tx/0x448ed7fc67b968b829d0e5cf8f7946fbb0fc47ef48903b33b8cd7be4dd6e7df) |
| The tally the curve accepts | `seq-gov-tally.json` | [`0x16bd3806…cbff0b`](https://voyager.online/tx/0x16bd3806cab40f1628e25c62ab8453d7af487b2c7006f0820f0d63405cbff0b) |
| The tally key, on-chain forever | `seq-gov-tally.json` | [`0x475b97c4…c25227`](https://voyager.online/tx/0x475b97c46df69c24fbf92429a9ce03a0df3779a4a23415b2d51960b36c25227) |

Two notes. The sponsored registration this project landed through its own relayer
([`0x4fbbf9aa…bfe27d`](https://voyager.online/tx/0x4fbbf9aa7992a95d313554bc17b2fff311b35a5974271defc6672f57abfe27d))
touches the pool but not our contracts, so under the judges' *mine* rule it is history rather
than manifest. And the pool class hash is pinned on purpose: the pool is upgradeable with zero
delay, so if the running class stops matching, the app says so and stops rather than guess.

---

## Where each surface stands

Seven modes, one pool.

| Surface | State today |
|---|---|
| **Wallet** | **Live end to end.** Balance read from the pool, send, deploy, register, QR receive, account lifecycle, history. |
| **Chat** | **Live end to end.** Multi-conversation, one multiplexed socket, sealed messages, money attached to a message, opt-in public name directory. |
| **Swap** | **Live end to end.** Real route priced through an on-chain aggregator, executed in one transaction, proceeds land back in the pool. |
| **Bridge** | **Live, outbound only.** Shielded USDC to another chain through StarkWare's deployed `OutboundAnonymizer`. |
| **Markets** | **Deployed on mainnet.** Live Pragma prices, real market records, bets, cash-out while eligible, terminal claims and refunds. |
| **Launch** | **Deployed on mainnet.** Real sale records, buys, graduation redemption, failed-raise refunds. |
| **Houses** | **Readable on mainnet; affected writes blocked.** The deployed class predates two corrections, so the app fails closed until a corrected deployment updates the evidence. |

What does not work, stated plainly: there is no invite for an unregistered address; the bridge is
outbound only and no crossing has been sent from this code; depositing into the pool is public —
what the pool hides is which notes are yours afterwards. No surface substitutes fixture rows or
invented numbers when a chain read is empty.

---

## How it fits together

<p align="center">
  <img src="https://raw.githubusercontent.com/Blockchain-Oracle/strk20-run/main/assets/architecture.svg" width="960" alt="How strk20.run fits together — browser, app host proxy, relayer, and the contracts on Starknet mainnet" />
</p>

The account is an embedded key made in the browser. The relayer is reached only through a
same-origin proxy, so the browser never holds its token. Swap and bridge are one invoke sandwich —
withdraw to the venue's privacy executor, invoke it, proceeds land back in the pool as a note.
The full page, including the relayer's security model, is
**[docs/architecture.md](docs/architecture.md)**.

---

## Running it

Node 24 (`.nvmrc`), pnpm 11 (`packageManager`); `scarb` 2.8.2 and `snforge` 0.31.0 for the contracts.

```bash
nvm use && corepack enable && pnpm install
pnpm run typecheck        # packages + apps/web
pnpm run build:web        # refuses an off-mainnet tree

cd contracts && scarb build && snforge test    # 109 tests

cp .env.example .env      # the relayer's two values; see that file
npx tsx packages/relayer/src/server.ts
```

The relayer holds a funded key and pays for what it signs — behind any proxy,
`RELAYER_AUTH_TOKEN` is mandatory ([why](docs/architecture.md#running-it-and-the-one-setting-you-must-not-skip)).
The privacy SDK installs from `vendor/`; it is not on npm. No protocol number is hardcoded: the
pool fee is read at call time, every time.

---

<!-- claims-lint:disable -->
## What we do not claim

Every statement here is checkable from mainnet.

- **The recipient of a private transfer sees the sender.** Private does not mean anonymous to your counterparty.
- **Anonymity sets on this pool are small.** The app shows the real number where you choose the amount, because that number — not the cryptography — is your cover.
- **Our relayer sees network metadata** — your IP and the timing of your request — so that its address, not yours, is the visible submitter.
- **Your viewing private key is escrowed on-chain to a StarkWare auditor, permanently.** Registration writes it encrypted to the auditor key `0x1eed60b8…801bf7`, readable by anyone via `get_enc_private_key(address)`, with no rotation and no opt-out. Chat room keys derive from the same viewing keys, so the auditor can read any conversation here. This is why nothing here is described as end-to-end encrypted.
- **The same key reads your notes and signs your spending.** There is no watch-only version, and there never will be, because the protocol has none.
- **Amounts are public on any leg that touches an open note** — a swap, a launch buy, a market bet all publish their size.
- **The audit does not cover this code.** The OpenZeppelin audit is scoped to protocol commit `c5e2fb5` (May 2026); everything in this repository is unaudited.
- **Compliance is not ours.** Deposits are screened by a third-party provider the pool operator chose; a refusal is silent and will look like our bug.

We will not say: *fully anonymous* · *untraceable* · *your amounts are private* · *your deposit is hidden* · *end-to-end encrypted* · *watch-only* · *unlinkable* · that compliance is handled for you.

> *"Claim identity privacy; never claim amount privacy for swaps."* — the sponsor's rule, and ours.
<!-- claims-lint:enable -->

---

## Licence

MIT. See [`LICENSE`](./LICENSE).
