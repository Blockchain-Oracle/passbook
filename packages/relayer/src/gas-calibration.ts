//
// What a proven pool transaction actually costs, measured from the pool's own recent receipts.
//
// ── WHY THIS EXISTS WHEN A LIVE ESTIMATE ALSO WORKS ───────────────────────────────────────
//
// `starknet_estimateFee` does carry the proof at RPC 0.10.1+ — probed on mainnet: with the proof
// fields absent a real `apply_actions` dies on `Result::unwrap failed.`, and with them present the
// sequencer gets past that and validates the facts. So an accurate per-transaction estimate is
// available to whoever holds a proof.
//
// It is not available to everyone who needs a NUMBER, though, and that is the gap this fills.
// `NET.rpc` fails over to a node pinned at spec 0.9, which predates the proof fields entirely, so
// on that node an estimate is impossible. And every screen that quotes a cost before there is
// anything to prove — the shield dialog's "gas ~X expected", the floor a balance is judged
// against — needs the number without a proof in hand.
//
// So the relayer measures instead. It reads receipts the pool has already produced, which works on
// any spec version, costs the browser nothing, and self-corrects as the pool's proof cost moves.
// The constant in `fee-ceiling.ts` stays as the floor of last resort for a cold start.
//
import type { RpcProvider } from 'starknet'

import { NET } from '../../protocol/src/constants.js'

/** Units a proven transaction burns, as measured. Mirrors `protocol/fee-ceiling.ts:MeasuredGas`. */
export interface MeasuredGas {
  l2Gas: bigint
  l1Gas: bigint
  l1DataGas: bigint
}

export interface GasCalibration {
  /** The measurement, or `null` until enough receipts have been read to make one. */
  current(): (MeasuredGas & { samples: number; at: number }) | null
  /** Reads recent pool receipts and folds them in. Never throws. */
  sample(): Promise<void>
}

/**
 * How many transactions to look back over.
 *
 * Small on purpose: this is one `getEvents` plus one receipt read per TRANSACTION, on a timer, so
 * the cost is linear in this number — 20 takes about seven seconds against a public node. The
 * percentile barely moves above that, because the thing being measured has little spread: proof
 * verification costs what the circuit costs.
 *
 * Distinct from `LOOKBACK_BLOCKS`, which is how far back to look rather than how many to take. The
 * window is wide because the pool is quiet; the sample is small because it converges quickly.
 */
export const SAMPLE_SIZE = 20

/**
 * How often to re-measure. Fifteen minutes: the thing being watched is a circuit's cost, which
 * changes when the pool is upgraded and not otherwise, so polling it hard would spend RPC calls to
 * re-learn the same number. Bounded by MAX_TIMER_MS like every other interval here.
 */
export const GAS_CALIBRATION_INTERVAL_MS = 15 * 60_000

/**
 * The percentile taken, as a fraction of the sorted sample.
 *
 * NOT THE MEDIAN, and the asymmetry is the reason. This number becomes a resource bound, and the
 * two ways of being wrong do not cost the same: bounding too high costs nothing at all — only what
 * a transaction USES is charged, the bound is a ceiling — while bounding too low gets the
 * transaction rejected outright and the sender pays for the attempt. So it sits near the top of
 * what the pool has actually been costing rather than in the middle of it.
 */
export const PERCENTILE = 0.9

/**
 * How far back to look for pool events — roughly two days of blocks.
 *
 * WIDE BECAUSE THE POOL IS QUIET, not because old data is wanted. Probed on mainnet: 2,000 blocks
 * yielded 4 distinct transactions, which is below the floor this needs to produce a number at all;
 * 20,000 yielded 53. A window sized for a busy contract simply returns nothing here.
 *
 * The age of a sample matters less than it would elsewhere, which is what makes that safe. The l2
 * gas of a pool proof is a function of how many actions it verifies, not of when it was verified —
 * so a transaction from yesterday measures today's cost for the same shape of work. Prices move;
 * they are read live and separately (`GasPrices`).
 */
const LOOKBACK_BLOCKS = 20_000

function percentile(sorted: bigint[], fraction: number): bigint {
  if (sorted.length === 0) return 0n
  const index = Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))
  return sorted[index]!
}

/**
 * Reads `execution_resources` off recent transactions that touched the pool.
 *
 * ── ONLY SUCCEEDED RECEIPTS COUNT ─────────────────────────────────────────────────────────
 *
 * A reverted transaction consumed gas up to the point it died, which is by definition less than
 * the work a successful one does. Folding those in would drag the measurement DOWN and produce a
 * bound too small for the transactions it is meant to cover — the one direction that costs money.
 */
export function createGasCalibration(provider: RpcProvider): GasCalibration {
  let measured: (MeasuredGas & { samples: number; at: number }) | null = null

  return {
    current: () => measured,
    async sample() {
      try {
        const head = await provider.getBlockNumber()
        const events = await provider.getEvents({
          address: NET.pool,
          from_block: { block_number: Math.max(0, head - LOOKBACK_BLOCKS) },
          to_block: { block_number: head },
          chunk_size: 200,
        })
        // Newest first, deduped: one transaction emits several pool events and is one sample.
        const hashes: string[] = []
        for (const event of [...events.events].reverse()) {
          const hash = event.transaction_hash
          if (hash && !hashes.includes(hash)) hashes.push(hash)
          if (hashes.length >= SAMPLE_SIZE) break
        }
        if (hashes.length === 0) return

        const l2: bigint[] = []
        const l1: bigint[] = []
        const l1d: bigint[] = []
        for (const hash of hashes) {
          try {
            const receipt = (await provider.getTransactionReceipt(hash)) as unknown as {
              execution_status?: string
              execution_resources?: { l2_gas?: number | string; l1_gas?: number | string; l1_data_gas?: number | string }
            }
            if (receipt.execution_status !== 'SUCCEEDED') continue
            const r = receipt.execution_resources
            if (!r || r.l2_gas === undefined) continue
            l2.push(BigInt(r.l2_gas))
            l1.push(BigInt(r.l1_gas ?? 0))
            l1d.push(BigInt(r.l1_data_gas ?? 0))
          } catch {
            // One unreadable receipt is a smaller sample, not a failed calibration.
          }
        }
        // Below a handful the percentile is noise wearing a number's clothes; keep the last good one.
        if (l2.length < 5) return

        const asc = (a: bigint, b: bigint) => (a < b ? -1 : a > b ? 1 : 0)
        measured = {
          l2Gas: percentile(l2.sort(asc), PERCENTILE),
          l1Gas: percentile(l1.sort(asc), PERCENTILE),
          l1DataGas: percentile(l1d.sort(asc), PERCENTILE),
          samples: l2.length,
          at: Date.now(),
        }
      } catch (e) {
        // A calibration that cannot be taken leaves the previous one standing, and the constant
        // standing behind that. It is an optimisation; it must never be able to stop a submission.
        console.warn(`relayer: gas calibration failed: ${String(e)}`)
      }
    },
  }
}
