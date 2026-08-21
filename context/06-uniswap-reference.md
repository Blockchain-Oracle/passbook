# Uniswap Interface — architecture reference

Source: full clone of `Uniswap/interface@main` (pushed 17 Aug 2026, 12,384 files) plus a live
disconnected capture of `app.uniswap.org` on 21 Aug 2026. Paths below are repo-relative.

Caveat: the public repo is a periodic publish of a private monorepo — real and current, but not the
live commit.

To re-obtain the source (the working clone was in a session scratchpad and is gone):
`git clone --depth 1 https://github.com/Uniswap/interface.git` (~230 MB), or read single files at
`raw.githubusercontent.com/Uniswap/interface/main/<path>`. Every path below is valid against `main`.
Live `app.uniswap.org` cannot be scraped with a plain fetch — it returns an empty SPA shell
(`<title>Uniswap Interface</title>`, no nav, no meta); it needs a JS-rendering fetch with a 7–12s wait.

---

## The headline: Uniswap does let you launch a token

**`/liquidity/launch-auction`** — nav path **Pool → "Launch auction"**. A 4-step wizard:

```ts
enum CreateAuctionStep { ADD_TOKEN_INFO, CONFIGURE_AUCTION, CUSTOMIZE_POOL, REVIEW_LAUNCH }
enum TokenMode { CREATE_NEW = 'create_new', EXISTING = 'existing' }
```

Step 1 collects name, symbol, description, **image upload to IPFS**, X-profile OAuth verification,
network, and total supply — and with `TokenMode.CREATE_NEW` it **deploys a brand-new ERC-20**.
Contracts come from `@uniswap/liquidity-launcher-sdk`. Internal codename "Toucan"; the UI calls them
**Continuous Clearing Auctions** — supply releases over time, one market-clearing price per block,
anti-snipe by construction.

**Abu's instinct is directly validated.** Swap + bridge + pools + *launch your own token* is
literally the shape Uniswap ships.

Two adjacent things not to confuse with it: **`/positions/create`** deploys a *pool* for an existing
pair (with a v4 hook), not a token. **`/launches`** is a read-only third-party launchpad aggregator.

---

## Surface inventory: 5 nav tabs, ~15 surfaces

| Nav | Route | Dropdown |
|---|---|---|
| **Trade** | `/swap` | Swap · Limit · Buy · Sell |
| **Explore** | `/explore` | Tokens · Auctions · Pools · Transactions |
| **Launches** `Beta` | `/launches` | — |
| **Pool** | `/positions` | View positions · Create position · **Launch auction** |
| **Portfolio** | `/portfolio` | Overview · Tokens · Pools · DeFi · NFTs · Activity |

The **entire top nav is one 236-line array** (`NavBar/Tabs/TabsContent.tsx`). NFTs and governance were
removed as products — `/nfts` 404s, `/vote/*` redirects out.

---

## The lesson that matters most: routes are modes, not pages

```ts
// pages/RouteDefinitions.tsx
createRouteDefinition({ path: '/swap',  getElement: () => <SwapPage /> })
createRouteDefinition({ path: '/limit', getElement: () => <SwapPage /> })
createRouteDefinition({ path: '/buy',   getElement: () => <SwapPage /> })
createRouteDefinition({ path: '/sell',  getElement: () => <SwapPage /> })
createRouteDefinition({ path: '/send',  getElement: () => <SwapPage /> })
```

**Five URLs. One component.** Not five similar pages — literally the same React element. Inside,
`UniversalSwapFlow` maps pathname → tab. **Buy and Sell are the same component with an enum flipped**
(`<BuyForm rampDirection={ON_RAMP | OFF_RAMP}>`).

**And there is no `/bridge` route at all.** Pick token A on Ethereum and token B on Base and
`routing === BRIDGE`; a `BridgeTrade` flows through the identical form and review screen. Bridging is
not a tab — it is a *consequence* of the token selector spanning chains.

## The unifying machinery — and how small it is

| Device | File | Lines |
|---|---|---|
| Whole route table (40+ routes) | `pages/RouteDefinitions.tsx` | 459 |
| `UniversalSwapFlow` (5 routes) | `pages/Swap/index.tsx` | 539 |
| Modal registry | `TopLevelModals/modalRegistry.tsx` | 333 |
| Token selector | `TokenSelector/TokenSelector.tsx` | 366 |
| Amount input | `CurrencyInputPanel/CurrencyInputPanel.tsx` | 276 |
| Entire top nav | `NavBar/Tabs/TabsContent.tsx` | 236 |
| Activity renderer switch | `activity/generateActivityItemRenderer.ts` | 124 |
| Confirmation modal (web) | `TransactionModal.web.tsx` | 65 |
| Open any modal from anywhere | `hooks/useModalState.ts` | 46 |
| Embed strip-down rules | `pages/Swap/swapCapabilities.ts` | 27 |

**The load-bearing coherence machinery is ~2,500 lines.** The monorepo is 623k LOC, but the part that
makes it feel like one app is small enough for a solo builder to hold by hand. *This is the single most
useful number in the report.*

### The reuse is literal, not stylistic

- **`CurrencyInputPanel`** (276 lines) is the amount box in web swap, **mobile send**, **LP deposit**,
  and **auction bidding**.
- **`TokenSelectorContent`** is opened from **9 call sites**, parameterized by two enums:
  `TokenSelectorFlow {Swap, Send, Liquidity, Limit}` × `TokenSelectorVariation {BalancesOnly,
  SwapInput, SwapOutput}`. Send shows only tokens you hold; swap-output adds suggested bases.
- **Confirmation is a two-state machine**: `enum TransactionScreen { Form, Review }`. Swap, send,
  limit, LP increase/remove, create position, migrate, auction bid and vault deposit all share it —
  and share one `ProgressIndicator` rendering `TransactionStep[]` across 20+ call sites.
- **One `TransactionType` enum (~40 members)** → one 124-line switch → the activity feed in the wallet
  drawer, portfolio, mobile and extension. `useMergeLocalAndRemoteTransactions` merges optimistic and
  indexed history into one stream.
- **Settings are data**: `TransactionSettingConfig` objects (`renderTitle`, `Control`, `Screen`,
  `InfoModal`, `featureFlag`). Callers assemble `[Slippage, Deadline, RoutingPreference]`; LP passes a
  different array. The gear icon behaves identically everywhere with no flow knowing about another.
- **271 `ModalName` constants** + a registry mapping name → lazy component + `shouldMount(state)`.
  Two primitives (Send, Earn) have **no route at all** — they are registry entries only.

---

## Repo structure, code sharing, and size calibration

```
apps/       web, mobile, extension, cli, dev-portal, mission-control
packages/   uniswap, ui, wallet, utilities, api, chains, gating, embedded-wallet, …
config/     tsconfig, oxlint-plugins, vitest-presets
```

Bun workspaces + Nx. Layering doctrine, stated in `packages/README.md` and `packages/ui/README.md`:
**`ui`** = Tamagui-wrapped primitives, *"should not contain … Uniswap business logic"*; **`uniswap`** =
*"where any cross functional features should be built by default"* — this is where all the unifying
components live; **`utilities`** = depends on nothing.

**How web and mobile share code — three mechanisms, no runtime abstraction layer:**

1. **Tamagui + react-native-web** — one component vocabulary. `AGENTS.md`: *"ALWAYS use `styled` from
   `ui/src`."*
2. **Platform file extensions** — `Component.web.tsx` / `.native.tsx`. Counts: 91 `.web.tsx`,
   95 `.native.tsx`, 83 `.web.ts`, 87 `.native.ts` — **140 of them inside `packages/uniswap` alone**.
   This is how `TransactionModal` is a centered dialog on web and a bottom sheet on native *from one
   import*.
3. **tsconfig path aliases** — `~/*` → app src; `uniswap/src/*`, `ui/src/*`, `utilities/src/*` → packages.

**State management** (doctrine is explicit in `AGENTS.md`: *"Redux for complex global state, Zustand for
simple global/shared state — do not use Jotai, we are migrating away from it"*). Measured file counts:
`react-redux` 311 · `@tanstack/react-query` 274 · `redux-saga` 95 · `zustand` 91 · `@apollo/client` 57 ·
`jotai` 39 (being removed) · `createSlice` 34.

The shared slice set is `packages/uniswap/src/state/uniswapReducer.ts` — **13 slices** (`transactions`,
`portfolio`, `favorites`, `searchHistory`, `userSettings`, `swapSettings`, …) with an explicit
`uniswapPersistedStateList`. Web composes them in `state/webReducer.ts`, mobile in `mobileReducer.ts`.
Zustand is used as **context-scoped stores**, never globals (`SwapFormStoreContextProvider`,
`SwapReviewStoreContextProvider`) — which is *why* the swap widget can be mounted four times on four
surfaces without state collisions.

**Size calibration.** Whole monorepo **623,268 non-test LOC** (875,622 with tests).

| Workspace | LOC | Files |  | Web surface | LOC |
|---|---|---|---|---|---|
| `apps/web` | 235,532 | 2,054 |  | `features/Toucan/` | 38,491 |
| `packages/uniswap` | 153,862 | 1,848 |  | `features/Liquidity/` | 28,383 |
| `apps/mobile` | 67,085 | 654 |  | `pages/Liquidity/` | 17,774 |
| `packages/wallet` | 39,344 | 425 |  | `pages/Portfolio/` | 13,371 |
| `apps/extension` | 32,915 | 321 |  | `pages/Swap/` (all 5 routes) | 10,389 |
| `packages/ui` | 21,439 | 584 |  | `pages/Explore/` | 7,935 |

Shared core: `transactions/swap/` 27,046 · `swap/review/` 6,312 · `activity/` 5,382+4,504 ·
`search/` 4,596 · `TokenSelector/` 4,055 · `settings/` 2,354 · `CurrencyInputPanel/` 1,889 ·
**`accounts/` 860**.

**Read this next to the ~2,500-line spine table above.** A single surface (`pages/Portfolio/`, 13k)
costs 5× the entire coherence layer. Coherence is cheap; surface area is what actually costs.

## One account model, and why it is only 860 lines

`packages/uniswap/src/features/accounts/store/types/README.md` — the repo's one real architecture doc.
Four concepts: **Platform → Wallet → Connection (Connector + Session) → Account**, with three enums:

```ts
AccessPattern { Native, Injected, SDK }
ConnectorStatus { Connected, Connecting, Disconnected }
SigningCapability { None, Interactive, Immediate }
```

This is what lets an injected MetaMask, a Privy passkey embedded wallet, WalletConnect, the browser
extension, and a **Solana** wallet all be the same object to every feature — across 25 chains and two
VMs (EVM + SVM), on web, mobile and extension. **860 LOC, 17 files.**

Directly relevant here: a Starknet privacy app has the same shape of problem — braavos/argent, a
burner, a viewing key, and a shielded note-owner identity are all "accounts" with different signing
capabilities. Model that once, as data, before building any flow on top of it. `SigningCapability
{None, Interactive, Immediate}` is a particularly good primitive to steal: it is what lets the UI decide
whether to show a confirm step without knowing which wallet it is talking to.

---

## The hackathon-relevant trick: the demo IS the app

`/` is a marketing page whose hero contains the **real, working swap widget**:

```tsx
<Swap hideHeader hideFooter syncTabToUrl={false} … />
```

The same component is the app at `/swap`, the hero at `/`, an inline module on every token page, and a
third-party embed at `/embed?view=swap`. The strip-down rules are themselves data
(`swapCapabilities.ts`, 27 lines). A cold visitor can transact before navigating anywhere, and **nobody
maintains a fake demo.**

For a hackathon with a mandatory login-free demo and a 3-minute video, landing page + demo + app being
**one artifact** is a compounding advantage.

Related trick: the token detail page passes `tokenColor` *into* the shared widget, so a reused
component takes on the identity of its host. Let the host inject identity.

---

## Transferable principles

1. **One route table, one array.** Path + SEO title + feature-flag gate + element per entry. ~460 lines
   for 40+ routes. Do it first; the IA becomes readable in one screen.
2. **Before writing a second page, ask if it is the first page with an enum flipped.** For a privacy
   app: shield / unshield / private send / private swap almost certainly share "pick asset → enter
   amount → review → confirm". That is one component with a mode, not four pages.
3. **Build the amount input and the asset selector before anything else.** They are the spine. A user
   who learns to pick an asset once has learned it for the whole app; every new primitive gets a
   familiar front door free.
4. **Make confirmation a two-state machine and share it absolutely.** This matters *more* for a privacy
   app — proof generation, note maturity, relayer submission are exactly the multi-step opacity that
   needs one canonical progress UI. Model steps as data.
5. **One transaction union + one renderer switch = an activity feed that unifies everything.** This is
   where a multi-primitive app becomes legible. Shield, private transfer and private swap in one
   chronological list = one mental model. New primitive = one enum member + one parser + one row.
6. **Settings are config objects, not a screen.** Privacy knobs (anonymity-set size, relayer choice,
   fee mode) become descriptors; each flow declares which it exposes.
7. **One modal registry, one string, one 46-line hook.** Cheapest big win. Free per-modal telemetry too,
   since the name doubles as the analytics ID.
8. **Make the product embeddable, then embed it in your own landing page.**
9. **Actions are atoms.** `ActionTiles/` — Send/Receive/Buy/Copy/More rendered identically in the wallet
   drawer and the portfolio overview. Build verbs once, scatter them.
10. **Have one home for the user's state.** `/portfolio` gives every primitive a shelf with "View all".
    The counterweight to a modal-heavy app.

---

## How Uniswap documents this: they don't

Checked directly — 59 markdown files, ~4,500 lines. **Essentially none of the unifying machinery above
is written down anywhere in the repo.** Nothing states that `/swap`, `/limit`, `/buy`, `/sell` and
`/send` are one component. Nothing describes `TransactionScreen {Form, Review}` as a cross-cutting
contract. Nothing says the token selector is parameterized by Flow × Variation with nine callers, or
that bridging is not a separate product. All of that was derived from the route table and the import
graph, not from prose.

`packages/uniswap/src/state/README.md`, in full:

```
# Uniswap State
TODO consolidate state README's
```

`apps/web/README.md` links to a `CLAUDE.md` that **does not exist** in the public repo. The
architecture docs live in the private monorepo and get stripped at publish.

What *is* documented: conventions (`AGENTS.md`, 197 lines — Redux vs Zustand, the `.web`/`.native`
split, "keep components under 250 lines"), the package layering rule, and exactly one proper
architecture doc — the accounts store README with its Platform → Wallet → Connection → Account diagram.

**Where the knowledge actually lives: inline comments pinned at the decision point.**

> `swapCapabilities.ts` — *"Single source of truth for what the swap surface exposes per embed view,
> so the strip points … can't drift."*

> `supportedChains.ts` — *"The SDK is the single source of truth — enabling a chain here is a
> `@uniswap/liquidity-launcher-sdk` version bump, not a code change."*

> `pages/Swap/index.tsx` — *"Same shared SwapPage for every surface… so the swap-only surface can strip
> itself instead of forking into a separate component tree."*

**The practice to steal:** encode coherence in *code and lint* — one route array, one modal registry,
settings as data, a component-size cap, a route snapshot test — and pin the *why* in a comment at the
constraint. Architecture docs rot; a `swapCapabilities.ts` the compiler forces you through does not.

**Important distinction for this project:** that lesson is about *architecture* docs. It does not apply
to `context/` — decisions, vision and verified facts must stay written down, because those are the
things that get lost between sessions and cannot be re-derived from the code.

## Honest caveats

- **Uniswap is not perfectly unified.** Two currency-input lineages coexist; TokenSelector v1 and v2
  both ship behind a flag; LP flows use their own `Input|Review` enum instead of `TransactionScreen`.
  **Cohesion is maintained, not achieved.**
- `/migrate/v3` 404s because it is param-only — param-only routes need a landing state.
- The sitemap still lists `/nfts` years after removal. Dead surfaces leave residue.
- They enforce this with tooling a solo builder cannot run (route snapshot tests, a 250-line component
  lint cap, knip/syncpack/manypkg in CI) — which is exactly why the **~2,500-line spine** matters. It
  is small enough to keep coherent by hand.
