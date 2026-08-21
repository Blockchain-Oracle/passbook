# The STRK20 Private Sprint — the brief

## Who and why

**StarkWare** built STRK20, a privacy layer for existing ERC-20 tokens on Starknet. The event repo is
maintained by the **`starkience`** GitHub account ("Ecosystem at StarkWare"). The **Starknet
Foundation** is a separate body and the RFP footer states StarkWare wrote the RFPs *as a community
member*, committing the Foundation to nothing.

**Why they are running it.** A privacy pool is worthless without other people in it — your transaction
hides among everyone else's. That is why the rules force ≥3 verified mainnet transactions into one
specific pool. They are buying pool activity and proof that ordinary developers can build on the stack.

Sponsor, verbatim:

> "Everything cryptographic is already in production... What's missing is the consumer surface...
> Whoever builds it owns the default entry point to STRK20 for normal users."

> "Be especially precise about what is and isn't private — overclaiming costs you on integration depth."

> "If another team depends on something you published, that counts in your favour."

## Hard facts

| Item | Detail |
|---|---|
| Window | 14 → **31 Aug 2026, 23:59 UTC** |
| Winners announced | 4 Sept 2026 |
| Prize | **$5,000 STRK** — $2,500 / $1,500 / $1,000 |
| Tracks | **None.** Consumer/DeFi/Tooling/Infra/Payments/Gaming/Other are display filters only |
| RFPs | Wish list, not reservations. Nobody owns an RFP; picking one earns nothing by itself |
| Registration | Fork event repo, add `{repo_url, telegram}` to `registry.json`, open a PR. Automated |
| Submission | **No submit button.** The indexer reads your repo at the deadline |

## The elimination gate

Miss any one of these and you are not scored, regardless of quality:

- Public repo with an **open-source licence**
- Root-level **`strk20.json`**
- **≥3 verified Starknet mainnet transactions** touching pool
  `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a` on `SN_MAIN`
- **Live public demo**, working **without login**
- **Demo video ≤ 3 minutes**, publicly reachable
- README explaining the product, why privacy is necessary, how to run it, and mainnet addresses

```json
{
  "transactions": ["0x...", "0x...", "0x..."],
  "contracts": ["0x..."],
  "demo_video": "https://...",
  "demo_url": "https://..."
}
```

## Judging

| Criterion | Weight | What it means |
|---|---:|---|
| STRK20 integration depth | **30%** | The criterion enumerates a ladder: *"shielded balances, private transfers, anonymizer contracts, the SDK, using stealth accounts."* |
| Working mainnet product | **30%** | *"It runs, on mainnet, for a real user."* A judge verifies your transactions independently |
| Innovation | **25%** | *"Something the ecosystem doesn't have yet, or a better take on something it does."* Note: **a better take counts** |
| Documentation / open source | **15%** | Reproducible, licensed, useful to others |

## Claims that must never be made

The sponsor scores against overclaiming. Never say:

- "Fully anonymous" / "untraceable" / "completely hidden DeFi"
- Amount privacy for swaps or any open-note DeFi leg — **amounts and timing are public by design**
- That the deposit is hidden — **depositor address and deposit amount are public**
- That the latest code is fully audited (the OpenZeppelin audit is scoped to commit `c5e2fb5`, May 2026)
- That compliance is handled automatically

Always disclose: the recipient of a private transfer sees the sender; early anonymity sets are small;
the paymaster/relayer may see network metadata.
