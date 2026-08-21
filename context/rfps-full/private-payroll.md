[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 11 · Payments & Money

# Private payroll and treasury disbursement at company scale

A payroll protocol where per-recipient amounts stay private from each other and from the public, but the payer can prove aggregate spend to auditors and each recipient can prove income for tax filings. The compliance model traditional payroll uses, brought onchain without a centralized intermediary.

## What this enables

- →**Onchain companies that can compete for senior talent.** The single largest barrier to crypto-native companies hiring senior engineers and execs is salary visibility. Today a candidate's choice is "compensation public on the internet" or "take the Web2 offer." STRK20 closes the gap - onchain payroll handled exactly as any traditional employer handles it.
- →**Vesting without front-running.** Token vesting unlocks are the most reliably gamed events in crypto. Markets price in the dump weeks ahead. Founders get accused of dumping before they've sold anything. Private vesting lands tokens in encrypted notes; the schedule is enforced on-chain but the amounts and timing of recipient sells aren't public.
- →**DAO treasury confidentiality with public accountability.** Aggregate spend is visible ($847K to 73 contributors this quarter, on-chain verifiable). Per-recipient breakdown is encrypted. A governance committee with viewing-key access can verify the split. First treasury model that doesn't force a choice between public accountability and internal cohesion.
- →**Contractor and grant networks without recipient doxxing.** Crypto gig platforms pay thousands of contributors in public transactions. Top earners get profiled, recruiters scrape leaderboards, phishers target high-value addresses. STRK20 keeps the rails public-accountable while taking the contributor base off the surveillance target list.
- →**Compliance that tax authorities already understand.** Confidential from the public, fully disclosed to the tax authority - the W-2 / P60 / T4 model. Each recipient generates a viewing-key-derived income statement; the payer generates the full payroll book. Cryptographic proof of completeness; no fabrication, no omission.

## What you build

A `Payroll` helper contract managing recurring (payer, recipient) channels. Batched disbursement transactions (one tx, 50 recipients). Vesting schedules with on-chain enforcement and private amounts. Termination as a recorded-on-chain event with no public disclosure. Admin tooling (session-key scoped to a payroll cycle's budget) and the recipient discovery experience (paymaster-sponsored - no recipient signature ever required).

## Why this isn't Sablier or Vesting.so

Both put schedules on public ledgers. Stream rate equals salary divided by duration - the math is trivial; zero privacy improvement. Vesting.so publishes cliff dates and amounts; markets dump ahead of every unlock. STRK20 inherits the channel + viewing-key model: the schedule is on-chain and enforced, but its parameters are encrypted to the parties and the auditing entity.

## Why this isn't Deel-style centralized payroll

Centralized payroll services solve privacy by being the centralized intermediary. They see everything, hold the relationship, can be subpoenaed, hacked, or shut down. STRK20 splits the trust: cryptographic on the rails, cryptographic on the compliance disclosure. No intermediary holds the data.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Payments & Money

Published May 26, 2026

11

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Private payroll and treasury disbursement at company scale

Send message→

More in Payments & Money

[Idea 12\\
**Private subscriptions and creator monetization with Web2-grade UX** \\
Recurring private payments from subscribers to creators - gas-sponsored, set-and-forget, with subscriber identity cryptographically hidden. Tier-gated access via STARK proofs, not wallet scanning. The onchain Patreon that finally works.](https://strk20.starknet.io/rfp/private-subscriptions) [Idea 13\\
**Savings circle vaults the organizer holds, not you** \\
Hundreds of millions of people save in circles - a tanda, a kameti, a pardner, an ayuuto, a paluwagan, a stokvel. Ten people put in $100 a month; each month one member takes the pot, in the order the group set at the start. Every app that tried to digitize this died the moment the company held the pooled money and the law treated it like a bank. A vault only the organizer controls removes that: the rules live in code, the schedule is enforced on-chain, and the people who built the software never touch the money.](https://strk20.starknet.io/rfp/savings-circle-vaults)

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