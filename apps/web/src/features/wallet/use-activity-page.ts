//
// Four rows at a time.
//
// The feed used to render every transaction in the read window, which on an account that has
// actually been used is a page you scroll past rather than one you read. Four and a Next keeps the
// wallet's height CONSTANT, so the balances above it never move under your cursor — which is the
// difference between this and a "show more" that grows the page back to what it was.
//
// Paging is over the FLAT ordered list, never inside the day/week/older sections: paging each
// section would give four pagers and a page whose height depends on which groups it happened to
// land in. The sections are re-derived from the page's rows, so a heading appears exactly when
// that page holds rows belonging to it.
//
import { useState } from 'react'

export const ACTIVITY_PAGE_SIZE = 4

export interface Paged<T> {
  rows: T[]
  /** 1-based, already clamped into range. */
  page: number
  pages: number
  /** 1-based row numbers for the `1–4 of 23` line. `from` is 0 when there are no rows. */
  from: number
  to: number
  total: number
  hasPrev: boolean
  hasNext: boolean
  prev: () => void
  next: () => void
}

/**
 * A page of rows.
 *
 * `resetKey` is the caller's statement that the ROW SET changed rather than grew — flipping the
 * system-notes switch, say. Growth alone must not reset: a transaction landing while you read page
 * three should not throw you back to page one.
 */
export function useActivityPage<T>(rows: readonly T[], resetKey: unknown, size = ACTIVITY_PAGE_SIZE): Paged<T> {
  const [page, setPage] = useState(1)
  const [seenKey, setSeenKey] = useState(resetKey)

  // Adjusting state during render — React's own pattern for a prop-derived value, and one render
  // rather than the two an effect would cost.
  if (resetKey !== seenKey) {
    setSeenKey(resetKey)
    setPage(1)
  }

  const total = rows.length
  const pages = Math.max(1, Math.ceil(total / size))
  // Clamped rather than written back: a list that shrinks under a high page number must show the
  // last page, and it must do it without a second render to get there.
  const current = Math.min(Math.max(1, page), pages)
  const start = (current - 1) * size

  return {
    rows: rows.slice(start, start + size),
    page: current,
    pages,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + size, total),
    total,
    hasPrev: current > 1,
    hasNext: current < pages,
    prev: () => setPage(Math.max(1, current - 1)),
    next: () => setPage(Math.min(pages, current + 1)),
  }
}
