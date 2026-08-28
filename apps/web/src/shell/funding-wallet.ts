//
// Connecting an external Starknet wallet — Ready, and anything else the standard discovers.
//
// ── IT IS A FUNDING SOURCE AND NEVER AN IDENTITY, WHICH IS THE WHOLE DESIGN ───────────────
//
// `wallet-capability.ts` wrote this rule down long before there was any code to enforce it, and
// it is the line that keeps this feature from contradicting the product. Passbook's account is
// derived in this browser on first load (AD-4/AD-7) — that is what makes it login-free, and it is
// what the account chip shows. A connected wallet NEVER becomes that chip. It is a place money
// comes FROM, and the only thing it is asked to do is sign a public ERC-20 transfer into the
// Passbook address.
//
// The failure this rule prevents is subtle and would be hard to walk back: an app that adopts a
// connected address as its identity has quietly re-introduced the wallet-connect flow the whole
// product was built to avoid, and every account created before the connection becomes orphaned
// the moment somebody disconnects.
//
// ── AND IT IS ENTIRELY LAZY ───────────────────────────────────────────────────────────────
//
// `starknet` and the wallet-standard packages are all behind `import()`. `scripts/build-web.mjs`
// enforces this by scanning for SDK markers in the eager chunk, and it is right to: a visitor who
// never presses Connect must not pay for a wallet-standard implementation on first paint.
//
// ── DISCOVERY IS `@wallet-standard/app`, NOT `@starknet-io/get-starknet-discovery` ────────
//
// The official route doc names the get-starknet discovery package, and it was the first thing
// tried here. `build:web` refused the build over what it drags in: that package depends on
// `@starknet-io/get-starknet-virtual-wallet`, which pulls `@module-federation/runtime`, which
// contains a DIRECT `eval('require')`. A module-federation runtime with an eval in it has no
// business in a wallet's bundle, and the gate's own message says not to widen the allowlist to
// make a warning go away — so the dependency went instead of the rule.
//
// What replaced it is the thing get-starknet's discovery is itself a wrapper around: the Wallet
// Standard's own `getWallets()`, which is the `window` event protocol every Starknet wallet
// already implements to be discoverable at all. Two small packages, no eval, no federation
// runtime, and `isStarknetWallet` — the starknet-io type guard — is what narrows the standard's
// wallet list to the ones this app can use.
//
// WHAT IS GIVEN UP: the virtual-wallet adapters, which wrap EIP-1193 (MetaMask-style) providers
// as Starknet wallets. Nothing in this product needs one — the funding rail wants a Starknet
// wallet signing a Starknet transfer.
//
// ── WHAT THE CAPABILITY CHECK IS AND IS NOT FOR ───────────────────────────────────────────
//
// The official route doc (`reference/agent-skills/.../wallet-api-route.md`) is explicit on two
// points that are easy to get backwards:
//
//   1. DETECT WITH A VERSION QUERY, NEVER A DATA CALL. `supportedWalletApi` reads no user data.
//      Probing `strk20Balances([])` to feature-detect makes wallets raise a consent prompt for
//      balance access the app does not need — which is exactly the wrong first impression, and a
//      least-privilege violation. `wallet-capability.ts` shipped a probe fallback as a
//      last resort; this module does not call it, and the reason is written at `readCapability`.
//
//   2. It does not gate anything here. STRK20 capability decides whether a wallet can perform
//      PRIVATE operations, and we never ask it to — the pool work is done by this browser's own
//      key through our own relayer. Any Starknet wallet can send us a public transfer. So the
//      capability is reported as information, not used as a filter, and an "unsupported" wallet
//      funds an account exactly as well as a supported one.
//
import { useSyncExternalStore } from 'react'

import { MIN_WALLET_API, assessByVersion, type WalletSupport } from '@strk20/protocol/wallet-capability'

/** One wallet the standard found. `id` is stable enough to key a list and to reconnect by. */
export interface DiscoveredWallet {
  id: string
  name: string
  /** A `data:` URI from the wallet itself. Rendered as an icon; never fetched from a host. */
  icon: string
}

export interface ConnectedWallet {
  id: string
  name: string
  icon: string
  /** The wallet's account address. NOT this app's account — see the header. */
  address: string
  chainId: string
  /**
   * Whether this wallet advertises the STRK20 Wallet API.
   *
   * Informational. Nothing here refuses an `unsupported` wallet, because funding needs no privacy
   * features — see the header. It is surfaced so a user who came expecting private actions FROM
   * their wallet learns that this one cannot do them, rather than wondering.
   */
  support: WalletSupport
  /** The advertised version, for the honest sentence. `null` when the wallet advertises none. */
  walletApi: string | null
}

export type ConnectOutcome = { ok: true; wallet: ConnectedWallet } | { ok: false; because: string }

//
// ── ONE CONNECTION PER TAB, AS A STORE ────────────────────────────────────────────────────
//
// `session.ts`'s pattern and its reasoning: the connect button lives in a dialog that is not an
// ancestor of the surfaces that care, so context would answer the wrong question.
//
// NOT PERSISTED, deliberately. A remembered connection would have this app silently re-attach to
// somebody's wallet on every visit — and unlike the session key, this one belongs to software the
// user controls separately. Reconnecting is one press, and `standardConnect`'s own silent path is
// the wallet's decision to offer rather than ours to assume.
//
let connected: ConnectedWallet | null = null
const listeners = new Set<() => void>()

function publish(next: ConnectedWallet | null): void {
  connected = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** The connected funding wallet, or `null`. */
export function useFundingWallet(): ConnectedWallet | null {
  return useSyncExternalStore(
    subscribe,
    () => connected,
    () => connected,
  )
}

//
// The live `WalletAccountV6`, held beside the published summary.
//
// It is NOT in `ConnectedWallet` because that object is rendered — it goes into React state, gets
// spread into props, and would end up in a devtools tree as a live signer with an open channel to
// somebody's extension. The summary is data; this is the capability.
//
// `import type` so naming the class costs no bytes: the annotation is erased, and the value only
// ever arrives through the dynamic import below.
//
let account: import('starknet').WalletAccountV6 | null = null

/** Everything the SDK side needs, loaded once and only when somebody presses Connect. */
async function loadWalletTier() {
  const [app, features, sdk, constants] = await Promise.all([
    import('@wallet-standard/app'),
    import('@starknet-io/get-starknet-wallet-standard/features'),
    import('starknet'),
    import('@strk20/protocol/constants'),
  ])
  return { app, features, sdk, net: constants.NET, network: constants.ACTIVE_NETWORK }
}

/**
 * Every registered wallet that is a STARKNET wallet.
 *
 * `getWallets().get()` returns everything on the standard — a browser can hold Solana and Sui
 * wallets on the same bus — so `isStarknetWallet` is not a nicety. Without it the picker would
 * offer a Solana wallet, `WalletAccountV6.connect` would fail on the missing feature, and the
 * user would read a type error as our bug.
 */
async function starknetWallets() {
  const { app, features } = await loadWalletTier()
  return app
    .getWallets()
    .get()
    .filter((wallet) => features.isStarknetWallet(wallet))
}

/**
 * Every wallet the standard can see right now.
 *
 * ── IT RETURNS AN EMPTY LIST RATHER THAN THROWING WHEN THERE ARE NONE ─────────────────────
 *
 * No wallet installed is the COMMON case for this product, not an error: Passbook works without
 * one, which is the entire point of the embedded key. The surface renders "no wallet found" with
 * a link to install one, and never an error state.
 */
export async function listWallets(): Promise<DiscoveredWallet[]> {
  try {
    const found = await starknetWallets()
    return found.map((wallet) => ({ id: wallet.name, name: wallet.name, icon: wallet.icon }))
  } catch {
    // A discovery chunk that will not load is indistinguishable, from here, from a browser with
    // no wallets. Both mean "there is nothing to offer", and neither is worth an error dialog.
    return []
  }
}

/**
 * Reads a wallet's advertised Wallet API version.
 *
 * NEVER PROBES. `wallet-capability.ts` exposes `assessByProbe` for the case where no version is
 * advertised, and this function deliberately does not reach for it: the probe is
 * `wallet_strk20Balances`, which is a BALANCE READ, and wallets gate it behind a consent prompt.
 * Raising a permission dialog for balance access we do not want, in order to decide whether to
 * grey out a label, is the least-privilege violation the official route doc calls out by name.
 *
 * So an unknown version resolves to `probe-required` and the surface renders that honestly as
 * "this wallet does not say" — which is true, and costs the user nothing.
 */
async function readCapability(
  sdk: typeof import('starknet'),
  wallet: Parameters<typeof import('starknet').walletV6.supportedWalletApi>[0],
): Promise<{ support: WalletSupport; walletApi: string | null }> {
  try {
    const versions = await sdk.walletV6.supportedWalletApi(wallet)
    // The list is every spec the wallet speaks; the highest is what it can do. Sorted by the same
    // arithmetic `assessByVersion` uses, so "highest" means the same thing in both places.
    const best = [...versions].sort((a, b) => (assessByVersion(a) === 'supported' ? -1 : 1))[0] ?? null
    return { support: assessByVersion(best), walletApi: best }
  } catch {
    // A wallet that will not answer a version query has told us nothing, which is exactly what
    // `probe-required` means. It does not stop it being a funding rail.
    return { support: 'probe-required', walletApi: null }
  }
}

/**
 * Connect to one of the discovered wallets.
 *
 * NEVER THROWS. Every failure — a user who dismissed the extension prompt, a wallet on the wrong
 * chain, a chunk that would not load — comes back as a sentence, because this runs from a button
 * in a dialog and an exception there takes out the surface behind it.
 */
export async function connectWallet(id: string): Promise<ConnectOutcome> {
  try {
    const { sdk, net, network: ACTIVE_NETWORK } = await loadWalletTier()
    const found = (await starknetWallets()).find((w) => w.name === id)
    if (!found) {
      return { ok: false, because: 'That wallet is no longer available in this browser.' }
    }

    const walletAccount = await sdk.WalletAccountV6.connect({ nodeUrl: net.rpc[0] }, found)
    const address = walletAccount.address
    if (!address) {
      // A connect that resolves without an address is a wallet that did not actually authorise
      // us. Publishing it would show a connected chip over nothing.
      return { ok: false, because: `${found.name} did not share an account.` }
    }

    //
    // THE CHAIN IS CHECKED, AND A MISMATCH IS REFUSED RATHER THAN WARNED ABOUT.
    //
    // Passbook is pinned to one network (`ACTIVE_NETWORK`). A wallet sitting on a different chain
    // can still be connected, still shows an address, and still signs — and the deposit it signs
    // sends real tokens on THAT chain to an address that only exists on ours. There is no undo,
    // and the wallet's own confirmation dialog will look entirely normal.
    //
    // Refusing means the user switches network and presses Connect again, which is one step. The
    // alternative costs somebody their money.
    //
    //
    // `walletV6.requestChainId(wallet)` ASKS THE WALLET. `walletAccount.getChainId()` would read
    // the provider we constructed it with — our own `net.rpc[0]` — and would therefore always
    // agree with `net.chainId`, which is a check that can never fail and never help.
    //
    const chainId = await sdk.walletV6.requestChainId(found)
    if (BigInt(chainId) !== BigInt(net.chainId)) {
      return {
        ok: false,
        because: `${found.name} is on a different Starknet network. Switch it to ${ACTIVE_NETWORK} and connect again.`,
      }
    }

    const { support, walletApi } = await readCapability(sdk, found)

    account = walletAccount
    publish({
      id: found.name,
      name: found.name,
      icon: found.icon,
      address,
      chainId,
      support,
      walletApi,
    })
    return { ok: true, wallet: connected! }
  } catch (e) {
    // The overwhelmingly common case is a dismissed prompt, which is a decision rather than a
    // fault — so the sentence names the wallet and does not apologise.
    return { ok: false, because: `Could not connect: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/**
 * Drop the connection.
 *
 * IT DOES NOT ASK THE WALLET TO REVOKE ANYTHING, and the copy must not imply it does. The
 * wallet's own permission list is the wallet's, managed in its own UI; what this clears is this
 * page's handle on it. Telling a user they have "revoked access" when they have not would be the
 * same class of overclaim `account-copy.ts` refuses about locking.
 */
export function disconnectWallet(): void {
  account = null
  publish(null)
}

/** The minimum Wallet API version that means "this wallet can do STRK20 itself". */
export { MIN_WALLET_API }

export type DepositOutcome = { ok: true; txHash: string } | { ok: false; because: string }

/**
 * The connected wallet as a SUBMIT EXECUTOR — Ready signs, Ready pays — or null.
 *
 * ── THE SUBMITTER IS NOT THE IDENTITY, AND THIS SEAM IS WHERE THAT LINE HOLDS ─────────────
 *
 * A shielded send's viewing key and proofs derive from the EMBEDDED key (`send.ts:input.accountKey`)
 * — the connected wallet can only take over the submission: it signs the batch, its account pays
 * the gas and the pool fee (`collect_fee` pulls from whoever submits). That satisfies "if I'm
 * using Ready, Ready pops up and signs" without ever moving the identity out of this browser.
 *
 * Only a wallet whose Wallet API is `'supported'` (≥ MIN_WALLET_API) qualifies: the batch rides
 * v3 proof fields, and an older wallet would drop them at signing — a broadcast the sequencer
 * rejects AFTER the user approved it in their extension. Returning null routes those sends back
 * to the embedded key, which always works.
 */
export function walletSubmitter():
  | ((calls: unknown[], details?: { proofFacts: string[]; proof: string }) => Promise<string>)
  | null {
  const live = account
  if (!live || !connected || connected.support !== 'supported') return null
  return async (calls, details) => {
    // `executeWithProof` is the Wallet API ≥ 0.10.3 door for a SNIP-36 proven submission —
    // the reason `support === 'supported'` gates this function at all. A plain `execute`
    // would drop the proof pair and buy a sequencer rejection after the user approved.
    const { transaction_hash } = details
      ? await live.executeWithProof(calls as never, {
          data: details.proof,
          output: [],
          proof_facts: details.proofFacts,
        } as never)
      : await live.execute(calls as never)
    return transaction_hash
  }
}

/**
 * Send tokens from the connected wallet to this browser's Passbook address.
 *
 * ── THIS IS A PUBLIC TRANSFER AND THE UI MUST SAY SO BEFORE IT RUNS ───────────────────────
 *
 * `PUBLIC_DEPOSIT_NOTICE` is the sentence, and it is not decoration: the sender, the recipient and
 * the amount are all on chain here. Privacy starts AFTER the deposit — when the funds are shielded
 * into the pool — and a UI that implied otherwise would be making the one claim about this product
 * that is most tempting and most false.
 *
 * ── ONE CALL, AND THE AMOUNT IS A u256 ────────────────────────────────────────────────────
 *
 * Same encoding trap as the relayer's drip: `transfer` takes low and high felts, and emitting one
 * makes the ERC-20 read the next slot as the high half.
 */
export async function depositToPassbook(
  token: string,
  amountWei: bigint,
  passbookAddress: string,
): Promise<DepositOutcome> {
  const live = account
  if (!live) return { ok: false, because: 'No wallet is connected.' }

  try {
    const { sdk } = await loadWalletTier()
    const to = sdk.num.toHex(sdk.num.toBigInt(passbookAddress))
    const { transaction_hash } = await live.execute([
      {
        contractAddress: token,
        entrypoint: 'transfer',
        calldata: [
          to,
          sdk.num.toHex(amountWei & 0xffffffffffffffffffffffffffffffffn),
          sdk.num.toHex(amountWei >> 128n),
        ],
      },
    ])
    return { ok: true, txHash: transaction_hash }
  } catch (e) {
    return {
      ok: false,
      because: `The deposit was not sent: ${e instanceof Error ? e.message : String(e)}`,
    }
  }
}
