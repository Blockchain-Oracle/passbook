//
// What is TRUE of a launch right now — one word every launch surface renders its shape from.
//
// Shared by the card, the table, and the detail page so "graduated" cannot mean three slightly
// different predicates on three surfaces.
//
import { LAUNCH_STATE, UNITS_PER_EPOCH, type OnChainLaunch } from '@strk20/protocol/app-reads'

export type Phase = 'selling' | 'sold-out' | 'graduated' | 'failed' | 'missed'

export function phaseOf(launch: OnChainLaunch, nowMs: number): Phase {
  if (launch.state === LAUNCH_STATE.graduated) return 'graduated'
  if (launch.state === LAUNCH_STATE.failed) return 'failed'
  const offered = launch.epochs * UNITS_PER_EPOCH
  if (launch.sold >= offered) return 'sold-out'
  if (launch.deadline * 1000 <= nowMs) return 'missed'
  return 'selling'
}

/** The phase as the sentence the surfaces say about it. The card and the page share the words. */
export const PHASE_SENTENCE: Record<Exclude<Phase, 'selling'>, string> = {
  graduated: 'Graduated — the token is deployed and buyers redeem their units for it.',
  'sold-out': 'Sold out — every epoch filled. Graduation deploys the token.',
  failed: 'The raise failed. Every buyer reclaims in full.',
  missed:
    'The deadline passed with the raise short. Every buyer reclaims in full — there is no half-launched limbo.',
}

/** The short chip form, for headers and table rows. */
export const PHASE_CHIP: Record<Phase, string> = {
  selling: 'Selling',
  'sold-out': 'Sold out',
  graduated: 'Graduated',
  failed: 'Refunding',
  missed: 'Refunding',
}

/** The pipeline stages, worded for a buy. Shared by the ticket dialog and the detail rail. */
export const STAGE_LABEL: Record<string, string> = {
  build: 'Building the buy…',
  prove: 'Proving…',
  relay: 'Signing and broadcasting…',
  mature: 'Waiting for the pool to accept it…',
  confirmed: 'Confirming on chain…',
}
