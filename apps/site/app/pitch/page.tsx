import type { Metadata } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight, BookOpen, Code2, Play } from 'lucide-react'

import { MAINNET_RECORD, NETWORK } from '@/data/deployment'
import { SUBMISSION_CONTRACT_COUNT, SUBMISSION_TRANSACTION_COUNT } from '@/data/submission'
import { SURFACE_STATUS } from '@/data/surfaces'
import { Band, Inner } from '@/landing/Band'
import { EXTERNAL, PAGES, SitePage } from '@/landing/SiteChrome'
import { APP_URL, REPO_URL } from '@/lib/shared'

export const metadata: Metadata = {
  title: 'Pitch',
  description: 'The strk20.run product pitch: one private account, seven Starknet surfaces, explicit privacy boundaries, and mainnet evidence.',
}

function Frame({
  number,
  tone,
  title,
  children,
}: {
  readonly number: string
  readonly tone: 'light' | 'dark'
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <Band tone={tone} className="scroll-mt-[72px] py-s48 lg:min-h-[calc(100svh-72px)] lg:py-s60">
      <Inner className="flex min-h-[620px] flex-col">
        <div className="flex items-center justify-between gap-s16 border-b border-[color:var(--line)] pb-s12">
          <span className="kicker text-[color:var(--ink3)]">{number} / 06</span>
          <span className="kicker text-[color:var(--ink3)]">{title}</span>
        </div>
        <div className="grid flex-1 items-center py-s36">{children}</div>
      </Inner>
    </Band>
  )
}

export default function PitchPage() {
  return (
    <SitePage current="pitch">
      <Frame number="01" tone="dark" title="The product">
        <div className="grid items-end gap-s32 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,30rem)]">
          <h1 className="display m-0 max-w-[10ch] text-display1 md:text-poster2 xl:text-poster1">
            Everything on Starknet, from one <span className="text-accent1">private account.</span>
          </h1>
          <div className="flex flex-col gap-s20">
            <p className="m-0 text-body2 text-[color:var(--ink2)]">
              Hold, send, mail, swap, bridge out, bet, launch a token, and run a House without
              beginning with a wallet extension or a seed phrase.
            </p>
            <div className="flex flex-wrap gap-s12">
              <Link
                href={PAGES.demo}
                className="focus-ring inline-flex items-center gap-s8 rounded-pill bg-accent1 px-s20 py-s12 text-body3 font-medium text-onAccent no-underline hover:bg-accent1Hovered"
              >
                <Play aria-hidden="true" size={16} fill="currentColor" /> Watch demo
              </Link>
              <a
                href={APP_URL}
                {...EXTERNAL}
                className="focus-ring inline-flex items-center gap-s8 rounded-pill border border-surface3 px-s20 py-s12 text-body3 font-medium text-neutral1 no-underline hover:border-neutral1"
              >
                Open app <ArrowRight aria-hidden="true" size={16} />
              </a>
            </div>
          </div>
        </div>
      </Frame>

      <Frame number="02" tone="light" title="The front door">
        <div>
          <span className="kicker text-[color:var(--ink3)]">One page load</span>
          <h2 className="display m-0 max-w-[14ch] pt-s8 text-display1 xl:text-poster2">
            No wallet. No email. <span className="text-accent1">No seed phrase.</span>
          </h2>
          <div className="grid gap-s24 pt-s36 md:grid-cols-3">
            {[
              ['01', 'A browser-made key', 'The account key is created in the browser. The recovery step is required before the first on-chain write.'],
              ['02', 'A funded first run', 'Registration arrives with shielded STRK and a small public gas balance instead of an empty screen.'],
              ['03', 'Three covered transactions', 'The relayer pays registration and two more transactions while showing the remaining count.'],
            ].map(([n, heading, body]) => (
              <article key={n} className="border-t border-[color:var(--line)] pt-s16">
                <span className="font-mono text-body4 text-accent1">{n}</span>
                <h3 className="m-0 pt-s8 text-body1 font-medium">{heading}</h3>
                <p className="m-0 pt-s8 text-body4 text-[color:var(--ink2)]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </Frame>

      <Frame number="03" tone="dark" title="The boundary">
        <div>
          <span className="kicker">Privacy described before action</span>
          <h2 className="display m-0 max-w-[14ch] pt-s8 text-display1 xl:text-poster2">
            Public in. Private through. <span className="text-accent1">Public out.</span>
          </h2>
          <div className="grid gap-s24 pt-s36 md:grid-cols-3">
            {[
              ['Public in', 'A deposit address and amount are visible when value enters the pool.'],
              ['Inside the pool', 'The account spends notes and builds proofs in the browser. Pool activity is still observable.'],
              ['Public out', 'A withdrawal exposes its destination, amount, and timing. The app says that before confirmation.'],
            ].map(([heading, body]) => (
              <article key={heading} className="rounded-large border border-surface3 bg-raised p-s24">
                <h3 className="display m-0 text-display3">{heading}</h3>
                <p className="m-0 pt-s12 text-body4 text-neutral2">{body}</p>
              </article>
            ))}
          </div>
          <p className="m-0 max-w-[78ch] pt-s24 text-body4 text-neutral3">
            The relayer sees network and timing metadata. StarkWare&rsquo;s auditor receives an encrypted
            viewing key during registration. These are product facts, not footnotes.
          </p>
        </div>
      </Frame>

      <Frame number="04" tone="light" title="The breadth">
        <div>
          <span className="kicker text-[color:var(--ink3)]">Status from the deployment record</span>
          <h2 className="display m-0 pt-s8 text-display1 xl:text-poster2">Seven surfaces. One account.</h2>
          <div className="grid gap-x-s32 gap-y-s8 pt-s28 md:grid-cols-2">
            {SURFACE_STATUS.map((surface) => (
              <div key={surface.key} className="flex items-center gap-s16 border-t border-[color:var(--line)] py-s12">
                <span className="font-mono text-body4 text-[color:var(--ink3)]">{surface.n}</span>
                <span className="display text-display3">{surface.name}</span>
                <span className="flex-1" />
                <span className={surface.state === 'live' ? 'kicker text-accent1' : 'kicker text-[color:var(--ink3)]'}>
                  {surface.status}
                </span>
              </div>
            ))}
          </div>
          <p className="m-0 pt-s16 font-mono text-body4 text-[color:var(--ink3)]">
            No balances are combined. Unknown values render as —. Bridge remains outbound only.
          </p>
        </div>
      </Frame>

      <Frame number="05" tone="dark" title="The evidence">
        <div className="grid items-end gap-s36 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,34rem)]">
          <div>
            <span className="kicker">Built and checkable</span>
            <h2 className="display m-0 max-w-[12ch] pt-s8 text-display1 xl:text-poster2">
              Mainnet is the <span className="text-accent1">record.</span>
            </h2>
            <p className="m-0 max-w-[52ch] pt-s20 text-body2 text-neutral2">
              The submission manifest, deployment evidence, and public documentation point to the
              chain rather than to a dashboard counter.
            </p>
          </div>
          <div className="flex flex-col border-t border-surface3">
            {[
              ['Network', NETWORK],
              ['Manifest transactions', String(SUBMISSION_TRANSACTION_COUNT)],
              ['Manifest contracts', String(SUBMISSION_CONTRACT_COUNT)],
              ['Evidence rows', String(MAINNET_RECORD.length)],
            ].map(([label, value]) => (
              <div key={label} className="flex items-baseline justify-between gap-s20 border-b border-surface3 py-s16">
                <span className="kicker">{label}</span>
                <span className="display text-display3 text-accent1">{value}</span>
              </div>
            ))}
            <Link
              href="/docs/evidence"
              className="focus-ring mt-s20 inline-flex items-center gap-s8 text-body3 font-medium text-accent1 no-underline hover:text-accent1Hovered"
            >
              Inspect every row <ArrowRight aria-hidden="true" size={17} />
            </Link>
          </div>
        </div>
      </Frame>

      <Frame number="06" tone="light" title="The next click">
        <div className="grid items-end gap-s36 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,32rem)]">
          <h2 className="display m-0 max-w-[10ch] text-display1 md:text-poster2 xl:text-poster1">
            Watch it. Inspect it. <span className="text-accent1">Then open it.</span>
          </h2>
          <div className="flex flex-col gap-s12">
            <Link
              href={PAGES.demo}
              className="focus-ring flex items-center gap-s12 rounded-large border border-[color:var(--line)] p-s16 text-[color:var(--ink)] no-underline"
            >
              <Play aria-hidden="true" size={20} className="text-accent1" />
              <span className="flex-1 text-body3 font-medium">Three-minute demo</span>
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <Link
              href={PAGES.docs}
              className="focus-ring flex items-center gap-s12 rounded-large border border-[color:var(--line)] p-s16 text-[color:var(--ink)] no-underline"
            >
              <BookOpen aria-hidden="true" size={20} className="text-accent1" />
              <span className="flex-1 text-body3 font-medium">Documentation</span>
              <ArrowRight aria-hidden="true" size={17} />
            </Link>
            <a
              href={REPO_URL}
              {...EXTERNAL}
              className="focus-ring flex items-center gap-s12 rounded-large border border-[color:var(--line)] p-s16 text-[color:var(--ink)] no-underline"
            >
              <Code2 aria-hidden="true" size={20} className="text-accent1" />
              <span className="flex-1 text-body3 font-medium">Source code</span>
              <ArrowRight aria-hidden="true" size={17} />
            </a>
            <a
              href={APP_URL}
              {...EXTERNAL}
              className="focus-ring mt-s8 inline-flex items-center justify-center gap-s8 rounded-pill bg-accent1 px-s24 py-s16 text-body2 font-medium text-onAccent no-underline hover:bg-accent1Hovered"
            >
              Open the app <ArrowRight aria-hidden="true" size={18} />
            </a>
          </div>
        </div>
      </Frame>
    </SitePage>
  )
}
