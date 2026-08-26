//
// The global degraded modes, as one copy table (story 6.5, EXPERIENCE §5 / FR-052).
//
// ── THIS MODULE HOLDS COPY. `pool.ts` HOLDS THE CLASSIFICATION. ───────────────────────────
//
// The predicates already exist and are already tested — `classifyPause` (two consecutive positive
// reads, never a failed one), `classHashMatches`, `screeningPolicyPresent`. They live beside the
// chain reads that feed them, and they reach `rpc.ts`. This file reaches nothing, so a component
// can import the sentence a user reads without importing a chain client (story 6.4's 268 kB
// lesson, and see `pipeline-stage.ts`).
//
// ── CLASSIFICATION PRECEDES COPY (§3 rule 4) ──────────────────────────────────────────────
//
// The single most important thing in this file is what is NOT merged. "We couldn't reach the
// screener" and "your deposit was refused" are one keystroke apart in a switch statement and are
// opposite claims about the user. Same for "the pool is paused" and "we couldn't reach the pool".
// Every entry below is its own key for that reason, and an ambiguous classification is required to
// default to the retryable one rather than to a determination we did not actually receive.
//

/**
 * Every named degraded state. Closed — a surface inventing a seventh is a compile error.
 *
 * `screening-flip` is the PRD addition (FR-052): the unreleased `OpenNoteScreeningPolicy
 * { Required }` rewrite reverts every value-bearing helper at once on a pool upgrade. It is a
 * named state precisely so it never renders as a silent revert that looks like our bug.
 */
export type DegradedMode =
  | 'paused'
  | 'upgraded'
  | 'screening-flip'
  | 'screening-declined'
  | 'prover-down'
  | 'screener-unreachable'
  | 'offline'

/**
 * Whether this state stops the whole app or just the action the user attempted.
 *
 * TYPED, BECAUSE THE DISTINCTION IS THE COPY'S MEANING. `screening-declined` is about one deposit
 * and `screening-flip` refuses everyone. Rendering the per-deposit sentence as a global strip
 * would tell every user they personally were refused; rendering the global one on a single failed
 * deposit would tell a refused user the pool is down. The two are adjacent and opposite.
 */
export type DegradedScope = 'global' | 'action'

export interface DegradedCopy {
  scope: DegradedScope
  /**
   * `grey` for facts and administrative stops, `amber` for the retryable.
   *
   * ONLY WHAT §5 EXPLICITLY CALLS AMBER IS AMBER. The table names amber for the screener timeout
   * and for relayer-down (which is 1-16's, not here); it does not assign a colour to the others,
   * and "the most severe state renders calmest" makes grey the honest default rather than an
   * omission to fill in. Guessing here would spend colour on severity nobody authored.
   */
  severity: 'grey' | 'amber'
  /** The sentence, byte-exact from §5. */
  body: string
  /** What the blocked CTA says instead of its action (§7.10, `label = blocker ?? action`). */
  blocker: string
  /** Present only where §5 gives the user something to press. */
  retryAction?: string
}

const TABLE: Readonly<Record<DegradedMode, DegradedCopy>> = {
  paused: {
    scope: 'global',
    severity: 'grey',
    body: 'The pool is paused by its operator. Reading works; new actions resume when it does.',
    blocker: 'The pool is paused by its operator',
  },

  upgraded: {
    scope: 'global',
    severity: 'grey',
    // The body is completed by `upgradedBody()` — it names a block, so it cannot be a constant.
    body: '',
    blocker: 'The pool was upgraded',
  },

  'screening-flip': {
    scope: 'global',
    severity: 'grey',
    //
    // AUTHORED HERE, AND NOWHERE ELSE. EXPERIENCE §5 marks this state's copy `[GAP — not authored
    // in any source]` and the epic forbids inventing it silently, so it was drafted under the §3
    // rules and RATIFIED BY ABU on 2026-08-26 before it shipped.
    //
    // The second sentence is the load-bearing one. `screening-declined` below is about one
    // deposit; this refuses everyone. Without the disclaimer a user reads the two as the same
    // event and concludes they were personally rejected, which is false and unfixable by them.
    //
    body:
      "The pool changed how deposits are screened, and every new deposit is being refused until it's " +
      "updated. This isn't about your deposit — nothing was submitted, nothing was charged, and no " +
      'tokens moved. Your balance, your history and your chat rooms are unaffected.',
    blocker: 'New deposits are being refused',
  },

  'screening-declined': {
    scope: 'action',
    severity: 'grey',
    body:
      "This deposit wasn't approved to enter the pool. Nothing was submitted — no transaction was " +
      'created, no tokens moved, no fee was charged. Every deposit is screened by a compliance ' +
      "provider the pool operator chose; we don't receive a reason and can't override it.",
    blocker: "This deposit wasn't approved to enter the pool",
  },

  'prover-down': {
    scope: 'global',
    severity: 'grey',
    body:
      "We can't reach the proving service. Proving and compliance screening both run on StarkWare's " +
      "hosted service — it isn't ours and we can't route around it. Your notes and history are " +
      'unaffected; they decrypt locally from your key.',
    blocker: "We can't reach the proving service",
  },

  'screener-unreachable': {
    scope: 'global',
    // The one §5 explicitly calls amber, and the one with something to press.
    severity: 'amber',
    body:
      "We couldn't reach the compliance screener. Nothing was submitted and nothing was charged. " +
      'Try again in a minute.',
    blocker: "We couldn't reach the compliance screener",
    retryAction: 'Try again',
  },

  offline: {
    scope: 'global',
    severity: 'grey',
    // One of the three sanctioned offline strings (§3 rule 4). The other two name the indexer and
    // the pool, and neither is what an unreachable transport means.
    body: "You're offline",
    blocker: "You're offline",
  },
}

export function degradedCopy(mode: DegradedMode): DegradedCopy {
  return { ...TABLE[mode] }
}

/**
 * The upgraded body, which names the block the upgrade landed at.
 *
 * The block is the whole point: "the pool was upgraded" is unverifiable and "at block 13,412,556"
 * can be checked in an explorer in ten seconds. Both hashes render in mono beside it (§5).
 */
export function upgradedBody(blockNumber?: number): string {
  const tail =
    "We've stopped new actions until we've verified our contracts still work with it. " +
    'Your notes are unaffected.'

  // NO BLOCK, NO CLAIM ABOUT A BLOCK. The dated sentence is better when the number is real and a
  // lie when it is not — and the undated one loses nothing the user needs, because the two class
  // hashes beside it are the checkable part either way.
  return blockNumber === undefined
    ? `The pool was upgraded. ${tail}`
    : `The pool was upgraded at block ${blockNumber.toLocaleString('en-US')}. ${tail}`
}

/**
 * What the paused strip's detail panel lists — AS A LIST, not prose (§5).
 *
 * A paragraph saying "you can still read your balance and history and the global feed" is read as
 * reassurance and skimmed. Six items with a heading is read as an inventory and believed, which is
 * the difference between a user who waits and a user who assumes the app is broken.
 */
export const PAUSED_WORKS: readonly string[] = [
  'Balance',
  'History',
  'Global feed',
  'Open chat rooms',
  'Drafts',
  'Browsing',
]

export const PAUSED_STOPPED: readonly string[] = ['Every pool transaction']

/**
 * The paused strip's chat line, which §5 makes conditional on the reader actually having chat.
 *
 * `Chat still works` is a promise, and to a user with no open room and a dead transport it is a
 * false one — they would tap through to find nothing works. So the claim is only made to the
 * people it is true for, and everyone else gets the honest limitation instead.
 *
 * Chat is structurally immune to every pool degradation because it is zero-deposit: messages
 * travel off-chain and a paused pool cannot stop them. Opening a NEW room is a pool transaction
 * and cannot happen, which is exactly the split these two sentences draw.
 */
export function pausedChatLine(openRooms: number, transportHealthy: boolean): string {
  return openRooms >= 1 && transportHealthy
    ? 'Chat still works — messages travel off-chain.'
    : "New rooms can't open while the pool is paused."
}

export interface DegradedReading {
  mode: DegradedMode | null
  /**
   * Present only for `upgraded`, and only when the reading actually carried the facts.
   *
   * `blockNumber` is OPTIONAL because `PoolHealth`'s upgraded variant does not have one —
   * `readPoolHealth` returns as soon as the class hashes disagree, before it reads a height. An
   * earlier version defaulted it to `0` and the strip rendered "The pool was upgraded at block 0",
   * which is a fabricated fact in the one sentence whose whole job is to be checkable.
   */
  upgrade?: { blockNumber?: number; pinned: string; onchain: string }
}

/**
 * Maps a `PoolHealth` reading onto the named degraded mode a user sees.
 *
 * LIVES HERE RATHER THAN IN THE APP because it is logic, and `vitest.config.ts` collects
 * `packages/*&#47;test/**` only — a pure function under `apps/web` is a pure function nothing runs.
 * The paused and upgraded branches cannot be forced live, which makes a unit test the only
 * evidence they behave, exactly as it is for `pool.ts`'s own classifiers.
 *
 * Typed structurally rather than against `PoolHealth` itself: importing that type would erase at
 * build time, but it puts `pool.ts` in this leaf's resolution graph, and one careless later edit
 * turns a type import into a value import that drags a chain client into the browser.
 *
 * ── WHY `unreachable` USUALLY RESOLVES TO NOTHING ─────────────────────────────────────────
 *
 * §3 rule 4 sanctions exactly three offline strings: `You're offline`, `Our indexer is
 * unreachable`, and `The pool is paused by its operator`. A failed pool read is none of them — it
 * is not the indexer, and calling it a pause is the specific confusion `classifyPause` exists to
 * prevent. When the browser reports being offline we say the true thing; otherwise we say nothing
 * rather than inventing a fourth string.
 */
export function degradedFromHealth(
  health: { state: string; pinned?: string; onchain?: string; blockNumber?: number },
  online: boolean,
  screeningFlipped: boolean,
): DegradedReading {
  // Checked first: a screening flip refuses every deposit, and it is the state most likely to be
  // mistaken for our own bug.
  if (screeningFlipped) return { mode: 'screening-flip' }

  switch (health.state) {
    case 'paused':
      return { mode: 'paused' }
    case 'upgraded':
      return {
        mode: 'upgraded',
        upgrade: {
          // Carried through only when present. `PoolHealth.upgraded` has no `blockNumber` field at
          // all today, so this is normally absent — and `upgradedBody` has an undated sentence for
          // exactly that case rather than printing a zero.
          ...(Number.isFinite(health.blockNumber) ? { blockNumber: health.blockNumber } : {}),
          pinned: health.pinned ?? '',
          onchain: health.onchain ?? '',
        },
      }
    case 'unreachable':
      return { mode: online ? null : 'offline' }
    default:
      return { mode: null }
  }
}
