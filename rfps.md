https://strk20.starknet.io/rfp/private-messaging ▸ Idea 01 · Social & Communications
Encrypted on-chain messaging via the privacy pool
A private messaging layer built on the existing privacy pool - sender anonymity, encrypted payloads, persistent channels. No modifications to the pool contract, no trusted server, no metadata.
What this enables
* →Encrypted on-chain mail between any two privacy-pool participants - addresses never appear on-chain, messages decrypt only on the recipient's device.
* →Payment memos - attach a message to a private transfer in the same transaction. The first credible "remittance with note" primitive on a public chain.
* →Escrow negotiation - parties coordinate terms privately before executing a transfer, without ever leaking the relationship to observers.
* →A reusable substrate for any application that needs metadata-resistant messaging - anonymous tips, dissident comms, professional escrow.
What you build
A helper contract callable via InvokeExternal that appends encrypted message payloads to per-channel storage. An off-chain discovery indexer that returns decrypted messages for a given viewing key. SDK methods (sendMessage, discoverMessages) that reuse the same ECDH channel-key derivation the pool already uses for note encryption.
Why it ships
The privacy pool already gives you everything hard about secure messaging: key agreement via ECDH, encrypted persistent channels, sender anonymity via InvokeExternal (the pool is msg.sender, not the user). The work here is the helper contract, the indexer, and an SDK extension. No protocol changes required.
Hidden vs visible
| Element | Hidden | Visible | | --- | --- | --- | | Sender identity | Yes - pool is the msg.sender | | | Recipient identity | Yes - only resolvable via the recipient's viewing key | | | Message content | Yes - encrypted with the channel key | | | That a message was sent | Partially - an observer sees a pool transaction occurred | Block timestamp |
https://strk20.starknet.io/rfp/confidential-token-launchIdea 17 · Markets & Trading
Confidential token launch platform on Starknet
A privacy-native token launch platform on Starknet — confidential participation, private bonding curves, dark liquidity, unlinkable execution — so projects launch without exposing every participant's identity, allocation, and trades in real time.
What this enables
* →Launches where the cap table isn't public at t=0. A token launch is the single most attention-dense moment in a project's lifecycle. Today every allocation, every buyer, every insider wallet is legible on-chain within the first block. Confidential participation lands allocations in encrypted notes: the curve fills, price prints, but who bought how much is not attributable.
* →Bonding curves without the whale-attribution cascade. A 200K USDC buy moves the curve. On Pumpfun that buy is a Nansen alert and a copy-trade signal before it confirms. Here the price action is public and the buyer is not - no wallet-level attribution, no reflexive front-running of the launch itself.
* →Dark liquidity for the graduation moment. Projects seed and migrate liquidity without broadcasting the exact size, timing, and provenance of every LP position. The market sees depth; it does not see which sub-account seeded it.
* →Chain-abstracted participation from EVM and Solana. A buyer arrives with USDC on Base or SOL on Solana and participates without bridging, wrapping, or holding a Starknet wallet. Starknet is the privacy-and-settlement layer; the participant never sees it.
* →Insider allocations that can't be reverse-engineered on day one. Team, treasury, and strategic allocations settle into unlinkable execution identities. The public sees supply and price; it cannot map the concentrated allocation to a single dumping wallet the moment the token trades.
What you build
A LaunchFactory deploying per-token confidential bonding curves, each a privacy_invoke helper handling buy / sell / graduate against notes rather than public balances. Participation routes external capital through Chain Abstraction into the Privacy Pool, the curve computes tokens-out inside an Enclave so allocation size never touches a public event, and returns them as encrypted notes. Buyers fan activity across Private Sub-Accounts so no observer links participation across launches or aggregates a profile. At the market-cap threshold, graduate migrates liquidity to an AMM with the curve's final price while the seeding positions stay unattributed. The social feed and price oracle read public curve state - amount, timestamp, price, market cap - with the "who" encrypted end to end.
Why this isn't Pumpfun
Pumpfun is the same business with zero privacy: every buy, sell, and dev wallet is fully legible in real time, which is exactly why launches are gamed - snipers, copy-traders, and dev-dump detectors all operate on public attribution. Pumpfun still clears $25–31M/month in fees even in bear markets, so the demand is proven; the missing layer is the one Starknet provides. STRK20 keeps the visible price action that makes a launch a spectacle and removes only the attribution that makes it a surveillance target.
Why this isn't Fjord Foundry
Fjord Foundry runs LBPs and fair launches on transparent EVM chains where the pool, the participants, and every fill are public by construction. Its whole value is auction mechanics, not confidentiality - the allocation and the buyer set are observable as the sale runs. STRK20 owns the privacy layer of token distribution instead: same fair-launch and curve mechanics, but participation, allocation, and post-launch trading are unlinkable, and buyers reach it chain-abstracted from EVM and Solana without leaving their home chain.
https://strk20.starknet.io/rfp/privacy-wallet▸ Idea 10 · Infrastructure
An Umbra-style privacy wallet for Starknet
A wallet that delivers the Umbra UX - publish once, receive privately, spend freely - fully powered by the existing STRK20 privacy pool. No protocol changes. The hard parts are already shipped; what's missing is the UI.
What this enables
* →Umbra-grade UX on a stronger foundation. Umbra on Ethereum hides the recipient behind a one-time stealth address. STRK20 hides the recipient, the sender, the amount, and the token type - all inside encrypted pool storage. Stronger privacy by default; better UX with the right wallet on top.
* →A real consumer entry point to STRK20. Right now the privacy pool is accessed via SDK calls. A privacy-first wallet is the user-facing product that brings the rest.
* →One-key registration. Umbra requires a 2-key stealth meta-address. STRK20 needs one viewing-key registration. Smaller surface, simpler onboarding.
Why STRK20 beats Umbra structurally
| Umbra concept | STRK20 equivalent | Advantage | | --- | --- | --- | | Stealth meta-address (2 public keys) | Registered viewing key | One key, on-chain, simpler | | Per-payment stealth address | Per-channel encrypted notes | No visible on-chain address at all | | Announcement events for scanning | Discovery service | Off-chain scan - no public event trail | | View-tag filtering | Full ECDH decryption | Discovery handles compute; no shortcuts | | Relayer for gas-free withdrawals | Pool-mediated withdrawals | Pool is the caller - no separate relayer | | Anonymity set = stealth users | Anonymity set = all pool participants | Shared pool with transfers and apps, not stealth-only |
What you build
A Starknet wallet (browser + mobile) that:
* →Generates and registers viewing keys on first use.
* →Lets the user publish a privacy-pool receive address that anyone can pay to.
* →Runs the discovery service against the user's viewing key to surface incoming notes.
* →Handles sends as Withdraw / CreateEncNote through the pool with paymaster-sponsored gas.
* →Maintains a clean, "looks like a wallet, behaves like privacy" UI - the discovery, encryption, and proof-construction is all under the hood.
No new contracts. No protocol changes. The work is product, UX, and SDK integration.
Why it ships
Everything cryptographic is already in production: the pool, channels, the discovery service, the SDK. What's missing is the consumer surface - a wallet that makes private receive-and-spend feel as easy as Venmo. Whoever builds it owns the default entry point to STRK20 for normal users.
▸ Building this?
Show us what you’re working on. We’ll support you every step of the way.
Infrastructure
Published May 26, 2026https://strk20.starknet.io/rfp/private-cross-chain-bridge

← All ideas
▸ Idea 22 · Infrastructure
Private cross-chain bridge with unlinkable settlement
A chain-abstracted bridge that moves assets between chains without publicly linking the source wallet to the destination — STRK20 and private sub-accounts as the privacy routing layer between transparent blockchains.
What this enables
* →Move between chains without linking wallet A to wallet B. Ethereum wallet A deposits, the assets route through the Starknet privacy layer and private sub-account settlement, Solana wallet B receives - and the A↔B relationship is not publicly observable on either side. Every existing bridge writes both legs to transparent ledgers, so anyone can join deposit to withdrawal. Here the link is broken by construction.
* →Starknet as the privacy routing layer between transparent chains. Ethereum, Solana, Base, and Arbitrum are all publicly traceable; the moment value crosses between them on a normal bridge, the graph is complete. STRK20 and Private Sub-Accounts sit in the middle as an anonymity set - assets enter from any chain, mix, and exit to any chain with no carried-through link. The bigger the pool, the stronger every crossing.
* →A fresh destination wallet with no history. Withdraw to a brand-new address on the target chain that has no onchain connection to the funding source. Useful for post-CEX-withdrawal privacy, portfolio restructuring, treasury operations, and separating a public identity from a working wallet - without trusting a custodian to forget.
* →Compliance-compatible, not a mixer. Unlike sanctioned mixers, this keeps a disclosure path: Viewing Keys register the crossing, an authorized trace is possible under legal process, and source-of-funds can be proven selectively. Confidentiality from public surveillance - not evasion.
* →One deposit, any chain out. The user picks a source, an amount, and a destination chain; routing, settlement, and privacy are abstracted. No manual bridging, no wrapped-asset juggling, no understanding of Starknet required.
What you build
A Bridge helper contract that orchestrates deposit → shield → route → unshield across chains. Assets enter from Ethereum, Solana, Base, or Arbitrum via Chain Abstraction and land in the Privacy Pool as Encrypted Notes; settlement routes through Private Sub-Accounts so the deposit leg and the withdrawal leg share no observable link. The user signs once on the source chain with their existing wallet; the destination is a fresh address on the target chain with no onchain path back to the funding source. Timeout-and-reclaim covers the failure path. A Viewing-Key registration layer preserves selective disclosure and authorized tracing, so the bridge is compliance-compatible rather than a mixer - the anonymity set grows with every crossing, and each crossing strengthens the ones around it.
Why this isn't Houdini Swap
Houdini Swap has processed $1.5B+ in private cross-chain volume and proves the demand - people will pay to break the link between source and destination. But Houdini routes through intermediary assets and an operator that sees both ends; the privacy is custodial and trust-based. Here the routing layer is a verifiable Cairo contract and a cryptographic anonymity set, not a company that could log, be subpoenaed, or be shut down. Same job - unlinkable cross-chain movement - done without a trusted middle.
Why this isn't Near Intents
Near Intents settles cross-chain intents by having solvers fill a stated outcome, and it's efficient - but the settlement legs are public and the source-to-destination relationship remains observable on the transparent chains it touches. Privacy isn't in the model; it optimizes routing, not unlinkability. This bridge makes non-linkability the primitive: the crossing passes through STRK20 as a privacy layer, so the A↔B relationship never becomes public in the first place.
Why this isn't Jumper
Jumper (LI.FI) is best-in-class transparent bridging - it aggregates routes across dozens of bridges and chains for the cheapest, fastest path, and every hop is fully traceable. It's built to move assets, not to hide the connection between where they came from and where they went. Here chain abstraction serves privacy rather than just price: the point isn't the optimal route, it's that no one can reconstruct the route or link the endpoints.
https://strk20.starknet.io/rfp/private-pumpfun▸ Idea 04 · Markets & Trading
Bonding-curve token launches with hidden buyers, visible price action
A Pump.fun-style launchpad where bonding-curve mechanics, trade sizes, and the social feed stay fully visible - but no observer can attribute any trade to any wallet. Whales buy without triggering copy-trade cascades; devs sell without panic dumps.
What this enables
* →Whale-safe token launches. A 50K USDC buy is visible. The price impact is visible. The buyer is not. No Nansen alert. No "smart money" notification. No copy-trade cascade.
* →Dev-safe token creation. Creators launch without their wallet becoming a permanent surveillance target. Sells show on the curve (price drops); attribution to the dev wallet does not.
* →Anonymous participation across launches. Users participate in dozens of launches without building a trackable on-chain profile. No wallet-level history for analytics to aggregate.
* →Post-graduation privacy continuity. When a token graduates to Ekubo, the existing swap helper keeps trading private. Full lifecycle anonymity - no other chain offers this.
What you build
A BondingCurveFactory deploying per-token curves. Each curve is a privacy_invoke helper handling buy / sell / graduate. Buyers route USDC notes through the pool, the curve computes tokens-out, returns them as an OpenNoteDeposit. At market-cap threshold, anyone calls graduate and liquidity migrates to Ekubo with the curve's final price. The social feed reads public events (amounts, timestamps, price) - just no "who."
What it doesn't solve
Sniping. Bots that monitor for new contract deployments still work - they don't need to know who you are to front-run. Anti-snipe (launch delay, commit-reveal first block, rate limits, graduated fees) is layered on top as optional modules.
The revenue argument
Pump.fun does $25–31M/month in fees even in bear markets. A Starknet version capturing 1% of the memecoin launch market is $250–310K/month. The privacy angle attracts the segment most willing to pay premium fees for anonymity - whales, alpha hunters, sensitive creators.
Hidden vs visible
| Element | Hidden | Visible | | --- | --- | --- | | Buyer / seller identity | Yes - paymaster submits all tx | | | Trade amounts | | Yes - open notes are plaintext | | Price, market cap, supply | | Yes - bonding curve state is public | | Dev token holdings | Yes - encrypted notes in the pool | | | Total volume, trade history | | Yes (aggregate) - but not attributable |
https://strk20.starknet.io/rfp/private-prediction-market← All ideas
▸ Idea 07 · Markets & Trading
Prediction markets with visible odds and invisible bettors
Bet sizes and odds stay fully visible - the information aggregation works. Bettor identities are completely hidden. Markets stay informationally efficient while the identity-based manipulation that plagues Polymarket disappears.
What this enables
* →Informationally efficient markets without identity leakage. Polymarket's accuracy comes from visible bet flow driving accurate odds. The same visibility creates whale tracking, herding, and bettor pressure. Academic research shows anonymous betting produces more accurate forecasts - bandwagoning is replaced with independent information aggregation.
* →Institutional prediction markets. Corporations want internal forecasting markets (project completion, strategic decisions, sales targets) but can't because positions become political. An executive betting against their own division's timeline is a career risk. Anonymous betting unlocks the use case entirely.
* →Political and sensitive markets, less regulatory exposure. France blocked Polymarket. The CFTC has taken enforcement actions. Visible large positions on political outcomes create narratives that influence the outcomes themselves. Anonymous betting separates information aggregation from attribution.
* →Cross-market privacy for professional bettors. Polymarket lets sophisticated observers build wallet-level profiles: hit rate, sector specialization, holding patterns. Professional edge gets copied. STRK20 prevents the profiling.
What you build
A PredictionMarket helper with per-question state (outcomes, resolution source, deadline, per-outcome volume) and privacy_invoke for bet / claim. Bets are open notes to the market contract (amounts public, identity hidden via paymaster). Resolution writes the winning outcome; winners claim payouts as private transfers. Per-market oracle binding (Pragma for prices, designated resolver or DAO vote for non-price outcomes).
Why this works on Starknet specifically
Compliance-first privacy (viewing keys make it auditable), DeFi composability in the pool (open notes + InvokeExternal), production paymaster + session keys. Other privacy chains lack at least one of these - and the lack of any one breaks the institutional use case.
Hidden vs visible
| Element | Hidden | Visible | | --- | --- | --- | | Bettor identity | Yes - paymaster submits all tx | | | Bet amounts | | Yes - open notes, drives accurate odds | | Current odds, per-outcome volume | | Yes - public market state | | Resolution | | Yes - verifiable from oracle / resolver | | Bettor's cross-market profile | Yes - no wallet-level history accumulates | |
