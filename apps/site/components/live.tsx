//
// The components MDX uses instead of writing a fact down.
//
// Each one renders from a source that cannot be out of date: the evidence files the deploy scripts
// wrote, or the protocol package the app itself imports. A paragraph claiming any of this would be
// a paragraph that is true on the day it is written.
//
import { FORBIDDEN_CLAIMS } from '@strk20/protocol/forbidden-claims'

import { MAINNET_RECORD, VERIFIED_AT_BLOCK } from '@/data/deployment'
import { SURFACE_STATUS, type SurfaceState } from '@/data/surfaces'
import { WHO_SEES_WHAT } from '@/data/who-sees-what'

const STATE_INK: Record<SurfaceState, string> = {
  live: 'text-accent1',
  partial: 'text-neutral2',
  coming: 'text-exposed',
}

/**
 * The ten phrases this product will not use about itself.
 *
 * `FORBIDDEN_CLAIMS` is the array the protocol package's copy tests enforce. They read as FRAGMENTS
 * ("only you can", "amounts are private") because that is what they are — substrings swept for, not
 * sentences — and the page around this component says so.
 */
export function RefusedClaims() {
  return (
    <ul className="my-s20 flex list-none flex-wrap gap-s8 p-0">
      {FORBIDDEN_CLAIMS.map((claim) => (
        <li
          key={claim}
          className="rounded-pill border border-surface3 px-s12 py-s8 font-mono text-body4 text-neutral3 line-through decoration-accent1 decoration-2"
        >
          {claim}
        </li>
      ))}
    </ul>
  )
}

/** Where each of the six surfaces stands. Markets and Launch are computed from the evidence file. */
export function SurfaceStatus() {
  return (
    <div className="my-s20 overflow-hidden rounded-card border border-surface3 not-prose">
      {SURFACE_STATUS.map((surface, i) => (
        <div
          key={surface.key}
          className={`flex flex-wrap items-baseline gap-x-s20 gap-y-s6 p-s16 ${
            i < SURFACE_STATUS.length - 1 ? 'border-b border-surface3' : ''
          }`}
        >
          <span className="basis-[90px] text-body2 font-medium text-neutral1">{surface.name}</span>
          <span className={`kicker basis-[150px] ${STATE_INK[surface.state]}`}>
            {surface.status}
          </span>
          <span className="min-w-0 flex-1 basis-[280px] text-body3 text-neutral2">
            {surface.body}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Who learns what, as a table of parties rather than of actions. */
export function WhoSeesWhat() {
  return (
    <div className="my-s20 overflow-hidden rounded-card border border-surface3 not-prose">
      {WHO_SEES_WHAT.map((row, i) => (
        <div
          key={row.who}
          className={`flex flex-wrap items-baseline gap-x-s20 gap-y-s6 p-s16 ${
            i < WHO_SEES_WHAT.length - 1 ? 'border-b border-surface3' : ''
          }`}
        >
          <span className="kicker basis-[190px] text-accent1">{row.who}</span>
          <span className="min-w-0 flex-1 basis-[300px] text-body3 text-neutral2">{row.what}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Every address and transaction, each row naming the file its value came out of.
 *
 * The source column is what makes this a record rather than a list: a reader who does not trust the
 * page can go and diff it against the repository.
 */
export function MainnetRecord() {
  return (
    <div className="not-prose my-s20 flex flex-col gap-s12">
      <div className="overflow-hidden rounded-card border border-surface3">
        {MAINNET_RECORD.map((row, i) => (
          <a
            key={row.address}
            href={row.href}
            target="_blank"
            rel="noopener noreferrer"
            className={`focus-ring flex flex-wrap items-baseline gap-x-s20 gap-y-s4 p-s16 text-neutral1 no-underline hover:bg-raised ${
              i < MAINNET_RECORD.length - 1 ? 'border-b border-surface3' : ''
            }`}
          >
            <span className="kicker basis-[70px]">{row.kind}</span>
            <span className="basis-[250px] text-body3 font-medium">{row.label}</span>
            <span className="min-w-0 flex-1 basis-[260px] break-all font-mono text-body4 text-neutral3">
              {row.address} ↗
            </span>
            <span className="basis-full font-mono text-body4 text-neutral3">{row.source}</span>
          </a>
        ))}
      </div>
      <p className="m-0 text-body4 text-neutral3">
        App contracts read back off the chain at block{' '}
        <span className="font-mono">{VERIFIED_AT_BLOCK.toLocaleString()}</span>. Every row opens on
        Voyager.
      </p>
    </div>
  )
}
