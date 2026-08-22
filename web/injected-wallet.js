//
// Wraps a legacy injected `window.starknet_*` object so it looks like a Wallet Standard
// wallet, which is the only shape `WalletAccountV6.connect` and `strk20InvokeTransaction`
// accept.
//
// A LEGACY INJECTION IS NOT A DEAD END. The adapter that proves it ships with the SDK:
// `@starknet-io/get-starknet-wallet-standard` v6 exports `StarknetInjectedWallet`, whose
// whole job is exactly this, and it is installed as a transitive dependency of
// `starknet@10.5.0` at `node_modules/@starknet-io/get-starknet-wallet-standard-v6/`.
//
// WHY THIS IS A LOCAL PORT RATHER THAN AN IMPORT of that class. Its module graph reaches
// `ox` (via `chains.mjs`, for one `Hex.validate` call), and `ox` reaches `@noble/curves`,
// `@noble/hashes`, `@scure/bip32`, `@scure/bip39` and `@adraffy/ens-normalize`, several of
// them through subpath specifiers. Loading that in a browser with no bundler means an
// import map enumerating the whole tree, which is a lot of fragility to add on the one
// path a user is currently blocked on. This file is ~40 lines and no import at all.
//
// It is a PORT, not an invention: the behaviour below is transcribed from that class.
// Read it side by side before changing anything here.
//
// DELIBERATELY OMITTED, and safe to omit: the original derives a CAIP-2 chain string
// (`starknet:0x534e5f4d41494e`) for `accounts[].chains`, which is the only thing `ox` was
// needed for. Nothing in this page reads that field — the chain guard asks the wallet
// directly with `wallet_requestChainId`, because a chain the page inferred is not a chain
// the wallet confirmed. The constant list is kept for `chains`, which callers do read.
//
// WHAT WRAPPING DOES NOT PROVE. The `starknet:walletApi` feature below is present
// unconditionally — that is true of the SDK's class too, because `request` is a plain
// passthrough to the injected object. So a wrapped wallet advertising the feature says
// nothing about whether it supports `wallet_strk20InvokeTransaction`; only asking it does.
// See `probeStrk20Support`.
//

export const WELL_KNOWN_STARKNET_CHAINS = [
  'starknet:0x534e5f4d41494e',
  'starknet:0x534e5f5345504f4c4941',
]

/**
 * Is this object a legacy Starknet window object worth wrapping?
 *
 * The sweep that feeds this looks at every `window` key beginning with "starknet", and
 * pages collect all sorts of things there. `request` and `on` are both load-bearing:
 * `request` is the entire wallet API, and the wrapper subscribes with `on` in its
 * constructor, so an object without it throws on wrap rather than failing later.
 */
export function isInjectedStarknetWallet(candidate) {
  return (
    !!candidate &&
    typeof candidate === 'object' &&
    typeof candidate.request === 'function' &&
    typeof candidate.on === 'function'
  )
}

export class StarknetInjectedWallet {
  #listeners = {}
  #account = null

  constructor(injected) {
    this.injected = injected
    this.injected.on('accountsChanged', this.#onAccountsChanged.bind(this))
    this.injected.on('networkChanged', this.#onNetworkChanged.bind(this))
  }

  get version() {
    return '1.0.0'
  }

  get name() {
    return this.injected.name
  }

  get icon() {
    return typeof this.injected.icon === 'string' ? this.injected.icon : this.injected.icon?.light
  }

  get chains() {
    return WELL_KNOWN_STARKNET_CHAINS.slice()
  }

  get accounts() {
    return this.#account
      ? [{ address: this.#account, publicKey: new Uint8Array(), chains: this.chains, features: [] }]
      : []
  }

  get features() {
    return {
      'standard:connect': { version: '1.0.0', connect: this.#connect },
      'standard:disconnect': { version: '1.0.0', disconnect: this.#disconnect },
      'standard:events': { version: '1.0.0', on: this.#on },
      'starknet:walletApi': {
        id: this.injected.id,
        version: '1.0.0',
        request: (...args) => this.injected.request(...args),
        walletVersion: this.injected.version,
      },
    }
  }

  #connect = async ({ silent } = {}) => {
    if (!this.#account) {
      const accounts = await this.injected.request({
        type: 'wallet_requestAccounts',
        params: { silent_mode: silent },
      })
      if (!accounts?.length) return { accounts: [] }
      this.#account = accounts[0]
      this.#emit('change', { accounts: this.accounts })
    }
    return { accounts: this.accounts }
  }

  #disconnect = async () => this.#disconnected()

  #on = (event, listener) => {
    ;(this.#listeners[event] ??= []).push(listener)
    return () => {
      this.#listeners[event] = this.#listeners[event].filter((l) => l !== listener)
    }
  }

  #emit(event, ...args) {
    for (const listener of this.#listeners[event] ?? []) listener(...args)
  }

  #disconnected() {
    if (this.#account) {
      this.#account = null
      this.#emit('change', { accounts: this.accounts })
    }
  }

  #onAccountsChanged = async (accounts) => {
    if (!accounts?.length) return this.#disconnected()
    if (!this.#account) return // never connected; nothing to update
    this.#account = accounts[0]
    this.#emit('change', { accounts: this.accounts })
  }

  // The chain is not tracked here — see the header. What matters is that a network change
  // reaches the page, which re-reads the chain from the wallet and re-locks the UI.
  #onNetworkChanged = (chainId, accounts) => {
    if (!chainId) return this.#disconnected()
    if (!this.#account) return
    if (accounts?.length) this.#account = accounts[0]
    this.#emit('change', { accounts: this.accounts })
  }
}

/**
 * Sweeps `window` for injected Starknet wallets and returns them wrapped.
 *
 * Returns BOTH the wallets it wrapped and the candidates it rejected, because "we found
 * something called window.starknet_foo but it had no request method" is a diagnosis and
 * "no wallet found" is a dead end. The caller shows the difference.
 */
export function sweepInjectedWallets() {
  const wrapped = []
  const rejected = []

  for (const key of Object.getOwnPropertyNames(window)) {
    if (!/^starknet/i.test(key)) continue
    let candidate
    try {
      candidate = window[key] // a getter here can throw; that is the wallet's problem, not ours
    } catch (e) {
      rejected.push({ key, reason: `reading window.${key} threw: ${e.message}` })
      continue
    }
    if (!isInjectedStarknetWallet(candidate)) {
      rejected.push({
        key,
        reason: candidate
          ? `no request()/on() methods — this is not an injected wallet object`
          : 'empty',
      })
      continue
    }
    try {
      wrapped.push({ key, wallet: new StarknetInjectedWallet(candidate) })
    } catch (e) {
      rejected.push({ key, reason: `could not be wrapped: ${e.message}` })
    }
  }

  return { wrapped, rejected }
}

/**
 * Asks a wallet whether it actually speaks STRK20, rather than assuming it from the
 * presence of the `starknet:walletApi` feature — which a wrapped legacy wallet always has.
 *
 * There is no capability flag for this in the wallet API, so the question is put the only
 * way it can be: call `wallet_supportedWalletApi`. A wallet that does not recognise the
 * STRK20 methods answers `API_VERSION_NOT_SUPPORTED` (162) when they are used. Returns
 * what was learned rather than a verdict, because a wallet that fails to answer this is
 * not thereby proven incapable.
 */
export async function probeStrk20Support(wallet) {
  try {
    const versions = await wallet.features['starknet:walletApi'].request({
      type: 'wallet_supportedWalletApi',
    })
    return { versions: Array.isArray(versions) ? versions : [versions], error: null }
  } catch (e) {
    return { versions: null, error: e?.message ?? String(e) }
  }
}
