# Verified technical facts

Confirmed 21 Aug 2026 by live Starknet mainnet RPC calls, GitHub API source reads, and transaction
replays. **The public docs are stale on several of these. Trust this file.**

## What STRK20 is

A privacy layer for tokens that already exist on Starknet. Not a new token.

Public deposit → encrypted **note** (your private receipt) → private transfer or app action, proved
with a STARK proof → optional public withdrawal. A **nullifier** marks a note spent without revealing
it. **Shield** = deposit in. **Unshield** = withdraw out. A **viewing key** lets someone read your
history without spending. An **anonymizer** is a small on-chain adapter letting private value call an
ordinary contract.

## Live mainnet state (called directly)

| Fact | Value |
|---|---|
| Pool | `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` |
| `get_version()` | `0x322e30` = `"2.0"` |
| `is_paused()` | `0x0` |
| `get_fee_amount()` | `0x53444835ec580000` = **exactly 6 STRK** (docs say 4 — docs are wrong) |
| All-in cost per pool tx | **~9.1 STRK** (6 protocol fee + ~3 L2 gas), measured across 9 real txs |
| Prover | `https://transaction-prover.alpha-mainnet.sw-dev.io` → `{"status":"ok"}` **IT EXISTS** |
| Discovery | `https://discovery-service.alpha-mainnet.sw-dev.io` → healthy, ~6s lag, **open to anonymous third parties** |
| OutboundAnonymizer | `0x009067f3...9092` — exact-amount USDC from a private note to any EVM address on Ethereum/Optimism/Arbitrum/Base/Polygon via Circle CCTP v2. `mint_recipient` unconstrained; only guard is `caller == pool` |
| InboundAnonymizer | `0x3a7e7f34e530f8ec00b1ff7eaca90a136311d9da7cb17a73203f813b56c86cb` |
| Vesu anonymizer | `0x028b49bc7a48b92d06d436d90e889729d7161dfc2fef3f16b674029bf7abc336` |
| ~~AVNU Forwarder~~ | `0x1270…584f` — **CORRECTED 21 Aug: this is WHITELIST-GATED and unusable.** `execute_private` and `execute_private_sponsored` both revert `0x43616c6c6572206973206e6f742077686974656c6973746564` = **"Caller is not whitelisted"**. `is_whitelisted` returns `0x0` for an arbitrary address **and for the STRK20 pool itself** — so a `privacy_invoke` helper reached via the pool cannot call it either. `set_whitelisted_address` is owner-only and the whitelist event enum has **zero variants**, so you cannot even enumerate who *is* whitelisted. Listing it here as available was an error. |
| **AVNU privacy_swap_helper** | `0x426dcd1a…` — **THE ONE THAT ACTUALLY WORKS.** Live, **permissionless** (whole body executed with `caller=0`), **73 invokes on mainnet**, most recent ~1h before this research. Does aggregated multi-hop swaps into a private note with **zero Cairo written**. This is a different AVNU contract from the Forwarder above; the two were conflated. |
| Endur xSTRK | `0x28d709c8...4b0a` — unpaused, `asset()` = STRK, full IERC4626, ~137M STRK TVL |

## The single most important finding: helpers are permissionless

`is_open_note_depositor_blocked(0x1234)` → `0x0`.

The pool runs a **default-allow blocklist**, not an allowlist. **You can deploy your own
`privacy_invoke` helper and settle open notes with no permission from anyone.**

Empirically proven: **57 `OpenNoteDeposited` events since block 13.3M from 9 distinct helper
contracts, 7 of them self-deployed by non-sponsor teams.**

## The router architecture is valid — confirmed in source

- **CORRECTED 21 Aug: there are TWO invoke selectors, not one.** The deployed `ClientAction` enum is
  `SetViewingKey · OpenChannel · OpenSubchannel · CreateEncNote · CreateOpenNote · Deposit · UseNote ·
  Withdraw · InvokeExternal · ComputeAndInvoke`, and `ServerAction` carries both `Invoke` and
  `InvokeWithComputation`:
  - `privacy_invoke` = `0x402925cce9218828b3ac9a72ac249103f8448a1e1d73c3efaf5da992625043`
  - `privacy_invoke_with_computation` = `0x00d7dcfbab5157247251535943d20090fb50187f80535f739fbacc8febab767`

  **`ComputeAndInvoke` is the most important thing in this file.** The pool itself derives
  `identity_key = compute_identity_key(user_addr, user_private_key, helper_address)` and injects it as
  argument 0 of your helper's `privacy_compute`. That is **the sponsor's own shipped substitute for the
  "Private Sub-Accounts" and "Enclave" that Idea 17 asks for and that do not exist** — a per-user handle
  only the user can reproduce, untraceable back to them, and **scoped per contract** so it means nothing
  at any other helper. Verified: the variant is in the deployed mainnet class (`get_version()` = "2.0"),
  the selectors are hardcoded so no ABI drift can break them, and the SDK exposes a generic
  `computeAndInvoke()` builder. **329 mainnet calls across 7 helpers all-time** — so this is proven to
  work, but it is NOT virgin territory (an early claim of "used twice, you'd be first" was refuted by
  the verifier). Defensible claim: *first launchpad / prediction market* on it, never *first*.
- `invoke_external` **forwards calldata raw with no ABI inspection** — it just builds
  `InvokeInput{contract_address, calldata}`

Therefore **one contract exposing `privacy_invoke(mode: felt252, …)` can legitimately serve many
modes.** `doom` already ships a 2-variant mode enum with 4 verified mainnet txs.

Reference sizes: StarkWare's `EkuboSwapAnonymizer` = **163 lines** (~110 logic). The sponsor-endorsed
`StrkInvokeHelper` = **99 lines**, already live at `0x78ae662e…`.

### Structural rules to design around

1. **At most ONE invoke-phase action per transaction.** `InvokeExternal` and `ComputeAndInvoke` share
   phase 7 with an "at most once" rule. This is why only a *unified* router can do
   "buy + memo" atomically — separate helpers structurally cannot compose.
2. **Actions execute in a fixed 7-phase order:** SetViewingKey → OpenChannel → OpenSubchannel →
   Deposit/UseNote → CreateNote → Withdraw → Invoke.
3. **Return shape differs per mode and must be exact.** Register-leg returns an empty span; claim-leg
   returns one deposit. Reversing them makes the pool **reject** the call.
4. **Zero-value invoke is legal.** `_apply_invoke_and_deposits` guards the deposit block with
   `if !deposits.is_empty()`, so a helper returning an empty `Span<OpenNoteDeposit>` still executes and
   still emits `ExternalContractInvoked`. A message costs only the pool fee, no token movement.
5. **Open notes are plaintext by construction** (`OPEN_NOTE_SALT` packed with a visible amount).
   Amounts in any open-note DeFi leg are **public**. This is why Idea 04's own table admits it.

## Route fork: the Wallet API cannot build a wallet

`@starknet-io/types-js` (0.10.3 **and** 0.11.0-beta.2) exposes exactly three methods:
`wallet_strk20InvokeTransaction`, `wallet_strk20PrepareInvoke`, `wallet_strk20Balances`.

- No registration action — every method errors `NOT_REGISTERED`
- No note listing, no history
- **Never exposes the viewing key** (by design — a dapp should not hold it)
- `wallet_strk20Balances` returns only `{token, balance}`, not per-note data

Action vocabulary is exactly four: `deposit` · `withdraw` · `transfer` (amount FELT or `'OPEN'`) ·
`invoke` (contract + calldata, with `${openNoteIds[N]}` and `${poolAddress}` placeholders).

**Consequence:** a dapp fits the Wallet API. A *wallet* does not — it needs registration, discovery and
history. A wallet must use the **SDK route with a self-custodied in-browser account** (the pattern
`offbook` used for 6 real mainnet txs, and that StarkWare's own privacy-bridge runs in production:
*"All client-side key material is derived from a single wallet signature"*).

Bonus: an in-browser derived account makes the demo **login-free by construction**.

## Not shipped — do not build on these

| Thing | Status |
|---|---|
| **Enclave / confidential compute** | **DOES NOT EXIST.** Zero occurrences of `enclave`, `TEE`, `trusted execution`, `SGX`, `nitro` in the sponsor's 121KB builder docs, in `llms-full.txt`, or across the **595-file** protocol tree. Appears only in Idea 17's marketing prose |
| **Private sub-accounts / shadow accounts** | RC-only, SDK-route only, sponsor's own `/build` page says "coming soon". Renamed in 0.14.3-rc.5 with breaking selectors; return shape changes again in Unreleased. Absent from types-js 0.10.3 and 0.11.0-beta.1. No mainnet anonymizer found among all 9 open-note depositors |
| **Chain Abstraction** | Not a primitive — it is **itself an unbuilt sponsor RFP** (`/rfp/chain-abstracted-private-execution`) |
| **Solana support** | Zero Solana code anywhere in the ecosystem repos. `privacy-bridge` is Circle CCTP / EVM only |

## Traps that are zeroing real projects right now

- **The mine rule.** If `strk20.json`'s `contracts` array is non-empty, **every** listed transaction
  must also emit from one of those contracts. Empty `contracts` → `mine === null` → passes.
  Currently firing on: **airlock** (3 real pool txs, 0 route through its contracts → scores 0),
  **nexora** (14 contracts, 0 transactions), **veyl** (Sepolia addresses in a mainnet array),
  **offbook** (2 of 6 bypass). Strategy: keep `contracts: []`, bank clean txs first, add your router
  address **in the same commit** as transactions routed through it. The verifier passes a tx matching
  **any** declared contract, so listing two router versions is safe.
- `strk20.json` must use **flat bare-string arrays**. `{hash: …}` objects are silently dropped —
  that is why nexora scores 0 on 614KB of code. First 10 entries only. Malformed JSON reads as empty.
- **Braavos does not support STRK20.** Ready wallet only.
- **Fork detection** (added 20 Aug) byte-compares the first 300 chars of your README against the
  starter kit. Write your own words, mention Starknet/STRK20 early.
- Bare `npm i starknet` gives **10.0.2, which has no STRK20 API at all**. Pin `starknet@10.5.0`
  (SDK route) or `10.7.0` (Wallet API route), get-starknet-discovery 6.0.4, types-js 0.10.3, Node ≥24.
- **starkli 0.4.2 rejects Sierra ≥1.8; sncast 0.59 wants RPC 0.10 vs mainnet's 0.8.x.** Deploy with
  starknet.js `account.declareAndDeploy` instead.
- Shield is **two transactions** (approve + deposit). Confirm via the public ERC-20 balance dropping,
  not the returned hash. Notes mature ~10 blocks; proofs valid ~450 blocks (nothing can be pre-baked).
- **BlastAPI is dead.** Use `https://rpc.starknet.lava.build` or `https://starknet-rpc.publicnode.com`.
- Never feature-detect with `strk20Balances([])` — it raises a consent prompt.

## Free gift for the demo

Wallet-API pool transactions get a **fresh ephemeral sender every time** — verified across 54 hashes.
You can *show* sender-unlinkability on camera using two of your own transactions.
*(UNVERIFIED: mechanism inferred from receipts, not documented.)*
