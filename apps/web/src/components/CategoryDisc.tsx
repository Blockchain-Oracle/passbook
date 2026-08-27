//
// The tinted disc at the left of every history row.
//
// ── IT IS A GLYPH FIRST AND A TINT SECOND ────────────────────────────────────────────────
//
// The tints below are the design authority's `*Tint` washes, which are 5–12% alphas: they are
// deliberately quiet, and at that strength colour cannot be the thing that tells a Sent row from a
// Received one. So the ARROW is the identity — up-and-out, down-and-in, the swap's two-way pair,
// the bridge's arc — and the wash is atmosphere. Remove all colour and the column still reads,
// which is the same test the visibility matrix and the ladder markers are held to.
//
// ── AND THE ACCESSIBLE NAME LIVES ON THE ROW, NOT HERE ───────────────────────────────────
//
// The row's title already says what it is ("Sent", "Note created"), so a label on this disc would
// make a screen reader announce the same word twice before reaching the amount. It is decorative
// by construction and marked as such.
//
import type { ActivityCategory } from '@strk20/protocol/transaction'

import { cn } from '../lib/cn'

/**
 * The tint and the path for each category.
 *
 * WRITTEN OUT IN FULL rather than built from a template. Tailwind generates utilities by SCANNING
 * SOURCE TEXT for complete class names — `bg-${x}Tint` produces no rule at all, and the failure is
 * silent: the disc renders transparent and nothing anywhere reports a problem. `Text.tsx` documents
 * the same trap for the same reason.
 */
const LOOK: Record<ActivityCategory, { tint: string; ink: string; d: string }> = {
  // Out of the account: an arrow leaving, up and to the right.
  sent: { tint: 'bg-inset', ink: 'text-neutral1', d: 'M7 17L17 7M17 7H9M17 7v8' },
  // In: the same arrow, reversed, in the one colour this app spends on value that arrived.
  received: { tint: 'bg-settledTint', ink: 'text-settled', d: 'M17 7L7 17M7 17h8M7 17V9' },
  // The public boundary going in. Amber, because a deposit is visible on chain and that is a fact
  // about exposure rather than about success.
  deposit: { tint: 'bg-exposedTint', ink: 'text-exposed', d: 'M12 4v10m0 0l-4-4m4 4l4-4M5 19h14' },
  // The public boundary going out.
  withdrawal: { tint: 'bg-exposedTint', ink: 'text-exposed', d: 'M12 20V10m0 0l-4 4m4-4l4 4M5 5h14' },
  // The write-once viewing-key write. A key, because that is literally what it writes.
  registration: {
    tint: 'bg-accent2',
    ink: 'text-accent1',
    d: 'M14.5 6.5a3.5 3.5 0 1 1-3.2 4.9L5 17.7V20h3v-2h2v-2h1.8l1.2-1.2a3.5 3.5 0 0 0 1.5.2z',
  },
  // Two arrows passing. The one glyph everybody already reads as "swap".
  swap: { tint: 'bg-accent2', ink: 'text-accent1', d: 'M7 8h11l-3-3M17 16H6l3 3' },
  // The bridge's arc with two piers.
  bridge: { tint: 'bg-accent2', ink: 'text-accent1', d: 'M4 15c0-4 3.6-7 8-7s8 3 8 7M4 15h16M8 15v4M16 15v4' },
  // A speech bubble: money that travelled as a message.
  message: {
    tint: 'bg-accent2',
    ink: 'text-accent1',
    d: 'M5 5h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-7l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  },
  // The 1-wei companion. A small dot inside a ring: structure, told as structure.
  system: { tint: 'bg-inset', ink: 'text-neutral3', d: 'M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z' },
  // Somebody else's note movement. A plain diamond — it claims nothing about direction.
  note: { tint: 'bg-inset', ink: 'text-neutral2', d: 'M12 4l8 8-8 8-8-8 8-8z' },
}

export function CategoryDisc({ category }: { category: ActivityCategory }) {
  const look = LOOK[category]
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-s40 shrink-0 items-center justify-center rounded-pill',
        look.tint,
        look.ink,
      )}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path
          d={look.d}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}
