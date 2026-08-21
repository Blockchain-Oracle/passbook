[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 03 · Markets & Trading

# Trustless, atomic, private OTC settlement for large block trades

Two counterparties agree off-chain, settle on-chain through the privacy pool: no intermediary holds funds, no counterparty risk, and neither party's identity is linked to the trade. 5–15bps per side undercuts every desk in the market.

## What this enables

- →**Trustless large block trading.** FTX and Genesis were both OTC desks that went bankrupt with client funds. This removes the intermediary entirely - atomic settlement via a verifiable Cairo contract, no admin keys.
- →**Privacy that institutions can actually use.** Both parties generate viewing-key trade confirmations for their compliance teams. The auditing entity can trace specific trades under legal process. Privacy through cryptography, not through opacity.
- →**Fee compression for the OTC market.** Traditional desks charge 10–50bps for matching, custody, and settlement. STRK20 OTC automates the last two. Fees collapse to 5–15bps - the cost of matching alone.
- →**Channel-based counterparty relationships.** A market maker with 50 regular counterparties has 50 encrypted, persistent channels. Subsequent trades are frictionless: no new on-chain setup, no re-KYC, no address leakage.

## What you build

An `OTCSettlement` helper contract with a two-leg fill pattern: seller fills leg A, buyer fills leg B in the matching transaction, settlement is atomic on leg B (verify, fee, distribute via `open_note_deposit`, mark settled). Timeout-and-reclaim for the cancel path. Counterparty discovery is a separate layer - start with off-chain matching (Telegram/Discord OTC groups), extend to on-chain encrypted intent boards or automated RFQ later.

## Hidden vs visible

\| Element \| Hidden \| Visible \|
\| \-\-\- \| \-\-\- \| \-\-\- \|
\| Both parties' identities \| Yes - paymaster submits, no address link \| \|
\| The relationship between them \| Yes - channels are encrypted \| \|
\| Trade amounts, token pair \| \| Both parties already know - open notes are plaintext \|
\| That an OTC trade occurred \| \| Yes - deposits to and distributions from the helper \|
\| Compliance history \| Selectively - via each party's own viewing key \| Not public \|

## Why it ships

The privacy pool already provides the three things traditional OTC desks charge for: privacy (cryptographic, not opacity-based), settlement (atomic, no human in the loop), and compliance (selective disclosure via viewing keys). The desk's value collapses to matching - everything else is better done by the protocol.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Markets & Trading

Published May 26, 2026

03

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Trustless, atomic, private OTC settlement for large block trades

Send message→

More in Markets & Trading

[Idea 04\\
**Bonding-curve token launches with hidden buyers, visible price action** \\
A Pump.fun-style launchpad where bonding-curve mechanics, trade sizes, and the social feed stay fully visible - but no observer can attribute any trade to any wallet. Whales buy without triggering copy-trade cascades; devs sell without panic dumps.](https://strk20.starknet.io/rfp/private-pumpfun) [Idea 07\\
**Prediction markets with visible odds and invisible bettors** \\
Bet sizes and odds stay fully visible - the information aggregation works. Bettor identities are completely hidden. Markets stay informationally efficient while the identity-based manipulation that plagues Polymarket disappears.](https://strk20.starknet.io/rfp/private-prediction-market)

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