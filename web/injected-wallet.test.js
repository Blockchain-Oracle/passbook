//
// The legacy-injection path, which is the one a real wallet was actually found on.
//
// The point of these tests is that the sweep must find an injected wallet AND that the
// wrapper it produces must satisfy the same interface `WalletAccountV6.connect` and
// `strk20InvokeTransaction` use — `standard:connect` to get an address, and a
// `starknet:walletApi.request` that reaches the injected object unchanged.
//
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  StarknetInjectedWallet,
  isInjectedStarknetWallet,
  probeStrk20Support,
  sweepInjectedWallets,
} from './injected-wallet.js'

const ADDRESS = '0x049d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7'

/** A legacy injected object of the shape a Starknet wallet extension puts on `window`. */
function makeInjected(overrides = {}) {
  const calls = []
  return {
    id: 'mock',
    name: 'MockWallet',
    icon: 'data:image/svg+xml;base64,PHN2Zy8+',
    version: '6.0.0',
    calls,
    handlers: {},
    on(event, handler) {
      ;(this.handlers[event] ??= []).push(handler)
    },
    off() {},
    async request(payload) {
      calls.push(payload)
      if (payload.type === 'wallet_requestAccounts') return [ADDRESS]
      if (payload.type === 'wallet_supportedWalletApi') return ['0.10']
      if (payload.type === 'wallet_strk20InvokeTransaction') return { transaction_hash: '0xabc' }
      throw new Error(`unexpected request ${payload.type}`)
    },
    ...overrides,
  }
}

describe('isInjectedStarknetWallet', () => {
  it('accepts an object with request() and on()', () => {
    expect(isInjectedStarknetWallet(makeInjected())).toBe(true)
  })

  it('rejects the things that actually turn up on window under a starknet* key', () => {
    expect(isInjectedStarknetWallet(undefined)).toBe(false)
    expect(isInjectedStarknetWallet(null)).toBe(false)
    expect(isInjectedStarknetWallet('starknet')).toBe(false)
    expect(isInjectedStarknetWallet({})).toBe(false)
    // the starknet.js library bundle itself, were it ever on window: no request/on
    expect(isInjectedStarknetWallet({ RpcProvider: class {}, hash: {} })).toBe(false)
    // an object with request but no on would throw in the constructor
    expect(isInjectedStarknetWallet({ request: () => {} })).toBe(false)
  })
})

describe('StarknetInjectedWallet', () => {
  it('presents the four features WalletAccountV6.connect needs', () => {
    const wallet = new StarknetInjectedWallet(makeInjected())
    expect(Object.keys(wallet.features).sort()).toEqual([
      'standard:connect',
      'standard:disconnect',
      'standard:events',
      'starknet:walletApi',
    ])
  })

  it('subscribes to the injected object on construction', () => {
    const injected = makeInjected()
    new StarknetInjectedWallet(injected)
    expect(Object.keys(injected.handlers).sort()).toEqual(['accountsChanged', 'networkChanged'])
  })

  it('connects by asking the injected object for accounts', async () => {
    const injected = makeInjected()
    const wallet = new StarknetInjectedWallet(injected)
    expect(wallet.accounts).toEqual([])
    const { accounts } = await wallet.features['standard:connect'].connect({ silent: false })
    expect(accounts).toHaveLength(1)
    expect(accounts[0].address).toBe(ADDRESS)
    expect(injected.calls[0]).toEqual({
      type: 'wallet_requestAccounts',
      params: { silent_mode: false },
    })
  })

  it('returns no accounts rather than throwing when the wallet returns none', async () => {
    const wallet = new StarknetInjectedWallet(makeInjected({ request: async () => [] }))
    await expect(wallet.features['standard:connect'].connect()).resolves.toEqual({ accounts: [] })
  })

  // This is the whole reason wrapping works: the request is not translated, so every
  // STRK20 method reaches the wallet exactly as the SDK would send it.
  it('passes requests through to the injected object unchanged', async () => {
    const injected = makeInjected()
    const wallet = new StarknetInjectedWallet(injected)
    const payload = { type: 'wallet_strk20InvokeTransaction', params: { actions: [] } }
    await expect(wallet.features['starknet:walletApi'].request(payload)).resolves.toEqual({
      transaction_hash: '0xabc',
    })
    expect(injected.calls.at(-1)).toBe(payload)
  })

  it('reports a network change to subscribers so the page can re-lock', async () => {
    const injected = makeInjected()
    const wallet = new StarknetInjectedWallet(injected)
    await wallet.features['standard:connect'].connect()
    const onChange = vi.fn()
    wallet.features['standard:events'].on('change', onChange)
    injected.handlers.networkChanged.forEach((h) => h('0x534e5f5345504f4c4941', [ADDRESS]))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('reports a disconnect when the wallet reports no accounts', async () => {
    const injected = makeInjected()
    const wallet = new StarknetInjectedWallet(injected)
    await wallet.features['standard:connect'].connect()
    const onChange = vi.fn()
    wallet.features['standard:events'].on('change', onChange)
    injected.handlers.accountsChanged.forEach((h) => h([]))
    expect(onChange).toHaveBeenCalledWith({ accounts: [] })
    expect(wallet.accounts).toEqual([])
  })

  it('unsubscribes the listener it hands back', async () => {
    const injected = makeInjected()
    const wallet = new StarknetInjectedWallet(injected)
    await wallet.features['standard:connect'].connect()
    const onChange = vi.fn()
    const off = wallet.features['standard:events'].on('change', onChange)
    off()
    injected.handlers.accountsChanged.forEach((h) => h([]))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('sweepInjectedWallets', () => {
  const added = []
  const define = (key, value) => {
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    added.push(key)
  }

  beforeEach(() => {
    for (const key of added.splice(0)) delete globalThis[key]
    globalThis.window = globalThis
  })

  it('finds an injected wallet under a starknet-prefixed key', () => {
    define('starknet_ready', makeInjected())
    const { wrapped } = sweepInjectedWallets()
    expect(wrapped.map((w) => w.key)).toContain('starknet_ready')
    expect(wrapped.find((w) => w.key === 'starknet_ready').wallet.name).toBe('MockWallet')
  })

  it('finds the bare window.starknet too, and is case-insensitive about the prefix', () => {
    define('starknet', makeInjected())
    define('StarkNetFoo', makeInjected())
    expect(sweepInjectedWallets().wrapped.map((w) => w.key).sort()).toEqual([
      'StarkNetFoo',
      'starknet',
    ])
  })

  it('finds several wallets at once', () => {
    define('starknet_ready', makeInjected())
    define('starknet_braavos', makeInjected())
    expect(sweepInjectedWallets().wrapped).toHaveLength(2)
  })

  // The reason the sweep reports rejections instead of silently skipping: "we found
  // window.starknet_x but it is not a wallet" is a diagnosis, "no wallet found" is not.
  it('reports what it rejected and why, rather than dropping it', () => {
    define('starknet_notAWallet', { hello: 'world' })
    const { wrapped, rejected } = sweepInjectedWallets()
    expect(wrapped).toHaveLength(0)
    expect(rejected).toHaveLength(1)
    expect(rejected[0].key).toBe('starknet_notAWallet')
    expect(rejected[0].reason).toMatch(/request\(\)\/on\(\)/)
  })

  it('survives a window property whose getter throws', () => {
    Object.defineProperty(globalThis, 'starknet_hostile', {
      configurable: true,
      get() {
        throw new Error('nope')
      },
    })
    added.push('starknet_hostile')
    const { rejected } = sweepInjectedWallets()
    expect(rejected.find((r) => r.key === 'starknet_hostile').reason).toMatch(/threw: nope/)
  })

  it('ignores window keys that have nothing to do with starknet', () => {
    define('ethereum', makeInjected())
    define('mystarknet', makeInjected()) // prefix must be at the start
    expect(sweepInjectedWallets().wrapped).toHaveLength(0)
  })
})

describe('probeStrk20Support', () => {
  it('returns the versions the wallet reports', async () => {
    const wallet = new StarknetInjectedWallet(makeInjected())
    await expect(probeStrk20Support(wallet)).resolves.toEqual({ versions: ['0.10'], error: null })
  })

  it('returns the error rather than a verdict when the wallet cannot answer', async () => {
    const wallet = new StarknetInjectedWallet(
      makeInjected({
        request: async () => {
          throw new Error('An error occurred (API_VERSION_NOT_SUPPORTED)')
        },
      }),
    )
    const result = await probeStrk20Support(wallet)
    expect(result.versions).toBeNull()
    expect(result.error).toMatch(/API_VERSION_NOT_SUPPORTED/)
  })
})
