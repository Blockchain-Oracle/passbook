//
// Slippage (Uniswap `SwapFormSettings` + `TransactionSettingsButton` are the model).
//
// ── THE GEAR ROTATES 90deg ON HOVER, OVER 80ms ────────────────────────────────────────────
//
// Copied precisely because it is the kind of detail that separates a product from a form: the
// control tells you it is a control before you press it. `--transition-duration-simple` IS 80ms on
// this sheet, so the number is the design authority's own and not a second copy of Uniswap's.
//
// ── AND THE PRESETS ARE THE SETTING, NOT A SHORTCUT TO IT ─────────────────────────────────
//
// There is no free-text slippage field. A typed 50% is almost always a mistake and occasionally a
// disaster, and the three offered values cover every honest case. `minimumOut` refuses anything at
// or above 100% anyway — this keeps the refusal from ever being needed.
//
import { useEffect, useRef, useState } from 'react'
import type { Bps } from '@strk20/protocol/quote'

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
  const wrapperRef = useRef<HTMLDivElement>(null)

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
