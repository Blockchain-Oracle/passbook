[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 12 · Payments & Money

# Private subscriptions and creator monetization with Web2-grade UX

Recurring private payments from subscribers to creators - gas-sponsored, set-and-forget, with subscriber identity cryptographically hidden. Tier-gated access via STARK proofs, not wallet scanning. The onchain Patreon that finally works.

## What this enables

- →**Sensitive-content creator economies, onchain for the first time.** OnlyFans alone processed $6.6B in 2023 with a subscriber base that depends on absolute privacy from spouses, employers, family. No fraction of this market moves to a public-ledger subscription system. STRK20 opens the entire category - sex work, drug-policy advocacy, mental health, dissident journalism, sex education in restrictive jurisdictions.
- →**"Set and forget" UX that matches Web2.** Session keys (one-time authorization), keepers (automatic charging), paymaster (no gas surprises), natural expiry (graceful end-of-subscription). First onchain primitive that actually resembles Web2 subscription UX, with the added property that the authorization is auditable, time-bounded, and unilaterally revocable by the subscriber.
- →**Creator confidentiality from competitors.** Every existing onchain creator platform exposes per-creator revenue. Rivals benchmark and copy pricing; would-be competitors target high-revenue creators; sponsors negotiate from informational asymmetry. STRK20 puts creator analytics behind the viewing key - same posture as Patreon and OnlyFans.
- →**Tier-gated access without surveillance.** Today, "is this user a $50/mo subscriber?" requires scanning the creator's wallet - a public surveillance act that doxes both parties. Token-gating replaces scanning with a public token-holdings list (same surveillance, different form). STRK20 replaces both with a STARK proof: "I have an active $50/mo subscription to creator C, expiring after D." Discord bot, Telegram gate, or software license verifies the proof and learns nothing else.
- →**Compliance with FTC "click to cancel" and equivalents.** Cancellation is a single session-key revocation. The helper records it. The creator cannot continue charging - structurally compliant by design, meaningfully easier than the Web2 platforms repeatedly hit with FTC enforcement.

## What you build

A `Subscriptions` helper contract managing (subscriber, creator) channels, session-key-authorized recurring charges, keeper-driven charge execution, and cancellation via revocation. A creator-side dashboard (active subscribers, MRR, churn, LTV - all derived from the creator's viewing key, all private to them). A tier-proof verifier library that Discord/Telegram/SaaS gates can drop in. Optional public aggregate counters (total subscriber count, opt-in MRR) for creators who want to show traction without exposing per-tier breakdown.

## Why prior onchain subscriptions died

Mirror, Paragraph, Lens, Solana Pay subscriptions, Unlock Protocol, Sablier-as-subscriptions - all credible attempts, all stalled. Every one forced a trade between subscriber privacy, clean cancellation UX, and creator verifiability. Streaming contracts approximate auto-charge but break on cancellation. Token-gated memberships work for access but dox membership. Session keys + channels resolve the trade - first time the structural pieces line up.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Payments & Money

Published May 26, 2026

12

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Private subscriptions and creator monetization with Web2-grade UX

Send message→

More in Payments & Money

[Idea 11\\
**Private payroll and treasury disbursement at company scale** \\
A payroll protocol where per-recipient amounts stay private from each other and from the public, but the payer can prove aggregate spend to auditors and each recipient can prove income for tax filings. The compliance model traditional payroll uses, brought onchain without a centralized intermediary.](https://strk20.starknet.io/rfp/private-payroll) [Idea 13\\
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