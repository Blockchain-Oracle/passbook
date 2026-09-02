//
// The page that is not here. Same chrome as every other page, so a wrong address is a wrong
// turn inside the site rather than a fall out of it. Nothing on it is a claim; there is nothing
// to claim about a page that does not exist.
//
import type { Metadata } from 'next'
import Link from 'next/link'

import { APP_URL } from '@/lib/shared'
import { EXTERNAL, PAGES, SitePage } from '@/landing/SiteChrome'

export const metadata: Metadata = { title: 'Not found' }

export default function NotFound() {
  return (
    <SitePage current="lost">
      <section className="mx-auto flex w-full max-w-[1500px] flex-col gap-s32 px-s20 pb-s60 pt-s48 lg:px-s40 lg:pt-s80">
        <p className="kicker m-0">404</p>
        <h1 className="display m-0 text-display1 md:text-poster2 xl:text-poster1">
          <span className="block">Nothing</span>
          <span className="block pl-s36 text-accent1 lg:pl-s60">at this address.</span>
        </h1>
        <p className="m-0 max-w-[46ch] text-body1 text-neutral1">
          The link is wrong, or the page it named is gone. Nothing of yours lives on this site — the account is in the app.
        </p>
        <div className="flex flex-wrap gap-s16">
          <Link
            href={PAGES.landing}
            className="focus-ring rounded-pill bg-accent1 px-s24 py-s16 text-body2 font-medium text-onAccent no-underline hover:bg-accent1Hovered"
          >
            Home
          </Link>
          <Link
            href={PAGES.docs}
            className="focus-ring rounded-pill border border-surface3Hovered px-s24 py-s16 text-body2 font-medium text-neutral1 no-underline hover:border-neutral1"
          >
            Docs
          </Link>
          <a
            href={APP_URL}
            {...EXTERNAL}
            className="focus-ring rounded-pill border border-surface3Hovered px-s24 py-s16 text-body2 font-medium text-neutral1 no-underline hover:border-neutral1"
          >
            Open the app
          </a>
        </div>
      </section>
    </SitePage>
  )
}
