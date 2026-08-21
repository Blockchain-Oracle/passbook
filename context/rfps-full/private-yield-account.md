[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 24 · Markets & Trading

# Private chain-abstracted yield account

A private, chain-abstracted savings-and-investment account — hold shielded assets, lend, stake, and route capital across DeFi opportunities without exposing total holdings or linking positions to your primary identity.

## What this enables

- →**Yield without publishing your net worth.** An onchain savings account today is a public balance sheet — anyone can read your total holdings, every position, and the address you withdraw to. Shielded balances via STRK20 let you lend, stake, and allocate across DeFi while total holdings stay private and no position links back to your primary identity.
- →**Positions that don't advertise your strategy.** When you lend on one protocol and stake on another from the same public wallet, observers reconstruct your whole allocation and copy or front-run it. Private sub-accounts split each position into an unlinkable execution identity — the yield accrues, the strategy doesn't leak.
- →**Deposit from anywhere, withdraw fresh.** Capital arrives from Ethereum, Solana, Bitcoin, or any supported chain, routes through Starknet and private sub-accounts, and withdraws to a fresh wallet on any chain — the deposit address and the withdrawal address share no on-chain link.
- →**Allocation logic that stays confidential.** The Enclave runs the routing — which opportunity, what size, when to rebalance — as confidential computation, so the account can chase the best rate across protocols without broadcasting where the capital is about to move.
- →**Compliance when you need it.** Viewing keys let you prove source of funds or generate an income statement for a tax authority without exposing the account to the public. Confidential from surveillance, disclosable to the parties that are legally owed disclosure.

## What you build

A `YieldAccount` helper contract holding shielded balances in the Privacy Pool and fanning capital out into per-opportunity private sub-accounts. Deposits enter via chain abstraction from Ethereum, Solana, Bitcoin, and other supported chains; capital routes through Starknet before hitting external DeFi. Allocation and rebalancing decisions run in the Enclave as confidential strategy, then execute against lending markets, staking, and yield protocols through `InvokeExternal` — each leg from a distinct unlinkable sub-account so aggregate holdings and individual positions never reconcile publicly. Withdrawals settle to a fresh wallet on any supported chain with no link to the deposit path. Viewing keys sit on top for scoped source-of-funds and income disclosure.

## Why this isn't ether.fi Cash/Liquid

ether.fi Cash and Liquid are the closest thing to this without the privacy layer — you deposit, the vault routes across DeFi opportunities, you earn. But every position, the total balance, and the withdrawal address are public and permanently linked to the depositing wallet. Anyone can size your holdings, map your allocation across protocols, and follow your capital when it moves. This is the same product — hold, lend, stake, allocate, chain-abstracted deposit and exit — with STRK20 shielding the balances, private sub-accounts unlinking the positions, and the Enclave keeping the routing strategy confidential. Same yield surface, categorically different exposure: ether.fi tells the market your entire book; this tells it nothing.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Markets & Trading

Published Aug 3, 2026

24

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Private chain-abstracted yield account

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