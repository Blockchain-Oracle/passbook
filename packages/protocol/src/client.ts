//
// The ONE `createPrivateTransfers` call. Every money module (transfer, withdraw, swap, bridge,
// app-invoke, register, shield) builds on a `PoolClient`; nothing else composes the SDK.
//

import { RpcProvider, type constants } from 'starknet'
import {
  createPrivateTransfers,
  type DiscoveryProviderInterface,
  type ExecuteOptions,
  type PrivateTransfersInterface,
  type PrivateTransfersUser,
  type ProofProviderInterface,
  type ProvingRetryOptions,
} from '@starkware-libs/starknet-privacy-sdk'
import { NET, PROVING_BLOCK_LAG } from './constants.js'
import { contractDiscoveryFor, poolContractFor } from './discovery.js'
import { deriveViewingKey } from './identity.js'
import { getProvider, withFallback } from './rpc.js'

/** Transient prover refusals (`-32005` / 503) are retried with backoff: 1 s, 2 s, 4 s. */
export const PROVER_RETRY: ProvingRetryOptions = { maxRetries: 3, baseDelayMs: 1_000 }

/**
 * What a value-moving build passes: the SDK composes setup, note selection (largest-first) and
 * a refreshed registry from the same indexer-free walk `discoverWallet` uses.
 */
export const EXECUTE_DEFAULTS: ExecuteOptions = {
  autoSetup: true,
  autoSelectNotes: 'naive',
  autoDiscover: { notes: 'refresh', channels: 'refresh' },
}

export interface PoolClientInput {
  accountKey: string
  /** `{ address, signer }` — a starknet `Account` is assignable. */
  account: PrivateTransfersUser
}

export interface PoolClientDeps {
  provider?: RpcProvider
  discovery?: DiscoveryProviderInterface
  proving?: ProofProviderInterface
}

export interface PoolClient {
  transfers: PrivateTransfersInterface
  viewingKey: bigint
  /** The account address, as a 0x felt hex string. */
  address: string
  provider: RpcProvider
  /** `latest − PROVING_BLOCK_LAG`, read live: a proof against the head is rejected as unseen. */
  provingBlockId(): Promise<{ block_number: number }>
}

export function createPoolClient(input: PoolClientInput, deps: PoolClientDeps = {}): PoolClient {
  const provider = deps.provider ?? getProvider()
  const viewingKey = deriveViewingKey(input.accountKey, NET.chainId, NET.pool)
  const transfers = createPrivateTransfers({
    account: input.account,
    viewingKeyProvider: { getViewingKey: async () => viewingKey },
    // OHTTP on, so the prover never pairs a network address with the amounts it proves.
    provingProvider:
      deps.proving ??
      { url: NET.prover, chainId: NET.chainId as constants.StarknetChainId, retry: PROVER_RETRY, ohttp: true },
    discoveryProvider: deps.discovery ?? contractDiscoveryFor(poolContractFor(provider)),
    poolContractAddress: NET.pool,
  })
  return {
    transfers,
    viewingKey,
    address: `0x${BigInt(input.account.address).toString(16)}`,
    provider,
    async provingBlockId() {
      const head = await withFallback((p) => p.getBlockNumber())
      return { block_number: Math.max(0, head - PROVING_BLOCK_LAG) }
    },
  }
}
