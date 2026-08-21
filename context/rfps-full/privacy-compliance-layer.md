[Hackathon is liveAug 14–31 · $5,000 in STRKJoin the sprint→](https://strk20.starknet.io/hackathon)

[STRK\[20\]](https://strk20.starknet.io/) [Home](https://strk20.starknet.io/) [Use](https://strk20.starknet.io/app/live-apps) [Build](https://strk20.starknet.io/apply) [RFPs](https://strk20.starknet.io/rfp) [Hackathon](https://strk20.starknet.io/hackathon) [Tutorials](https://strk20.starknet.io/#playlists) [Dashboard](https://strk20.starknet.io/dashboard) [Launch App](https://strk20.starknet.io/app/live-apps)

[← All ideas](https://strk20.starknet.io/rfp)

▸ Idea 23 · Infrastructure

# Privacy compliance layer for onchain privacy apps

Shared compliance infrastructure for privacy apps — deposit and sanctions screening, selective disclosure, viewing keys, authorized tracing, source-of-funds proofs, and configurable policies — the compliance standard for programmable onchain privacy.

## What this enables

- →**Privacy apps that survive contact with regulators.** Tornado Cash got OFAC-sanctioned because it had no compliance path — deposit anything, withdraw anywhere, no screening, no disclosure. Every privacy app since inherits that liability. A shared compliance layer gives any STRK20-built app deposit screening, sanctions screening, and authorized tracing under legal process without the app team rebuilding it from scratch.
- →**Screening at the deposit, not the withdrawal.** FPI (feed pull input) screening checks funds against sanctions and risk lists before they enter the privacy pool, so the anonymity set stays clean. Tainted funds are rejected at the door instead of being laundered through the set — the difference between a compliant privacy tool and a mixer.
- →**Selective disclosure the account holder controls.** Viewing keys let a user prove exactly what they need to prove — source of funds to a bank, income to a tax authority, aggregate spend to an auditor — and nothing else. Disclosure is scoped, cryptographic, and initiated by the holder or by authorized trace under legal process, never a blanket surveillance backdoor.
- →**Institutional reporting without a custodian.** A fund can generate a complete, tamper-evident report of its positions and flows for its compliance desk while those same positions stay unlinkable to the public. Proof of completeness via STARK proof means no fabrication and no omission — the report is verifiable, not asserted.
- →**One integration, every privacy app.** Instead of each protocol building bespoke screening and disclosure, they call one shared layer with configurable policies. A remittance app sets light-touch consumer thresholds; an OTC venue sets institutional KYC gates; a payroll tool sets tax-disclosure defaults. Same infrastructure, policy per app.

## What you build

A `Compliance` module any STRK20 app can compose: an FPI screening contract that checks deposits against sanctions and risk feeds before shielding, rejecting or quarantining tainted inflows; a viewing-key registry binding disclosure capabilities to accounts and to authorized third parties; a selective-disclosure prover that emits STARK proofs of scoped facts (source of funds, aggregate balance, sanctions-clear status, transaction inclusion) without revealing the underlying private state; an authorized-tracing path that unwinds a specific flow only under a registered legal-process key, leaving everything else opaque; and a configurable policy engine where each integrating app declares its screening lists, disclosure defaults, threshold rules, and reporting cadence. The output is a set of contracts and an SDK surface, not an app — the compliance primitives every other RFP on this list plugs into.

## Why this isn't per-protocol bolt-on compliance

Today every privacy protocol reinvents screening and disclosure in-house, badly and inconsistently. One app screens deposits, another doesn't; one supports viewing keys, another has no trace path at all. Regulators see a fragmented landscape with no common standard and treat the whole category as mixers. A shared layer means screening logic, sanctions feeds, and disclosure semantics are written once, audited once, and identical across every app that integrates — the difference between twelve half-built compliance stories and one that a regulator can actually evaluate.

## Why this isn't doing it in-house

An app team building compliance in-house spends its scarce engineering on FPI feed integration, viewing-key cryptography, and trace-authorization plumbing instead of on its product. It ships late, ships incomplete, and carries the full legal liability of any gap. Consuming a shared, audited compliance layer turns compliance from a multi-quarter build into a dependency — the app declares its policy and inherits screening, selective disclosure, and authorized tracing on day one. The layer amortizes the hardest, highest-liability work across the entire ecosystem.

## Why this is the shared standard

The strategic point isn't to build one more compliant app — it's to become the compliance standard for programmable onchain privacy. Privacy apps on other ecosystems have no compliance answer and can't get one without a layer like this. If every STRK20 app screens through the same FPI infrastructure, discloses through the same viewing-key model, and traces through the same authorized path, that convention becomes the reference implementation regulators and institutions point to. Owning the compliance standard is how the entire private stack stays legal at scale.

▸ Building this?

Show us what you’re working on. We’ll support you every step of the way.

Book a chat→

Infrastructure

Published Aug 3, 2026

23

▸ Not ready to book a call?

## Just drop us a message.

A line about what you're thinking, an early idea, a question — no commitment. It comes straight to our inbox and a human gets back to you.

Message \*

Name (optional)Email / TG / X \*

re:Privacy compliance layer for onchain privacy apps

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