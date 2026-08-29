//
// Reading the recent crowd over plain JSON-RPC: `fetch`, two RPC methods, no crypto. The bounded
// reader in `pool-events.ts` is better (paging, host-pinned continuations) but imports `starknet`,
// which a surface must not load. The event selector is a deterministic hash of a fixed string, so
// it is duplicated as a constant. One request, no paging: a partial answer is a FLOOR and the
// meter's grammar is exact integers, so a truncated response is reported as unmeasurable.
//
import { NET } from './constants.js'
import type { CrowdReading } from './crowd.js'
import { INDEXER_UNREACHABLE } from './linkability-copy.js'

/** `keys[0]` for the pool's `Deposit` event — `poolEventSelector('Deposit')`, duplicated on purpose. */
export const DEPOSIT_EVENT_KEY = '0x9149d2123147c5f43d258257fef0b7b969db78269369ebcf5ebb9eef8592f2'

/**
 * How far back to look, and how many sub-windows the range splits into.
 *
 * READ BOUNDS, NOT THRESHOLDS. Nothing here decides whether a crowd is big enough — that is
 * `boundaryFor`'s job and it derives it from whatever these produce. Six buckets clears
 * `MIN_QUARTILE_SAMPLE` with room to spare, and the product stays inside one RPC chunk so a normal
 * read comes back whole and the count is exact.
 */
const DEFAULT_BLOCKS = 6_000
const DEFAULT_BUCKETS = 6
const CHUNK = 1_000

export interface CrowdRpcOptions {
  blocks?: number
  buckets?: number
  /** Test seam: the JSON-RPC transport. Defaults to `fetch` against the active network. */
  call?: (method: string, params: unknown) => Promise<unknown>
}

/** One JSON-RPC round trip, against each configured host in turn. */
async function rpc(method: string, params: unknown): Promise<unknown> {
  let last: unknown
  for (const nodeUrl of NET.rpc) {
    try {
      const response = await fetch(nodeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
      if (!response.ok) throw new Error(`${nodeUrl} answered ${response.status}`)
      const body = (await response.json()) as { result?: unknown; error?: unknown }
      if (body.error) throw new Error(`${nodeUrl} returned an error: ${JSON.stringify(body.error)}`)
      return body.result
    } catch (error) {
      last = error
    }
  }
  throw new Error(`all RPC hosts failed: ${String(last)}`)
}

/** The depositor's address, which the contract emits as `keys[1]` beside the event selector. */
function depositorOf(event: unknown): string | null {
  const keys = (event as { keys?: unknown })?.keys
  if (!Array.isArray(keys) || typeof keys[1] !== 'string') return null
  try {
    // Normalised through `BigInt` so two spellings of one address are one depositor. Counting
    // `0x0a11ce` and `0xa11ce` as two would inflate the exact number the user is asked to trust.
    return BigInt(keys[1]).toString()
  } catch {
    return null
  }
}

function blockOf(event: unknown): number | null {
  const value = (event as { block_number?: unknown })?.block_number
  return typeof value === 'number' && Number.isInteger(value) ? value : null
}

/**
 * Read the recent crowd, or say why it could not be read.
 *
 * NEVER THROWS. A meter is furniture on a review screen, and an exception thrown from furniture
 * takes the review down with it. Every failure path returns the `unmeasurable` arm carrying the
 * SOURCED offline sentence — which is honest here precisely BECAUSE a read was attempted. Printing
 * it without trying would be stating a reason nobody established.
 */
export async function readCrowd(options: CrowdRpcOptions = {}): Promise<CrowdReading> {
  const blocks = options.blocks ?? DEFAULT_BLOCKS
  const buckets = options.buckets ?? DEFAULT_BUCKETS
  const call = options.call ?? rpc

  try {
    const head = await call('starknet_blockNumber', [])
    if (typeof head !== 'number' || !Number.isInteger(head)) {
      return { state: 'unmeasurable', because: INDEXER_UNREACHABLE }
    }

    const span = Math.max(1, Math.floor(blocks / buckets))
    const fromBlock = Math.max(0, head - blocks)

    const page = (await call('starknet_getEvents', [
      {
        from_block: { block_number: fromBlock },
        to_block: { block_number: head },
        address: NET.pool,
        // ONE inner array with ONE key. An EMPTY inner array is starknet's match-anything wildcard,
        // which would turn this bounded question into a request for every event the pool ever
        // emitted — the hazard `pool-events.ts` refuses an empty name list over.
        keys: [[DEPOSIT_EVENT_KEY]],
        chunk_size: CHUNK,
      },
    ])) as { events?: unknown[]; continuation_token?: string } | null

    if (!page || !Array.isArray(page.events)) {
      return { state: 'unmeasurable', because: INDEXER_UNREACHABLE }
    }

    // A TRUNCATED ANSWER IS A FLOOR, NOT A COUNT. Rendered as a count it understates the crowd, and
    // understating a crowd understates the user's privacy in a way they cannot detect.
    if (page.continuation_token) return { state: 'unmeasurable', because: INDEXER_UNREACHABLE }

    const perBucket: Array<Set<string>> = Array.from({ length: buckets }, () => new Set<string>())

    for (const event of page.events) {
      // ONE UNREADABLE EVENT COSTS ITS OWN ROW, NEVER THE WHOLE READING — the trade
      // `activity.ts:419-423` makes, for the same reason.
      const depositor = depositorOf(event)
      const block = blockOf(event)
      if (depositor === null || block === null) continue
      const index = Math.min(buckets - 1, Math.floor((block - fromBlock) / span))
      if (index < 0) continue
      perBucket[index]!.add(depositor)
    }

    const distribution = perBucket.map((set) => set.size)

    return {
      state: 'measured',
      // THE MOST RECENT BUCKET, so the count and the sample it is judged against share a unit.
      // Counting distinct depositors over the whole range and comparing that against per-bucket
      // numbers would put every reading above its own boundary and report every crowd healthy.
      candidates: distribution[buckets - 1] ?? 0,
      // COUNTED IN BLOCKS, NEVER IN HOURS. The authored example says "the last 24 hours", but hours
      // from a block height means assuming a block time: counted in blocks, never in time.
      window: `the last ${span.toLocaleString('en-US')} blocks`,
      blockNumber: head,
      // The maximum inside a 6,000-block window is not the largest crossing the pool has EVER
      // carried, and the authored sentence says ever. So the amount axis stays silent and Tier 2
      // is unreachable from a client read, by construction.
      largestEverWei: null,
      distribution,
    }
  } catch {
    return { state: 'unmeasurable', because: INDEXER_UNREACHABLE }
  }
}
