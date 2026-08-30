# Redeploying Governance

> **DONE — 30 Aug 2026.** Houses is live on mainnet. Kept below as the procedure for the next time,
> with two corrections learned by running it (steps 0 and 2).
>
> | | |
> |---|---|
> | Governance | `0x731207e62d01d80632e9d6e911072bb5a3eeaf86232123d2ab9fc50654babc5` |
> | Class | `0x61bd2b40dd4dbf1fb9620023854e834dbd4e87cc84bc60839fcb4dc76f78c40` (corrected) |
> | Declare tx | `0x494adb6ca08719b8bbb74a7d341c1efd03ce33119248800b3fdb6c2b920d242` (block 14103842) |
> | Deploy tx | `0x40c19af8bd30bdc64a0283c3e0c51eb91f0b7d019964fe940fa6c417ede2ef7` (block 14103862) |
> | Cost | ~65.8 STRK, from `0x10fe91…4b97` |
>
> **`sncast 0.31.0` cannot do this any more.** It speaks RPC spec 0.7.0; `rpc.starknet.lava.build`
> is on 0.8.1 and rejects the declare with `missing field: "l1_data_gas"`. Use **starknet.js
> 10.5.0** (already pinned in this repo) against **`starknet-rpc.publicnode.com`**, which is on
> 0.10.2 — the matching pair. The sncast steps below are left for when the toolchain catches up.
>
> **Watch the fee padding.** starknet.js pads resource bounds 50%/50% by default, which compounds
> to 2.25× and made a 60 STRK declare estimate at 135 STRK — more than the account held. Pass
> `resourceBoundsOverhead` (25%/20% was used here) to get a sane cap. `resourceBoundsOverhead:
> false` prints the raw number.

## Why this was needed

Houses was **read-only on mainnet**, and this was the whole reason why.

| | |
|---|---|
| Deployed Governance | `0xdbe265829e0f1c859f3a8c1bd8fcfb0a774836b9e07191c6a624a59e37f9bf` |
| Class it runs | `0x7240c52656a0a5250649b4db768fbe6ad43e794b11d036ebb19904ff4bb8f20` — `VULNERABLE_GOVERNANCE_CLASS_HASH` |
| Class the app requires | `0x61bd2b40dd4dbf1fb9620023854e834dbd4e87cc84bc60839fcb4dc76f78c40` — `CORRECTED_GOVERNANCE_CLASS_HASH` |

`governanceWriteSafety` (`packages/protocol/src/app-contracts.ts`) fails closed on that mismatch,
so every write is disabled — create, join, fund, propose, ballot, delegate, reclaim, revoke. Reads
are unaffected, which is why the surfaces look alive and every button says "Read-only".

**The corrected contract is already written and already built.** Nothing needs coding. It was never
declared or deployed.

## Before you sign anything

Two consequences, both worth accepting on purpose:

- **The existing House is left behind.** There is exactly one (`house_count` → `1`) at the old
  address. It stays readable there forever, but the app points at one Governance address, so a new
  deployment starts with an empty board.
- **Two mainnet transactions**, paid from your account. Under the submission's pool-event rule they
  will not count toward the score — they make Houses demoable, which is the point.

## 0. An account for sncast

`sncast 0.31.0` and `scarb 2.8.2` are installed and match `Scarb.toml`. There is no accounts file
yet, so add the wallet you want to deploy from:

```sh
sncast account add \
  --name deployer \
  --address <YOUR_ACCOUNT_ADDRESS> \
  --type argent \                 # or: braavos | oz — must match the wallet you are importing
  --private-key <YOUR_PRIVATE_KEY>
```

It writes `~/.starknet_accounts/starknet_open_zeppelin_accounts.json`. Confirm with
`sncast account list`.

## 1. Build, and check the hash before signing

```sh
cd contracts
scarb build
```

Then confirm the artifact is still the class the app expects. **If this prints `false`, stop** —
the source has drifted from `CORRECTED_GOVERNANCE_CLASS_HASH` and declaring it would deploy a class
the app will keep refusing:

```sh
cd ..
node --input-type=module -e "
import { hash } from 'starknet';
import fs from 'node:fs';
const cls = JSON.parse(fs.readFileSync('contracts/target/dev/strk20_app_Governance.contract_class.json','utf8'));
const h = hash.computeContractClassHash(cls);
console.log(h);
console.log('matches:', BigInt(h) === BigInt('0x61bd2b40dd4dbf1fb9620023854e834dbd4e87cc84bc60839fcb4dc76f78c40'));
"
```

## 2. Declare

```sh
cd contracts
sncast --account deployer declare \
  --contract-name Governance \
  --fee-token strk \
  --url https://rpc.starknet.lava.build
```

Keep the `class_hash` and `transaction_hash` it prints. If it answers "class already declared",
that is fine — the class hash is what matters and you can go straight to step 3.

## 3. Deploy

**One constructor argument: the pool.** `governance.cairo`'s constructor asserts it is non-zero,
so a wrong or missing value fails loudly rather than deploying something inert.

```sh
sncast --account deployer deploy \
  --class-hash 0x61bd2b40dd4dbf1fb9620023854e834dbd4e87cc84bc60839fcb4dc76f78c40 \
  --constructor-calldata 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a \
  --fee-token strk \
  --url https://rpc.starknet.lava.build
```

That calldata is `NET.pool` from `packages/protocol/src/constants.ts` — the mainnet privacy pool.

Sanity-check the new address before wiring it in; it should answer `0x0` houses:

```sh
curl -s -X POST https://rpc.starknet.lava.build -H 'content-type: application/json' -d '{
  "jsonrpc":"2.0","id":1,"method":"starknet_call","params":[{
    "contract_address":"<NEW_ADDRESS>",
    "entry_point_selector":"0x114f343c7aa6468376d6821cdaf564ef8472cafe7a706e844d2e0c5821b0836",
    "calldata":[]},"latest"]}'
```

## 4. Record it

`evidence/markets-launch-deployment.json` is the single source both the web build and the relayer
read. Replace the whole `Governance` block:

```json
"Governance": {
  "classHash": "0x61bd2b40dd4dbf1fb9620023854e834dbd4e87cc84bc60839fcb4dc76f78c40",
  "compiledClassHash": "<from the declare output>",
  "declareTx": "<from step 2>",
  "deployTx": "<from step 3>",
  "contractAddress": "<from step 3>",
  "blockNumber": <block the deploy landed in>,
  "deployedAt": "<ISO timestamp>"
}
```

## 5. Ship it

Both consumers read that file — the web app at **build** time, the relayer at **boot** — so neither
picks the change up on its own:

```sh
nvm use 24
pnpm -C apps/web build     # vite.config.ts wires VITE_APP_GOVERNANCE_* from the evidence file
```

Then redeploy the web app and restart the relayer (`packages/relayer/src/allowlist.ts` builds its
allowlist from the same file at boot; until it restarts it will still be allowlisting the old
address).

## 6. Confirm it worked

Open a House page. Every door that said **Read-only** should now be live, and
`governanceWriteSafety` should return `enabled: true`. The first real check is a **join** — after
which "Your handle on this roll" fills in on that House's page, which is also the proof that the
locally derived voter handle matches the one the pool injects.
