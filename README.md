<p align="center">
  <img src="https://raw.githubusercontent.com/Blockchain-Oracle/strk20-run/main/assets/brand/strk20-mark.svg" width="96" alt="The strk20.run mark — an asterisk that runs" />
</p>

<h1 align="center">strk20.run</h1>

<p align="center"><strong>Everything on Starknet, from one private account.</strong></p>

<p align="center">
  Open the app and you have an account — no wallet to connect, nothing to install, nothing to paste.<br/>
  Hold and send shielded value, mail a payment with a sealed note, chat, earn, swap, bet, launch, bridge out.
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
  <img src="https://raw.githubusercontent.com/Blockchain-Oracle/strk20-run/main/assets/brand/strk20-banner.svg" width="960" alt="strk20.run — a private account on Starknet. Hold, send, mail, swap, bridge, bet, launch." />
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
| `Markets` (ours) — standing windows | [`0x30b487e6…a3c702`](https://voyager.online/contract/0x30b487e6b15d65fae30482fd07dcbfaa47b5b07e5133c0cdb10d8e49a3c702) |
| `Launch` (ours) | [`0x3fc07897…32eb54`](https://voyager.online/contract/0x3fc07897f657b184ff9b0dab28939bb5a175d7cff9290406a1bd4b3d032eb54) |
| `Mailbox` (ours) — pool-only memo log | [`0x675196bd…0bba5a`](https://voyager.online/contract/0x675196bd1c2df73c85acdf3ac97a5baffce476f0915006ca8187e00c80bba5a) |
| `VesuEarn` (ours) — exact-share Vesu exits | [`0x3ce7a79c…204157`](https://voyager.online/contract/0x3ce7a79c53685ab178bcf36960099bf37bbd16035f0f7e2defefa5153204157) |
| `Governance` — the Houses (ours) | [`0x731207e6…4babc5`](https://voyager.online/contract/0x731207e62d01d80632e9d6e911072bb5a3eeaf86232123d2ab9fc50654babc5) |
| Pragma oracle (read live by Markets) | [`0x2a85bd61…fa875b`](https://voyager.online/contract/0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b) |

Two of these were redeployed after the first transactions below were made. The manifest includes
both the current contract and the historical emitter because a declared transaction has to match
the address it actually ran through. `Markets` superseded
[`0x7905ba4e…72a783`](https://voyager.online/contract/0x7905ba4e7535a3e7c1f9f4045762cc7ce83cfb120fe916f97a0dc512d72a783)
on 29 Aug; `Governance` superseded
[`0xdbe26582…37f9bf`](https://voyager.online/contract/0xdbe265829e0f1c859f3a8c1bd8fcfb0a774836b9e07191c6a624a59e37f9bf)
on 30 Aug, once the tally-key and exclusion fixes landed. Both older addresses stay readable, and
`evidence/markets-launch-deployment.json` records what replaced what.

**Seven qualifying transactions** — every successful mainnet transaction found in the sweep that
emits from both the STRK20 pool and one of our declared contracts:

| What happened | Evidence | Transaction |
|---|---|---|
| Market 0 created — BTC/USD, priced off Pragma | `seq-market.json` | [`0x77fceec7…16f978`](https://voyager.online/tx/0x77fceec7b1dab186b6f6121db07aca62c727dedae35b3a9db22c17b9716f978) |
| The ladder — 3 bets on market 0, one transaction, one fee | `seq-bet.json` | [`0x16933dd6…d72523`](https://voyager.online/tx/0x16933dd6edd5ade29c3b3cb3954da2c3b5bb806f85040fe42810f73acd72523) |
| The hidden buy — 4 units on launch 0, buyer never named | `seq-buy.json` | [`0x84a59651…3871d4`](https://voyager.online/tx/0x84a59651f14c6c995eac59ce0598e9cb58a7b1d02334870db9494acf3871d4) |
| The batch claim — 3 of 4 positions settled in one transaction | `seq-claim.json` | [`0x15eb0939…6561c0`](https://voyager.online/tx/0x15eb0939a124cbe8fc6a0e5825004f665f031e0d6abb80088bab0a8466561c0) |
| A sealed FOR ballot, weight escrowed through the pool | `seq-gov-ballot.json` | [`0x448ed7fc…d6e7df`](https://voyager.online/tx/0x448ed7fc67b968b829d0e5cf8f7946fbb0fc47ef48903b33b8cd7be4dd6e7df) |
| A shielded bet through the current Markets contract | `submission-chain-sweep.json` | [`0x22f0d0a0…884d1c6`](https://voyager.online/tx/0x22f0d0a0ae52be2a04213f536b0f922fc2add07e472b17804e9acbf3884d1c6) |
| A second shielded buy through Launch | `submission-chain-sweep.json` | [`0x2ce4fa15…a3d27`](https://voyager.online/tx/0x2ce4fa1571a30dc6986ba0acccc4aaf973e8d735aaef468170a3161199a3d27) |

Two notes. The sponsored registration this project landed through its own relayer
([`0x4fbbf9aa…bfe27d`](https://voyager.online/tx/0x4fbbf9aa7992a95d313554bc17b2fff311b35a5974271defc6672f57abfe27d))
touches the pool but not our contracts, so under the judges' *mine* rule it is history rather
than manifest. Setup, creation, resolution and tally actions are real app history, but the sweep
keeps them out of `strk20.json` because they emit no pool event. The full classification is in
`evidence/submission-chain-sweep.json`. And the pool class hash is pinned on purpose: the pool is upgradeable with zero
delay, so if the running class stops matching, the app says so and stops rather than guess.

---

## Where each surface stands

Nine modes, one pool.

| Surface | State today |
|---|---|
| **Wallet** | **Live on mainnet.** Balance read from the pool, send, deploy, register, QR receive, account lifecycle, history. |
| **Mail** | **Deployed on mainnet.** Every message is a shielded payment: the pool creates the recipient's note and posts the sealed memo to our pool-only `Mailbox` in the same proved transaction. Threads are rebuilt from the chain with the viewing key — no server carries a message, nothing is kept in the browser. Opt-in public name directory. |
| **Chat** | **Live, and free because it is not a transaction.** Sealed messages over one multiplexed connection to our relay. Sending an ordinary message costs nothing and writes nothing to the chain — the relay carries the ciphertext, sees who is talking to whom and when, and keeps a bounded in-memory backlog rather than durable storage. Money attached to a message is a separate pool transaction with an ordinary fee. Use Mail for a message that survives on chain. |
| **Swap** | **Live on mainnet.** Real route priced through an on-chain aggregator, executed in one transaction, proceeds land back in the pool. |
| **Earn** | **Deployed on mainnet.** Seven Vesu V2 USDC lending markets in one catalog, every rate and liquidity figure a live contract read — Vesu's own API returns no stats for V2 at all. Supplying and redeeming go through `VesuEarn`, our own helper, which redeems an exact share count; positions are discovered vToken notes, so they survive a cleared browser. Always submitted by your own account. |
| **Bridge** | **Live, outbound only.** Shielded USDC to another chain through StarkWare's deployed `OutboundAnonymizer`. |
| **Markets** | **Deployed on mainnet.** Live Pragma prices, real market records, bets, cash-out while eligible, terminal claims and refunds. |
| **Launch** | **Deployed on mainnet.** Real sale records, buys, graduation redemption, failed-raise refunds. |
| **Houses** | **Live on mainnet.** A house is a treasury with members; a ballot's weight is public, its choice is sealed to the proposal's tally key, and no address is written on it. Our Teller opens the tally at close and cannot forge, drop or miscount a ballot, because the contract checks the arithmetic. |

What does not work, stated plainly: there is no invite for an unregistered address; the bridge is
outbound only and no crossing has been sent from this code; the Earn helper is deployed and proven
against real Vesu on a mainnet fork, but no lending transaction has been sent through the live pool
yet; a chat message
is not on chain, not decentralized and not persistent, and this README will not call it any of those
things; depositing into the pool is public — what the pool hides is which notes are yours afterwards. No surface substitutes fixture rows or
invented numbers when a chain read is empty.

---

## How it fits together

<p align="center">
  <img src="https://raw.githubusercontent.com/Blockchain-Oracle/strk20-run/main/assets/architecture.svg" width="960" alt="How strk20.run fits together — browser, app host proxy, relayer, and the contracts on Starknet mainnet" />
</p>

The account is an embedded key made in the browser. The relayer is reached only through a
same-origin proxy, so the browser never holds its token. Swap, Earn and bridge are one invoke
sandwich — withdraw to a privacy executor, invoke it, proceeds land back in the pool as a note.
The full page, including the relayer's security model, is
**[docs/architecture.md](docs/architecture.md)**. The feature-level maps live in the documentation:
**[Mail](https://strk20.run/docs/how-it-works/mail)**,
**[Chat](https://strk20.run/docs/how-it-works/chat)**,
**[Passkey](https://strk20.run/docs/how-it-works/passkeys)**,
**[Earn / Yield](https://strk20.run/docs/how-it-works/earn)**,
**[Markets](https://strk20.run/docs/how-it-works/markets-and-launch#markets-architecture)**, and
**[Launch](https://strk20.run/docs/how-it-works/markets-and-launch#launch-architecture)**.

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
- **Your viewing private key is escrowed on-chain to a StarkWare auditor, permanently.** Registration writes it encrypted to the auditor key `0x1eed60b8…801bf7`, readable by anyone via `get_enc_private_key(address)`, with no rotation and no opt-out. Mail memo keys derive from the pool's channel keys, which the auditor can recover from those viewing keys, so the auditor can read any mail here. The auditor is always inside the trust boundary.
- **The same key reads your notes and signs your spending.** The protocol exposes no separate observation key.
- **Amounts are public on any leg that touches an open note** — a swap, a launch buy, a market bet all publish their size.
- **The audit does not cover this code.** The OpenZeppelin audit is scoped to protocol commit `c5e2fb5` (May 2026); everything in this repository is unaudited.
- **Compliance is not ours.** Deposits are screened by a third-party provider the pool operator chose; a refusal is silent and will look like our bug.

We do not claim complete anonymity, universal untraceability, hidden deposits, sole-reader messaging, cross-surface separation, or automatic compliance.

> *"Claim identity privacy; never claim amount privacy for swaps."* — the sponsor's rule, and ours.
<!-- claims-lint:enable -->

---

## Licence

MIT. See [`LICENSE`](./LICENSE).
