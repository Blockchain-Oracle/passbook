//
// A surface that is not live yet (Uniswap `BaseCard.EmptyState` and `NoPositionsBanner` are the
// models).
//
// ── AN HONEST COMING-STATE IS NOT A BARE SENTENCE ────────────────────────────────────────
//
// The four surfaces that are not built said one grey line each and nothing else. That reads as an
// unfinished page rather than a decision, and it is the same in every case — so a reader learns
// nothing about which of them is close and which is far.
//
// Uniswap's answer is that an empty state is a DESIGNED state: a bordered field with its own
// texture, a heading at the same size as a real one, and — in the richest version — an actual
// populated table of what exists elsewhere, so nothing on screen is a placeholder. This is that
// shape, minus the table, plus the one thing this product can honestly add: what IS true today.
//
// ── AND IT SAYS WHAT IS ALREADY REAL, WHICH IS THE PART THAT COSTS SOMETHING ─────────────
//
// Each of these surfaces already has machinery behind it — the pool is deployed, the disclosure
// panel exists, the linkability meter reads a live crowd. Listing that is not a roadmap; it is the
// difference between "nothing here" and "this part works, that part does not". Claims here are
// held to the same standard as everywhere else: nothing is listed that has not shipped.
//
// The grid texture is `.dotted-grid`, which has been in this stylesheet since the design system
// landed and had no consumer — `index.css:88` says so. It is the authority's one permitted texture
// and this is the first place it earns its place.
//
import type { ReactNode } from 'react'

import { cn } from '../lib/cn'
import { Text } from './ui/Text'

export interface ComingStateProps {
  title: string
  /** One or two sentences on what the surface will do. Present tense, no dates, no story numbers. */
  description: string
  /**
   * What is already true, as short clauses.
   *
   * Each one must be a thing that has SHIPPED — this is the list a reader uses to judge whether
   * the rest is plausible, so a single aspirational entry makes the whole panel worthless.
   */
  alreadyTrue?: readonly string[]
  /** An icon or mark. Optional; the panel reads fine without one. */
  icon?: ReactNode
}

export function ComingState({ title, description, alreadyTrue = [], icon }: ComingStateProps) {
  return (
    <div
      className={cn(
        'dotted-grid flex flex-col items-center gap-s16 rounded-large border border-solid',
        'border-surface3 bg-accent2 px-s24 py-s32 text-center',
      )}
    >
      {icon ? <span className="text-neutral3">{icon}</span> : null}

      <div className="flex max-w-[520px] flex-col gap-s8">
        <Text variant="heading3" as="h2">
          {title}
        </Text>
        <Text variant="body2" className="text-neutral2">
          {description}
        </Text>
      </div>

      {alreadyTrue.length > 0 ? (
        <div className="flex w-full max-w-[520px] flex-col gap-s8 text-left">
          <Text variant="body4" className="text-neutral2">
            Already working
          </Text>
          <ul className="flex flex-col gap-s6">
            {alreadyTrue.map((claim) => (
              <li key={claim} className="flex items-start gap-s8">
                {/*
                  A filled dot, not a tick. A tick reads as "done" for the SURFACE, which is the one
                  thing this panel exists to say is not true.
                */}
                <span aria-hidden="true" className="mt-s8 size-s4 shrink-0 rounded-pill bg-settled" />
                <Text variant="body3" className="text-neutral1">
                  {claim}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
