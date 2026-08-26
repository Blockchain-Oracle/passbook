//
// The amount input (DESIGN §7.1) — the spine, built first.
//
// Swap, Bridge, Markets stake and Launch buy all need this and all need it to behave identically.
// Whichever of them shipped first would otherwise have invented the vocabulary the other three
// copied, and by then the differences would be in three codebases' worth of muscle memory.
//
// ── THE ROW CANNOT SHIFT, AND THE PROOF IS IN THE STYLESHEET ──────────────────────────────
//
// Every height in here is reserved in `index.css` before there is content to fill it: `.amount-row`
// carries a `min-height` larger than the tallest line the field can produce, and `.amount-balance`
// is mounted from first paint at `opacity: 0` rather than rendered conditionally. Nothing in this
// component adds or removes a box — the insufficient state changes ink, the fit changes font size
// inside an already-reserved line, and the balance line changes opacity. `build:web` reads those two
// declarations back out of the emitted artifact and fails by name if either goes.
//
// ── THE ONE INLINE STYLE, AND WHY IT IS ALLOWED TO BE ONE ─────────────────────────────────
//
// Font size is continuous between two token-derived endpoints (36 → 24). There is no utility that
// can express "somewhere between these two, depending on how much you typed", and a token for it
// would be a token with infinitely many values. Everything else in this file is on-sheet.
//
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import {
  AMOUNT_LINE_RATIO,
  fitAmountFontPx,
  insufficient,
  isUnchangedRefetch,
  parseAmountInput,
  toPlainText,
} from '@strk20/protocol/amount'
import type { ParsedAmount, Valued } from '@strk20/protocol/amount'

import { confidenceClass } from './OptionRow'

/** The additive chips §7.1 specifies. They ADD; they are not presets, and nothing is pre-filled. */
export const DEFAULT_CHIPS = [1, 5, 20] as const

export interface AmountField extends ParsedAmount {
  /** True only when the entered amount exceeds a KNOWN balance. See `insufficient`. */
  short: boolean
  setText: (raw: string) => void
  /** Adds whole units to whatever is already there. A no-op when the token's scale is unverified. */
  add: (whole: number) => void
}

/**
 * Owns the parse, so a surface cannot get it wrong on its way to the same answer.
 *
 * The surface still gets `wei` back, because its blocker chain needs the number — but it never
 * decides what counts as a valid amount or what counts as short, and those two decisions are where
 * four surfaces would otherwise drift apart.
 */
export function useAmountField({
  decimals,
  available,
}: {
  decimals: number | null
  available: bigint | null
}): AmountField {
  const [text, setTextState] = useState('')

  const parsed = useMemo(() => parseAmountInput(text, decimals), [text, decimals])

  const setText = useCallback((raw: string) => {
    // Sanitizing on the way IN, not on the way out: the field shows exactly what the parser
    // accepted, so what is on screen and what will be submitted are the same string.
    setTextState(parseAmountInput(raw, null).text)
  }, [])

  const add = useCallback(
    (whole: number) => {
      // `BigInt(1.5)` throws a bare RangeError from inside a click handler, which React turns into
      // an unmounted surface. A chip amount comes from a caller's prop, so it is not this
      // component's to trust.
      if (decimals === null || !Number.isInteger(whole)) return
      // REFUSES RATHER THAN DISCARDING. `parsed.wei` is null whenever the typed text has a problem
      // — too many decimal places, say — and `?? 0n` silently threw the user's entry away and
      // replaced it with the chip's own amount. Adding to a number we could not read is not
      // something to guess at; the field keeps what was typed and the problem keeps saying why.
      if (parsed.wei === null && parsed.text !== '') return
      const base = 10n ** BigInt(decimals)
      setTextState(toPlainText((parsed.wei ?? 0n) + BigInt(whole) * base, decimals))
    },
    [decimals, parsed.wei, parsed.text],
  )

  return { ...parsed, short: insufficient(parsed.wei, available), setText, add }
}

export interface AmountInputProps {
  field: AmountField
  /** The token's symbol. One of the three elements that change ink when the balance is short. */
  symbol: string
  /**
   * The balance line, carrying its own confidence. `null` leaves the reserved line empty rather
   * than removing it — removing it is the shift this component exists to not have.
   */
  balance: Valued<string> | null
  /** The accessible name of the field. */
  label: string
  chips?: readonly number[]
}

export function AmountInput({ field, symbol, balance, label, chips = DEFAULT_CHIPS }: AmountInputProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [width, setWidth] = useState(0)
  const [pulses, setPulses] = useState(0)
  const previousBalance = useRef<Valued<string> | null>(null)
  const inputId = useId()

  // A refetch that came back the same still happened, and the user is entitled to see that it did.
  // The predicate is `isUnchangedRefetch` rather than a condition written out here, because what
  // counts as a refetch is genuinely subtle (see its comment) and it is worth being able to test.
  useEffect(() => {
    const previous = previousBalance.current
    previousBalance.current = balance
    if (isUnchangedRefetch(previous, balance)) setPulses((n) => n + 1)
  }, [balance])

  // The only measurement in the component. It observes the INPUT rather than the row, because the
  // input's width is what the text has to fit inside — and with `flex-basis: 0` that width is a
  // function of the row and the symbol only, never of the text, so this cannot feed back on itself.
  useEffect(() => {
    const element = inputRef.current
    // The `typeof` guard is for the browser floor, not for tests: `ResizeObserver` is absent below
    // Safari 13.1, and a bare `new` on an undefined constructor throws during mount and takes the
    // whole surface with it. Without an observer the width stays 0 and `fitAmountFontPx` returns
    // the ceiling — a field that does not shrink, rather than a page that does not render.
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const size = fitAmountFontPx(field.text, width)
  const shortInk = field.short ? ' amount-short' : ''

  // Short ink WINS over confidence ink. Both want the same text, and "you do not have this much" is
  // the more urgent of the two things a balance line can say — the alternative renders a shortfall
  // in the faint not-yet-real grey, which reads as though the number itself were provisional.
  const balanceInk = field.short
    ? 'amount-short'
    : balance
      ? confidenceClass(balance.confidence)
      : ''

  return (
    <div className="amount-field">
      <div className="amount-row">
        <input
          id={inputId}
          ref={inputRef}
          className={`amount-value${shortInk}`}
          style={{ fontSize: `${size}px`, lineHeight: `${size * AMOUNT_LINE_RATIO}px` }}
          // `decimal` rather than `numeric`: the phone keypad needs a decimal separator on it, and
          // `type="number"` is not an option — it silently drops values past float precision, which
          // for an 18-decimal token is most of them.
          inputMode="decimal"
          type="text"
          autoComplete="off"
          aria-label={label}
          // Never pre-filled (§7.1). The placeholder is what shows the field's shape.
          placeholder="0"
          value={field.text}
          onChange={(event) => field.setText(event.target.value)}
        />
        <span className={`amount-symbol${shortInk}`}>{symbol}</span>
      </div>

      {/*
        ALWAYS MOUNTED. `data-shown` fades it in; it never enters or leaves the layout. When the
        balance is short this line takes the irreversible ink too — three elements change colour and
        nothing changes size, which is the whole of the insufficient-balance treatment. No banner
        appears, because a banner is a box, and a box is a shift.
      */}
      <p className={`amount-balance ${balanceInk}`} data-shown={balance ? '' : undefined}>
        {/*
          THE PULSE RESTARTS BY REMOUNTING THIS SPAN, and the span exists for that alone.

          A boolean `pulsing` flag cannot express two refetches in a row: re-adding an animation
          class that is already present does nothing, so a second read landing inside the first
          500ms produced no feedback at all — precisely the "the read happened and the user is
          entitled to see it" case the pulse was built for. Clearing on `animationend` had a worse
          failure: in a background tab the event never fires and the flag latches on forever.

          Keying on a counter sidesteps both. The RESERVED `<p>` above never unmounts — it is the
          box that must never leave the layout — while this inner span, which occupies no space of
          its own, remounts freely and starts its animation from zero every time.
        */}
        <span key={pulses} className={pulses > 0 ? 'pulse' : undefined}>
          {balance?.value ?? ''}
        </span>
      </p>

      {chips.length > 0 ? (
        <div className="flex flex-wrap gap-s8">
          {chips.map((amount) => (
            <button
              key={amount}
              type="button"
              className="amount-chip focus-ring"
              // Named for what it does to the value, not for the value itself: "5" alone reads as
              // "set to 5" and these are additive.
              aria-label={`Add ${amount} ${symbol}`}
              onClick={() => field.add(amount)}
            >
              {`+${amount}`}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
