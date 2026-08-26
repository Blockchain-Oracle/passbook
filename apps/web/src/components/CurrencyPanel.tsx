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
import { useMemo, useState, type ReactNode } from 'react'
import type { TokenInfo } from '@strk20/protocol/token-list'

import { cn } from '../lib/cn'
import { Text } from './ui/Text'
import { TokenLogo } from './TokenLogo'

/** Uniswap's numbers: start at 36, never go below 24, line-height always 1.2x. */
const MAX_FONT_PX = 36
const MIN_FONT_PX = 24
/** Characters past which the figure starts shrinking. Tuned to the 480px column. */
const COMFORTABLE_CHARS = 9

function fontSizeFor(text: string): number {
  const length = Math.max(text.length, 1)
  if (length <= COMFORTABLE_CHARS) return MAX_FONT_PX
  const shrunk = Math.round((MAX_FONT_PX * COMFORTABLE_CHARS) / length)
  return Math.max(MIN_FONT_PX, shrunk)
}

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
  children,
}: CurrencyPanelProps) {
  const [focused, setFocused] = useState(false)
  const fontSize = useMemo(() => fontSizeFor(value || '0'), [value])

  return (
    <div
      className={cn(
        'flex flex-col gap-s8 border border-solid p-s16',
        corners === 'all' && 'rounded-large',
        corners === 'top' && 'rounded-t-large',
        corners === 'bottom' && 'rounded-b-large',
        // THE INVERSION. Resting panel is the well; focused panel comes forward and shows its edge.
        focused ? 'border-surface3 bg-raised' : 'border-transparent bg-inset',
      )}
    >
      <Text variant="body4" className="text-neutral2">
        {label}
      </Text>

      <div className="flex items-center gap-s12">
        <input
          // `inputMode="decimal"` summons the numeric keypad on a phone without the spinner and
          // locale parsing that `type="number"` drags in — the latter also silently rejects values
          // it dislikes, which on a money field means the user's keystroke vanishes.
          inputMode="decimal"
          autoComplete="off"
          placeholder="0"
          value={value}
          readOnly={readOnly}
          aria-label={`${label} amount`}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(event) => {
            // Digits and one separator. Filtering here rather than validating later is what stops
            // a stray letter reaching the amount parser at all.
            const next = event.target.value.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
            onValueChange?.(next)
          }}
          className={cn(
            'numeric min-w-0 flex-1 bg-transparent font-medium outline-none',
            'placeholder:text-neutral3',
            invalid ? 'text-irreversible' : 'text-neutral1',
          )}
          style={{ fontSize, lineHeight: 1.2 }}
        />

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
