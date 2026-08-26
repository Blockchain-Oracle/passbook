//
// `cn()` — the class merger, taught this app's token vocabulary.
//
// ── WHY A PLAIN `tailwind-merge` IS WRONG HERE, AND SILENTLY ──────────────────────────────
//
// `tailwind-merge` decides which of two conflicting classes wins by classifying each into a group.
// It knows Tailwind's DEFAULT names. This app wiped those (`--color-*: initial` in the generated
// token sheet closes 21 namespaces) and replaced them with its own: `text-body3` is a FONT SIZE,
// `text-neutral2` is a COLOUR, and both look like `text-*`.
//
// Untaught, `cn('text-body3', 'text-neutral2')` sees one group and drops the size. The bug is
// invisible — no error, no missing rule, just type that is subtly the wrong size on exactly the
// components that pass a colour override. Uniswap hit this and records the same fix in
// `packages/mycelium/src/cn.ts`.
//
// So both lists below are derived from `apps/web/design/tokens.css`, which is generated from the
// design authority. `cn.test.ts` walks that sheet and fails if a token exists there and is missing
// here — the lists cannot drift silently.
//
import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/** Every `--text-*` key in the token sheet. These are SIZES (each also carrying leading/weight). */
export const TEXT_SIZES = [
  'heading1',
  'heading2',
  'heading3',
  'subheading1',
  'subheading2',
  'body1',
  'body2',
  'body3',
  'body4',
  'mono',
  'buttonLabel1',
  'buttonLabel2',
  'buttonLabel3',
  'buttonLabel4',
] as const

/** Every `--color-*` key in the token sheet. These are COLOURS. */
export const COLOR_TOKENS = [
  'ground',
  'raised',
  'raisedHovered',
  'inset',
  'insetHovered',
  'surface3',
  'surface3Hovered',
  'surface3Solid',
  'surface4',
  'scrim',
  'neutral1',
  'neutral1Hovered',
  'neutral2',
  'neutral2Hovered',
  'neutral3',
  'neutral3Hovered',
  'accent1',
  'accent1Hovered',
  'accent2',
  'accent2Hovered',
  'accent2Solid',
  'accent3',
  'settled',
  'settledHovered',
  'settledTint',
  'exposed',
  'exposedHovered',
  'exposedTint',
  'irreversible',
  'irreversibleHovered',
  'irreversibleTint',
] as const

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // The two that collide. Registering them separately is the whole point of this file.
      'font-size': TEXT_SIZES.map((size) => `text-${size}`),
      'text-color': COLOR_TOKENS.map((color) => `text-${color}`),
    },
  },
})

/**
 * Merge class names, last conflicting one winning.
 *
 * Use this EVERYWHERE a component accepts a `className` — a component that concatenates instead
 * cannot be overridden by its caller, which is the whole reason the caller passed a class.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
