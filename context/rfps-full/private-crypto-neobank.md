[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 18 · Payments & Money

# Private crypto neobank with a non-custodial spending card

A chain-abstracted account to hold fiat, stables, and crypto, convert, earn yield, and spend through a non-custodial card connected to private balances — public and private modes per activity, closing the loop between shielded balances and real-world spending.

## What this enables

- →**A card that spends shielded balances in the real world.** The card is non-custodial and connected directly to private balances. Swipe at any merchant that takes cards; stablecoins or crypto convert automatically at point of sale. The primary wallet, total balance, full history, and the origin of the spending wallet stay unexposed - the loop between private on-chain funds and offchain spending finally closes.
- →**Public and private modes per activity, not per account.** Every action - hold, convert, earn, spend - toggles between transparent and shielded. One account, not two products: the user decides transaction by transaction what is legible and what is not.
- →**Yield on balances nobody can size.** Hold multiple fiat currencies, stables, and crypto; earn yield; and route capital without publishing total holdings or linking positions back to a primary identity. Shielded balances still earn.
- →**Chain-abstracted funding and spending.** Deposit from Ethereum, Solana, or any supported chain and spend anywhere cards work, with wallet creation, chain selection, gas, and privacy abstracted away. Gas is paymaster-sponsored; the user never touches a bridge or a network switch.
- →**The consumer end state of the private stack.** A global crypto-native financial account with privacy in the infrastructure rather than bolted on - the surface where a normal person actually uses shielded money without knowing it is shielded.

## What you build

A chain-abstracted `Account` layer where balances live in the Privacy Pool and each spending surface is a Private Sub-Account unlinkable to the primary identity or to each other. Card authorizations settle against shielded notes: an authorization request triggers a just-in-time conversion inside the pool, funds a single-use spending sub-account, and settles to the acquirer, so the merchant and the network see a card, not a wallet. Beam handles human-readable inbound and outbound distribution; Chain Abstraction ingests deposits from external chains and normalizes them into private balances. Paymaster (Avnu) sponsors gas so the user signs value, not fees, and Viewing Keys generate statements and source-of-funds proofs for card issuers, tax filings, and compliance without exposing the full ledger.

## Why this isn't ether.fi Cash

ether.fi Cash spends against on-chain balances, but the account, its holdings, and its transaction history are public - the card is a spending surface on a transparent wallet. Anyone can size the account funding each swipe. STRK20 spends against shielded balances instead: the same real-world card acceptance, but total balance, history, and the origin wallet are never exposed, and modes flip public/private per transaction rather than being permanently transparent.

## Why this isn't Ready or Kast

Ready and Kast are card-first crypto spending apps: fund a wallet, get a card, spend stables at point of sale. The rails work, but the funding wallet and its balances are public on-chain, and privacy is not part of the product. STRK20 is the same spend-anywhere experience with the balance layer shielded and non-custodial - the card draws from private notes via a single-use sub-account, so the merchant, the network, and the chain never see the account behind the swipe.

## Why this isn't Gnosis Pay

Gnosis Pay ties a Visa card to a self-custodial Safe on Gnosis Chain, which is exactly the point of friction: the Safe, its balance, and every transaction are publicly legible, so the card is a window into the user's whole on-chain life. STRK20 keeps the non-custodial guarantee but severs the link between the card and a visible account - conversions and settlement happen inside the Privacy Pool, spending runs through unlinkable sub-accounts, and disclosure to an issuer or auditor is selective via viewing keys rather than automatic to the entire public.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Payments & Money

Published Aug 3, 2026

18

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Private crypto neobank with a non-custodial spending card

Send message→

More in Payments & Money

[Idea 11\\
**Private payroll and treasury disbursement at company scale** \\
A payroll protocol where per-recipient amounts stay private from each other and from the public, but the payer can prove aggregate spend to auditors and each recipient can prove income for tax filings. The compliance model traditional payroll uses, brought onchain without a centralized intermediary.](https://strk20.starknet.io/rfp/private-payroll) [Idea 12\\
**Private subscriptions and creator monetization with Web2-grade UX** \\
Recurring private payments from subscribers to creators - gas-sponsored, set-and-forget, with subscriber identity cryptographically hidden. Tier-gated access via STARK proofs, not wallet scanning. The onchain Patreon that finally works.](https://strk20.starknet.io/rfp/private-subscriptions)

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