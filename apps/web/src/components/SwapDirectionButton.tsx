//
// The flip button (Uniswap `SwitchCurrenciesButton` + `SwapArrowButton` are the model).
//
// ── IT PUNCHES A HOLE THROUGH BOTH PANELS, AND THAT IS THE ENTIRE EFFECT ──────────────────
//
// The button carries a 4px border in the PAGE's colour, not the panel's. Sitting on the seam
// between two panels, that ring reads as a gap cut out of both of them rather than as a chip
// resting on top — which is what makes the two panels look like one machine with a control in the
// middle instead of two stacked cards.
//
// Geometry, straight from the source: 24px icon + 8px padding + 4px border = 48px, offset by
// exactly half of that so its centre lands on the seam.
//
// ── IT DOES NOT ROTATE ────────────────────────────────────────────────────────────────────
//
// Uniswap presses it to 0.98 and nothing else. A 180deg spin is the obvious flourish and it is
// wrong here: the arrow's DIRECTION is meaningful (value flows down), so an animation that turns it
// upside down is briefly showing a claim that is false.
//
import { cn } from '../lib/cn'

const ICON = 24
const PADDING = 8
const BORDER = 4
const TOTAL = ICON + PADDING * 2 + BORDER * 2

export interface SwapDirectionButtonProps {
  onPress: () => void
  disabled?: boolean
}

export function SwapDirectionButton({ onPress, disabled = false }: SwapDirectionButtonProps) {
  return (
    // Zero-height rail so the button is positioned relative to the seam without occupying any of it
    // — otherwise it would push the two panels apart by its own height.
    <div className="relative z-[1] flex h-0 items-center justify-center">
      <button
        type="button"
        onClick={onPress}
        disabled={disabled}
        aria-label="Swap the two assets"
        className={cn(
          'focus-ring absolute flex items-center justify-center rounded-card',
          'border-solid border-ground bg-inset text-neutral1',
          'transition-[background-color,transform] duration-[var(--transition-duration-simple)]',
          'hover:bg-insetHovered active:scale-[0.98]',
          'disabled:pointer-events-none disabled:text-neutral3',
        )}
        style={{
          width: TOTAL,
          height: TOTAL,
          borderWidth: BORDER,
          padding: PADDING,
          top: -TOTAL / 2,
        }}
      >
        <svg width={ICON} height={ICON} viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M12 5V19M12 19L19 12M12 19L5 12"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  )
}
