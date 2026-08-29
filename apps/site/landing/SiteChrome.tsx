//
// The site's chrome — the header and footer both pages share.
//
// It has one job: say what this is and offer the door. The APP has a completely different header
// (six coequal modes, an account chip, a pool-health strip underneath), and every element of it
// would be meaningless here — a nav to six surfaces the reader cannot reach, an account derived
// for a visitor who only came to read, and a health strip about a pool they have no notes in.
//
import type { ReactNode } from 'react'
import Link from 'next/link'

import { BrandLockup } from '@/components/brand'
import { APP_URL, REPO_URL } from '@/lib/shared'

/**
 * Every off-site link opens in a new tab with `noopener noreferrer`.
 *
 * `noreferrer` alongside `noopener` is deliberate rather than cargo: Voyager and GitHub have no
 * business being told which page of ours a reader arrived from, and `noopener` alone does not
 * suppress the `Referer` header.
 */
export const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const

/** The two halves of the site. Both are routes in this app, so both are client-side `Link`s. */
export const PAGES = { landing: '/', docs: '/docs' } as const

export type PageId = keyof typeof PAGES

/**
 * The header.
 *
 * `current` marks which page is being read, so the header never offers a link to the page you are
 * already on — the same rule the app's header follows with `aria-current`, applied by hand because
 * there are two pages and a router would be a dependency bought for that.
 */
export function SiteHeader({ current }: { current: PageId }) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-s16 border-b border-surface3 bg-ground/85 px-s20 py-s16 backdrop-blur-md lg:px-s40">
      {current === 'landing' ? (
        <span className="flex items-center gap-s8">
          <BrandLockup />
        </span>
      ) : (
        <Link
          href={PAGES.landing}
          className="focus-ring flex items-center gap-s8 text-neutral1 no-underline"
        >
          <BrandLockup />
          <span className="kicker rounded-pill border border-surface3 px-s8 py-s4">Docs</span>
        </Link>
      )}

      <nav aria-label="Site" className="flex items-center gap-s16 sm:gap-s24">
        {current === 'docs' ? null : (
          <Link href={PAGES.docs} className="focus-ring kicker no-underline hover:text-neutral1">
            Docs
          </Link>
        )}
        <a
          href={REPO_URL}
          {...EXTERNAL}
          className="focus-ring kicker no-underline hover:text-neutral1"
        >
          GitHub
        </a>
        <a
          href={APP_URL}
          {...EXTERNAL}
          className="focus-ring rounded-pill bg-accent1 px-s20 py-s8 text-body3 font-medium text-onAccent no-underline hover:bg-accent1Hovered"
        >
          Open the app
        </a>
      </nav>
    </header>
  )
}

/**
 * The footer: one more offer of the door, then the wordmark.
 *
 * The wordmark takes `poster1` — the same step as the landing headline — because it is the same
 * gesture at the other end of the page. Sized off the app's ladder it would read as a heading
 * rather than as a sign-off.
 */
export function SiteFooter() {
  return (
    <footer className="px-s20 pb-s32 pt-s48 lg:px-s40 lg:pt-s60">
      <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-s36">
        <div className="flex flex-wrap items-center justify-between gap-s20">
          <span className="display max-w-[24ch] text-display3 xl:text-display2">
            Ready when you are. It takes one page load.
          </span>
          <a
            href={APP_URL}
            {...EXTERNAL}
            className="focus-ring rounded-pill bg-accent1 px-s24 py-s16 text-body2 font-medium text-onAccent no-underline hover:bg-accent1Hovered"
          >
            Open the app →
          </a>
        </div>

        <div className="flex flex-wrap items-end justify-between gap-s20 border-t border-surface3 pt-s24">
          <span className="display text-display1 xl:text-poster1">
            strk20<span className="text-accent1">.run</span>
          </span>
          <div className="flex flex-col items-start gap-s8 sm:items-end sm:text-right">
            <div className="flex gap-s20">
              <Link href={PAGES.docs} className="focus-ring kicker no-underline hover:text-neutral1">
                Docs
              </Link>
              <a
                href={REPO_URL}
                {...EXTERNAL}
                className="focus-ring kicker no-underline hover:text-neutral1"
              >
                GitHub
              </a>
            </div>
            <span className="font-mono text-body4 text-neutral3">MIT · SN_MAIN · STRK20 pool</span>
          </div>
        </div>
      </div>
    </footer>
  )
}

/** The frame both pages sit in. Carries the one `<main>` landmark. */
export function SitePage({ current, children }: { current: PageId; children: ReactNode }) {
  return (
    <>
      <SiteHeader current={current} />
      <main className="overflow-x-hidden">{children}</main>
      <SiteFooter />
    </>
  )
}

/** Inline monospace, one component instead of four utilities repeated down a page of prose. */
export function Code({ children }: { children: ReactNode }) {
  return <span className="font-mono text-body4 text-neutral1">{children}</span>
}
