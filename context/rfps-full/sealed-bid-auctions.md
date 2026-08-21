[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 08 · Markets & Trading

# Sealed-bid auctions where the bids are actually sealed

Bids are encrypted STRK20 notes - invisible to everyone, including the auctioneer, until reveal. First-price, second-price Vickrey, and multi-unit auctions, all with cryptographic bid sealing that's impossible on any transparent chain.

## What this enables

- →**Economically optimal auctions on-chain.** Vickrey (second-price sealed-bid) is the gold standard of auction theory - bidding your true value is dominant strategy, allocations are efficient, revenue is fair. Known since 1961 but never deployable on-chain because sealed bids were impossible without a trusted auctioneer. STRK20 makes them native.
- →**NFT auctions without sniping or manipulation.** Bots sniping last-second bids? Irrelevant when all bids are submitted before the deadline. Wash bidding? Now requires actually locking funds _and_ being the second-highest bidder. Whale intimidation? Impossible - nobody sees anyone else's bid.
- →**DAO grant allocation that ends anchoring.** Projects submit sealed funding requests; the DAO reveals simultaneously and funds from the lowest ask. No anchoring on Project A's number when Project B writes theirs. No social pressure, no gaming.
- →**Protocol parameter auctions.** Block space, sequencer priority, MEV-style auctions allocated by sealed-bid Vickrey instead of speed-based first-come-first-served. The fastest bot stops winning; the highest-value buyer does.
- →**Institutional M&A and RWA.** Real estate, business acquisitions, art - all conducted via sealed-bid auctions in traditional finance. Bringing them on-chain requires actually-sealed bids, not commit-reveal with griefing risk.

## What you build

An auction protocol with three phases: listing (auctioneer creates parameters), bidding (bidders submit encrypted notes - real escrowed funds, not just commitments), reveal (selective disclosure of bid amounts via viewing key material - revealed amounts must match the encrypted notes, or the bid is forfeit). Force-reveal via threshold auditing if a bidder goes offline. Support first-price, Vickrey, and multi-unit variants on the same contract.

## Why this isn't just commit-reveal

\| Approach \| Problem \|
\| \-\-\- \| \-\-\- \|
\| Commit-reveal \| Bidders grief by not revealing. Timing leaks info. Gas friction. \|
\| Timelock encryption \| Trusted timelock servers. Approximate decryption time. \|
\| Threshold MPC \| Committee can collude. Setup ceremony is complex. \|
\| Trusted auctioneer \| Server sees everything. No improvement over off-chain. \|
\| **STRK20 encrypted notes** \| **Real locked funds, no trusted party, no committee, no timing assumption.** \|

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Markets & Trading

Published May 26, 2026

08

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Sealed-bid auctions where the bids are actually sealed

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