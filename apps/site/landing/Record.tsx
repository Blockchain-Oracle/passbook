//
// The two bands that are a record rather than an argument: what is built, and what is on chain.
//
// Both are computed. `SURFACE_STATUS` keys off the protocol's own closed list of surfaces and off
// the evidence files the deploy scripts wrote; `MAINNET_RECORD` is addresses read back off the
// chain rather than copied out of a log. Split into this file so `Landing.tsx` stays a page and
// not a pile.
//
import { Band, Inner } from './Band'
import { EXTERNAL } from './SiteChrome'
import { MAINNET_RECORD, VERIFIED_AT_BLOCK } from '@/data/deployment'
import { SURFACE_STATUS, type SurfaceState } from '@/data/surfaces'

/** The ink each status takes. `partial` stays neutral: it is a qualifier, not a warning. */
const STATE_INK: Record<SurfaceState, string> = {
  live: 'text-accent1',
  partial: 'text-[color:var(--ink2)]',
  coming: 'text-exposed',
}

/**
 * Seven surfaces, one account — the band that carries the "not a wallet" claim as evidence.
 *
 * It reads as an index on purpose. A wallet has one surface; the argument this page is making is
 * that these seven share an account, and a list you can scan in three seconds makes that better
 * than a paragraph does.
 */
export function Surfaces() {
  return (
    <Band tone="light" className="py-s60">
      <Inner>
        <div className="flex flex-wrap items-baseline justify-between gap-s16 pb-s24">
          <p className="display m-0 text-display2 xl:text-display1">Seven surfaces, one account.</p>
          <span className="kicker text-[color:var(--ink3)]">Status today</span>
        </div>

        <div className="flex flex-col border-t border-[color:var(--line)]">
          {SURFACE_STATUS.map((surface) => (
            <div
              key={surface.key}
              className="flex flex-wrap items-center gap-x-s24 gap-y-s8 border-b border-[color:var(--line)] py-s20"
            >
              <span className="w-s28 shrink-0 font-mono text-body4 text-[color:var(--ink3)]">{surface.n}</span>
              <span className="display text-display3 xl:text-display1">{surface.name}</span>
              <span className="flex-1 basis-s12" />
              {surface.note ? (
                <span className="max-w-[36ch] text-body4 text-[color:var(--ink3)] sm:text-right">{surface.note}</span>
              ) : null}
              <span className={`kicker flex shrink-0 items-center gap-s8 ${STATE_INK[surface.state]}`}>
                <span
                  aria-hidden="true"
                  className={`size-s6 rounded-pill ${surface.state === 'partial' ? 'bg-transparent' : 'bg-current'}`}
                />
                {surface.status}
              </span>
            </div>
          ))}
        </div>

        <p className="m-0 pt-s16 font-mono text-body4 text-[color:var(--ink3)]">
          Each surface says the same thing on its own screen. No fixture rows, no mock with
          plausible numbers in it.
        </p>
      </Inner>
    </Band>
  )
}

/** The last band: the one place the page stops talking about itself and points at the chain. */
export function Proof() {
  return (
    <Band tone="light" className="py-s60">
      <Inner className="max-w-[1100px]">
        <span className="kicker text-[color:var(--ink3)]">Don’t take our word for it</span>
        <h2 className="display m-0 pb-s20 pt-s6 text-display2 xl:text-display1">Check the chain</h2>

        <div className="flex flex-col border-t border-[color:var(--line)]">
          {MAINNET_RECORD.map((row) => (
            <a
              key={row.address}
              href={row.href}
              {...EXTERNAL}
              className="focus-ring flex flex-wrap items-baseline gap-x-s16 gap-y-s4 border-b border-[color:var(--line)] py-s16 text-[color:var(--ink)] no-underline"
            >
              <span className="w-s60 shrink-0 font-mono text-body4 uppercase tracking-widest text-[color:var(--ink3)]">
                {row.kind}
              </span>
              <span className="shrink-0 text-body3 font-medium">{row.label}</span>
              <span className="flex-1 basis-s12" />
              <span className="max-w-full truncate font-mono text-body4 text-[color:var(--ink3)]">{row.address}</span>
              <span aria-hidden="true" className="shrink-0 font-mono text-body4">
                ↗
              </span>
            </a>
          ))}
        </div>

        <p className="m-0 max-w-[66ch] pt-s16 text-body4 text-[color:var(--ink2)]">
          Every row opens on Voyager, and every one of them was read back off the chain rather than
          copied out of a deployment log — the app contracts at block{' '}
          <span className="font-mono">{VERIFIED_AT_BLOCK.toLocaleString()}</span>. &ldquo;The
          transaction succeeded&rdquo; is a weaker claim than &ldquo;the class is there now&rdquo;.
        </p>
      </Inner>
    </Band>
  )
}
