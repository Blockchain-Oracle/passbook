// What is TRUE of a launch right now — one word every launch surface renders its shape from, so
// "graduated" cannot mean three slightly different predicates on three surfaces.
import { LAUNCH_STATE, UNITS_PER_EPOCH, type OnChainLaunch } from '@strk20/protocol/app-reads'

export type Phase = 'selling' | 'sold-out' | 'graduated' | 'failed' | 'missed'

/** The launch surfaces' shared clock: once a minute keeps "closes in" honest without a timer per card. */
export const LAUNCH_CLOCK_MS = 60_000

export function phaseOf(launch: OnChainLaunch, nowMs: number): Phase {
  if (launch.state === LAUNCH_STATE.graduated) return 'graduated'
  if (launch.state === LAUNCH_STATE.failed) return 'failed'
  if (launch.sold >= launch.epochs * UNITS_PER_EPOCH) return 'sold-out'
  if (launch.deadline * 1000 <= nowMs) return 'missed'
  return 'selling'
}

export const PHASE_SENTENCE: Record<Exclude<Phase, 'selling'>, string> = {
  graduated: 'Graduated — the token is deployed and buyers redeem their units for it.',
  'sold-out': 'Sold out — every epoch filled. Graduation deploys the token.',
  failed: 'The raise failed. Every buyer reclaims in full.',
  missed: 'The deadline passed with the raise short. Every buyer reclaims in full — there is no half-launched limbo.',
}

export const PHASE_CHIP: Record<Phase, string> = {
  selling: 'Selling',
  'sold-out': 'Sold out',
  graduated: 'Graduated',
  failed: 'Refunding',
  missed: 'Refunding',
}

/** The launch's own state word, as `position-actions` spells it. */
export function launchStateWord(launch: OnChainLaunch): 'active' | 'graduated' | 'failed' {
  if (launch.state === LAUNCH_STATE.graduated) return 'graduated'
  if (launch.state === LAUNCH_STATE.failed) return 'failed'
  return 'active'
}
