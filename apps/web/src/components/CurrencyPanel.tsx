//
// One half of a swap form (Uniswap `SwapFormCurrencyInputPanel` + `CurrencyInputPanel` are the model).
//
// ── THE FOCUS INVERSION IS THE CHARACTERISTIC DETAIL ──────────────────────────────────────
//
// At rest the panel is a FILLED well with no border. Focused, it becomes the RAISED surface with a
// visible edge. Uniswap's `useCurrencyInputFocusedStyle` is exactly this and it is worth copying
// precisely, because it does something a border-colour change cannot: the active panel appears to
// come forward, so on a two-panel form there is never a question about which one a keystroke goes
// to. Our tokens map one-for-one — `inset` at rest, `raised` focused, `surface3` edge.
//
// ── AND THE FIGURE SHRINKS INSTEAD OF WRAPPING ────────────────────────────────────────────
//
// 36px down to 24px as the number lengthens, line-height locked to 1.2. A money field that wraps or
// ellipsises has stopped being a money field; shrinking is the only behaviour that keeps the whole
// value visible without moving anything around it.
//
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AMOUNT_LINE_RATIO, fitAmountFontPx } from '@strk20/protocol/amount'
import type { TokenInfo } from '@strk20/protocol/token-list'

import { cn } from '../lib/cn'
import { Text } from './ui/Text'
import { TokenLogo } from './TokenLogo'

//
// THE FIGURE'S SIZE IS `amount.ts`'s JOB, NOT THIS FILE'S.
//
// The first version of this panel estimated it from a character count. That was a second, worse
// copy of something the protocol package already owns and tests: `fitAmountFontPx` measures the
// text against the container's REAL width using a deliberately wide per-digit advance, so an
// 18-decimal amount cannot overflow — and its own header explains why an unmeasurable width returns
// the CEILING rather than the floor (returning the floor paints 24px for one frame on an empty
// field and then jumps, which is a layout shift invented by the guard meant to prevent one).
//
// The ceiling and floor are 36 and 24, which are the same numbers Uniswap uses. That is the design
// authority and the reference agreeing, not a coincidence worth re-deriving here.
//

export interface CurrencyPanelProps {
  /** "Sell" / "Buy" / "Amount". Sits above the figure at 12px. */
  label: string
  value: string
  onValueChange?: (next: string) => void
  /** A quoted output panel is not typed into. Renders the same, refuses input. */
  readOnly?: boolean
  token: TokenInfo | null
  onSelectToken: () => void
  /** e.g. `"Balance: 12.40"`. Rendered bottom-left at 12px, or a reserved blank. */
  balanceLabel?: string | null
  /** Pressing it should fill the field. Rendered only when supplied — never a no-op. */
  onMax?: () => void
  /** Corner radius pairing, so two panels can be welded into one card. */
  corners?: 'all' | 'top' | 'bottom'
  /** Turns the figure red — an insufficient balance, not a validation error. */
  invalid?: boolean
  /** Merged last, so a caller can adjust the panel without forking it. */
  className?: string
  children?: ReactNode
}

export function CurrencyPanel({
  label,
  value,
  onValueChange,
  readOnly = false,
  token,
  onSelectToken,
  balanceLabel = null,
  onMax,
  corners = 'all',
  invalid = false,
  className,
  children,
}: CurrencyPanelProps) {
  const [focused, setFocused] = useState(false)

  // The real available width, observed. `fitAmountFontPx` needs a measurement, not a guess — and
  // before the observer first fires it correctly returns the ceiling for an empty field.
  const fieldRef = useRef<HTMLDivElement>(null)
  const [availablePx, setAvailablePx] = useState(0)

  useEffect(() => {
    const element = fieldRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setAvailablePx(entry.contentRect.width)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const fontSize = useMemo(() => fitAmountFontPx(value, availablePx), [value, availablePx])

  return (
    <div
      className={cn(
        'flex flex-col gap-s8 border border-solid p-s16',
        corners === 'all' && 'rounded-large',
        corners === 'top' && 'rounded-t-large',
        corners === 'bottom' && 'rounded-b-large',
        // THE INVERSION. Resting panel is the well; focused panel comes forward and shows its edge.
        focused ? 'border-surface3 bg-raised' : 'border-transparent bg-inset',
        className,
      )}
    >
      <Text variant="body4" className="text-neutral2">
        {label}
      </Text>

      <div className="flex items-center gap-s12">
        <div ref={fieldRef} className="min-w-0 flex-1">
          <input
            // `inputMode="decimal"` summons the numeric keypad on a phone without the spinner and
            // locale parsing that `type="number"` drags in — the latter also silently rejects
            // values it dislikes, which on a money field means the user's keystroke vanishes.
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={value}
            readOnly={readOnly}
            aria-label={`${label} amount`}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            // RAW, straight through. Sanitising here would be a second parser competing with
            // `parseAmountInput`, which already handles the comma-as-separator case, the second
            // decimal point, and the two pastes that silently change a value's meaning (`1e5`,
            // `-1.5`). The owner of this panel runs that and hands back what it returned.
            onChange={(event) => onValueChange?.(event.target.value)}
            className={cn(
              'numeric w-full bg-transparent font-medium outline-none',
              'placeholder:text-neutral3',
              invalid ? 'text-irreversible' : 'text-neutral1',
            )}
            style={{ fontSize, lineHeight: AMOUNT_LINE_RATIO }}
          />
        </div>

        <TokenPill token={token} onPress={onSelectToken} />
      </div>

      {/*
        RESERVED WHETHER OR NOT THERE IS A BALANCE. Uniswap reserves this row's height for the same
        reason: a line that appears when a balance arrives shifts the panel below it, and on a
        two-panel form that moves the button the user was reaching for.
      */}
      <div className="flex min-h-s20 items-center justify-between gap-s8">
        <Text variant="body4" className="text-neutral2">
          {balanceLabel ?? ' '}
        </Text>
        {onMax ? (
          <button
            type="button"
            onClick={onMax}
            className="focus-ring rounded-badge px-s6 text-buttonLabel4 text-accent1 hover:bg-accent2"
          >
            Max
          </button>
        ) : null}
      </div>

      {children}
    </div>
  )
}

/**
 * The token trigger. 36px tall, fully round, logo pulled left so the mark reads as part of the pill.
 *
 * Empty state is a FILLED accent pill saying "Select asset" — Uniswap's, and the reason is that an
 * outlined empty trigger looks disabled next to a filled one, which is backwards: choosing the
 * asset is the most important thing an empty form needs.
 */
function TokenPill({ token, onPress }: { token: TokenInfo | null; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        'focus-ring flex min-h-s36 shrink-0 items-center gap-s6 rounded-pill px-s12',
        'transition-colors duration-[var(--transition-duration-simple)] active:scale-[0.98]',
        token
          ? 'border border-solid border-surface3 bg-raised text-neutral1 hover:bg-raisedHovered'
          : 'bg-accent1 text-ground hover:bg-accent1Hovered',
      )}
    >
      {token ? (
        <span className="-ml-s8">
          <TokenLogo url={token.logoUri} symbol={token.symbol} name={token.name} size={28} />
        </span>
      ) : null}
      <Text variant="buttonLabel2">{token ? token.symbol : 'Select asset'}</Text>
      <ChevronDown />
    </button>
  )
}

/** 20px chevron, `currentColor` so it follows the pill's own text colour in both states. */
function ChevronDown() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="-mr-s2">
      <path
        d="M6 9L12 15L18 9"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
