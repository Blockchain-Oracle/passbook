//
// The live quote, debounced and race-safe.
//
// ── TWO BUGS THIS FILE EXISTS TO NOT HAVE ─────────────────────────────────────────────────
//
// A QUOTE PER KEYSTROKE. Typing "1000" is four requests, three of which are about amounts the user
// never meant. Debounced, so the venue is asked about what someone stopped typing.
//
// AND THE STALE ANSWER WINNING. Requests do not come back in the order they were sent: ask about
// 1, then 100, and the answer to 1 can land second and overwrite the right price with a wrong one.
// Every effect run carries a token and a late answer whose token is not the current one is dropped.
// This is the classic async-in-effect bug and it is invisible in testing because it needs the slow
// request to be the earlier one.
//
// ── AND WHY THE PREVIOUS QUOTE IS KEPT WHILE A NEW ONE IS IN FLIGHT ───────────────────────
//
// Clearing it would blank the output panel on every keystroke, which flickers the number the user
// is reading. `stale` says the figure on screen is a real quote for a DIFFERENT amount, so the
// surface can dim it rather than erase it — Uniswap's "warm loading" idiom.
//
import { useEffect, useState } from 'react'
import { fetchQuote, type QuoteResult } from '@strk20/protocol/quote'

/** Long enough to skip the middle of a typed number, short enough to feel immediate. */
const DEBOUNCE_MS = 350

export interface QuoteState {
  result: QuoteResult | null
  /** A request is in flight. `result` may still hold the previous, now-stale, answer. */
  loading: boolean
  /** `result` is a real quote, but for an older input. */
  stale: boolean
}

export interface UseQuoteInput {
  sellToken: string | null
  buyToken: string | null
  sellAmount: bigint | null
}

export function useQuote({ sellToken, buyToken, sellAmount }: UseQuoteInput): QuoteState {
  const [state, setState] = useState<QuoteState>({ result: null, loading: false, stale: false })

  useEffect(() => {
    // Nothing to ask about. Clear rather than leave a price for a pair that is no longer selected —
    // a stale price beside a changed pair is the one wrong number nobody would question.
    if (!sellToken || !buyToken || sellAmount === null || sellAmount <= 0n) {
      setState({ result: null, loading: false, stale: false })
      return
    }

    let live = true
    setState((previous) => ({ ...previous, loading: true, stale: previous.result !== null }))

    const timer = window.setTimeout(() => {
      void fetchQuote({ sellToken, buyToken, sellAmount }).then((result) => {
        // The token: this effect run's own closure variable. A late answer from a superseded run
        // has `live === false` and is dropped.
        if (!live) return
        setState({ result, loading: false, stale: false })
      })
    }, DEBOUNCE_MS)

    return () => {
      live = false
      window.clearTimeout(timer)
    }
  }, [sellToken, buyToken, sellAmount])

  return state
}
