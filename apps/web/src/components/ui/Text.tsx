//
// The type primitive (Uniswap `packages/ui/src/components/text/Text.tsx` is the model).
//
// ── THE VARIANT PICKS THE TAG, WHICH IS AN ACCESSIBILITY FACT AND NOT A STYLING ONE ───────
//
// `variant="heading2"` renders an `<h2>`. Uniswap does the same, and the reason is that a document
// whose headings are all `<div>` has no outline: a screen-reader user navigating by heading gets
// nothing, and every surface in this app is a page of dense financial claims where that navigation
// is the point. `as` overrides it for the case where the level is wrong for the document.
//
// ── LOADING IS A PROP, NOT A SEPARATE SKELETON COMPONENT ──────────────────────────────────
//
// A number that is still arriving reserves its own space with a placeholder of about the right
// width. Written as a sibling `<Skeleton>` the two drift and the layout jumps when the real value
// lands. Uniswap's note on the same prop: children are deliberately NOT rendered while loading,
// because a child reading a not-yet-fetched value often throws before it can be measured.
//
import type { ElementType, HTMLAttributes, ReactNode } from 'react'

import { cn } from '../../lib/cn'
import { Skeleton } from './Skeleton'

/** The design authority's type steps. `mono` is the only one that also changes family. */
export type TextVariant =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'subheading1'
  | 'subheading2'
  | 'body1'
  | 'body2'
  | 'body3'
  | 'body4'
  | 'mono'
  | 'buttonLabel1'
  | 'buttonLabel2'
  | 'buttonLabel3'
  | 'buttonLabel4'

//
// WRITTEN OUT IN FULL, AND IT HAS TO BE. `text-${variant}` is a template literal, and Tailwind
// generates utilities by SCANNING SOURCE TEXT for complete class names — it never evaluates the
// expression, so a dynamic class produces no rule at all. The failure is silent: the element
// renders at the inherited size and nothing anywhere reports a problem. Every class name in this
// file is a literal for that reason.
//
const SIZE: Record<TextVariant, string> = {
  heading1: 'text-heading1',
  heading2: 'text-heading2',
  heading3: 'text-heading3',
  subheading1: 'text-subheading1',
  subheading2: 'text-subheading2',
  body1: 'text-body1',
  body2: 'text-body2',
  body3: 'text-body3',
  body4: 'text-body4',
  mono: 'text-mono font-mono',
  buttonLabel1: 'text-buttonLabel1',
  buttonLabel2: 'text-buttonLabel2',
  buttonLabel3: 'text-buttonLabel3',
  buttonLabel4: 'text-buttonLabel4',
}

/** Which element each step means. Everything not listed is a `<span>`. */
const TAG: Partial<Record<TextVariant, ElementType>> = {
  heading1: 'h1',
  heading2: 'h2',
  heading3: 'h3',
  subheading1: 'h4',
  subheading2: 'h5',
}

export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, 'color'> {
  variant?: TextVariant
  /** Override the tag the variant would choose. Use when the visual step and the outline differ. */
  as?: ElementType
  /**
   * Reserve this text's space while its value is still arriving.
   *
   * `loadingPlaceholder` should be about as long as the real value — the skeleton is sized from it.
   */
  loading?: boolean
  loadingPlaceholder?: string
  children?: ReactNode
}

export function Text({
  variant = 'body2',
  as,
  loading = false,
  loadingPlaceholder = '000.00',
  className,
  children,
  ...rest
}: TextProps) {
  const Component = as ?? TAG[variant] ?? 'span'
  const classes = cn(SIZE[variant], className)

  if (loading) {
    return (
      <Component className={classes} aria-busy="true" {...rest}>
        {/* The placeholder is INVISIBLE but present, so the box is the width the real value will
            need. `aria-hidden` because a screen reader announcing "000.00" would be reading a
            number that is not a measurement of anything. */}
        <Skeleton>
          <span aria-hidden="true" className="invisible">
            {loadingPlaceholder}
          </span>
        </Skeleton>
      </Component>
    )
  }

  return (
    <Component className={classes} {...rest}>
      {children}
    </Component>
  )
}
