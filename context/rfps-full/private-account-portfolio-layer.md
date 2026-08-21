[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 25 · Infrastructure

# Private account and portfolio layer for the crypto economy

One private account controlling an unlimited number of unlinkable execution identities, with a single interface aggregating everything you hold and do across chains and apps — the universal private identity and account layer for crypto.

## What this enables

- →**One account, unlimited unlinkable identities.** A single main account fans out into as many execution identities as you want — Account A trades Hyperliquid, B holds Polymarket positions, C swaps on Jupiter, D lends on Vesu, E enters launchpads, F handles payments, G runs lending — and no external observer can link them to each other or back to you. Created per app, per venue, or per strategy, across Starknet and any supported external chain.
- →**A portfolio view that only you can assemble.** Externally your activity is scattered across hundreds of isolated identities and multiple chains. Internally, one interface aggregates all of it — spot, perps, lending, staking, yield, token launches, payments, prediction markets — into a single consolidated balance, allocation, PnL, historical performance, and risk exposure. The fragmentation is the privacy; the consolidation is the product.
- →**Public and private in the same account.** Positions stay externally unlinkable wherever privacy is enabled, but the account also aggregates your public activity — the interface shows one portfolio spanning both modes, so you don't run a private stack and a public stack side by side.
- →**Chain abstraction underneath every identity.** Sub-accounts operate across Starknet and external chains without you managing wallets, gas, or bridges per venue. The account layer handles routing; you see identities and a portfolio, not infrastructure.
- →**Aggregation without a data broker.** The consolidated view is computed for you, by you — not by a third party that indexes your addresses and sells the graph. Viewing keys scope any disclosure you choose to make; nobody else assembles your portfolio.

## What you build

An `Account` layer exposed through the Wallet API: one main account that deterministically derives unlimited private sub-accounts, each an unlinkable execution identity bound to an app, venue, or strategy. Chain abstraction lets each sub-account act across Starknet and external chains — Hyperliquid, Polymarket, Jupiter, Vesu, launchpads, payment rails — without per-venue wallet management. A portfolio engine, running aggregation in the Enclave so the consolidated state never leaks, pulls balances and positions from every sub-account and every connected public wallet into one internal view: balance, allocation, PnL, historical performance, risk. Viewing keys gate any external disclosure. The deliverable is the account and portfolio infrastructure other STRK20 apps sit on top of, not a single trading app.

## Why this isn't Particle Universal Accounts

Particle's Universal Accounts use account abstraction to give a user one account that operates across chains — unified balance, one signing experience, cross-chain execution. But the whole point is unification that's visible: one account, linkable, aggregating your activity into a single observable identity. This is the inverse at the identity layer: the account fans out into hundreds of identities that observers cannot link, and the unification exists only internally for the user. Same AA foundation, opposite privacy property — Particle makes you one legible account; this makes you unlimited illegible ones with a private console.

## Why this isn't Infinex

Infinex builds the unified interface — one front end over spot, perps, and the rest of DeFi so you stop juggling apps. But it unifies the surface, not the identity: everything you do still runs from linkable public addresses, and the convenience comes with full attribution. This provides the unified interface too, and adds the layer Infinex lacks — every action routes through an unlinkable execution identity, so the single console sits on top of privacy rather than on top of a public address book.

## Why this isn't Zerion

Zerion aggregates your portfolio by indexing your public addresses — it reads the transparent chain and assembles the view for you, which means the same graph is assemblable by anyone, and Zerion itself sees all of it. Here the portfolio is aggregated from your own private sub-accounts, computed in the Enclave, visible only to you; external observers see scattered unlinkable identities and can't reconstruct the consolidated picture. Zerion aggregates what's already public; this aggregates what's private and keeps it that way.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Infrastructure

Published Aug 3, 2026

25

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Private account and portfolio layer for the crypto economy

Send message→

More in Infrastructure

[Idea 06\\
**One-click privacy from any chain - Starknet as the privacy layer of crypto** \\
Any user on Ethereum, Base, Arbitrum, or Solana gets one-click access to STRK20 privacy - without learning Starknet, installing a new wallet, or holding STRK. Bridge in, hold private, withdraw to any chain with zero on-chain link.](https://strk20.starknet.io/rfp/cross-chain-privacy-hub) [Idea 10\\
**An Umbra-style privacy wallet for Starknet** \\
A wallet that delivers the Umbra UX - publish once, receive privately, spend freely - fully powered by the existing STRK20 privacy pool. No protocol changes. The hard parts are already shipped; what's missing is the UI.](https://strk20.starknet.io/rfp/privacy-wallet)

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