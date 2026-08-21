[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 02 · Gaming

# Provably fair on-chain poker where cheating is mathematically impossible

A fully on-chain poker game where players' hands are cryptographically private, dealing is STARK-proven fair, and betting settles through the privacy pool. No trusted server, no admin who can peek at cards.

## What this enables

- →**Provably fair online poker.** Every existing platform asks players to trust a black-box RNG. This replaces trust with STARK proofs of correct dealing. Every hand is independently verifiable.
- →**Cryptographic cash games.** Buy in by shielding USDC, play through paymaster-submitted actions, cash out to any address - your stack size, session history, and lifetime results are private unless you choose to disclose.
- →**Tournament infrastructure** \- guaranteed prize pools, blind structures, table balancing. Entry fees and payouts as private transfers; organizers verify participants via viewing keys.
- →**A platform for any hidden-information game.** The card-as-encrypted-note pattern generalizes to Battleship, Mafia, sealed-bid auctions, and anything else with hidden state. Poker is the proof of concept; the primitives are reusable.

## What you build

A `PokerGame` contract implementing `privacy_invoke` for deal/bet/fold/reveal/settle. Cards are encrypted STRK20 notes that decrypt only with the player's channel key. Ship with the trusted-dealer shuffle first (STARK-proven from a committed seed - strictly better than every existing platform). V2 explores Noir + Garaga mental poker for heads-up games where the proving overhead is tolerable.

## The "only on Starknet" showcase

Encrypted notes as cards, channels as player relationships, session keys for gameplay (sign in once, play for hours, scoped permissions), paymaster for gasless UX, STARK proofs for dealing fairness. Every core primitive of STRK20 works together in one application that literally cannot exist on any other chain.

## Hidden vs visible

\| Element \| Hidden \| Visible \|
\| \-\-\- \| \-\-\- \| \-\-\- \|
\| Player identities \| Yes - paymaster submits all tx \| \|
\| Hole cards \| Yes - encrypted notes, only the holder decrypts \| \|
\| Bet amounts \| \| Yes - poker bets are public by design \|
\| Stack sizes, session history \| Yes - held as private notes \| \|
\| Showdown reveals \| \| Yes - selective reveal of channel keys at hand end \|

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Gaming

Published May 26, 2026

02

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Provably fair on-chain poker where cheating is mathematically impossible

Send message→

More in Gaming

[Idea 09\\
**On-chain Among Us with provably fair roles and anonymous votes** \\
A fully on-chain social deduction game - hidden roles as encrypted notes, night actions as private transfers, voting as anonymous channel transfers. No server can leak roles, no admin can peek, vote tallies are provably correct.](https://strk20.starknet.io/rfp/social-deduction-game)

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