[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 21 · Markets & Trading

# Private index and copy-trading vaults

Spot-portfolio vaults — private crypto ETFs, index strategies, thematic baskets — where composition and execution stay confidential while NAV and historical performance stay verifiable.

## What this enables

- →**A private crypto ETF - the basket without the holdings sheet.** Index Coop and Nested (30,000 portfolios created) publish exactly what each product holds, because on transparent chains they have no choice. Here composition stays confidential in the Enclave while NAV and historical performance stay verifiable via STARK proof. Depositors buy proven exposure to a strategy; they don't get a public shopping list of what to replicate.
- →**Copy-trading that doesn't leak the trades being copied.** The value of a top trader's book collapses the instant it's public - everyone piles into the same entries and the edge is gone. A copy vault mirrors the leader's spot allocation into depositor capital through Private Sub-Accounts, so followers get the exposure while the composition and rebalances stay confidential to non-followers. The strategy is a product, not a broadcast.
- →**Verifiable performance without a public portfolio.** The historical record is the thing that sells an index or a trader, and it's provable here without revealing the current book. NAV, historical performance, and drawdown are exposed as verifiable metrics; the live composition is encrypted. Depositors trust the track record cryptographically, not the manager.
- →**Thematic baskets that don't move the market against themselves.** A public "AI tokens" or "Solana DeFi" index telegraphs every rebalance - front-runners trade ahead of the additions and deletions. Confidential composition and execution mean the basket rebalances without signalling its own flow, so the index captures its target rather than paying for its own transparency.
- →**Chain-abstracted spot exposure from one deposit.** The basket can hold assets across chains while the depositor deposits once. Composition spans venues and networks via Chain Abstraction; the depositor sees a single NAV curve, not a multi-chain reconciliation problem.

## What you build

A `Vault` helper contract for spot portfolios that mints depositor shares against pooled STRK20 capital and marks them to a NAV proven by STARK proof rather than a published holdings list. The Enclave holds index composition, weightings, and rebalance logic confidential; for copy-trading vaults it mirrors a leader's spot allocation into follower capital without exposing the underlying trades to non-followers. Execution routes through Private Sub-Accounts across chains via Chain Abstraction, so rebalances and additions don't telegraph flow. NAV, historical performance, and risk metrics are exposed as verifiable public numbers, while per-asset composition is disclosed only through Viewing Keys to a depositor, auditor, or compliance process - the ETF's transparency-to-authorities model without the transparency-to-front-runners cost.

## Why this isn't Enzyme

Enzyme has executed $7B+ in transaction volume and is the reference implementation for onchain asset management - but every vault's holdings and every trade are public by construction. That transparency is exactly what makes an Enzyme strategy copyable and front-runnable the moment it works. Here composition and execution stay confidential while NAV and performance remain provable, so a manager can run a real strategy without handing it to the mempool. Same managed-vault model; the portfolio is no longer a public dataset.

## Why this isn't Index Coop

Index Coop builds tokenized index products with fully published methodologies and holdings - which is fine for a passive, well-known basket but fatal for any index with actual alpha, since the composition is the entire IP and it's given away. This vault keeps composition and rebalance logic encrypted in the Enclave while still proving NAV and historical performance. It lets an index be both verifiable and proprietary - a combination transparent chains can't offer.

## Why this isn't Nested

Nested lets anyone create and share spot portfolios (30,000 created), and sharing is the point - the portfolio is public and meant to be copied openly. That works for social discovery but destroys any edge and telegraphs every rebalance to front-runners. Here the composition stays confidential and copy-trading mirrors exposure into follower capital without publishing the trades, while performance stays verifiable. Nested makes portfolios public; this makes proven portfolios private.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Markets & Trading

Published Aug 3, 2026

21

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Private index and copy-trading vaults

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