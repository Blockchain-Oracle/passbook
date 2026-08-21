[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 20 · Markets & Trading

# Private market-maker vaults across venues and chains

Professional-managed vaults that deploy across DEXs, perps, lending, and multiple chains with confidential strategies and positions — while publicly proving NAV, PnL, historical performance, and solvency.

## What this enables

- →**A vault that isn't handcuffed to one perp exchange.** Hyperliquid vaults ($300M TVL), Paradex ($6M TVL), and Extended ($85M TVL) all prove the demand - depositors want managed exposure to a professional's book. But each locks the manager inside a single venue. Here a manager runs one strategy across DEXs, perpetual exchanges, lending markets, and yield protocols on any supported chain, and depositors get exposure to all of it from one deposit.
- →**Alpha that survives being deployed.** On a transparent exchange a market maker's positions, entries, and execution logic are readable in real time - the strategy is copied and front-run the moment it's profitable. The Enclave holds strategy, positions, and order flow confidential; the market sees fills, not the book behind them. The edge is capturable because it isn't public.
- →**Verifiable NAV without a public position sheet.** Depositors don't take the manager's word and don't watch the strategy leak. The vault publicly proves NAV, PnL, historical performance, and solvency via STARK proof, while the underlying positions and execution stay encrypted. Trust the numbers, not the manager - without exposing the book.
- →**Cross-venue execution that doesn't leak aggregate size.** A manager splits a book across Private Sub-Accounts and venues so no counterparty reconstructs the total position or the rebalance. The same nine-figure flow that moves a transparent orderbook against itself executes without signalling.
- →**Manager economics that actually work onchain.** Managers earn a share of yield and profits, computed against a proven NAV curve, paid without disclosing which trades generated it. The performance fee is enforceable and auditable; the strategy that earned it stays private.

## What you build

A `Vault` helper contract that mints depositor shares against pooled STRK20 capital and marks them to a NAV proven by STARK proof rather than a published holdings list. Manager execution runs through Private Sub-Accounts that fan out across venues and chains via Chain Abstraction, with `InvokeExternal` reaching DEXs, perp exchanges, lending markets, and yield protocols; the Enclave holds the strategy logic, live positions, and order routing confidential end to end. NAV, PnL, historical performance, and solvency are exposed as verifiable public metrics; per-position detail is disclosed only through Viewing Keys to the depositor, an auditor, or a compliance process. Performance and management fees settle against the proven NAV curve, so the incentive is enforceable without the strategy ever becoming public.

## Why this isn't Hyperliquid / HLP

HLP validated the whole category - a vault depositors fund and a strategy they get exposure to - and Hyperliquid vaults hold ~$300M. But HLP runs on one venue, and Hyperliquid's transparency means the vault's positions are legible onchain in real time. This vault deploys the same capital across many venues and chains and keeps the positions and execution encrypted, proving NAV instead of publishing the book. Same deposit-and-earn model; the strategy is no longer a public artifact competitors trade against.

## Why this isn't Paradex

Paradex offers managed vaults ($6M TVL) but scopes them to its own perpetual exchange - the manager can only express a strategy in the instruments Paradex lists, and the positions live on Paradex's transparent ledger. Here the manager isn't confined to one exchange or one asset class: spot, perps, lending, and yield across chains sit inside a single vault. Confidentiality of positions is the product, not a setting.

## Why this isn't Extended

Extended's vaults ($85M TVL) are, again, single-venue managed exposure on a transparent perp DEX - depositors can watch, and so can everyone else. The differentiator here is categorical: a manager trades across multiple venues and chains without revealing positions or execution strategy, while depositors still get cryptographic proof of NAV and solvency. Extended proves people will fund a manager's book; this makes the book something worth funding by keeping it private.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Markets & Trading

Published Aug 3, 2026

20

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Private market-maker vaults across venues and chains

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