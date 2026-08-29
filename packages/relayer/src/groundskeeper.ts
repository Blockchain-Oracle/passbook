// The Groundskeeper — the board is never empty, because the house keeps it planted.
//
// Market creation dispatches OP_CREATE inside `privacy_invoke` and refuses a zero seed, so this
// job spends from a shielded balance like any bettor: the relayer's own account, registered and
// holding notes (`groundskeeper-provision.ts`). Its markets are the house's, publicly. Every seed
// secret is on disk BEFORE the submission is signed (`groundskeeper-store.ts`).
import { PRAGMA_PAIRS, type PragmaPair } from '../../protocol/src/pragma-pairs.js'
import { MARKET_STATE, type OnChainMarket } from '../../protocol/src/app-reads.js'
import { BOUNDS_CEILING_WEI, createProvisioner } from './groundskeeper-provision.js'
import { openSeedLedger, type StoredSeed } from './groundskeeper-store.js'

export { BOUNDS } from './groundskeeper-provision.js'
export type { StoredSeed, SeedStore } from './groundskeeper-store.js'

/**
 * 24 hours plus ten minutes of proving-and-inclusion margin. A DAY, NOT AN HOUR: every creation
 * pays the pool's 6 STRK, so hourly windows across three pairs would burn ~480 STRK a day.
 */
const DEFAULT_WINDOW_SECONDS = 24 * 3600 + 600

/** A market with less than this left on its clock no longer counts as covering its pair. */
const DEFAULT_MIN_REMAINING_SECONDS = 15 * 60

const DEFAULT_INTERVAL_MS = 180_000

/** Which pair needs a standing market, or null. First uncovered pair wins — ONE creation per sweep. */
export function nextStandingPair(
  markets: readonly OnChainMarket[],
  pairs: readonly PragmaPair[],
  nowSec: number,
  minRemainingSec: number = DEFAULT_MIN_REMAINING_SECONDS,
): PragmaPair | null {
  for (const pair of pairs) {
    // Any open market covers its pair, whoever seeded it — the job fills gaps, it does not compete.
    const covered = markets.some(
      (m) => m.pair === pair && m.state === MARKET_STATE.active && m.deadline > nowSec + minRemainingSec,
    )
    if (!covered) return pair
  }
  return null
}

export interface GroundskeeperDeps {
  pairs?: readonly PragmaPair[]
  seedWei: bigint
  windowSeconds?: number
  minRemainingSec?: number
  intervalMs?: number
  /** The open markets, newest first. */
  readMarkets(): Promise<OnChainMarket[]>
  /** Pragma's live median for a pair id, 8-decimal fixed point. */
  readStrike(pairId: string): Promise<bigint>
  /** Register + shield if needed. A sentence when the job cannot act — the sweep idles on it. */
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

/** The real wiring — SDK closures over the relayer's own account. */
export function openGroundskeeper(config: GroundskeeperConfig): Groundskeeper {
  const ledger = openSeedLedger(config.storePath)
  const provision = createProvisioner(config)

  const deps: GroundskeeperDeps = {
    seedWei: config.seedWei,
    log: config.log,
    warn: config.warn,
    ensureReady: provision.ensureReady,
    recordSeed: ledger.recordSeed,
    updateSeedTx: ledger.updateSeedTx,

    readMarkets: async () => {
      const { readMarkets } = await import('../../protocol/src/app-reads.js')
      const out = await readMarkets(config.markets, { cap: 24 })
      return out.markets
    },

    readStrike: async (pairId) => {
      const felts = await provision.transportCall(config.pragma, 'get_data_median', ['0x0', pairId])
      return BigInt(felts[0] ?? '0x0')
    },

    createMarket: async ({ pairId, strike, deadline, seedWei, persist }) => {
      const { mintPositionSecret } = await import('../../protocol/src/commitment.js')
      const { createPayload } = await import('../../protocol/src/market-calldata.js')
      const { readPoolConstants } = await import('../../protocol/src/pool.js')
      const { STRK_TOKEN } = await import('../../protocol/src/constants.js')
      const { approveCeiling } = await import('../../protocol/src/fee-ceiling.js')
      const { formatStrk } = await import('../../protocol/src/register.js')

      // THE FUNDS FLOOR, CHECKED BEFORE ANYTHING IS PROVEN OR SIGNED: a wallet that clears the
      // bounds but not the pool fee buys a revert at `collect_fee` every sweep.
      const pool = await readPoolConstants()
      const needed = pool.feeWei + BOUNDS_CEILING_WEI
      const balanceFelts = await provision.transportCall(STRK_TOKEN, 'balanceOf', [config.address])
      const held = BigInt(balanceFelts[0] ?? '0x0') + (BigInt(balanceFelts[1] ?? '0x0') << 128n)
      if (held < needed) {
        throw new Error(
          `the wallet holds ${formatStrk(held)} public STRK and one creation needs ~${formatStrk(needed)} ` +
            `(pool fee + gas ceiling) — top up ${config.address} to plant the board`,
        )
      }

      const seeder = mintPositionSecret()
      persist(seeder) // ON DISK BEFORE ANYTHING IS SIGNED.

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

      const txHash = await provision.proveAndSubmit(
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
  }

  return new Groundskeeper(deps)
}
