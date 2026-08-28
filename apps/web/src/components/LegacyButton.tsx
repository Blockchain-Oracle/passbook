//
// The button primitive (Uniswap `packages/mycelium/src/components/button.tsx` is the model).
//
// ── WHY A VARIANT TABLE AND NOT AUTHORED CSS ──────────────────────────────────────────────
//
// Everything visual lives in one `cva` table at the top of this file. A reader answers "what does a
// critical button look like?" by reading eight lines, not by grepping a 1,878-line stylesheet for
// `.cta` and then for every `.cta[data-…]` that modifies it. That grep is what this file exists to
// end.
//
// ── ONE FLAT `variant` LIST, NOT UNISWAP'S 4x4 ────────────────────────────────────────────
//
// `packages/ui` crosses `variant` (default/branded/critical/warning) with `emphasis`
// (primary/secondary/tertiary/text-only) and resolves all sixteen through a lookup table. Their own
// Tailwind rewrite collapsed it to a flat list, and so does this: sixteen combinations is a
// vocabulary nobody can hold, and this product uses five.
//
// ── THE BORDER IS ALWAYS 1px ──────────────────────────────────────────────────────────────
//
// Transparent when a variant has no border. `CustomButtonFrame.web.tsx:21` records why: with
// `border: 0` on some variants and `1px` on others, a button changes SIZE when its variant changes —
// which happens here every time severity escalates a CTA.
//
// ── SIZE CARRIES FOUR THINGS ──────────────────────────────────────────────────────────────
//
// Padding, radius, gap and type step, per Uniswap's scale. A caller never sets those four
// separately, so they are never inconsistent.
//
import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { cn } from '../lib/cn'

export const buttonVariants = cva(
  // The invariant half. `focus-ring` is the app's existing authored focus treatment — kept, because
  // the design authority owns the ring and it is asserted by the build gate.
  [
    'relative inline-flex items-center justify-center whitespace-nowrap',
    'border border-solid border-transparent',
    // `--ease-*` IS a Tailwind namespace so `ease-glide` generates; `--transition-duration-*` is
    // this sheet's own, so the duration has to name its var explicitly or no rule is emitted.
    'transition-[background-color,color,transform]',
    'duration-[var(--transition-duration-fastHeavy)] ease-glide',
    'active:scale-[0.98]',
    'disabled:pointer-events-none',
    'focus-ring',
  ],
  {
    variants: {
      variant: {
        /** The primary action. Ink, not brand — the design authority's call (`primaryFill: accent3`). */
        primary: 'bg-accent3 text-ground hover:bg-neutral1Hovered',
        /** The ordinary secondary action. */
        secondary: 'bg-inset text-neutral1 hover:bg-insetHovered',
        /** Sits on a filled surface and shows its edge instead of a fill. */
        tertiary: 'bg-transparent text-neutral1 border-surface3 hover:bg-inset',
        /** Destructive or unrecoverable. Spent sparingly — see the severity rules. */
        critical: 'bg-irreversible text-ground hover:bg-irreversibleHovered',
        /** No chrome at all: for chips, links-that-are-buttons, and the account pill. */
        ghost: 'bg-transparent text-neutral1 hover:bg-inset',
      },
      size: {
        /** 40px — chips, presets, inline controls. */
        sm: 'min-h-s40 gap-s4 rounded-control px-s12 py-s8 text-buttonLabel3',
        /** 48px — secondary actions, toolbar buttons. */
        md: 'min-h-s48 gap-s8 rounded-card px-s16 py-s12 text-buttonLabel2',
        // 56px, and it is the PADDING that produces it: 16 top + 24 line-height + 16 bottom. The
        // spacing scale jumps 48 → 60 with nothing between, so a `min-h` here would have to be one
        // of those and would fight the padding rather than floor it.
        /** 56px — the one primary action on a surface. Uniswap's `large`. */
        lg: 'gap-s12 rounded-large px-s20 py-s16 text-buttonLabel1',
      },
      /** Stretch to the container. The review CTA on every value surface uses this. */
      fill: { true: 'w-full', false: '' },
    },
    defaultVariants: { variant: 'primary', size: 'lg', fill: false },
  },
)

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'>,
    VariantProps<typeof buttonVariants> {
  /** Rendered before the label, at the size's own icon scale. */
  icon?: ReactNode
}

/**
 * A button.
 *
 * NOT the app's primary CTA — that is `BlockedButton`, which never disables and always states its
 * reason. This is for every other button on the screen. Reaching for `disabled` on a primary action
 * is the mistake `BlockedButton` exists to prevent.
 */
export function Button({
  className,
  variant,
  size,
  fill,
  icon,
  children,
  type,
  onClick,
  ...rest
}: ButtonProps) {
  //
  // `aria-disabled` MUST SWALLOW THE PRESS, and this is a money bug rather than a polish item.
  //
  // The sheet only carries `disabled:pointer-events-none`, which is the REAL `disabled` attribute.
  // But this app almost never sets it — the never-disable rule above means a blocked primary action
  // renders `aria-disabled` and keeps its handler, so the browser fires `onClick` exactly as if
  // nothing were wrong. Every review sheet is written as
  // `onClick={() => onConfirm?.()} aria-disabled={blocker !== null}`, and none of the confirm
  // handlers guards on its own in-flight state — so a second press while the button still reads
  // "Proving…" started a SECOND real mainnet transaction.
  //
  // Swallowed here, once, rather than in each handler: a guard that has to be remembered at every
  // call site is a guard that is missing at one of them, and the one it is missing at moves money.
  // The attribute keeps announcing the state to assistive technology either way — this changes what
  // a press DOES, not what the button says.
  //
  const blocked = rest['aria-disabled'] === true || rest['aria-disabled'] === 'true'
  return (
    <button
      // Buttons inside a form default to `submit` and reload the page. Nothing in this app wants
      // that, and it is the single most common way a React button misbehaves.
      type={type ?? 'button'}
      className={cn(buttonVariants({ variant, size, fill }), className)}
      onClick={
        onClick === undefined
          ? undefined
          : (event) => {
              if (blocked) {
                // Stopped here, not merely un-called: a blocked press must not reach a parent's
                // handler either, and a submit inside a form would still navigate.
                event.preventDefault()
                event.stopPropagation()
                return
              }
              onClick(event)
            }
      }
      {...rest}
    >
      {icon}
      {children}
    </button>
  )
}
