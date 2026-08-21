[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 26 · Infrastructure

# Private DAO governance and delegation

Confidential DAO voting where individual votes stay private but the final result is verifiable — plus private delegation, so nobody publicly learns which whale delegated to whom. Kills whale signaling and bandwagon voting.

## What this enables

- →**Votes that can't be front-run by other votes.** On every transparent governance system, early votes are public, so late voters follow the leading side and whales telegraph the result before quorum. Secret-until-close voting keeps every ballot in an encrypted note until the window ends; only the aggregate tally is proven and revealed. No bandwagon, no whale signaling.
- →**Permanently private governance for sensitive decisions.** Some votes — treasury allocations, legal settlements, contributor comp, contentious forks — should never expose who voted which way, even after close. A permanently-private mode reveals only the STARK-proven aggregate result and never the per-voter breakdown.
- →**Delegation nobody can see.** A holder delegates 5M tokens; the delegate votes with that weight; the public never learns the source. Today delegation is a public graph that de-anonymizes whales and lets them be lobbied, threatened, or bribed. Private delegation breaks the link between the token holder and the voting power they lend.
- →**Verifiable outcomes without a trusted counter.** The final tally is a STARK proof over encrypted ballots, computed in the Enclave. Anyone can verify the result is a correct aggregation of eligible votes without decrypting a single one — no snapshot admin, no multisig counting the votes by hand.
- →**Sybil-resistant private ballots.** Eligibility (token weight at snapshot) is proven against the Privacy Pool commitment set, so one holder can't split into many voters and can't vote twice, even though the individual ballot stays confidential.

## What you build

A `Governance` helper contract that anchors a proposal, its snapshot block, and its eligibility commitment set, then accepts ballots as encrypted notes committing to (choice, weight) without revealing either. Voting runs in two modes: secret-until-close, where ballots stay sealed until the window ends, and permanently-private, where only the aggregate is ever surfaced. The Enclave performs confidential tally and emits a STARK proof that the revealed result is the correct weighted sum over eligible, non-double-counted ballots. Private delegation is a separate note type: a holder assigns weight to a delegate's execution identity through the Privacy Pool so the delegate can vote with combined power while the holder→delegate edge stays unlinkable. Viewing keys let a governance committee or auditor reconstruct the full ballot book under authorization without exposing it publicly.

## Why this isn't Shutter

Shutter has already validated shielded voting as a real governance primitive: encrypted votes hidden until a reveal phase, live across 881+ DAOs (87% still using it after a year) and 372,000+ votes encrypted. But Shutter's model is threshold-encryption timelock — ballots are hidden only until the reveal window opens, then decrypted in full, so nothing is permanently private and the per-voter breakdown always becomes public. It also does nothing for delegation: on every Shutter-integrated DAO the delegation graph stays fully transparent, so whales are still visible and still lobbied. STRK20 covers both gaps — a permanently-private mode that reveals only the STARK-proven aggregate, and delegation routed through the Privacy Pool so the whale→delegate link is never observable.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Infrastructure

Published Aug 3, 2026

26

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Private DAO governance and delegation

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