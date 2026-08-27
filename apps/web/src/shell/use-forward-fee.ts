//
// The live crossing fee, debounced and race-safe.
//
// Structurally `use-quote.ts` and deliberately so — same debounce, same liveness token, same
// "keep the previous answer while a new one is in flight" rule, because the two failures it exists
// to not have are the same two: a request per keystroke, and a slow early answer landing after a
// fast later one and overwriting the right number with a stale one.
//
// ── WHAT IS DIFFERENT IS WHY THE NUMBER MATTERS ──────────────────────────────────────────
//
// A stale swap quote shows a price that is slightly wrong. A stale bridge fee decides how much
// USDC arrives at an address on another chain, and `feeExecuted == max_fee` on every observed
// message — so the fee is not an estimate that settles later, it is the exact amount deducted.
// `stale` is surfaced for the same reason it is on a quote, and the review step re-reads it.
//
import { useEffect, useState } from 'react'
import { fetchForwardFee, type ForwardFeeResult } from '@strk20/protocol/bridge'

/** Long enough to skip the middle of a typed number, short enough to feel immediate. */
const DEBOUNCE_MS = 350

export interface ForwardFeeState {
  result: ForwardFeeResult | null
  /** A request is in flight. `result` may still hold the previous, now-stale, answer. */
  loading: boolean
  /** `result` is a real quote, but for an older amount or a different chain. */
  stale: boolean
}

export function useForwardFee(input: {
  destinationDomain: number | null
  amount: bigint | null
}): ForwardFeeState {
  const [state, setState] = useState<ForwardFeeState>({
    result: null,
    loading: false,
    stale: false,
  })

  const { destinationDomain, amount } = input

  useEffect(() => {
    if (destinationDomain === null || amount === null || amount <= 0n) {
      setState({ result: null, loading: false, stale: false })
      return
    }

    let live = true
    setState((previous) => ({ ...previous, loading: true, stale: previous.result !== null }))

    const timer = window.setTimeout(() => {
      void fetchForwardFee({ destinationDomain, amount }).then((result) => {
        if (!live) return
        setState({ result, loading: false, stale: false })
      })
    }, DEBOUNCE_MS)

    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [destinationDomain, amount])

  return state
}
