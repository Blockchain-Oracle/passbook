import type { ReactNode } from 'react'

/**
 * One full-bleed section, in one of the page's two tones.
 *
 * ── NOT A THEME, AND THE DIFFERENCE IS THE WHOLE IDEA ─────────────────────────────────────
 *
 * A theme is a preference a reader sets once and every section obeys. These are a property of the
 * SECTION: an argument that reads better on bone-white sits directly against one that reads better
 * on black, on the same scroll, and the switch between them is the page's rhythm. `layout.shared`
 * keeps the docs' theme switch off for the same reason — there is nothing here for a reader to
 * choose, only something for the page to say.
 *
 * The tone classes live in `app/studio.css` and publish `--ink`, `--ink2`, `--ink3` and `--line`,
 * so everything inside is written once against those variables and does not know which band it is
 * in. Sections that spelled their own light and dark colours would drift the first time one of the
 * two was edited, and the drift would be invisible until somebody scrolled past it.
 */
export function Band({
  tone,
  children,
  className = '',
}: {
  readonly tone: 'light' | 'dark'
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <section className={`${tone === 'light' ? 'band-light' : 'band-dark'} px-s20 lg:px-s40 ${className}`}>
      {children}
    </section>
  )
}

/** The page's inner column. One width, so bands line up down the whole scroll. */
export function Inner({ children, className = '' }: { readonly children: ReactNode; readonly className?: string }) {
  return <div className={`mx-auto w-full max-w-[1500px] ${className}`}>{children}</div>
}
