//
// Serialising a route into the pool's invoke calldata (story: swap).
//
// ── THE LAYOUT ────────────────────────────────────────────────────────────────────────────
//
// The pool's `InvokeExternal` action calls `privacy_invoke(buy_token, calls, note_id)` on the
// executor. Flattened, that is:
//
//   [ buy_token, num_calls, (to, selector, calldata_len, ...calldata)*, note_id ]
//
// The middle is Cairo 1's `Span<Call>` serialisation — what `starknet.js` calls
// `fromCallsToExecuteCalldata_cairo1`, and what the sponsor's own demo uses.
//
// ── WHY THIS FILE REIMPLEMENTS IT RATHER THAN IMPORTING IT ────────────────────────────────
//
// `starknet.js` is banned from every emitted chunk (`build-web.mjs`'s `poseidon` scan), and this
// runs in the browser. The serialisation itself is four lines of array concatenation; the only part
// that genuinely needs the library is turning an entrypoint NAME into its selector, which is a
// keccak.
//
// ── SO THE SELECTORS ARE A CLOSED, PINNED SET — AND THAT IS A SAFETY PROPERTY ─────────────
//
// Rather than hashing at runtime, this file knows a fixed list of entrypoints and refuses anything
// else. That is stricter than the demo and deliberately so: these calls are executed against a
// contract holding real withdrawn funds, and the venue supplies them over HTTP. A route that comes
// back naming an entrypoint we have never verified is a route we do not execute — the failure mode
// of refusing is a swap that does not happen, and the failure mode of trusting is a swap that does
// something we did not read.
//
// Every selector below is pinned in `swap-calldata.test.ts` against `starknet.js`'s own hasher,
// which runs in Node where the library costs nothing. Same device as `crowd-rpc.ts`'s event key.
//
import type { SwapCall } from './quote.js'

/**
 * Entrypoint name → selector, for the calls an AVNU private route is made of.
 *
 * `approve` lets the executor hand the sell token to the Exchange; `multi_route_swap` is the swap
 * itself. Measured live: a STRK→USDC route came back as exactly these two, in this order.
 */
export const KNOWN_SELECTORS: Readonly<Record<string, string>> = {
  approve: '0x219209e083275171774dab1df80982e9df2096516f06319c5c6d71ae0a8480c',
  multi_route_swap: '0x1171593aa5bdadda4d6b0efde6cc94ee7649c3163d5efeb19da6c16d63a2a63',
}

export type CalldataResult =
  | { readonly state: 'ready'; readonly calldata: readonly string[] }
  /** Something in the route is not a shape we will execute. `because` is safe to show. */
  | { readonly state: 'refused'; readonly because: string }

/** A felt, as the chain wants it: `0x`-prefixed lowercase hex, no leading zeros beyond one. */
function felt(value: bigint | string): string | null {
  try {
    return `0x${BigInt(value).toString(16)}`
  } catch {
    return null
  }
}

/**
 * Build the calldata for `privacy_invoke`.
 *
 * ── EVERY FELT IS NORMALISED, AND THAT IS NOT COSMETIC ────────────────────────────────────
 *
 * The venue returns decimal strings for some fields and hex for others. The chain reads felts, and
 * a decimal string that happens to look like hex (`"1000"`) means two different numbers depending
 * on which the reader assumes. Everything goes through `BigInt` once, here, so there is exactly one
 * interpretation.
 *
 * REFUSES rather than throws: a swap surface calls this while someone is standing on it.
 */
export function invokeCalldata(input: {
  buyToken: string
  calls: readonly SwapCall[]
  openNoteId: string
}): CalldataResult {
  const buyToken = felt(input.buyToken)
  if (buyToken === null) return { state: 'refused', because: 'The buy token is not an address.' }

  const openNoteId = felt(input.openNoteId)
  if (openNoteId === null) return { state: 'refused', because: 'The open note has no usable id.' }

  if (input.calls.length === 0) {
    return { state: 'refused', because: 'The route contained no calls, so there was nothing to do.' }
  }

  const flattened: string[] = [buyToken, `0x${input.calls.length.toString(16)}`]

  for (const call of input.calls) {
    const selector = KNOWN_SELECTORS[call.entrypoint]
    if (selector === undefined) {
      // THE REFUSAL THAT MATTERS. See the header: an unverified entrypoint against a contract
      // holding withdrawn funds is not something to guess at.
      return {
        state: 'refused',
        because: `The route wants to call \`${call.entrypoint}\`, which this app has not verified. It was refused rather than executed.`,
      }
    }

    const to = felt(call.contractAddress)
    if (to === null) {
      return { state: 'refused', because: 'The route named a contract that is not an address.' }
    }

    const calldata: string[] = []
    for (const raw of call.calldata) {
      const value = felt(raw)
      if (value === null) {
        return { state: 'refused', because: 'The route carried a value that is not a number.' }
      }
      calldata.push(value)
    }

    flattened.push(to, selector, `0x${calldata.length.toString(16)}`, ...calldata)
  }

  flattened.push(openNoteId)
  return { state: 'ready', calldata: flattened }
}
