import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, BookOpen, Play, Presentation, Smartphone } from 'lucide-react'

import { DEMO_EMBED_URL, DEMO_VIDEO_URL } from '@/data/submission'
import { Band, Inner } from '@/landing/Band'
import { EXTERNAL, PAGES, SitePage } from '@/landing/SiteChrome'

export const metadata: Metadata = {
  title: 'Demo',
  description: 'Watch the three-minute strk20.run product walkthrough, then inspect the documentation and mainnet evidence.',
}

export default function DemoPage() {
  return (
    <SitePage current="demo">
      <Band tone="dark" className="py-s60">
        <Inner className="flex flex-col gap-s32">
          <div className="grid items-end gap-s24 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,34rem)]">
            <div>
              <span className="kicker">Recorded product walkthrough</span>
              <h1 className="display m-0 max-w-[12ch] pt-s8 text-display1 md:text-poster2 xl:text-poster1">
                See strk20.run <span className="text-accent1">work.</span>
              </h1>
            </div>
            <div className="flex flex-col gap-s16">
              <p className="m-0 text-body2 text-[color:var(--ink2)]">
                Three minutes across the account and its shipped surfaces. The recording is the
                demonstration; the documentation and chain record are the verification.
              </p>
              <a
                href={DEMO_VIDEO_URL}
                {...EXTERNAL}
                className="focus-ring inline-flex w-fit items-center gap-s8 text-body3 font-medium text-accent1 no-underline hover:text-accent1Hovered"
              >
                Open on Vimeo <ArrowRight aria-hidden="true" size={17} />
              </a>
            </div>
          </div>

          <div className="overflow-hidden rounded-large border border-surface3 bg-raised shadow-[0_28px_80px_rgba(0,0,0,0.38)]">
            <div className="aspect-video">
              <iframe
                src={DEMO_EMBED_URL}
                title="strk20.run three-minute product demo"
                className="size-full border-0"
                loading="lazy"
                allow="autoplay; fullscreen; picture-in-picture"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          </div>

          <p className="m-0 font-mono text-body4 text-neutral3">
            Recorded demo · The live app and documentation remain the current product record.
          </p>
        </Inner>
      </Band>

      <Band tone="light" className="py-s60">
        <Inner className="grid gap-s24 md:grid-cols-3">
          {[
            {
              href: PAGES.pitch,
              icon: <Presentation aria-hidden="true" size={24} />,
              title: 'Read the pitch',
              body: 'Six frames: problem, account, boundary, surfaces, evidence, and the door in.',
            },
            {
              href: '/docs/evidence',
              icon: <BookOpen aria-hidden="true" size={24} />,
              title: 'Inspect the evidence',
              body: 'Contract addresses, deployment transactions, sources, and the verified block.',
            },
            {
              href: PAGES.download,
              icon: <Smartphone aria-hidden="true" size={24} />,
              title: 'Put it on your phone',
              body: 'Open the web app in Safari or Chrome and add it to your Home Screen.',
            },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="focus-ring group flex min-h-[230px] flex-col justify-between rounded-large border border-[color:var(--line)] p-s24 text-[color:var(--ink)] no-underline"
            >
              {item.icon}
              <div>
                <h2 className="m-0 text-body1 font-medium">{item.title}</h2>
                <p className="m-0 pt-s8 text-body4 text-[color:var(--ink2)]">{item.body}</p>
                <ArrowRight aria-hidden="true" className="mt-s16 text-accent1" size={18} />
              </div>
            </Link>
          ))}
        </Inner>
      </Band>
    </SitePage>
  )
}
