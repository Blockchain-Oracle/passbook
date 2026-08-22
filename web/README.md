# `web/` — MessageBook console

A static page that connects a Starknet wallet and appends messages to our `MessageBook`
contract on mainnet, routed through the STRK20 privacy pool by the wallet.

It exists because `scripts/bank-gate-transactions.ts` can build and validate a
`MessageBook` action list but cannot submit one — submitting means running the pool's
client (prover, fee approval, the replay-protection companion action), and the wallet
already does all of that. On this route the whole submission is one
`wallet_strk20InvokeTransaction` call carrying a single `invoke` action.

## Running it

There is no build step. Serve the **repository root** — not `web/` — because the page
loads `starknet.js` from the repository's own pinned `node_modules`, so it cannot drift
from the version everything else is tested against.

```sh
npm install
python3 -m http.server 8080
# then open http://localhost:8080/web/
```

Serving `web/` on its own fails with an explicit message telling you this.

## What it checks before it will spend anything

The pool's `compile_actions` was verified against the deployed mainnet contract to accept
an empty payload, a wrong length prefix **and** an unknown mode without complaint,
because it only lays out the action list and never executes the invoke. All three reach
`apply_actions`, revert there, and cost the full fee. So the page refuses to call the
wallet unless, re-derived from the exact calldata array about to be sent:

- the payload is not empty (`EMPTY_PAYLOAD`),
- the mode is 1 or 2 (`UNKNOWN_MODE`),
- `MODE_SEAL` carries exactly one felt (`SEAL_NEEDS_ONE_FELT`),
- the length prefix equals the number of payload felts that follow it.

On top of that it refuses to submit unless the wallet is on `SN_MAIN`, the pool is not
paused, and the exact calldata in front of you has been dry-run through
`strk20PrepareInvoke(actions, true)` first. Every one of those is re-checked at the moment
the submit button is clicked, not just when it was enabled — the wallet can switch network
in between.

`message_count(tag)` and `seal_root(tag)` are read live from the contract before and after,
so the counter moving is the proof the transaction really routed through our contract.

## Files

| file                  | what it is                                                        |
| --------------------- | ----------------------------------------------------------------- |
| `index.html`          | markup and styles, no logic                                        |
| `app.js`              | wallet discovery, live reads, validation gates, dry run, submit    |
| `message-book.js`     | the call rules, ported from `packages/protocol/src/message-book.ts` |
| `message-book.test.js`| pins that port against the TypeScript module it was ported from    |

`npm test` runs the port-agreement test along with everything else.

## What this page does not do

Message bodies are sent as plaintext and emitted in a public Starknet event: anyone can
read them, permanently. Nothing here encrypts anything. There is no relayer in this path,
so the account that submits is the visible on-chain sender. The honest sentence about what
the protocol does provide is the one on the page: the pool sees your transaction, not your
notes.
