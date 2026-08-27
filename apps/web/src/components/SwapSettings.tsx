//
// Slippage (Uniswap `SwapFormSettings` + `TransactionSettingsButton` are the model).
//
// ── THE GEAR ROTATES 90deg ON HOVER, OVER 80ms ────────────────────────────────────────────
//
// Copied precisely because it is the kind of detail that separates a product from a form: the
// control tells you it is a control before you press it. `--transition-duration-simple` IS 80ms on
// this sheet, so the number is the design authority's own and not a second copy of Uniswap's.
//
// ── THE PRESETS COVER THE HONEST CASES; THE FIELD COVERS THE REST ─────────────────────────
//
// This file used to argue there should be NO free-text field, on the grounds that a typed 50% is
// almost always a mistake. The three presets do cover every ordinary swap — but "we did not build
// the input because you might use it wrong" is a product deciding it knows better than the person
// spending the money, and a thin pair on an illiquid token genuinely needs a number that is not one
// of three.
//
// So the field exists, and the safety moved from ABSENCE to REFUSAL: anything outside 0.01%–50% is
// rejected with a sentence, and the presets stay as the one-press path they always were. That is
// strictly more honest than the old position, which relied on `minimumOut` refusing at 100% — a
// backstop the user would only ever meet as an unexplained revert.
//
import { useEffect, useRef, useState } from 'react'
import { parseSlippage, type Bps } from '@strk20/protocol/quote'

import { cn } from '../lib/cn'
import { Text } from './ui/Text'

/** The offered values. 1% is the venue default and the one most swaps want. */
const PRESETS: ReadonlyArray<{ bps: Bps; label: string }> = [
  { bps: 10, label: '0.1%' },
  { bps: 50, label: '0.5%' },
  { bps: 100, label: '1%' },
]

export interface SwapSettingsProps {
  slippageBps: Bps
  onSlippageChange: (bps: Bps) => void
}

export function SwapSettings({ slippageBps, onSlippageChange }: SwapSettingsProps) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Validated as they type, applied on blur. Live validation is what makes the refusal feel like
  // guidance; applying live would rewrite the tolerance on every keystroke of "0.5" — including
  // the instant it reads "0." and means nothing.
  const parsedCustom = custom.trim() === '' ? null : parseSlippage(custom)
  const customProblem = parsedCustom && 'problem' in parsedCustom ? parsedCustom.problem : null

  // A popover that only closes on its own button is a popover that gets left open behind whatever
  // the user does next. Escape and outside-press are both expected of one, and neither is free.
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onPointer = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  const current = PRESETS.find((preset) => preset.bps === slippageBps)

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={`Slippage tolerance, currently ${current?.label ?? `${slippageBps / 100}%`}`}
        className={cn(
          'focus-ring group flex min-h-s32 items-center gap-s4 rounded-pill px-s8',
          'text-neutral2 transition-colors duration-[var(--transition-duration-simple)]',
          'hover:bg-inset hover:text-neutral1',
        )}
      >
        {/* Shown beside the gear only when it is NOT the default — a setting at its default needs
            no label, and one that has been changed must not be silent about it. */}
        {slippageBps !== 100 ? (
          <Text variant="body4" className="numeric">
            {current?.label ?? `${slippageBps / 100}%`}
          </Text>
        ) : null}
        <span
          className={cn(
            'inline-flex transition-transform ease-glide',
            'duration-[var(--transition-duration-simple)] group-hover:rotate-90',
          )}
        >
          <GearIcon />
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Swap settings"
          className={cn(
            'absolute right-0 top-[calc(100%+var(--spacing-s4))] z-[2] w-[240px]',
            'flex flex-col gap-s8 rounded-card border border-solid border-surface3',
            'bg-raised p-s12 shadow-short',
          )}
        >
          <Text variant="body4" className="text-neutral2">
            Max slippage
          </Text>
          <div className="flex gap-s4">
            {PRESETS.map((preset) => (
              <button
                key={preset.bps}
                type="button"
                onClick={() => {
                  onSlippageChange(preset.bps)
                  // Clear the field, or it would keep displaying a number that is no longer the
                  // setting — two controls on one popover disagreeing about the same value.
                  setCustom('')
                  setOpen(false)
                }}
                aria-pressed={preset.bps === slippageBps}
                className={cn(
                  'focus-ring numeric flex-1 rounded-control px-s8 py-s6 text-buttonLabel4',
                  'transition-colors duration-[var(--transition-duration-simple)]',
                  preset.bps === slippageBps
                    ? 'bg-accent3 text-ground'
                    : 'bg-inset text-neutral1 hover:bg-insetHovered',
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
          {/* The typed path. Kept BELOW the presets, because the presets are still the answer for
              almost everyone and the field is the escape hatch, not the headline. */}
          <label className="flex flex-col gap-s4">
            <Text variant="body4" className="text-neutral2" as="span">
              Or set your own
            </Text>
            <span className="flex items-center gap-s6 rounded-control bg-inset px-s8 py-s6">
              <input
                inputMode="decimal"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                onBlur={() => {
                  if (custom.trim() === '') return
                  const parsed = parseSlippage(custom)
                  if ('bps' in parsed) onSlippageChange(parsed.bps)
                }}
                placeholder={`${slippageBps / 100}`}
                aria-label="Custom slippage tolerance, in percent"
                aria-invalid={customProblem !== null}
                className={cn(
                  'numeric min-w-0 flex-1 bg-transparent text-buttonLabel4 text-neutral1',
                  'outline-none placeholder:text-neutral3',
                )}
              />
              <span className="numeric shrink-0 text-buttonLabel4 text-neutral2">%</span>
            </span>
          </label>

          {/* The refusal, as a sentence, where the typing happened. A field that silently ignored a
              bad value would leave the user believing they set something they did not. */}
          {customProblem ? (
            <Text variant="body4" className="text-exposed">
              {customProblem}
            </Text>
          ) : null}

          <Text variant="body4" className="text-neutral2">
            The swap reverts rather than filling below this. Nothing is charged when it does.
          </Text>
        </div>
      ) : null}
    </div>
  )
}

/** 20px, `currentColor`, so it follows the button's own hover colour. */
function GearIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="2" />
      <path
        d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.2 2.2M16.9 16.9l2.2 2.2M19.1 4.9l-2.2 2.2M7.1 16.9l-2.2 2.2"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  )
}
