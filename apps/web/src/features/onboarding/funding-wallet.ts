// An external wallet is a FUNDING SOURCE only: it signs one public ERC-20 transfer into the embedded address.
// Not persisted, and discovered without `get-starknet-discovery` (its runtime carries an `eval`).
import { useSyncExternalStore } from 'react'
import { queryOptions } from '@tanstack/react-query'
import { ACTIVE_NETWORK, NET } from '@strk20/protocol/constants'
import { assessByVersion, type WalletSupport } from '@strk20/protocol/wallet-capability'

export interface DiscoveredWallet {
  id: string
  name: string
  /** A `data:` URI from the wallet itself; never fetched from a host. */
  icon: string
}

export interface ConnectedWallet extends DiscoveredWallet {
  address: string
  chainId: string
  /** Informational only — funding needs no privacy features from the wallet. */
  support: WalletSupport
  walletApi: string | null
}

export type ConnectOutcome = { ok: true; wallet: ConnectedWallet } | { ok: false; because: string }
export type FundOutcome = { ok: true; txHash: string } | { ok: false; because: string }

let connected: ConnectedWallet | null = null
let live: import('starknet').WalletAccountV6 | null = null
const listeners = new Set<() => void>()

function publish(next: ConnectedWallet | null): void {
  connected = next
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

export function useFundingWallet(): ConnectedWallet | null {
  return useSyncExternalStore(subscribe, () => connected, () => connected)
}

async function loadWalletTier() {
  const [app, features, bridge, sdk] = await Promise.all([
    import('@wallet-standard/app'),
    import('@starknet-io/get-starknet-wallet-standard/features'),
    import('@starknet-io/get-starknet-wallet-standard'),
    import('starknet'),
  ])
  return { app, features, bridge, sdk, net: NET, network: ACTIVE_NETWORK }
}

interface Entry {
  standard: { name: string; icon: string } & Record<string, unknown>
  injected: Record<string, unknown> | null
}

async function starknetWallets(): Promise<Map<string, Entry>> {
  const { app, features, bridge } = await loadWalletTier()
  const map = new Map<string, Entry>()
  for (const wallet of app.getWallets().get()) {
    if (features.isStarknetWallet(wallet)) map.set(wallet.name, { standard: wallet as never, injected: null })
  }
  // The injected half is what finds Ready: extensions announce as `window.starknet_<id>`.
  const w = globalThis as unknown as Record<string, unknown>
  for (const key of Object.keys(w)) {
    if (!key.startsWith('starknet')) continue
    const swo = w[key] as Record<string, unknown> | null
    if (typeof swo?.name !== 'string' || typeof swo?.request !== 'function') continue
    if (typeof swo.icon !== 'string' && typeof swo.icon !== 'object') continue
    if (map.has(swo.name)) continue
    try {
      map.set(swo.name, { standard: new bridge.StarknetInjectedWallet(swo as never) as never, injected: swo })
    } catch {
      // Looks like a wallet, is not one: it loses the listing, not the picker.
    }
  }
  return map
}

/** Every Starknet wallet the browser can see. Empty is the common case, not an error. */
export function walletsQuery() {
  return queryOptions({
    queryKey: ['funding-wallets'],
    queryFn: async (): Promise<DiscoveredWallet[]> => {
      try {
        const found = await starknetWallets()
        return [...found.values()].map(({ standard }) => ({ id: standard.name, name: standard.name, icon: standard.icon }))
      } catch {
        return []
      }
    },
    staleTime: 0,
  })
}

/** Version query only — never a balance probe, which would raise a consent prompt for nothing. */
async function readCapability(sdk: typeof import('starknet'), target: never) {
  try {
    const versions = await sdk.walletV6.supportedWalletApi(target)
    const best = [...versions].sort((a) => (assessByVersion(a) === 'supported' ? -1 : 1))[0] ?? null
    return { support: assessByVersion(best), walletApi: best }
  } catch {
    return { support: 'probe-required' as const, walletApi: null }
  }
}

/** Never throws. A wallet on another network is refused: its deposit would go to a void. */
export async function connectWallet(id: string): Promise<ConnectOutcome> {
  try {
    const { sdk, net, network } = await loadWalletTier()
    const entry = (await starknetWallets()).get(id)
    if (!entry) return { ok: false, because: 'That wallet is no longer available in this browser.' }
    const target = (entry.injected ?? entry.standard) as never

    const account = await sdk.WalletAccountV6.connect({ nodeUrl: net.rpc[0] }, entry.standard as never)
    if (!account.address) return { ok: false, because: `${entry.standard.name} did not share an account.` }

    const chainId = await sdk.walletV6.requestChainId(target)
    if (BigInt(chainId) !== BigInt(net.chainId)) {
      return { ok: false, because: `${entry.standard.name} is on a different Starknet network. Switch it to ${network} and connect again.` }
    }
    const { support, walletApi } = await readCapability(sdk, target)
    live = account
    const wallet: ConnectedWallet = {
      id: entry.standard.name,
      name: entry.standard.name,
      icon: entry.standard.icon,
      address: account.address,
      chainId,
      support,
      walletApi,
    }
    publish(wallet)
    return { ok: true, wallet }
  } catch (e) {
    return { ok: false, because: `Could not connect: ${e instanceof Error ? e.message : String(e)}` }
  }
}

/** Drops this page's handle. The wallet's own permission list is the wallet's. */
export function disconnectWallet(): void {
  live = null
  publish(null)
}

/** A public ERC-20 `transfer` from the connected wallet to the embedded address. u256 = low, high. */
export async function fundPublicAccount(token: string, amountWei: bigint, passbookAddress: string): Promise<FundOutcome> {
  if (!live) return { ok: false, because: 'No wallet is connected.' }
  try {
    const { sdk } = await loadWalletTier()
    const { transaction_hash } = await live.execute([
      {
        contractAddress: token,
        entrypoint: 'transfer',
        calldata: [
          sdk.num.toHex(sdk.num.toBigInt(passbookAddress)),
          sdk.num.toHex(amountWei & 0xffffffffffffffffffffffffffffffffn),
          sdk.num.toHex(amountWei >> 128n),
        ],
      },
    ])
    return { ok: true, txHash: transaction_hash }
  } catch (e) {
    return { ok: false, because: `The public funding transfer was not sent: ${e instanceof Error ? e.message : String(e)}` }
  }
}
