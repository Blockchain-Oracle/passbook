[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 13 · Payments & Money

# Savings circle vaults the organizer holds, not you

Hundreds of millions of people save in circles - a tanda, a kameti, a pardner, an ayuuto, a paluwagan, a stokvel. Ten people put in $100 a month; each month one member takes the pot, in the order the group set at the start. Every app that tried to digitize this died the moment the company held the pooled money and the law treated it like a bank. A vault only the organizer controls removes that: the rules live in code, the schedule is enforced on-chain, and the people who built the software never touch the money.

## What this enables

- →**A product that doesn't die on contact with a money-transmitter license.** Yahoo launched a savings-circle app in January 2018 and shut it down four months later. eMoneyPool worked on it for nine years and closed in 2019. PayPal killed its group money pools despite holding more licenses than almost anyone. Every one hit the same wall: the moment the company holds the pot, it needs a bank or money-transmitter license in every country it touches. A vault only the organizer controls means no company holds the pot, so no company needs a license for the pot.
- →**The border-crossing circle that already exists, finally served.** A nurse in Minneapolis runs a circle with her sister in London and her mother in Mogadishu - today on WhatsApp, cash, and trust. Remittance companies move $685B a year to these corridors, but only person-to-person. No product serves the group. The vault does, with licensed money companies handling the bank-to-digital-dollar conversion at each end.
- →**A white-label rail for the companies that survived.** Bloom Money (UK only), MoneyFellows (Egypt, 8.5M users, profitable, spent nine years and $13M trying a second country), Hakbah (Saudi Arabia, 1.2M users), Oraan (Pakistan) - each is locked out of the international version of its own product by its own single-country license. The offer: your users, your brand, your home license untouched; the international circle runs on a vault the organizer holds, so your company never touches that money. These companies become customers, not competitors.
- →**A savings mode as well as a rotating one.** The same vault can lock every member's contributions until a chosen date - for groups saving toward a holiday, a wedding, or Eid - not just rotate a pot each month.
- →**Optional privacy that fits the law, not around it.** Members may not want outsiders to see their balances or who belongs to the group. Starknet's privacy tools can hide balances and membership from the public while still disclosing to the licensed money companies exactly what regulation requires them to see. This makes the product better; it is not required.

## What you build

An account that **only the organizer controls**, holding digital dollars, with the circle's rules encoded on-chain: the contribution schedule, the payout order the group agreed at the start, late-payment rules, exit rules, and automatic payout when a cycle closes. A second mode locks savings until a chosen date. Above it, an app that feels normal - sign in with email or a passkey, never a seed phrase, never a gas fee, never anything that looks like crypto. A member sees _"our circle, 10 members, $100 a month, my payout comes in March."_ Starknet's account features (native account abstraction, session keys, paymaster-sponsored transactions) are what make that invisibility possible, and that is why this idea belongs here. Wire in licensed money companies for the bank-to-digital-dollar conversion and identity checks at both ends - UK↔Pakistan (Pakistan licensed such companies in 2025) and Gulf↔Philippines (licensed for years) are the two most workable first corridors.

## The rules that keep it legal

These come from the ways past products died or got regulated. If you build this, treat them as fixed.

- →**Never hold or move the money, and never be able to.** No admin keys, no backup access, no ability to sweep a vault.
- →**Charge flat software fees.** Never a percentage of the pot; never fees that scale with the pooled amount.
- →**Never let the platform pick the payout order.** The group sets it when the circle starts. StepLadder (UK) picks winners by draw and needed a consumer-credit license for exactly that.
- →**Invite-only, always.** No public list of circles, no search, no matching strangers, no advertising individual circles. Circles are people who already know each other.
- →**No bidding circles.** Members bidding to receive the pot early by accepting less is a discount that works like interest between members - lending law then applies.
- →**No yield on pooled money** unless your own lawyers clear the design first. **No sellable credits or play money** that can convert to real money - several US states banned that pattern in 2025.
- →**Block the countries that license the organizer.** India (Chit Funds Act), Ghana (registers collectors), South Africa (currency controls block the international leg). This is a start, not a complete map - check every country you serve.

## Why this isn't a neobank or a wallet

A neobank or a pooled-savings wallet _holds_ customer funds - which is precisely the thing that forced eMoneyPool, Yahoo, and PayPal's money pools to shut down or acquire licenses. Here the company holds nothing and cannot: the pot lives in a vault the organizer alone controls. The software is plumbing, not a balance sheet.

## Why this isn't a lending or a yield product

Nobody borrows and nobody pays interest - after ten months everyone has paid in $1,000 and received $1,000. There is no credit extended, no return promised, no bidding for early access. Removing those is what keeps it out of lending and securities regimes. This is not a prediction market, not a lending product, not a yield product, and not a bid to compete with the existing circle companies. It is the rail they adopt.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Payments & Money

Published Jul 8, 2026

13

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Savings circle vaults the organizer holds, not you

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