[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 27 · Infrastructure

# Private DAO treasury OS

Safe + privacy + Starknet account abstraction — one private treasury for swaps, yield, grants, payroll, OTC, and LP with configurable role-based permissions, where members verify solvency without seeing every transaction.

## What this enables

- →**A treasury that transacts without broadcasting strategy.** DAOs, protocol foundations, crypto companies, and investment collectives run swaps, yield, grants, payroll, OTC, LP positions, and investments out of one account — today all of it public, so every rebalance, grant recipient, and OTC counterparty is legible to competitors and front-runners. STRK20 keeps operations confidential while the treasury stays a single managed account.
- →**Role-based permissions with cryptographic teeth.** A treasury manager deploys max $500k into whitelisted protocols; market makers trade but cannot withdraw; employees spend $10k/month. Each role is a Session Key scoped to a budget, a protocol allowlist, and an action set — enforced on-chain, not by trust in a signer.
- →**Solvency members can verify without surveillance.** DAO members prove the treasury is solvent and within policy without seeing every operational transaction. A Viewing Key exposes aggregate reserves and rule compliance to token holders while per-transaction detail stays private to the operators.
- →**Unlinkable execution across venues.** Each strategy, venue, or counterparty runs through its own Private Sub-Account, so an OTC block trade, a Hyperliquid position, and a grant payout can't be stitched into one treasury fingerprint by outside observers.
- →**Compliance-ready by construction.** Screening, selective disclosure, and source-of-funds proofs are wired into the treasury so a foundation can satisfy auditors and counterparties under authorization — confidentiality from the public, disclosure to the parties entitled to it.

## What you build

A `Treasury` helper contract that holds shielded balances in the Privacy Pool and fans execution out across Private Sub-Accounts, one per strategy or venue. Permissions are Session Keys parameterized by budget cap, protocol allowlist, action type, and recurrence — a manager key capped at $500k into whitelisted protocols, a market-maker key that can `InvokeExternal` into perps and DEXs but can't withdraw, an employee key metered at $10k/month. External calls into Ekubo, lending markets, perps, and OTC venues route through `InvokeExternal` so operations settle privately while remaining policy-enforced. Viewing Keys drive two disclosure surfaces: an aggregate solvency proof for members and a full transaction book for auditors under the Compliance Layer, which also handles screening, selective disclosure, and source-of-funds proofs for grants and payouts.

## Why this isn't Safe

Safe has already proven the demand: modular smart accounts with granular allowances, role-specific execution, recurring actions, and spending limits are exactly how serious treasuries want to operate. But every Safe module runs on a transparent ledger — the allowances, the recipients, the strategy, the balances, all public. Anyone can watch a foundation's runway, front-run its rebalances, and profile its grantees. STRK20 keeps Safe's permission model and adds the missing half: Privacy Pool balances, Sub-Account execution, and Viewing-Key disclosure, so the treasury is governable and provable without being public.

## Why this isn't Squads

Squads is the Solana equivalent — multisig treasury management with roles, spending controls, and program integrations, and it's the standard for Solana-native organizations. Same transparent-ledger limitation: positions, counterparties, and payouts are all on-chain in the clear, and members can only "verify" by watching everything everyone does. STRK20's treasury lets members verify solvency and policy compliance through a Viewing Key over proven aggregates, while the operational detail stays confidential — role-based control without turning the treasury into a public surveillance feed.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Infrastructure

Published Aug 3, 2026

27

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Private DAO treasury OS

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