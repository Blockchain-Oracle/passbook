//
// Network PARAMETERS are constants, not environment variables: they are facts about
// a network, so they belong in version control where they can be reviewed and diffed.
// Only secrets (the deployer key, the relayer key) come from the environment.
//
// Selection is a BUILD-TIME constant. There is no runtime network switch in the
// shipped app — the elimination gate depends on a judge seeing real mainnet state,
// and there is no upside to letting that be flippable in production.

export interface NetworkConfig {
  readonly chainId: string
  readonly pool: string
  readonly rpc: readonly string[]
  readonly prover: string
  readonly discovery: string
  readonly explorer: string
}

export const NETWORKS = {
  mainnet: {
    chainId: '0x534e5f4d41494e', // SN_MAIN
    pool: '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
    rpc: [
      'https://rpc.starknet.lava.build',
      'https://starknet-rpc.publicnode.com',
    ],
    prover: 'https://transaction-prover.alpha-mainnet.sw-dev.io',
    discovery: 'https://discovery-service.alpha-mainnet.sw-dev.io',
    explorer: 'https://voyager.online',
  },
  // The prover host is live (POST -> 200), but NO shared Sepolia pool is published:
  // the entire SDK source holds one long hex constant (the STRK fee token), poolAddress
  // is a runtime parameter everywhere, and the sponsor's demo ships a useDeployPool hook.
  // Left empty deliberately. Do not stand one up — compile_actions validates against the
  // real deployed mainnet contract for free, which is strictly better. See spec §3.2.1.
  sepolia: {
    chainId: '0x534e5f5345504f4c4941', // SN_SEPOLIA
    pool: '',
    rpc: ['https://starknet-sepolia-rpc.publicnode.com'],
    prover: 'https://transaction-prover.alpha-sepolia.sw-dev.io',
    discovery: '',
    explorer: 'https://sepolia.voyager.online',
  },
} as const satisfies Record<string, NetworkConfig>

export type NetworkName = keyof typeof NETWORKS

/** The one line that changes. Production builds must leave this on 'mainnet'. */
export const ACTIVE_NETWORK: NetworkName = 'mainnet'

export const NET: NetworkConfig = NETWORKS[ACTIVE_NETWORK]

// Selectors are protocol-level and identical on every network.
export const SELECTOR_PRIVACY_INVOKE =
  '0x402925cce9218828b3ac9a72ac249103f8448a1e1d73c3efaf5da992625043'
export const SELECTOR_PRIVACY_INVOKE_WITH_COMPUTATION =
  '0x00d7dcfbab5157247251535943d20090fb50187f80535f739fbacc8febab767'

// Deliberately absent: the pool fee, note maturity, and proof validity.
// All three are mutable on-chain and MUST be read at call time. See pool.ts.
