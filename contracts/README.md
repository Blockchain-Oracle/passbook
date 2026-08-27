# `strk20_app` contracts

Cairo package for the contracts the privacy pool invokes. Nothing else in this repo is Cairo.

| Contract | What it is |
|---|---|
| `MessageBook` | Append-only ciphertext log for chat. Touches no value. |
| `Markets` | Binary UP/DOWN prediction markets on a constant-product AMM, settled from Pragma. |

`MockERC20`, `MockPool` and `MockPragma` are snforge fixtures. They compile into `target/dev/`
because snforge can only `declare` classes that are in the package's artifacts — they are never
declared on mainnet.

## Toolchain

Two pinned versions, matching `Scarb.toml`:

| Tool | Version | Installs to |
|---|---|---|
| `scarb` | `2.8.2` | `~/.local/bin` |
| `snforge` (starknet-foundry) | `0.31.0` | `~/.foundry/bin` |

**Neither directory is on the default `PATH`.** Export this in every shell before running
anything here:

```bash
export PATH="$HOME/.foundry/bin:$HOME/.local/bin:$PATH"
scarb --version    # scarb 2.8.2 ... cairo: 2.8.2 ... sierra: 1.6.0
snforge --version  # snforge 0.31.0
```

Do not upgrade these to make something build. `starknet = "2.8.2"` and
`snforge_std = "0.31.0"` in `Scarb.toml` are pinned to them deliberately.

## Commands

```bash
scarb build    # -> target/dev/  (this is what gets deployed)
snforge test   # 62 tests
```

`scarb build` emits both artifacts the deploy step needs, per contract:

- `target/dev/strk20_app_<Name>.contract_class.json` — Sierra
- `target/dev/strk20_app_<Name>.compiled_contract_class.json` — CASM

`Markets`'s constructor takes `(pool, pragma)`, both non-zero.

`casm = true` in `Scarb.toml` is required, not cosmetic: declaring a class needs
`compiled_class_hash`, which is derived from the CASM. With `sierra = true` alone, scarb emits
only the Sierra file and there is nothing to declare from.

`target/` and `.snfoundry_cache/` are gitignored. `Scarb.lock` is committed.

## Known failure signatures

### `command not found: scarb` / `command not found: snforge`

You skipped the `PATH` export above.

### `snforge test` fails to build the test plugin

**This does not affect `scarb build` or the deploy artifacts** — `snforge_std` is a
dev-dependency and is not compiled for a normal build. Only the test run is blocked.

`snforge_std 0.31.0` ships its Scarb plugin as a Rust proc-macro (`snforge_scarb_plugin`) that
scarb compiles from source. Its `Cargo.toml` declares `cairo-lang-* = "2.7.0"`, which under
cargo semver means `>=2.7.0, <3.0.0`. Cargo therefore resolves the newest 2.x — currently
**2.20.0** — against plugin source written for the 2.7/2.8 API. You get ~42 errors like:

```
error[E0599]: no method named `trim_matches` found for struct `SmolStrId<'db>` in the current scope
error[E0599]: no method named `numeric_value` found for reference `&...TerminalLiteralNumber<'_>`
error: could not compile `snforge-scarb-plugin` (lib) due to 42 previous errors
[ERROR] Failed to build contracts with Scarb: `scarb` exited with error
```

A second, separate failure appears once that one is fixed, on aarch64 macOS with a modern
rustc:

```
error[E0570]: "stdcall" is not a supported ABI for the current target
error: could not compile `size-of` (lib) due to 5 previous errors
```

**Fix.** Both live in scarb's global cache, not in this repo, so a cache wipe or a fresh machine
will hit them again:

```
~/Library/Caches/com.swmansion.scarb/registry/src/scarbs.xyz-*/snforge_scarb_plugin-0.31.0/
```

1. In that directory's `Cargo.toml`, change the six direct `cairo-lang-*` dependencies
   (`diagnostics`, `filesystem`, `parser`, `sierra`, `syntax`, `utils`) from `version = "2.7.0"`
   to `version = "=2.8.2"`, delete `Cargo.lock`, and run `cargo generate-lockfile`.
   Pinning one crate at a time with `cargo update --precise` does not work — the constraints
   interlock, and batching all nine still drifts back up. Exact-pinning the manifest is what
   holds.
2. Then `cargo update -p starknet-types-core --precise 0.1.7`. From `0.1.8` it pulls
   `size-of 0.1.5`, whose newest release still uses `extern "stdcall"` / `"fastcall"` — hard
   errors (E0570) on `aarch64-apple-darwin` under rustc 1.96. `0.1.7` is the last version with
   no `size-of` dependency at all.

`allow-prebuilt-plugins` is **not** a fix here. Scarb 2.8.2 silently ignores the key; prebuilt
plugin support landed in a later scarb.

## `pool_types.cairo` is transcribed, not written

`OpenNoteDeposit` is copied verbatim — including field order — from the sponsor's source at the
tag deployed to mainnet:

- `https://github.com/starkware-libs/starknet-privacy`
- tag `CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08`, commit `74841caf0466d122117945e28ed983e2864c8fc1`
- `packages/privacy/src/objects.cairo`, lines 102–111

The pool deserializes an invoked contract's return data straight into `Span<OpenNoteDeposit>`
and then asserts the buffer is empty, so field order is load-bearing and a tuple return reverts.
Do not edit this struct from memory or from documentation, and do not regenerate it from `main`
— `main` has ABI drift.
