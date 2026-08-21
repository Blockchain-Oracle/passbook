[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 14 · Markets & Trading

# Chain-abstracted private execution across every chain and venue

One interface for private spot, perps, and prediction-market execution across Starknet, Solana, and EVM liquidity — routing, chain selection, and privacy are abstracted away, and solvers compete to fill your intent.

## What this enables

- →**One private surface over spot, perps, and prediction markets.** Capital sits private in STRK20; execution fans out across Starknet, Solana, and EVM liquidity (Ethereum, Base, Arbitrum, HyperCore) for spot, across Hyperliquid, Extended, Lighter, and Variational for perps, and across Polymarket and Kalshi for prediction markets. The user states what they want; routing, chain selection, and settlement stay abstracted. No other stack aggregates all three venue classes behind a single private account.
- →**Hidden and conditional orders with CEX-level UX.** An Enclave-powered execution layer holds instructions confidential until conditions trigger: hidden limit, stop-loss, take-profit, DCA, conditional payments, portfolio rebalancing, automated treasury. The order book never sees your resting orders, so they can't be hunted. This is the onchain, private version of what 1inch and CoW do publicly.
- →**Position building and exit that never reveals aggregate size.** Accumulate or unwind a large position through multiple unlinkable execution identities, splitting flow across sub-accounts and venues. No observer reconstructs the aggregate position or the strategy behind it — the thing that makes CoW's public batch settlement legible is exactly what stays hidden here.
- →**A private intent network with solvers competing on outcome.** State an outcome — "convert 1M USDC to ETH over 7 days, max 0.5% slippage", "move stables weekly to the safest >7% opportunity", "build a $500k position without moving the market" — and solvers compete privately across DEXs, bridges, lending, perps, and chains to fill it. Near Intents and Jumper solve routing in the open; here the intent, the route, and the fill are confidential.
- →**Chain abstraction that hides the chain, not just the click.** Users touch one interface and never choose a network, hold gas, or bridge manually. Deposits arrive from any supported chain, execution lands wherever the fill is best, and the link between source, venue, and destination is broken by the privacy pool.

## What you build

A private execution router built on STRK20 capital and Private Sub-Accounts as the unlinkable execution identities. Deposits shield into the Privacy Pool; a Chain Abstraction layer sources external liquidity and settles fills on Starknet, Solana, and EVM venues while a solver market competes to fill each request at best price. An `Enclave` confidential-execution module holds hidden and conditional orders — limit, stop-loss, take-profit, DCA, rebalancing — releasing instructions to solvers only when their trigger conditions are met, so nothing rests visibly on any book. A `PrivateIntent` contract accepts outcome-shaped intents, escrows the input as encrypted notes, and pays out the winning solver's fill against a proof of satisfied constraints; accumulation and exit flows spread a single logical order across many sub-accounts and venues so aggregate size is never reconstructable. Viewing Keys give the user (and, selectively, an auditor) a consolidated view of positions that external observers cannot link.

## Why this isn't Jumper

Jumper is a cross-chain routing and bridge aggregator: it finds the cheapest path to move an asset between chains, entirely in public. Every hop, source wallet, and destination is observable and linkable. This stack uses the same multi-chain routing, but STRK20 and the privacy pool sit in the middle, so the source-to-destination relationship and the execution itself are unlinkable — routing is a feature, privacy is the product.

## Why this isn't Houdini

Houdini offers private cross-chain swaps, but privacy stops at the swap: it obscures the transfer, not a full trading surface. There are no hidden orders, no solver-filled intents, no perps or prediction-market execution behind one account. Here the swap is the smallest primitive — spot, perps, prediction markets, conditional orders, and intent-based execution all share one private account and one anonymity set.

## Why this isn't VOOI

VOOI aggregates perpetuals across exchanges into one interface — Hyperliquid, Extended, Lighter, Variational — but aggregation happens entirely in the clear: positions, size, and direction are visible per venue. Confidentiality is not part of the design. This delivers the same perps aggregation while positions and execution route through unlinkable sub-accounts and the Enclave, so venue operators and observers never see the aggregate book.

## Why this isn't Kairos or PreDex

Kairos and PreDex aggregate prediction-market liquidity across venues like Polymarket and Kalshi, but every bet, size, and direction stays public and attributable. Aggregation without privacy just makes surveillance more convenient. This routes the same prediction-market flow through STRK20 so positions are unlinkable to the participant, while market prices and volumes stay public.

## Why this isn't 1inch or CoW

1inch and CoW deliver excellent public spot execution — 1inch via pathfinding across DEXs, CoW via batch auctions and coincidence-of-wants settled by solvers. Both are transparent by construction: 1inch's route and CoW's batch are on the public ledger, and resting intent is legible to searchers. The Enclave gives the same solver-competed, MEV-resistant execution, but instructions stay confidential until they trigger and fills spread across unlinkable identities — CEX-level UX for spot, onchain and private.

## Why this isn't Near Intents

Near Intents lets users declare an outcome and have solvers compete to fulfill it, which is the right shape — but the intent, the competing quotes, and the settlement are all public. Anyone can watch what you want and what you got. The Private Intent Network keeps the outcome statement, the solver competition, and the fill confidential end to end, so a "build a $500k position without moving the market" intent doesn't itself become the signal that moves the market.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Markets & Trading

Published Aug 3, 2026

14

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Chain-abstracted private execution across every chain and venue

Send message→

More in Markets & Trading

[Idea 03\\
**Trustless, atomic, private OTC settlement for large block trades** \\
Two counterparties agree off-chain, settle on-chain through the privacy pool: no intermediary holds funds, no counterparty risk, and neither party's identity is linked to the trade. 5–15bps per side undercuts every desk in the market.](https://strk20.starknet.io/rfp/private-otc-settlement) [Idea 04\\
**Bonding-curve token launches with hidden buyers, visible price action** \\
A Pump.fun-style launchpad where bonding-curve mechanics, trade sizes, and the social feed stay fully visible - but no observer can attribute any trade to any wallet. Whales buy without triggering copy-trade cascades; devs sell without panic dumps.](https://strk20.starknet.io/rfp/private-pumpfun)

STRK\[20\]

Shield any token. Move it privately. Use it anywhere in DeFi. Compliant for regulators, programmable by design.

JOIN »

PROTOCOL

[Documentation](https://docs.starknet.io/) [Developers](https://www.starknet.io/developers/) [Cairo](https://starkware.co/cairo/) [Bridge](https://starkgate.starknet.io/)

BUILD

[Request for startups](https://strk20.starknet.io/rfp) [Grants](https://www.starknet.io/grants/) [Ecosystem](https://www.starknet.io/dapps/) Book a call

COMPANY

[About](https://starkware.co/about-us/) [Careers](https://starkware.co/careers/) [Blog](https://starkware.co/blog/) [Media Kit](https://starkware.co/media-kit/)

Disclaimer

The information on this page is provided for general informational purposes only and does not constitute legal, financial, investment, or any other form of professional advice. Any decisions made based on this content are made at your own risk. No liability is accepted for any loss or damage arising from reliance on the information provided. To the extent any product is built and offered to the public it will be the builders’ sole responsibility to ensure compliance with applicable laws in the jurisdictions it is offered. Any comparisons featured are solely for illustrative purposes and should not be relied upon as a basis for decision-making.

The content on this page has been produced by a community member — Starkware Industries Limited — and does not represent the views or positions of the Starknet Foundation. The Starknet Foundation does not endorse any of the content, opinions, or recommendations expressed herein. Nothing on this page constitutes an offer or commitment by the Starknet Foundation to fund, support, or otherwise engage with any projects or initiatives that may be derived from or inspired by the ideas presented.

STARKWARE INDUSTRIES LTD. · COPYRIGHT 2026 · ALL RIGHTS RESERVED

[PRIVACY](https://www.starknet.io/legal-disclaimers/) [TERMS](https://www.starknet.io/legal-disclaimers/#terms-of-use) [● ALL SYSTEMS OPERATIONAL](https://status.starknet.io/)

STRK\[20\]