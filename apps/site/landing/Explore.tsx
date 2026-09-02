import Link from 'next/link'
import { ArrowRight, Play, Presentation, Smartphone } from 'lucide-react'

import { Band, Inner } from './Band'
import { PAGES } from './SiteChrome'

function DemoPreview() {
  return (
    <Link
      href={PAGES.demo}
      className="focus-ring group relative flex aspect-video min-h-[260px] flex-col justify-between overflow-hidden rounded-large border border-surface3 bg-raised p-s24 text-neutral1 no-underline sm:p-s32"
    >
      <div
        aria-hidden="true"
        className="absolute -right-[8%] top-[8%] size-[72%] rounded-full border-[42px] border-accent1 opacity-10"
      />
      <div className="relative flex items-center justify-between gap-s12">
        <span className="kicker">Recorded walkthrough · SN_MAIN</span>
        <span className="kicker text-accent1">03:00</span>
      </div>
      <div className="relative">
        <p className="display m-0 max-w-[12ch] text-display2 xl:text-display1">
          Private account. <span className="text-accent1">No wallet.</span>
        </p>
        <span className="mt-s20 inline-flex items-center gap-s8 rounded-pill bg-accent1 px-s20 py-s12 text-body3 font-medium text-onAccent group-hover:bg-accent1Hovered">
          <Play aria-hidden="true" size={17} fill="currentColor" /> Watch the demo
        </span>
      </div>
    </Link>
  )
}

/** Three public doors borrowed from the reference, expressed in strk20.run's own language. */
export function Explore() {
  return (
    <>
      <Band tone="dark" className="py-s60">
        <Inner className="grid items-center gap-s36 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <div className="flex flex-col gap-s16">
            <span className="kicker">See it before you trust it</span>
            <h2 className="display m-0 text-display2 xl:text-display1">
              Three minutes. <span className="text-accent1">The actual product.</span>
            </h2>
            <p className="m-0 max-w-[54ch] text-body2 text-[color:var(--ink2)]">
              Watch the account open, move across the product, and meet the privacy boundary. Then
              follow the addresses into the documentation instead of taking the video on faith.
            </p>
          </div>
          <DemoPreview />
        </Inner>
      </Band>

      <Band tone="light" className="py-s60">
        <Inner className="grid gap-s24 lg:grid-cols-2">
          <Link
            href={PAGES.pitch}
            className="focus-ring group flex min-h-[300px] flex-col justify-between rounded-large border border-[color:var(--line)] p-s24 text-[color:var(--ink)] no-underline sm:p-s32"
          >
            <div className="flex items-center justify-between gap-s16">
              <Presentation aria-hidden="true" size={30} strokeWidth={1.6} />
              <span className="kicker text-[color:var(--ink3)]">Six frames</span>
            </div>
            <div>
              <h2 className="display m-0 text-display2">Read the pitch.</h2>
              <p className="m-0 max-w-[48ch] pt-s12 text-body3 text-[color:var(--ink2)]">
                The problem, the account, the privacy boundary, the seven surfaces, and the mainnet
                record — one screen at a time.
              </p>
              <span className="mt-s20 inline-flex items-center gap-s8 text-body3 font-medium text-accent1">
                Open the pitch <ArrowRight aria-hidden="true" size={17} />
              </span>
            </div>
          </Link>

          <Link
            href={PAGES.download}
            className="focus-ring group grid min-h-[300px] grid-cols-[minmax(0,1fr)_7rem] items-end gap-s20 overflow-hidden rounded-large border border-[color:var(--line)] p-s24 text-[color:var(--ink)] no-underline sm:grid-cols-[minmax(0,1fr)_9rem] sm:p-s32"
          >
            <div>
              <span className="kicker text-[color:var(--ink3)]">Optional install</span>
              <h2 className="display m-0 pt-s8 text-display2">Take it with you.</h2>
              <p className="m-0 max-w-[42ch] pt-s12 text-body3 text-[color:var(--ink2)]">
                Add the web app to your phone from Safari or Chrome. No store download, and no
                claim that it works offline.
              </p>
              <span className="mt-s20 inline-flex items-center gap-s8 text-body3 font-medium text-accent1">
                Installation guide <ArrowRight aria-hidden="true" size={17} />
              </span>
            </div>
            <div
              aria-hidden="true"
              className="flex h-[230px] items-center justify-center rounded-t-[34px] border-x-[7px] border-t-[7px] border-ground bg-raised text-accent1 shadow-[0_20px_48px_rgba(0,0,0,0.2)]"
            >
              <Smartphone size={54} strokeWidth={1.25} />
            </div>
          </Link>
        </Inner>
      </Band>
    </>
  )
}
