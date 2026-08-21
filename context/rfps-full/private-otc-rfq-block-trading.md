[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 19 · Markets & Trading

# Private OTC and RFQ block trading for institutions

A confidential RFQ venue where whales, funds, and treasuries request quotes for large trades without revealing identity, size, or direction — market makers compete privately, best quote wins, and settlement runs through STRK20.

## What this enables

- →**Nine-figure orders that can finally settle on-chain.** A fund cannot show a nine-figure order to a transparent orderbook without being front-run, so that flow stays on CEX desks and bilateral OTC today. Confidential RFQ makes institutional size executable on-chain: the request, the size, and the direction stay hidden until a quote is accepted.
- →**Market makers competing without seeing each other's hand.** Participants request quotes without revealing identity, trade size, direction, or execution parameters; makers respond into a sealed process, the best quote is selected, and losing quotes learn nothing. Competition on price, not on information leakage.
- →**Settlement with no desk holding the funds.** The winning trade settles through STRK20 - atomic, verifiable, no intermediary custody and no counterparty risk. The value a traditional desk charges for collapses to matching; custody and settlement are done by the protocol.
- →**The highest-value flow in crypto, brought to Starknet.** Institutional block flow is the deepest liquidity there is, and it is precisely the flow retail venues can't attract. Capturing it gives STRK20 depth that retail volume cannot, on the trades that cannot happen in public.
- →**An institutional distribution channel, not just a venue.** Funds, treasuries, and market makers who onboard for block execution become users of private vaults, treasury management, and compliance elsewhere in the stack. Block trading is the wedge; the relationship is the asset.

## What you build

A confidential RFQ engine where a taker posts an encrypted request - pair, size, direction, and parameters sealed as Encrypted Notes - and makers submit competing quotes into an Enclave that evaluates them without revealing any quote to any other participant or the request to the losing makers. On acceptance, settlement runs as a two-leg atomic fill against the Privacy Pool via `InvokeExternal`, so neither counterparty's identity is linked to the trade and no venue holds funds mid-flight. Persistent maker-taker relationships live as encrypted channels, so a desk's regular counterparties re-trade without new on-chain setup or address leakage. The Compliance Layer sits alongside: each party generates viewing-key trade confirmations for their auditors and source-of-funds proofs for onboarding, and specific trades are traceable under legal process - the disclosure model institutions require, without making the book public.

## Why this isn't Paradigm or Paradex

Paradigm is an institutional RFQ and OTC communication network, and Paradex runs the on-chain execution and options venue - the potential first partner here, given existing OTC options activity and appetite for on-chain institutional execution. But their liquidity discovery and settlement expose identity, size, and relationship to counterparties and, on-chain, to observers. STRK20 makes the request itself confidential end to end: makers compete blind, the winning quote settles atomically through the pool, and identity and direction are never linked to the trade - turning a communication-and-relationship layer into a venue where the order can actually stay dark through settlement.

## Why this isn't Zama's confidential trading

Zama recently announced a similar confidential-execution offering, which validates that institutional demand for private on-chain block flow is real. The difference is the settlement substrate: STRK20 settles through a live privacy pool with atomic two-leg fills, viewing-key disclosure, and a Compliance Layer built for authorized tracing and source-of-funds proofs - the parts institutions actually gate onboarding on. This is not confidentiality as a primitive demo; it is a settlement venue with the compliance and distribution surface that turns block execution into an on-ramp for private vaults, treasury, and the rest of the stack.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Markets & Trading

Published Aug 3, 2026

19

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Private OTC and RFQ block trading for institutions

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