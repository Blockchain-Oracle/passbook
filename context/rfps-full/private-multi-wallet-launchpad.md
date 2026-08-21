[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 16 · Markets & Trading

# Private multi-wallet launchpad for external venues

A launchpad where you participate through one interface while activity auto-distributes across multiple unlinkable sub-accounts — private participation, reduced wallet-level attribution, and chain-abstracted deposits.

## What this enables

- →**One interface, many unlinkable identities.** Participate in launches on Pumpfun (and Pons) through a single interface while activity automatically fans out across multiple unlinkable sub-accounts. The user never manages a wallet cluster by hand — the sub-account mechanism does the distribution.
- →**Reduced wallet-level attribution.** Because participation spreads across execution identities that observers can't link to each other or to the user, no single wallet accumulates a trackable profile. Concentrated allocation stops reading as one whale on the public ledger.
- →**Bypass anti-Sybil measures the hard way is automated.** Launches gate against single-wallet concentration; the workaround has always been manually farming dozens of wallets. Here that's a primitive: allocation auto-distributes across many sub-accounts, producing a healthier-looking public holder distribution without spreadsheet-driven wallet ops.
- →**Chain-abstracted deposits from anywhere.** Users deposit from any supported chain and participate without holding gas or bridging manually — funds shield into the pool and route to sub-accounts underneath.
- →**Private post-launch trading continuity.** Once a token is live, the same sub-account model keeps post-launch buys and sells unlinkable, so the privacy doesn't evaporate the moment the launch closes.

## What you build

A launchpad front-end over a `MultiWallet` orchestration contract that maps one user session onto many Private Sub-Accounts, each an unlinkable execution identity. Deposits arrive via Chain Abstraction from any supported chain, shield into the Privacy Pool as encrypted notes, and the orchestrator allocates participation across N sub-accounts per an allocation policy so no single address carries the concentrated position. The launch integrations target external venues — Pumpfun, Pons — routing per-sub-account participation into their contracts while the mapping back to the user stays private. An Enclave module can hold the allocation and post-launch trading logic confidentially, so the distribution strategy itself isn't observable, and post-launch buys/sells continue to route through the sub-account set to preserve unlinkability.

## Why this isn't Axiom

Axiom is the Solana terminal for operating many wallets at once: it gives a trader a cockpit to manage a wallet cluster manually, but the wallets are public Solana addresses, fully attributable and linkable by anyone watching the chain. It's tooling for coordinating visible wallets faster. This launchpad makes the sub-accounts cryptographically unlinkable — the distribution across identities is a privacy primitive, not a UI convenience — so the concentrated allocation genuinely disappears from wallet-level analysis rather than just becoming easier to click through. And deposits are chain-abstracted into Starknet's privacy layer rather than tied to a single-chain terminal.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Markets & Trading

Published Aug 3, 2026

16

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Private multi-wallet launchpad for external venues

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