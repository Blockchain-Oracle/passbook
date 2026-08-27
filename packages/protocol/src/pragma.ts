//
// Pragma's spot oracle — the one thing on the Markets surface that is live TODAY.
//
// ── WHY THIS EXISTS BEFORE THE CONTRACTS DO ──────────────────────────────────────────────
//
// Markets and Launch are not deployed yet, so every market list, every position and every quote on
// those surfaces is honestly empty. The PRICE is not: `get_data_median` is a free view call on a
// contract that has been on mainnet for years, so the price strip and the charts are real from the
// first paint, against the same oracle the Markets contract will resolve against.
//
// That matters beyond looking alive. A chart drawn from an oracle the contract does NOT read would
// be a decoration that disagrees with settlement the day the contracts land. The address is
// therefore carried by the deployment (`app-contracts.ts`'s `pragma` field is the address the
// Markets CONSTRUCTOR was given) and only falls back to the pinned one below — which is what
// `evidence/day0-markets-launch-checks.json` measured, and what the deploy will use.
//
// ── THE PURE HALF LIVES IN `pragma-pairs.ts` AND IS RE-EXPORTED HERE ─────────────────────
//
// Everything that does not touch the chain — the pair ids, the decode, the staleness rule, the
// formatter — is in that module, so a component that formats a number does not pull `starknet`
// into its chunk. See its header; the build gate is what found the need for the split.
//
import { withFallback } from './rpc.js'
import { PRAGMA_PAIRS, PRAGMA_PAIR_LIST, medianFrom } from './pragma-pairs.js'
import type { PragmaPair, PragmaPrice, PragmaReading } from './pragma-pairs.js'

export {
  PRAGMA_PAIRS,
  PRAGMA_PAIR_LIST,
  STALE_AFTER_SECONDS,
  ageSeconds,
  formatPrice,
  isStale,
  medianFrom,
  type PragmaPair,
  type PragmaPrice,
  type PragmaReading,
} from './pragma-pairs.js'

/**
 * Pragma's mainnet oracle, as `evidence/day0-markets-launch-checks.json` pinned it.
 *
 * A FALLBACK, NOT A CONSTANT. `app-contracts.ts` explains the rule: a deployed address is a fact
 * about one deployment, not a protocol constant. Callers pass the deployment's `pragma` once there
 * is one; this is what answers before then, so the price strip works on a machine that has never
 * run the deploy script.
 */
export const PRAGMA_MAINNET = '0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b'

/**
 * The `DataType` discriminant for a spot pair.
 *
 * Pragma's `DataType` is an enum whose first variant is `SpotEntry(pair_id)`, so the calldata is
 * `[0, pairId]` — the variant index and its payload. Future and option entries are variants 1 and 2
 * and take more felts; this module does spot only, which is what the markets resolve against.
 */
export const SPOT_ENTRY = '0x0'

/**
 * Read one pair's median.
 *
 * `oracle` defaults to the pinned mainnet address so this works before any deployment exists; pass
 * the deployment's own `pragma` once there is one, so the chart and the settlement read the same
 * contract.
 */
export async function readMedian(
  pair: PragmaPair,
  oracle: string = PRAGMA_MAINNET,
): Promise<PragmaPrice> {
  const result = await withFallback((p) =>
    p.callContract({
      contractAddress: oracle,
      entrypoint: 'get_data_median',
      calldata: [SPOT_ENTRY, PRAGMA_PAIRS[pair]],
    }),
  )
  return medianFrom(pair, result)
}

/**
 * Read every pair at once.
 *
 * `allSettled`, not `all`: one pair the oracle has stopped carrying must not blank the other two.
 * A strip showing two live prices and one honest gap is strictly better than three blanks, and it
 * is the same fail-per-item rule the balance walk keeps.
 */
export async function readAllMedians(
  oracle: string = PRAGMA_MAINNET,
  pairs: readonly PragmaPair[] = PRAGMA_PAIR_LIST,
): Promise<PragmaReading[]> {
  const settled = await Promise.allSettled(pairs.map((pair) => readMedian(pair, oracle)))
  return settled.map((outcome, index) => {
    const pair = pairs[index]!
    return outcome.status === 'fulfilled'
      ? { ok: true, price: outcome.value }
      : { ok: false, pair, because: String(outcome.reason) }
  })
}
