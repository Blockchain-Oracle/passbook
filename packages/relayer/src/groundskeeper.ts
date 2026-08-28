//
// The Groundskeeper — the board is never empty, because the house keeps it planted.
//
// ── WHY THE RELAYER IS A POOL PARTICIPANT NOW ────────────────────────────────────────────
//
// Market creation is not a plain entrypoint: `markets.cairo` dispatches OP_CREATE inside
// `privacy_invoke`, and `createPayload` hard-refuses a zero seed — a market opens WITH liquidity
// or it does not open. So a job that keeps standing markets on the board must spend from a
// shielded balance like any other bettor: registered in the pool, holding notes, submitting
// proven batches. The relayer's own signing account takes that role. Its identity here is not a
// privacy claim — the Groundskeeper's markets are the house's, publicly and on purpose; what the
// pool gives us is the same rail every browser uses, exercised end to end by the product itself.
//
// ── PROVISIONING IS SELF-SERVICE, ONCE, AND SAID OUT LOUD ────────────────────────────────
//
// On the first sweep with the job on, the account registers itself (its own fee, its own gas —
// the one-subsidy doctrine applies to the house too) and shields a seed budget. Both are real
// mainnet spends; both are logged with amounts before they happen. If the wallet cannot cover
// them, the job idles with a sentence — it never closes any route, and the board simply stays
// whatever the users make it.
//
// ── THE SECRET IS ON DISK BEFORE THE TRANSACTION EXISTS ──────────────────────────────────
//
// Every market seeded mints a bearer position (the seeder's claim on the pot). The secret is
// appended to the store BEFORE the submission is signed — the markets surface's own rule
// ("stored the moment the send succeeds" is the browser's version; a server that can crash
// mid-await stores it the moment it EXISTS). A secret lost is STRK burned.
//
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { PRAGMA_PAIRS, type PragmaPair } from '../../protocol/src/pragma-pairs.js'
import { MARKET_STATE, type OnChainMarket } from '../../protocol/src/app-reads.js'

/**
 * Sized from the measured create probe (88M l2), with a lean margin instead of the ops scripts'
 * fat one. THE CEILING IS A BALANCE REQUIREMENT, not a spend: the sequencer refuses any
 * transaction whose worst-case bounds exceed the sender's balance ("Resources bounds … exceed
 * balance", measured live 2026-08-28 at 6.98 STRK held vs ~9.5 reserved). A generous ceiling on
 * a working wallet is free; on a lean one it is an outage. This one reserves ~4.7 STRK.
 */
const BOUNDS = {
  l2_gas: { max_amount: 120_000_000n, max_price_per_unit: 35_000_000_000n },
  l1_gas: { max_amount: 5_000n, max_price_per_unit: 100_000_000_000_000n },
  l1_data_gas: { max_amount: 30_000n, max_price_per_unit: 300_000_000_000n },
}

/**
 * Nominal 24 hours (plus ten minutes of proving-and-inclusion margin — the WINDOW_TOO_SHORT
 * lesson, already paid for twice at ~2.5 STRK each, says never compute a deadline this clock
 * cannot deliver).
 *
 * A DAY, NOT AN HOUR, AND THE REASON IS THE FEE: every creation pays the pool's 6 STRK on top of
 * its seed, so hourly windows across three pairs would burn ~480 STRK a day keeping an empty
 * board busy. Daily standing markets cost three fees a day, the seeds reclaim after settlement,
 * and a board that always shows today's question is the product Abu asked for — users who want
 * fast action open their own short markets beside them.
 */
const DEFAULT_WINDOW_SECONDS = 24 * 3600 + 600

/** A market with less than this left on its clock no longer counts as covering its pair. */
const DEFAULT_MIN_REMAINING_SECONDS = 15 * 60

const DEFAULT_INTERVAL_MS = 180_000

/**
 * Which pair needs a standing market, or null when the board is covered.
 *
 * Pure and exported for the tests: one decision, first uncovered pair wins, ONE creation per
 * sweep — pacing is the budget control, and a burst after downtime would spend several seeds in
 * one interval for a board that only needed to fill over the next few.
 */
export function nextStandingPair(
  markets: readonly OnChainMarket[],
  pairs: readonly PragmaPair[],
  nowSec: number,
  minRemainingSec: number = DEFAULT_MIN_REMAINING_SECONDS,
): PragmaPair | null {
  for (const pair of pairs) {
    const covered = markets.some(
      (m) =>
        m.pair === pair &&
        // Any open market covers its pair, whoever seeded it — the job fills gaps, it does not
        // compete with users.
        m.state === MARKET_STATE.active &&
        m.deadline > nowSec + minRemainingSec,
    )
    if (!covered) return pair
  }
  return null
}

interface StoredSeed {
  pair: string
  secret: string
  commitment: string
  seedWei: string
  createdAt: number
  /** Filled in after the submission answers; a seed with none may still be live — check chain. */
  txHash?: string
}

interface SeedStore {
  version: 1
  seeds: StoredSeed[]
}

function loadStore(path: string): SeedStore {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SeedStore
    if (parsed.version === 1 && Array.isArray(parsed.seeds)) return parsed
  } catch {
    // First boot, or an unreadable file — begin empty; the write below will say if the disk
    // refuses, which is the failure that actually matters.
  }
  return { version: 1, seeds: [] }
}

export interface GroundskeeperDeps {
  pairs?: readonly PragmaPair[]
  seedWei: bigint
  windowSeconds?: number
  minRemainingSec?: number
  intervalMs?: number
  /** The open markets, newest first — the protocol reader behind a closure for tests. */
  readMarkets(): Promise<OnChainMarket[]>
  /** Pragma's live median for a pair id, 8-decimal fixed point. */
  readStrike(pairId: string): Promise<bigint>
  /**
   * Register + shield if needed. Returns a sentence when the job cannot act (unfunded wallet,
   * failed read) — the sweep idles on it rather than throwing.
   */
  ensureReady(): Promise<string | null>
  /** Prove and submit one creation. `persist` runs BEFORE anything is signed. */
  createMarket(input: {
    pairId: string
    strike: bigint
    deadline: number
    seedWei: bigint
    persist(seed: { secret: string; commitment: string }): void
  }): Promise<{ txHash: string }>
  recordSeed(seed: StoredSeed): void
  updateSeedTx(commitment: string, txHash: string): void
  now?: () => number
  log?: (line: string) => void
  warn?: (line: string) => void
}

export class Groundskeeper {
  /** The sweep's honest state, for the boot banner and anyone who asks. */
  problem: string | null = null
  last: string | null = null

  private timer: ReturnType<typeof setInterval> | null = null
  private sweeping = false

  constructor(private readonly deps: GroundskeeperDeps) {}

  start(): void {
    const interval = this.deps.intervalMs ?? DEFAULT_INTERVAL_MS
    this.timer = setInterval(() => void this.sweep(), interval)
    this.timer.unref?.()
    void this.sweep()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** One pass. Never throws — a failed sweep is a sentence, and the next tick tries again. */
  async sweep(): Promise<void> {
    if (this.sweeping) return // proving takes minutes; overlapping sweeps would double-spend
    this.sweeping = true
    try {
      const notReady = await this.deps.ensureReady()
      if (notReady !== null) {
        this.problem = notReady
        return
      }
      const now = Math.floor((this.deps.now?.() ?? Date.now()) / 1000)
      const markets = await this.deps.readMarkets()
      const pairs = this.deps.pairs ?? (Object.keys(PRAGMA_PAIRS) as PragmaPair[])
      const pair = nextStandingPair(markets, pairs, now, this.deps.minRemainingSec)
      if (pair === null) {
        this.problem = null
        return
      }

      const pairId = PRAGMA_PAIRS[pair]
      const strike = await this.deps.readStrike(pairId)
      if (strike === 0n) {
        this.problem = `Pragma answered a zero median for ${pair}; not opening a market on it.`
        return
      }
      const deadline = now + (this.deps.windowSeconds ?? DEFAULT_WINDOW_SECONDS)
      this.deps.log?.(
        `groundskeeper: opening the ${pair} standing market — strike ${Number(strike) / 1e8}, ` +
          `seed ${this.deps.seedWei} wei, closes ${new Date(deadline * 1000).toISOString()}`,
      )
      const { txHash } = await this.deps.createMarket({
        pairId,
        strike,
        deadline,
        seedWei: this.deps.seedWei,
        persist: (seed) =>
          this.deps.recordSeed({
            pair,
            secret: seed.secret,
            commitment: seed.commitment,
            seedWei: this.deps.seedWei.toString(),
            createdAt: Date.now(),
          }),
      })
      this.last = `${pair} at ${new Date().toISOString()} — ${txHash}`
      this.problem = null
      this.deps.log?.(`groundskeeper: ${pair} market open — ${txHash}`)
    } catch (error) {
      this.problem = `The sweep failed: ${error instanceof Error ? error.message : String(error)}`
      this.deps.warn?.(`groundskeeper: ${this.problem}`)
    } finally {
      this.sweeping = false
    }
  }
}

export interface GroundskeeperConfig {
  markets: string
  pragma: string
  address: string
  accountKey: string
  seedWei: bigint
  storePath: string
  log?: (line: string) => void
  warn?: (line: string) => void
}

/**
 * The real wiring — SDK closures over the relayer's own account. Everything heavy loads on the
 * call, so a boot with the job off never touches the crypto graph.
 */
export function openGroundskeeper(config: GroundskeeperConfig): Groundskeeper {
  const store = () => loadStore(config.storePath)
  const save = (record: SeedStore) => {
    mkdirSync(dirname(config.storePath), { recursive: true })
    writeFileSync(config.storePath, `${JSON.stringify(record, null, 2)}\n`)
  }

  // One provision attempt per boot: a wallet that could not cover it will not grow richer by
  // being asked every three minutes, and the sentence stays visible either way.
  let provisioned: string | null | undefined

  const transportCall = async (contract: string, entrypoint: string, calldata: string[]) => {
    const { withFallback } = await import('../../protocol/src/rpc.js')
    return withFallback((p) => p.callContract({ contractAddress: contract, entrypoint, calldata }))
  }

  const openAccount = async () => {
    const { Account, RpcProvider } = await import('starknet')
    const { NET } = await import('../../protocol/src/constants.js')
    const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })
    return {
      provider,
      account: new Account({ provider, address: config.address, signer: config.accountKey }),
    }
  }

  const openTransfers = async () => {
    const { constants } = await import('starknet')
    const { IndexerDiscoveryProvider, createPrivateTransfers } = await import(
      '@starkware-libs/starknet-privacy-sdk'
    )
    const { NET } = await import('../../protocol/src/constants.js')
    const { deriveViewingKey } = await import('../../protocol/src/identity.js')
    const { account, provider } = await openAccount()
    const viewingKey = deriveViewingKey(config.accountKey, NET.chainId, NET.pool)
    const discovery = new IndexerDiscoveryProvider(NET.discovery, NET.pool, { ohttp: true })
    const transfers = createPrivateTransfers({
      account,
      viewingKeyProvider: { getViewingKey: async () => viewingKey },
      provingProvider: {
        url: NET.prover,
        chainId: NET.chainId as (typeof constants)['StarknetChainId'][keyof (typeof constants)['StarknetChainId']],
        ohttp: true,
      },
      discoveryProvider: discovery,
      poolContractAddress: NET.pool,
    })
    return { account, provider, transfers, discovery, viewingKey, NET }
  }

  const shieldedStrk = async (): Promise<bigint> => {
    const { STRK_TOKEN } = await import('../../protocol/src/constants.js')
    const { NET } = await import('../../protocol/src/constants.js')
    const { deriveViewingKey } = await import('../../protocol/src/identity.js')
    const { IndexerDiscoveryProvider } = await import('@starkware-libs/starknet-privacy-sdk')
    const discovery = new IndexerDiscoveryProvider(NET.discovery, NET.pool, { ohttp: true })
    const viewingKey = deriveViewingKey(config.accountKey, NET.chainId, NET.pool)
    const { notes } = await discovery.discoverNotes(
      BigInt(config.address) as never,
      viewingKey as never,
      {},
    )
    const mine = (notes.get(BigInt(STRK_TOKEN) as never) ?? []) as { amount: bigint }[]
    return mine.reduce((sum, n) => sum + n.amount, 0n)
  }

  /** Prove one built batch and submit it from the relayer's account, bounds set. */
  const proveAndSubmit = async (
    build: (b: unknown) => void,
    approveWei: bigint,
  ): Promise<string> => {
    const { CallData, cairo } = await import('starknet')
    const { NET, STRK_TOKEN } = await import('../../protocol/src/constants.js')
    const { PROVING_BLOCK_LAG, proofBlobFrom } = await import('../../protocol/src/register.js')
    const { withFallback } = await import('../../protocol/src/rpc.js')
    const { account, provider, transfers } = await openTransfers()

    const provingBlockId = (await withFallback((p) => p.getBlockNumber())) - PROVING_BLOCK_LAG
    const builder = transfers.build({
      autoSetup: true,
      autoSelectNotes: 'naive',
      autoDiscover: { notes: 'refresh', channels: 'refresh' },
    })
    builder.surplusTo(config.address)
    build(builder)
    const invocation = await builder.createProofInvocation({ provingBlockId })
    const { callAndProof } = await transfers.executeWithInvocation(invocation, provingBlockId)
    const { call, proof } = callAndProof

    const calls = [
      {
        contractAddress: STRK_TOKEN,
        entrypoint: 'approve',
        calldata: CallData.compile([NET.pool, cairo.uint256(approveWei)]),
      },
      call,
    ]
    const out = await account.execute(calls, {
      proofFacts: [...proof.proofFacts],
      proof: proofBlobFrom(proof),
      resourceBounds: BOUNDS,
    } as never)
    const receipt = (await provider.waitForTransaction(out.transaction_hash)) as {
      execution_status?: string
      revert_reason?: string
    }
    if (receipt.execution_status !== 'SUCCEEDED') {
      throw new Error(
        `submission ${out.transaction_hash} ended ${receipt.execution_status}: ${receipt.revert_reason ?? 'no reason on the receipt'}`,
      )
    }
    return out.transaction_hash
  }

  const deps: GroundskeeperDeps = {
    seedWei: config.seedWei,
    log: config.log,
    warn: config.warn,

    readMarkets: async () => {
      const { readMarkets } = await import('../../protocol/src/app-reads.js')
      const out = await readMarkets(config.markets, { cap: 24 })
      return out.markets
    },

    readStrike: async (pairId) => {
      const felts = await transportCall(config.pragma, 'get_data_median', ['0x0', pairId])
      return BigInt(felts[0] ?? '0x0')
    },

    ensureReady: async () => {
      if (provisioned !== undefined) return provisioned
      try {
        const { NET } = await import('../../protocol/src/constants.js')
        const { readPoolConstants } = await import('../../protocol/src/pool.js')
        const { formatStrk } = await import('../../protocol/src/register.js')

        const pool = await readPoolConstants()
        if (pool.paused) {
          // Deliberately NOT cached: a paused pool unpauses without this process restarting.
          return 'the pool is paused; the Groundskeeper waits with everyone else'
        }

        // Registered? `get_public_key` answers zero for an address the pool has no key for.
        const pk = await transportCall(NET.pool, 'get_public_key', [config.address])
        if (BigInt(pk[0] ?? '0x0') === 0n) {
          const { proveRegistration, assembleRegistrationCalls, PROVING_BLOCK_LAG } = await import(
            '../../protocol/src/register.js'
          )
          const { withFallback } = await import('../../protocol/src/rpc.js')
          const { account, provider } = await openAccount()
          config.log?.(
            `groundskeeper: registering the relayer with the pool — fee ${formatStrk(pool.feeWei)}, its own STRK`,
          )
          const provingBlockId = (await withFallback((p) => p.getBlockNumber())) - PROVING_BLOCK_LAG
          const proved = await proveRegistration({
            accountKey: config.accountKey,
            account: account as never,
            provingBlockId,
          })
          // `proved.proof` is already the broadcast blob — both-or-neither with the facts.
          const calls = assembleRegistrationCalls(proved.call, pool.feeWei)
          const out = await account.execute(calls, {
            proofFacts: [...proved.proofFacts],
            proof: proved.proof,
          } as never)
          const receipt = (await provider.waitForTransaction(out.transaction_hash)) as {
            execution_status?: string
          }
          if (receipt.execution_status !== 'SUCCEEDED') {
            throw new Error(`registration ${out.transaction_hash} ended ${receipt.execution_status}`)
          }
          config.log?.(`groundskeeper: registered — ${out.transaction_hash}`)
        }

        // Shielded budget: enough for a seed plus the pool fee, or top up with one deposit
        // sized to cover several windows rather than a deposit per market (each deposit pays
        // its own fee — four seeds per shield beats one).
        const held = await shieldedStrk()
        const perMarket = config.seedWei + pool.feeWei
        if (held < perMarket) {
          // Two markets' worth per shield: each deposit pays its own pool fee, so batching
          // beats a deposit per market — but the multiplier stays small because the relayer
          // wallet also backs sponsorship and gas, and seeds flow back after settlement.
          const depositWei = perMarket * 2n
          config.log?.(
            `groundskeeper: shielding ${formatStrk(depositWei)} for seeds (held ${formatStrk(held)})`,
          )
          const { STRK_TOKEN } = await import('../../protocol/src/constants.js')
          const txHash = await proveAndSubmit(
            (b) =>
              (b as { with: (t: string, f: (x: { deposit: (i: unknown) => unknown }) => unknown) => unknown }).with(
                STRK_TOKEN,
                (t) => t.deposit({ recipient: config.address, amount: depositWei }),
              ),
            depositWei + pool.feeWei,
          )
          config.log?.(`groundskeeper: shielded — ${txHash}`)
        }
        provisioned = null
        return null
      } catch (error) {
        // Cached ON PURPOSE: provisioning spends real STRK, and retrying a failing spend every
        // sweep is how a wallet drains on gas. A restart (deploy) retries once more.
        provisioned = `provisioning failed and will not be retried until restart: ${
          error instanceof Error ? error.message : String(error)
        }`
        return provisioned
      }
    },

    createMarket: async ({ pairId, strike, deadline, seedWei, persist }) => {
      const { mintPositionSecret } = await import('../../protocol/src/commitment.js')
      const { createPayload } = await import('../../protocol/src/market-calldata.js')
      const { readPoolConstants } = await import('../../protocol/src/pool.js')
      const { STRK_TOKEN } = await import('../../protocol/src/constants.js')
      const { approveCeiling } = await import('../../protocol/src/fee-ceiling.js')
      const { formatStrk } = await import('../../protocol/src/register.js')

      //
      // THE FUNDS FLOOR, CHECKED BEFORE ANYTHING IS PROVEN OR SIGNED. The bounds ceiling only
      // gates the broadcast; a wallet that clears it but cannot ALSO cover the pool fee buys a
      // revert at `collect_fee` — real gas burned, every sweep, three minutes apart. One free
      // balance read makes that a sentence instead of a bill.
      //
      const pool = await readPoolConstants()
      const ceiling =
        BOUNDS.l2_gas.max_amount * BOUNDS.l2_gas.max_price_per_unit +
        BOUNDS.l1_gas.max_amount * BOUNDS.l1_gas.max_price_per_unit +
        BOUNDS.l1_data_gas.max_amount * BOUNDS.l1_data_gas.max_price_per_unit
      const needed = pool.feeWei + ceiling
      const balanceFelts = await transportCall(STRK_TOKEN, 'balanceOf', [config.address])
      const held = BigInt(balanceFelts[0] ?? '0x0') + (BigInt(balanceFelts[1] ?? '0x0') << 128n)
      if (held < needed) {
        throw new Error(
          `the wallet holds ${formatStrk(held)} public STRK and one creation needs ~${formatStrk(needed)} ` +
            `(pool fee + gas ceiling) — top up ${config.address} to plant the board`,
        )
      }

      const seeder = mintPositionSecret()
      persist(seeder) // ON DISK BEFORE ANYTHING IS SIGNED — see the header.

      const payload = createPayload({
        pairId,
        strike,
        deadline,
        token: STRK_TOKEN,
        seed: seedWei,
        seederCommitment: seeder.commitment,
        experimental: false,
      })
      if (payload.state !== 'ready') throw new Error(payload.because)

      const txHash = await proveAndSubmit(
        (b) =>
          (b as {
            with: (t: string, f: (x: { withdraw: (i: unknown) => unknown }) => unknown) => {
              invoke: (f: () => { contractAddress: string; calldata: string[] }) => unknown
            }
          })
            .with(STRK_TOKEN, (t) => t.withdraw({ recipient: config.markets, amount: seedWei }))
            .invoke(() => ({ contractAddress: config.markets, calldata: [...payload.calldata] })),
        approveCeiling(pool.feeWei),
      )
      deps.updateSeedTx(seeder.commitment, txHash)
      return { txHash }
    },

    recordSeed: (seed) => {
      const record = store()
      record.seeds.push(seed)
      save(record)
    },

    updateSeedTx: (commitment, txHash) => {
      const record = store()
      const found = record.seeds.find((s) => s.commitment === commitment)
      if (found) {
        found.txHash = txHash
        save(record)
      }
    },
  }

  return new Groundskeeper(deps)
}
