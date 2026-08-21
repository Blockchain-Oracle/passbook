# Ideas

Everything on this page is in scope for the sprint. So is anything that isn't on it - build one of these, build a variation, or build something nobody here has thought of.

Ideas are not exclusive. Several teams can build the same one.

> [!IMPORTANT]
> Some of these depend on infrastructure that is **not shipped yet**, marked with a warning below. Sub-accounts and confidential compute are in progress, not available today. If one of those is central to your idea, ask in the group before you start so you know exactly what exists. A team that discovers the dependency in week two has lost the sprint.

## Contents

- [Request for Startups](#request-for-startups) - 12 problems with full write-ups
- [Trading and markets](#trading-and-markets)
- [Payments](#payments)
- [Wealth and asset management](#wealth-and-asset-management)
- [Capital formation](#capital-formation)
- [Infrastructure](#infrastructure)
- [Governance and treasury](#governance-and-treasury)

---

## Request for Startups

The [STRK20 Request for Startups](https://strk20.starknet.io/rfp) is the deepest starting point on this page: twelve problems, each with a full write-up covering what you build, why it ships, and a hidden-versus-visible breakdown of exactly what the pool does and does not conceal.

| | Idea | Category |
|---|---|---|
| RFP-01 | [Encrypted on-chain messaging](https://strk20.starknet.io/rfp/private-messaging) | Social |
| RFP-02 | [Anonymous whistleblower platform with proof-of-authorship](https://strk20.starknet.io/rfp/anonymous-whistleblower) | Social |
| RFP-03 | [Provably fair poker where cheating is mathematically impossible](https://strk20.starknet.io/rfp/private-poker) | Gaming |
| RFP-04 | [On-chain Among Us with provably fair roles and anonymous votes](https://strk20.starknet.io/rfp/social-deduction-game) | Gaming |
| RFP-05 | [Trustless atomic OTC settlement for block trades](https://strk20.starknet.io/rfp/private-otc-settlement) | Markets |
| RFP-06 | [Bonding-curve launches with hidden buyers, visible price action](https://strk20.starknet.io/rfp/private-pumpfun) | Markets |
| RFP-07 | [Prediction markets with visible odds and invisible bettors](https://strk20.starknet.io/rfp/private-prediction-market) | Markets |
| RFP-08 | [Sealed-bid auctions where the bids are actually sealed](https://strk20.starknet.io/rfp/sealed-bid-auctions) | Markets |
| RFP-09 | [One-click privacy from any chain](https://strk20.starknet.io/rfp/cross-chain-privacy-hub) | Infrastructure |
| RFP-10 | [An Umbra-style privacy wallet for Starknet](https://strk20.starknet.io/rfp/privacy-wallet) | Infrastructure |
| RFP-11 | [Private payroll and treasury disbursement at company scale](https://strk20.starknet.io/rfp/private-payroll) | Payments |
| RFP-12 | [Private subscriptions and creator monetization](https://strk20.starknet.io/rfp/private-subscriptions) | Payments |

Everything below is a shorter prompt. If one of them grabs you, the RFP write-ups are still the best model for how to think about what stays hidden and what does not.

---

## Trading and markets

**IDEA-01 · Private spot execution across chains**
One interface, private capital in the pool, execution routed across Starknet, Solana and EVM liquidity. The user picks an outcome; routing, chain selection and settlement stay abstracted.

**IDEA-02 · Private perpetuals aggregation**
Aggregate perps venues behind a single private account. Aggregation already exists in the market; doing it without exposing the trader's identity does not.

**IDEA-03 · Private prediction-market execution**
Route into existing prediction markets without linking the main wallet to the account placing the bets. Visible odds, invisible bettors, on venues that already have liquidity.

**IDEA-04 · Hidden and conditional orders** *(not shipped yet: confidential compute)*
Trading instructions that stay private until their trigger fires: hidden limit orders, stop-loss, take-profit, DCA schedules, conditional payments, rebalancing. CEX-grade order types, on-chain, without broadcasting intent.

**IDEA-05 · Private accumulation and exit** *(not shipped yet: sub-accounts)*
Build or unwind a large position across several unlinkable execution identities and venues, so the aggregate position and the strategy never become public.

**IDEA-06 · Private intent network** *(not shipped yet: confidential compute)*
The user states an outcome: "convert 1M USDC into ETH over 7 days, max 0.5% slippage", or "move my stables weekly to the safest opportunity above 7%". Solvers compete privately across DEXs, bridges, lending and perps.

**IDEA-07 · Confidential RFQ for block trades**
A venue where large trades get quotes without revealing identity, size or direction. Market makers compete privately, the best quote wins, settlement runs through the pool. The trades that cannot happen on a transparent orderbook are precisely the ones worth the most.

**IDEA-08 · Professional trading terminal**
Spot, perps, portfolio analytics, market data and advanced order types in one interface, built for people who trade all day rather than occasionally.

## Payments

**IDEA-09 · Payments by identifier, not address**
Send stablecoins to a phone number, an email, a payment link or a QR code. Neither side should need to understand wallets, chains, gas or bridges. Escrow the funds until the recipient onboards, and refund if they never do.

**IDEA-10 · Business payouts API**
The same rail exposed to companies paying people globally without collecting wallet addresses or exposing recipient balances: creator payouts, marketplace sellers, freelancers, payroll, rewards, grants.

**IDEA-11 · Merchant checkout and invoicing**
Static and dynamic QR codes, invoices sent to a phone number, expiring payment requests, and a merchant dashboard. A private merchant layer rather than another P2P transfer tool.

**IDEA-12 · Marketplace escrow**
Buyer pays into private escrow, seller delivers, buyer confirms, seller receives a private note, an arbitrator resolves disputes. Fits P2P commerce, freelance work, ticket sales, digital goods and OTC.

**IDEA-13 · Private account and card**
Hold stablecoins and crypto, convert, earn, and spend through a card connected to private balances, without exposing the primary wallet, total balances, or history. Public and private modes chosen per activity rather than once for everything.

## Wealth and asset management

**IDEA-14 · Private market-maker vaults**
Depositors get exposure to a professional strategy while the manager's positions, venues and execution logic stay confidential, and NAV, PnL, performance and solvency remain publicly provable. The vault model is proven elsewhere; multi-venue and private is not.

**IDEA-15 · Private index and copy-trading vaults**
Private crypto ETFs, index strategies, thematic baskets. Composition and execution confidential, performance verifiable. Copy a trader without either of you publishing every position.

**IDEA-16 · Private yield account**
Hold shielded assets, lend, stake and allocate across DeFi without exposing total holdings or linking positions back to one identity. Deposit from any chain, withdraw to a fresh wallet.

## Capital formation

**IDEA-17 · Confidential token launch platform**
Private bonding curves, confidential participation, dark liquidity, private balances, participation from EVM and Solana wallets. Token distribution is the most attention-dense moment in a project's life, and currently the most exposed.

**IDEA-18 · Multi-wallet launch participation** *(not shipped yet: sub-accounts)*
Participate through one interface while activity distributes across unlinkable accounts, instead of manually juggling wallets.

## Infrastructure

**IDEA-19 · Private cross-chain bridge**
Move value between chains without publicly linking the source wallet to the destination wallet. The pool sits in the middle as the privacy layer between two transparent chains.

**IDEA-20 · Private account and portfolio layer** *(not shipped yet: sub-accounts)*
One account fanning out into unlimited unlinkable execution identities, one per app, venue or strategy, with a single interface aggregating balance, allocation, PnL and risk across all of them. Externally unlinkable, internally one portfolio.

**IDEA-21 · Selective disclosure tooling**
Let a user prove one specific fact without revealing everything else: "this payment came from me", "my balance exceeds X", "none of my funds touched this address". The interesting version returns only the answer asked for, not the user's whole position.

**IDEA-22 · Compliance infrastructure for privacy apps**
Deposit and sanctions screening, viewing keys, authorised tracing, proof of source of funds, configurable policy, reporting. Shared infrastructure any privacy app can adopt rather than rebuild.

**IDEA-23 · Open note indexer**
Note discovery today means scanning. A public, self-hostable indexer wallets can query without handing over a viewing key.

**IDEA-24 · Local development environment**
One command that gives a developer a pool, an indexer, a prover and funded test accounts. Whatever the starter kit does not cover yet.

**IDEA-25 · Transaction privacy simulator**
Show a user what a transaction will reveal *before* they sign it: anonymity-set size, timing correlation, amount leakage. Most privacy mistakes are made by people who believed they were private.

**IDEA-26 · Drop-in component kit**
Shield, unshield, private transfer and balance components any Starknet app can install. If other sprint projects end up depending on yours, that counts in your favour.

## Governance and treasury

**IDEA-27 · Private governance and delegation**
Confidential DAO votes with verifiable results, either secret until close or permanently private with only aggregates revealed. Plus private delegation, so a large holder can delegate without publicly signalling to whom. Reduces whale signalling and bandwagon voting.

**IDEA-28 · Private treasury operations**
Swaps, yield, grants, payroll, OTC and LP positions from one treasury with configurable permissions: a manager can deploy a capped amount into whitelisted protocols, a trader can trade but not withdraw, members can verify solvency without seeing every transaction.

---

**Add your own.** Open a pull request against this file, take the next free ID, and keep the existing format.
