import type { Metadata } from 'next'
import { Ellipsis, EllipsisVertical, ExternalLink, Share, Smartphone, SquarePlus } from 'lucide-react'

import { BrandGlyph } from '@/components/brand'
import { Band, Inner } from '@/landing/Band'
import { EXTERNAL, SitePage } from '@/landing/SiteChrome'
import { APP_URL } from '@/lib/shared'

export const metadata: Metadata = {
  title: 'Install on your phone',
  description: 'Add the strk20.run web app to an iPhone, iPad, or Android Home Screen from the browser menu.',
}

function PhoneStage() {
  return (
    <div className="relative mx-auto w-full max-w-[330px]">
      <span aria-hidden="true" className="absolute -left-[4px] top-[104px] h-[54px] w-[4px] rounded-l bg-ground" />
      <span aria-hidden="true" className="absolute -left-[4px] top-[172px] h-[76px] w-[4px] rounded-l bg-ground" />
      <span aria-hidden="true" className="absolute -right-[4px] top-[150px] h-[92px] w-[4px] rounded-r bg-ground" />
      <div className="rounded-[52px] border-[8px] border-ground bg-ground p-s6 shadow-[0_42px_90px_rgba(0,0,0,0.36)]">
        <div className="relative min-h-[630px] overflow-hidden rounded-[40px] bg-raised px-s20 pb-s24 pt-s16 text-neutral1">
          <span aria-hidden="true" className="absolute left-1/2 top-s8 h-[22px] w-[86px] -translate-x-1/2 rounded-pill bg-ground" />
          <div className="flex items-center justify-between font-mono text-[10px] text-neutral3">
            <span>9:41</span>
            <span>5G · 100%</span>
          </div>

          <div className="mt-s40 flex items-center gap-s8">
            <span className="flex size-s28 items-center justify-center rounded-card bg-accent1 text-onAccent">
              <BrandGlyph className="size-s20" />
            </span>
            <span className="display text-heading3">
              strk20<span className="text-accent1">.run</span>
            </span>
          </div>

          <div className="mt-s60">
            <span className="kicker">Add to Home Screen</span>
            <p className="display m-0 pt-s8 text-display2">
              One tap back to <span className="text-accent1">your account.</span>
            </p>
            <p className="m-0 pt-s12 text-body4 text-neutral2">
              The icon opens the web app in its own window. It is still the web app, and it still
              needs a network connection.
            </p>
          </div>

          <div className="mt-s32 flex flex-col gap-s8 rounded-large border border-surface3 bg-inset p-s16">
            <span className="flex items-center gap-s8 text-body3 font-medium">
              <Ellipsis aria-hidden="true" size={17} className="text-accent1" /> Browser menu
            </span>
            <span className="flex items-center gap-s8 text-body3 font-medium">
              <Share aria-hidden="true" size={17} className="text-accent1" /> Share
            </span>
            <span className="flex items-center gap-s8 text-body3 font-medium">
              <SquarePlus aria-hidden="true" size={17} className="text-accent1" /> Add to Home Screen
            </span>
          </div>

          <div className="absolute inset-x-s20 bottom-s20 flex items-center justify-between border-t border-surface3 pt-s12">
            <span className="kicker">Web app</span>
            <Smartphone aria-hidden="true" size={19} className="text-accent1" />
          </div>
        </div>
      </div>
    </div>
  )
}

// Labels as the two browsers spell them in 2026: Safari on iOS 26 keeps Share behind the ⋯ button
// in its default Compact layout, and Chrome on Android names the menu item "Install and create
// shortcut". Chrome may also offer the install on its own; that prompt is the same install.
const INSTALL_STEPS = [
  {
    platform: 'iPhone or iPad',
    browser: 'Safari',
    icon: <Ellipsis aria-hidden="true" size={27} strokeWidth={1.6} />,
    steps: [
      'Open app.strk20.run in Safari.',
      'Tap the ⋯ button in the address bar, then Share.',
      'Scroll the sheet down and tap Add to Home Screen.',
      'Leave Open as Web App on, then tap Add.',
    ],
    note: 'Safari’s Top and Bottom tab layouts show a Share button in the bar instead; start from that.',
  },
  {
    platform: 'Android',
    browser: 'Chrome',
    icon: <EllipsisVertical aria-hidden="true" size={27} strokeWidth={1.6} />,
    steps: [
      'Open app.strk20.run in Chrome.',
      'If Chrome offers to install it, tap Install and you are done.',
      'Otherwise tap the ⋮ menu, then Install and create shortcut.',
      'Tap Install.',
    ],
    note: 'The icon lands on the Home screen and in the app drawer. Older Chrome versions call it Install app.',
  },
] as const

export default function DownloadPage() {
  return (
    <SitePage current="download">
      <Band tone="light" className="py-s60">
        <Inner className="grid items-center gap-s48 lg:grid-cols-[minmax(0,1fr)_minmax(280px,430px)]">
          <div className="flex max-w-[720px] flex-col gap-s20">
            <span className="kicker text-[color:var(--ink3)]">Optional home-screen install</span>
            <h1 className="display m-0 text-display1 md:text-poster2 xl:text-poster1">
              Put the account <span className="text-accent1">in your pocket.</span>
            </h1>
            <p className="m-0 max-w-[58ch] text-body2 text-[color:var(--ink2)]">
              strk20.run is a web app. There is no App Store or Play Store package to download.
              Open it in Safari or Chrome, then add it from the browser menu.
            </p>
            <a
              href={APP_URL}
              {...EXTERNAL}
              className="focus-ring inline-flex w-fit items-center gap-s8 rounded-pill bg-accent1 px-s24 py-s16 text-body2 font-medium text-onAccent no-underline hover:bg-accent1Hovered"
            >
              Open the app to install <ExternalLink aria-hidden="true" size={18} />
            </a>
            <div className="flex flex-wrap gap-x-s24 gap-y-s8 border-t border-[color:var(--line)] pt-s16">
              <span className="kicker text-[color:var(--ink3)]">Safari · iOS / iPadOS</span>
              <span className="kicker text-[color:var(--ink3)]">Chrome · Android</span>
              <span className="kicker text-[color:var(--ink3)]">Network required</span>
            </div>
          </div>
          <PhoneStage />
        </Inner>
      </Band>

      <Band tone="dark" className="py-s60">
        <Inner>
          <div className="flex flex-wrap items-end justify-between gap-s20 pb-s32">
            <div>
              <span className="kicker">From the browser menu</span>
              <h2 className="display m-0 pt-s8 text-display2 xl:text-display1">Two short paths.</h2>
            </div>
            <p className="m-0 max-w-[48ch] text-body4 text-neutral2">
              Start from the browser you intend to keep using. A Home Screen icon is not a backup
              of the account stored in that browser.
            </p>
          </div>

          <div className="grid gap-s24 lg:grid-cols-2">
            {INSTALL_STEPS.map((guide) => (
              <article key={guide.platform} className="rounded-large border border-surface3 bg-raised p-s24 sm:p-s32">
                <div className="flex items-center justify-between gap-s16">
                  <span className="text-accent1">{guide.icon}</span>
                  <span className="kicker">{guide.browser}</span>
                </div>
                <h3 className="display m-0 pt-s24 text-display3 xl:text-display2">{guide.platform}</h3>
                <ol className="m-0 flex list-none flex-col gap-s16 p-0 pt-s24">
                  {guide.steps.map((step, index) => (
                    <li key={step} className="grid grid-cols-[2rem_minmax(0,1fr)] gap-s12 border-t border-surface3 pt-s12">
                      <span className="font-mono text-body4 text-accent1">{String(index + 1).padStart(2, '0')}</span>
                      <span className="text-body3 text-neutral1">{step}</span>
                    </li>
                  ))}
                </ol>
                <p className="m-0 pt-s20 text-body4 text-neutral3">{guide.note}</p>
              </article>
            ))}
          </div>
        </Inner>
      </Band>

      <Band tone="light" className="py-s60">
        <Inner className="grid gap-s24 md:grid-cols-3">
          {[
            ['It changes the door', 'You get a Home Screen icon and a standalone window that starts at the wallet route.'],
            ['It does not add offline mode', 'The current app still needs a network connection for chain and relayer activity.'],
            ['It is not account recovery', 'Save the Recovery File in the app. The Home Screen icon does not preserve or restore your key.'],
          ].map(([title, body], index) => (
            <article key={title} className="border-t border-[color:var(--line)] pt-s16">
              <span className="font-mono text-body4 text-[color:var(--ink3)]">{String(index + 1).padStart(2, '0')}</span>
              <h3 className="m-0 pt-s8 text-body1 font-medium">{title}</h3>
              <p className="m-0 pt-s8 text-body4 text-[color:var(--ink2)]">{body}</p>
            </article>
          ))}
        </Inner>
      </Band>
    </SitePage>
  )
}
