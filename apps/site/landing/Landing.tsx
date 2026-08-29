//
// THE LANDING PAGE.
//
// ── NOTHING HERE THAT HAS A FACT UNDER IT IS TYPED TWICE ──────────────────────────────────
//
//   the refusal ticker   `FORBIDDEN_CLAIMS` — the actual ten strings the copy tests hold the
//                        product to, not a plausible-looking list written for a design mock
//   the seven surfaces     `data/surfaces.ts`, whose two changeable rows are computed from the
//                        evidence file and shared with the docs page
//   the chain table      `data/deployment.ts`, derived from the files the deploy scripts wrote
//
// That is not tidiness. A marketing page is the artifact in a repository most likely to still be
// describing last month's product, and this one's whole pitch is that the product does not
// overstate itself — so every part of it that could go stale is wired to a part that cannot.
//
import Link from 'next/link'

import { FORBIDDEN_CLAIMS } from '@strk20/protocol/forbidden-claims'

import { EXTERNAL, PAGES, SitePage } from './SiteChrome'
import { APP_URL } from '@/lib/shared'
import { MAINNET_RECORD, NETWORK, VERIFIED_AT_BLOCK } from '@/data/deployment'
import { SURFACE_STATUS, type SurfaceState } from '@/data/surfaces'

/** The ink each status takes. `partial` stays neutral: it is a qualifier, not a warning. */
const STATE_INK: Record<SurfaceState, string> = {
  live: 'text-accent1',
  partial: 'text-neutral2',
  coming: 'text-exposed',
}

export function Landing() {
  return (
    <SitePage current="landing">
      <Hero />
      <RefusalTicker />
      <Thesis />
      <Surfaces />
      <Proof />
    </SitePage>
  )
}

function Hero() {
  return (
    <section className="flex min-h-[calc(100vh-72px)] flex-col justify-between px-s20 pt-s36 lg:px-s40 lg:pt-s48">
      <div className="mx-auto w-full max-w-[1500px]">
        {/*
          THREE LINES, AND THE MIDDLE ONE IS THE ONLY COLOUR ON THE SCREEN. "account" is the claim
          the product is actually making — not privacy, which every competitor also claims, but that
          there is an account here at all with no wallet in front of it.
        */}
        <h1 className="display m-0 text-display1 md:text-poster2 xl:text-poster1">
          <span className="block">Private</span>
          <span className="block pl-s36 text-accent1 lg:pl-s60">account.</span>
          <span className="block">No wallet.</span>
        </h1>

        <div className="mt-s32 flex flex-wrap items-end justify-between gap-s24">
          <p className="m-0 max-w-[46ch] text-body1 text-neutral2">
            Open strk20.run and you have an account on Starknet&rsquo;s STRK20 pool. The key is
            generated in your browser on first load. Hold and send shielded value, chat, swap,
            bridge out, bet, launch.
          </p>
          <div className="flex flex-wrap items-center gap-s12">
            <a
              href={APP_URL}
              {...EXTERNAL}
              className="focus-ring rounded-pill bg-accent1 px-s24 py-s16 text-body2 font-medium text-onAccent no-underline hover:bg-accent1Hovered"
            >
              Open the app →
            </a>
            <Link
              href={PAGES.docs}
              className="focus-ring rounded-pill border border-surface3Hovered px-s24 py-s16 text-body2 font-medium text-neutral1 no-underline hover:border-neutral1"
            >
              Read the docs
            </Link>
          </div>
        </div>
      </div>

      {/*
        The footline of the first screen. `NETWORK` is read off the protocol's own chain id rather
        than typed as "SN_MAIN", so a site built against anything else says so here instead of
        lying quietly.
      */}
      <div className="mx-auto mt-s32 flex w-full max-w-[1500px] flex-wrap items-center justify-between gap-s12 border-t border-surface3 py-s20">
        <span className="kicker flex items-center gap-s8">
          <span
            aria-hidden="true"
            className="site-live-dot inline-block size-s6 rounded-pill bg-accent1"
          />
          Live on {NETWORK}
        </span>
        <span className="kicker">No login · No seed phrase</span>
      </div>
    </section>
  )
}

/**
 * The refusal ticker: the phrases this product will not use about itself, struck through.
 *
 * ── THE LIST IS THE REAL ONE, WHICH IS THE ENTIRE POINT OF THE SECTION ────────────────────
 *
 * `FORBIDDEN_CLAIMS` is what the protocol package's tests hold the shipped copy modules to. The
 * design prototype for this page carried a different, invented ten — "fully anonymous",
 * "untraceable", "compliance is handled for you" — which are plausible, well written, and not the
 * list. A section whose whole claim is "we wrote down what we refuse to say" is the worst possible
 * place to show a list nobody wrote down, so it renders the array.
 *
 * They read as FRAGMENTS ("only you can", "amounts are private") because that is what they are:
 * substrings the tests sweep for, not sentences. Struck through in a row of things-we-will-not-say
 * that reads correctly, and `/docs/` explains the mechanism.
 *
 * ── AND WHY THE LIST IS RENDERED TWICE ────────────────────────────────────────────────────
 *
 * The track travels exactly one copy's width and loops, so the second copy is standing where the
 * first one started at the instant it resets. One copy would snap back visibly; three would cost
 * bytes for a seam nobody can see.
 */
function RefusalTicker() {
  return (
    <div
      className="overflow-hidden border-y border-surface3 py-s12"
      // Decoration for a claim the docs page states in prose. A screen reader meeting the same ten
      // phrases twice, out of order, with no way to know they are struck through, gets nothing from
      // it — so it is hidden here and readable there.
      aria-hidden="true"
    >
      <div className="site-ticker-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="flex shrink-0 items-center gap-s24 pr-s24">
            {FORBIDDEN_CLAIMS.map((claim) => (
              <span key={claim} className="flex shrink-0 items-center gap-s24">
                <span className="kicker whitespace-nowrap line-through decoration-accent1 decoration-2">
                  {claim}
                </span>
                <span className="size-s4 shrink-0 rotate-45 bg-surface3Hovered" />
              </span>
            ))}
            <span className="kicker whitespace-nowrap text-accent1">Things we will not say</span>
            <span className="size-s4 shrink-0 rotate-45 bg-surface3Hovered" />
          </div>
        ))}
      </div>
    </div>
  )
}

function Thesis() {
  return (
    <section className="px-s20 py-s60 lg:px-s40">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-s24">
        <span className="kicker">Why it exists</span>
        <p className="display m-0 text-display3 xl:text-display1">
          Every screen names who can see what — <span className="text-accent1">before you act.</span>{' '}
          Including the parties you did not choose.
        </p>
        <p className="m-0 max-w-[60ch] text-body3 text-neutral2">
          A privacy tool that overstates what it hides is worse than none at all, because its users
          act on the difference. The full model — what is hidden, what is public, and what we refuse
          to claim —{' '}
          <Link
            href={PAGES.docs}
            className="focus-ring text-accent1 underline underline-offset-4 hover:text-accent1Hovered"
          >
            is in the documentation
          </Link>
          .
        </p>
      </div>
    </section>
  )
}

function Surfaces() {
  return (
    <section className="px-s20 pb-s60 lg:px-s40">
      <div className="mx-auto max-w-[1500px]">
        <div className="flex items-baseline justify-between gap-s16 pb-s12">
          <span className="kicker">Seven surfaces, one pool</span>
          <span className="kicker">Status today</span>
        </div>

        <div className="flex flex-col border-t border-surface3">
          {SURFACE_STATUS.map((surface) => (
            <div
              key={surface.key}
              className="flex flex-wrap items-center gap-x-s24 gap-y-s8 border-b border-surface3 py-s20"
            >
              <span className="w-s28 shrink-0 font-mono text-body4 text-neutral3">{surface.n}</span>
              <span className="display text-display3 xl:text-display1">{surface.name}</span>
              <span className="flex-1 basis-s12" />
              {surface.note ? (
                <span className="max-w-[36ch] text-body4 text-neutral3 sm:text-right">
                  {surface.note}
                </span>
              ) : null}
              <span
                className={`kicker flex shrink-0 items-center gap-s8 ${STATE_INK[surface.state]}`}
              >
                <span
                  aria-hidden="true"
                  className={`size-s6 rounded-pill ${
                    surface.state === 'partial' ? 'bg-transparent' : 'bg-current'
                  }`}
                />
                {surface.status}
              </span>
            </div>
          ))}
        </div>

        <p className="m-0 pt-s16 font-mono text-body4 text-neutral3">
          Each surface says the same thing on its own screen. No fixture rows, no mock with
          plausible numbers in it.
        </p>
      </div>
    </section>
  )
}

/**
 * "Check the chain" — the record, inverted.
 *
 * THE INVERSION IS THE ARGUMENT MADE VISUALLY: this is the one block on the page that is not the
 * site talking about itself. `neutral1` as a FILL with `ground` as its ink is the app's own
 * inverted-panel recipe, lifted from its balance hero.
 */
function Proof() {
  return (
    <section className="bg-neutral1 px-s20 py-s48 text-ground lg:px-s40 lg:py-s60">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-s8">
        <span className="kicker">Don’t take our word for it</span>
        <h2 className="display m-0 pb-s20 pt-s6 text-display2 xl:text-display1">Check the chain</h2>

        <div className="flex flex-col border-t border-ground/20">
          {MAINNET_RECORD.map((row) => (
            <a
              key={row.address}
              href={row.href}
              {...EXTERNAL}
              className="focus-ring flex flex-wrap items-baseline gap-x-s16 gap-y-s4 border-b border-ground/15 py-s16 text-ground no-underline"
            >
              <span className="w-s60 shrink-0 font-mono text-body4 uppercase tracking-widest opacity-60">
                {row.kind}
              </span>
              <span className="shrink-0 text-body3 font-medium">{row.label}</span>
              <span className="flex-1 basis-s12" />
              <span className="max-w-full truncate font-mono text-body4 opacity-60">
                {row.address}
              </span>
              <span aria-hidden="true" className="shrink-0 font-mono text-body4">
                ↗
              </span>
            </a>
          ))}
        </div>

        <p className="m-0 max-w-[66ch] pt-s16 text-body4 opacity-70">
          Every row opens on Voyager, and every one of them was read back off the chain rather than
          copied out of a deployment log — the app contracts at block{' '}
          <span className="font-mono">{VERIFIED_AT_BLOCK.toLocaleString()}</span>. &ldquo;The
          transaction succeeded&rdquo; is a weaker claim than &ldquo;the class is there now&rdquo;.
        </p>
      </div>
    </section>
  )
}
