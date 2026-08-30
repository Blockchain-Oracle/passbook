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
  // The pinned pool class hash — the deployed class we built against, tag
  // CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08 / commit 74841caf, never `main`. A live class hash
  // that differs from this is the "pool upgraded" degraded mode. Empty where no pool is pinned.
  readonly poolClassHash: string
  readonly rpc: readonly string[]
  readonly prover: string
  readonly discovery: string
  readonly explorer: string
}

export const NETWORKS = {
  mainnet: {
    chainId: '0x534e5f4d41494e', // SN_MAIN
    pool: '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
    poolClassHash: '0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d',
    // ── NEVER THE BARE LAVA HOST ────────────────────────────────────────────────────────
    //
    // `https://rpc.starknet.lava.build` is load-balanced across nodes running DIFFERENT RPC
    // spec versions: probed eight times it answered 0.8.1 six times and 0.10.2 twice. starknet.js
    // supports two specs (0.9 and 0.10 for v10), so most requests were landing on a node it
    // cannot speak to — which is why the settlement keeper failed intermittently and a declare
    // died on `missing field: "l1_data_gas"`. The failure is random per request, so it reads as
    // flakiness rather than as the version mismatch it is.
    //
    // Both entries below are single-version endpoints. Lava keeps its place, addressed by the
    // versioned path its own docs use.
    rpc: [
      'https://starknet-rpc.publicnode.com',
      'https://rpc.starknet.lava.build/rpc/v0_9',
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
    poolClassHash: '',
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

// The STRK fee token, identical on every network. `collect_fee` pulls the fee from
// `get_caller_address()`, so a submission's first call is `STRK.approve(pool, fee)`.
// Verified live on SN_MAIN rather than copied: symbol "STRK", name "Starknet Token",
// 18 decimals. It is also the one address an allowlist must never permit `transfer` on.
export const STRK_TOKEN =
  '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'

/**
 * The shielded balance a new account is registered with, in wei — 3 STRK.
 *
 * ── WHY IT IS THIS SMALL, AND WHY THAT IS NOT STINGY ──────────────────────────────────────
 *
 * It rides inside the registration's own proof, so the pool pulls it from whoever submits — the
 * relayer — against the SAME approve that pays `collect_fee`. `approveCeiling` is twice the live
 * fee, which at a 6 STRK fee leaves exactly 6 STRK of headroom for a starter. Six is therefore the
 * hard ceiling, not a preference (`assembleRegistrationCalls` refuses anything above it), and
 * raising `approveCeiling` to fit a bigger one would widen the blast radius of every sponsored
 * submission rather than buy a more generous starter.
 *
 * Three is usable because a covered transaction deducts NO pool fee from the holder — the relayer
 * pays `collect_fee` and folds no reimbursement leg (`send-preflight.ts`). An account's first
 * transactions therefore spend only what they send, so a small balance is a spendable one.
 *
 * ── WHAT THIS COSTS US IF SOMEBODY LIES ───────────────────────────────────────────────────
 *
 * The client composes the proof, so the amount is the client's to name and the relayer cannot read
 * it back out of `apply_actions`. The approve ceiling is the real bound: the most a hostile caller
 * extracts is one fee's headroom per sponsored registration, metered by the sponsorship budget.
 * That exposure predates the starter — it is what an approve ceiling above the fee has always
 * meant — and the span guard in `register-prove.ts` is what keeps an honest client honest.
 */
export const STARTER_WEI = 3_000_000_000_000_000_000n

/**
 * Proofs are built against `latest − PROVING_BLOCK_LAG`: a proof against the head is rejected as
 * unseen. Observed ~10 in both live probes; not a protocol constant. Lives here, SDK-free, so the
 * app can count a fresh deploy's wait without loading the SDK.
 */
export const PROVING_BLOCK_LAG = 10

// Deliberately absent: the pool fee, note maturity, and proof validity.
// All three are mutable on-chain and MUST be read at call time. See pool.ts.
