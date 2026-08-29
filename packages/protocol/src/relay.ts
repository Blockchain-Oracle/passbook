//
// The relay hop and the confirm leg, shared by registration and shield.
//
// Two facts shape everything here. A request that MAY have reached the relayer must never be
// reported as a clean refusal (the retry it invites reverts NON_ZERO_VALUE or double-spends).
// And a `waitForTransaction` that resolves is not a success: starknet.js decides on finality, a
// reverted transaction reaches ACCEPTED_ON_L2 like any other, and only the receipt records it.
//

import { RELAYER_PATHS, type SubmitBody, type SubmitResponseBody } from './relayer-wire.js'
import { withFallback } from './rpc.js'

/** The relayer endpoint, relative: the same-origin proxy carries `x-relayer-auth`. */
export const DEFAULT_RELAYER_URL = RELAYER_PATHS.submit

/** The relay hop runs under the submit lock; a hung socket must not park it forever. */
export const RELAY_TIMEOUT_MS = 60_000

/** A budget for WATCHING the chain, not for the transaction. Expiry means "we stopped looking". */
export const CONFIRM_TIMEOUT_MS = 300_000

/** Swappable so deadline paths are exercisable without waiting five real minutes. */
export interface DeadlineTimer {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export const REAL_TIMER: DeadlineTimer = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

/** Rejects if `work` has not settled within `ms`. The work is NOT cancelled — nothing cancels a chain. */
export async function withDeadline<T>(work: Promise<T>, ms: number, timer: DeadlineTimer = REAL_TIMER): Promise<T> {
  let handle: unknown
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        handle = timer.setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    // An unfired timer keeps Node alive for the whole window after a fast success.
    if (handle !== undefined) timer.clearTimeout(handle)
  }
}

/** Thrown by the relay leg when the request MAY have reached the relayer. */
export class RelayDeliveryUnknown extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'RelayDeliveryUnknown'
  }
}

/** The chain executed the transaction and the pool rolled it back — the one definitive "did not happen". */
export class RegistrationReverted extends Error {
  constructor(readonly revertReason: string) {
    super(revertReason)
    this.name = 'RegistrationReverted'
  }
}

/** What the relayer answered. `body` is parsed JSON whatever the status. */
export interface RelayResponse {
  status: number
  body: SubmitResponseBody
  /** A status line without a readable body. On a 200 a transaction exists and its hash is lost. */
  bodyUnreadable?: boolean
}

// A short allowlist: anything unclassified falls through to "may have been delivered".
function isPreSendFailure(e: unknown): boolean {
  const code = (e as { cause?: { code?: string } })?.cause?.code ?? (e as { code?: string })?.code
  return code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN'
}

/** POSTs a submission. Pre-send failures rethrow as-is (retry is free); anything else is `RelayDeliveryUnknown`. */
export async function postSubmitToRelayer(
  url: string,
  body: SubmitBody,
  timeoutMs: number = RELAY_TIMEOUT_MS,
): Promise<RelayResponse> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (e) {
    if (isPreSendFailure(e)) throw e
    throw new RelayDeliveryUnknown(`the relayer did not answer (${String(e)}); a transaction may already be in flight`)
  }

  let parsed: SubmitResponseBody = {}
  let bodyUnreadable = false
  try {
    // `?? {}`: a body of the four bytes `null` parses to null, not to a failure.
    parsed = ((await res.json()) as SubmitResponseBody | null) ?? {}
  } catch {
    bodyUnreadable = true
  }
  return { status: res.status, body: parsed, bodyUnreadable }
}

// ── Receipts ──────────────────────────────────────────────────────────────────────────────

/** Throws `RegistrationReverted` off the loose receipt shape — `errorStates` would drop the reason. */
export function assertNotReverted(receipt: unknown): void {
  const r = (receipt ?? {}) as { execution_status?: unknown; revert_reason?: unknown }
  if (r.execution_status === 'REVERTED') {
    throw new RegistrationReverted(
      typeof r.revert_reason === 'string' && r.revert_reason
        ? r.revert_reason
        : 'the pool reverted this registration and the receipt carried no reason',
    )
  }
}

/** The one rule for a block number. Anything else is `null`, never a guess. */
export function sanitizeBlockNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** Both spellings: the wire says `block_number`; an injected receipt may say `blockNumber`. */
export function readReceiptBlockNumber(receipt: unknown): number | null {
  const r = (receipt ?? {}) as { block_number?: unknown; blockNumber?: unknown }
  return sanitizeBlockNumber(r.block_number) ?? sanitizeBlockNumber(r.blockNumber)
}

/** Revert check FIRST — a reverted transaction still lands in a block. */
export function confirmFromReceipt(receipt: unknown): number | null {
  assertNotReverted(receipt)
  return readReceiptBlockNumber(receipt)
}

/** Waits for the chain, then reads the receipt. */
export async function confirmOnChain(transactionHash: string): Promise<number | null> {
  return confirmFromReceipt(await withFallback((p) => p.waitForTransaction(transactionHash)))
}

export type { SubmitBody, SubmitResponseBody }
