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
import { Faq, Offer } from './Sections'
import { Walkthrough } from './Walkthrough'
import { Surfaces, Proof } from './Record'
import { Band, Inner } from './Band'
import { MockScreen } from './MockScreen'
import { APP_URL } from '@/lib/shared'
import { NETWORK } from '@/data/deployment'

export function Landing() {
  return (
    <SitePage current="landing">
      {/*
        THE BAND SEQUENCE, and no two neighbours share a tone. The alternation is the page's
        rhythm — dark where it makes a claim, light where it shows evidence — and it is a property
        of each section rather than a theme the reader picks. See `Band.tsx`.
      */}
      <Hero />
      <RefusalTicker />
      <Offer />
      <Walkthrough />
      <Thesis />
      <Surfaces />
      <Faq />
      <Proof />
    </SitePage>
  )
}

function Hero() {
  return (
    <Band tone="dark" className="flex min-h-[calc(100vh-72px)] flex-col justify-between pt-s36 lg:pt-s48">
      <div className="mx-auto w-full max-w-[1500px]">
        {/*
          FOUR LINES, AND THE COLOURED ONE IS THE CLAIM. "Everything" is the word doing the work:
          a wallet holds, and every competitor on this pool sells holding. What is being sold here
          is the doing — swap, bet, launch, vote — and the account is what makes those one identity
          instead of seven. "Private account" survives the copy rules where "private wallet" would
          have described the smallest room in the house.
        */}
        <h1 className="display m-0 text-display1 md:text-poster2 xl:text-poster1">
          <span className="block">Everything</span>
          <span className="block">on Starknet,</span>
          <span className="block pl-s36 lg:pl-s60">from one</span>
          <span className="block pl-s36 text-accent1 lg:pl-s60">private account.</span>
        </h1>

        {/*
          NO SUB-HEADLINE. There was a paragraph here explaining the account and listing the
          surfaces, and it was doing work the page does better elsewhere: the surfaces have their
          own band, the walkthrough shows the account being used, and saying "not a wallet" in
          prose is weaker than a headline that simply is not about one. ZK Freighter's hero is H1
          plus two buttons for the same reason — a first screen that argues has already lost.
        */}
        <div className="mt-s32 flex flex-wrap items-end justify-between gap-s24">
          <div className="max-w-[46ch]">
            {/*
              The offer, and the only line left standing here — it is the reason to click, so it
              sits where the click is. The underline draws itself once on load rather than sitting
              there: it is a rule under a promise about money, and a rule that arrives is read.
            */}
            <p className="m-0 text-body1 text-neutral1">
              <span className="site-underline text-accent1">Your first three transactions are on us.</span>{' '}
              Real STRK, on mainnet.
            </p>
          </div>
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
      {/*
        THE PRODUCT, ABOVE THE FOLD, CROPPED ON PURPOSE.

        A landing page for a wallet that shows no wallet until the third section is asking to be
        taken on trust — which is the one thing this product does not do anywhere else. It is
        cropped rather than fitted because a screen that peeks reads as a real surface continuing
        past the edge, where a whole one shrunk to fit reads as a picture of a surface. `maxHeight`
        does the cropping; the mask fades the cut so it is a horizon and not a slice.

        Hidden below `lg`: at phone widths this scales to an unreadable smudge, and an illustration
        nobody can read is weight with no argument in it. The section that owns the full screen is
        further down and shows it uncropped.
      */}
      <div className="mx-auto hidden w-full max-w-[1500px] lg:block">
        <div className="[mask-image:linear-gradient(to_bottom,black_60%,transparent)]">
          <div className="overflow-hidden rounded-t-[12px] border-x border-t border-surface3 bg-raised">
            <MockScreen src="/mock-wallet.html" width={1180} height={760} maxHeight={300} />
          </div>
        </div>
      </div>

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
    </Band>
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
      // Explicitly dark rather than inheriting: it is a thin strip closing the hero's dark run,
      // and a band with no stated tone is one that changes silently when its neighbour moves.
      className="band-dark overflow-hidden border-y border-[color:var(--line)] py-s12"
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
    <Band tone="dark" className="py-s60">
      <Inner className="flex max-w-[1100px] flex-col gap-s24">
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
      </Inner>
    </Band>
  )
}
