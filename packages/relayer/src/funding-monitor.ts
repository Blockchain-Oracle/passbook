// Relayer funding monitor (FR-053 / AD-7, story 1.5). The relayer pays every fee it signs out
// of its own STRK balance; when that balance runs low, `apply_actions` starts reverting on the
// fee transfer — a revert that would look like OUR bug. Ops must be paged BEFORE that, and the
// user must see the ordinary relayer-down state, never a distinct funding string.
//
// WHY BALANCE AND NOT ALLOWANCE (Abu ruling, 2026-08-23). This module used to watch
// `STRK.allowance(relayer, pool)`, on the assumption that the relayer held a standing approval
// the pool drew fees from. It does not. `collect_fee` pulls from `get_caller_address()`, so the
// `STRK.approve(pool, fee)` rides INSIDE each submitted batch and is consumed by the
// `apply_actions` beside it (constants.ts:66-68, paymaster.ts:59-61). The standing allowance is
// therefore 0 in steady state — a quantity that cannot deplete, so watching it paged a false
// alarm at every boot and gating on it would have refused every submission forever. The balance
// is the thing that actually runs out, so the balance is what this watches.

export type FundingHealth = 'healthy' | 'low' | 'exhausted'

/**
 * How many live fees must remain before the relayer REFUSES work (Abu ruling, 2026-08-23).
 *
 * Two, not ten. This number decides when the relayer stops accepting submissions, so it has to
 * mean "very nearly unable to pay", and nothing else. A floor of ten fees put it in direct
 * conflict with this relayer's operating rule — fund the wallet with what the current batch
 * needs (see the server.ts header) — because a wallet funded that way would sit permanently
 * below the floor and refuse everything. At two, a small working balance clears the floor, and
 * the relayer only closes when it genuinely cannot cover the next couple of submissions.
 */
export const REFUSAL_FEE_MULTIPLE = 2n

/**
 * How many live fees must remain before OPS IS PAGED.
 *
 * Kept independent of the refusal floor rather than derived from it. When the floor was ten
 * fees, "warn at twice the floor" left twenty fees of runway and any relationship between the
 * two was fine. At a floor of two, the same rule warns at four — a margin of two submissions,
 * which at a five-minute poll can be gone before anyone reads the page, making the pre-emptive
 * warning pre-emptive in name only. Five fees is the smallest margin that still leaves room to
 * notice and act before the door closes.
 */
export const WARNING_FEE_MULTIPLE = 5n

/**
 * Classifies the relayer's spendable balance. `low` is the page-ops warning band (still fully
 * functional, ops should top up); `exhausted` means the next submission will revert on the fee
 * and the relayer refuses instead.
 *
 * Both thresholds are REQUIRED, and both should come from `fundingThresholds` — which is where
 * the invariant between them is enforced. An earlier version defaulted `warnWei` to
 * `floorWei * 2n`, which quietly meant unit tests exercised a threshold production never used:
 * the real warning is five live fees, the default computed four. A default that disagrees with
 * production is a test that passes against code nobody runs.
 */
export function classifyFunding(
  currentWei: bigint,
  floorWei: bigint,
  warnWei: bigint,
): FundingHealth {
  if (currentWei < floorWei) return 'exhausted'
  if (currentWei < warnWei) return 'low'
  return 'healthy'
}

/** Below this the relayer refuses to sign: not enough left to pay the next couple of fees. */
export function fundingFloor(liveFeeWei: bigint, burst = REFUSAL_FEE_MULTIPLE): bigint {
  return liveFeeWei * burst
}

/** Below this ops is paged, while the relayer is still working normally. */
export function warningFloor(liveFeeWei: bigint, burst = WARNING_FEE_MULTIPLE): bigint {
  return liveFeeWei * burst
}

/**
 * The two thresholds as a coherent pair, and the ONLY place their relationship is enforced.
 *
 * The warning must sit strictly above the refusal floor, or `low` is unreachable and the only
 * page anyone ever gets is the one that arrives with the door already shut. Nothing stops an
 * operator raising `burst` past the warning multiple, so the invariant is repaired here rather
 * than asserted in a comment: whenever the configured warning would fall at or below the floor,
 * it is lifted to twice the floor so the warning band always exists.
 */
export function fundingThresholds(
  liveFeeWei: bigint,
  { burst, warnBurst }: { burst?: bigint; warnBurst?: bigint } = {},
): { floor: bigint; warn: bigint } {
  const floor = fundingFloor(liveFeeWei, burst)
  const configured = warningFloor(liveFeeWei, warnBurst)
  return { floor, warn: configured > floor ? configured : floor * 2n }
}

/**
 * What the USER is shown for a given funding health. `low`/`healthy` are invisible to users
 * (an ops concern); `exhausted` degrades to the ordinary relayer-down state — never a distinct
 * "out of funds" string, which would leak our balance and read as our bug (FR-053).
 */
export function userFacingState(h: FundingHealth): 'ok' | 'relayer-down' {
  return h === 'exhausted' ? 'relayer-down' : 'ok'
}

/** Whether ops should be paged. Both `low` (pre-emptive) and `exhausted` page. */
export function shouldPageOps(h: FundingHealth): boolean {
  return h !== 'healthy'
}

/**
 * The one string a user sees when the relayer cannot submit, whatever the reason.
 *
 * Written to sit in the `PoolHealth` family's voice (pool.ts:15-20): say what happened, in
 * a sentence, and say what still works. Ops learns the cause from the page; the user learns
 * only that this route is closed and the other one is open. The relayer's balance never
 * appears here — a number would leak our funding state and read as our bug (FR-053).
 */
export const RELAYER_DOWN_NOTICE =
  'The relayer is not submitting right now. ' +
  'You can still submit from a funded Starknet wallet.'

/** `unknown` until the first read lands — see the note in `check()` about why it is not a fault. */
export type MonitorHealth = FundingHealth | 'unknown'

export interface FundingMonitorOptions {
  /** Live `STRK.balanceOf(relayer)`. Injected so the classifier stays testable offline. */
  readBalance: () => Promise<bigint>
  /** The live pool fee the floor is derived from — never a pinned number (pool.ts:99-103). */
  readFeeWei: () => Promise<bigint>
  /** Delivers an ops page. Must not throw: a failed page cannot become a failed check. */
  pageOps: (message: string) => void
  /** Poll period. Omitted or 0 means no timer at all, which is what tests want. */
  intervalMs?: number
  /** Refusal-floor multiple, passed through to `fundingFloor`. */
  burst?: bigint
  /** Warning-threshold multiple, passed through to `warningFloor`. Must exceed `burst`. */
  warnBurst?: bigint
}

export interface FundingMonitor {
  /** One read + classify + page-on-change. Never rejects. Returns the health it settled on. */
  check(): Promise<MonitorHealth>
  /** Begins polling, if a non-zero interval was configured. Idempotent. */
  start(): void
  stop(): void
  /** The most recent reading, which may be `unknown` when the last read failed. */
  health(): MonitorHealth
  /** What the submit path and, through it, the user is allowed to know. */
  userState(): 'ok' | 'relayer-down'
}

/**
 * The largest delay Node's timers accept. Beyond this the value overflows a signed 32-bit int
 * and setInterval silently clamps to 1ms — so a "poll once a month" setting becomes a thousand
 * RPC reads a second. It clamps rather than throws, which is why this has to be checked.
 */
export const MAX_TIMER_MS = 2_147_483_647

/**
 * Watches the relayer's funding and pages ops before it bites.
 *
 * Four decisions worth stating:
 *
 *   A FAILED READ IS NOT `exhausted`. It is `unknown`. This copies pool.ts's rule that "we could
 *   not reach the chain" and "the chain said no" are different sentences — and here the
 *   consequence is sharper: classifying an RPC blip as exhausted would turn every read failure
 *   into a self-inflicted relayer outage. The failure still pages ops.
 *
 *   BUT `unknown` DOES NOT CANCEL AN OUTAGE EITHER. The gate reads the last DEFINITE
 *   measurement, not the last reading. Otherwise the pair "balance is exhausted" then "read
 *   failed" silently reopens a gate that a real measurement closed — the relayer resumes signing
 *   transactions it cannot pay for, on the strength of not having been able to look. A failed
 *   read is an absence of news; it is not good news. Only a successful `healthy`/`low` read
 *   reopens the gate.
 *
 *   A NON-POSITIVE FEE IS ALSO `unknown`. A fee of 0 makes the floor 0, and every balance in
 *   existence clears a floor of 0 — the monitor would report `healthy` forever while measuring
 *   nothing. Being blind is a thing to say out loud, not a thing to report as health.
 *
 *   PAGES FIRE ON TRANSITIONS, not on every poll. A page every five minutes for a week is a
 *   page nobody reads, which is the same as no monitor. Entering a paging state pages once;
 *   recovering to healthy says so, so the resolution is visible without checking.
 */
export function createFundingMonitor(opts: FundingMonitorOptions): FundingMonitor {
  const { readBalance, readFeeWei, pageOps, intervalMs = 0, burst, warnBurst } = opts
  /** The most recent reading, `unknown` included. */
  let current: MonitorHealth = 'unknown'
  /** The most recent SUCCESSFUL measurement. Null only before the first one lands. */
  let lastDefinite: FundingHealth | null = null
  let paged: MonitorHealth | null = null
  let timer: NodeJS.Timeout | null = null
  let inFlight: Promise<MonitorHealth> | null = null

  function page(message: string): void {
    try {
      pageOps(message)
    } catch (e) {
      // A monitor that dies because its pager died is worse than an unpaged monitor.
      console.warn(`relayer: could not page ops: ${String(e)}`)
    }
  }

  /** Pages only when the state being entered is not the one already paged. */
  function pageOnce(state: MonitorHealth, message: string): void {
    if (paged === state) return
    paged = state
    page(message)
  }

  async function runCheck(): Promise<MonitorHealth> {
    let balance: bigint
    let feeWei: bigint
    try {
      ;[balance, feeWei] = await Promise.all([readBalance(), readFeeWei()])
    } catch (e) {
      current = 'unknown'
      pageOnce(
        'unknown',
        `relayer funding could not be read: ${String(e)}. Health is unknown, not exhausted.`,
      )
      return current
    }

    if (feeWei <= 0n) {
      current = 'unknown'
      pageOnce(
        'unknown',
        `relayer funding cannot be judged: the live fee read as ${feeWei}, which would make the ` +
          `floor 0 and every balance look healthy. Treating this as unknown rather than fine.`,
      )
      return current
    }

    const { floor, warn } = fundingThresholds(feeWei, { burst, warnBurst })
    current = classifyFunding(balance, floor, warn)
    lastDefinite = current
    if (shouldPageOps(current)) {
      pageOnce(
        current,
        `relayer STRK balance is ${current}: ${balance} wei against a refusal floor of ${floor} ` +
          `wei and a warning threshold of ${warn} wei (live fee ${feeWei} wei). ` +
          `Top up the relayer wallet.`,
      )
    } else if (paged !== null) {
      pageOnce(
        'healthy',
        `relayer STRK balance is healthy again: ${balance} wei, clear of the ${warn} wei ` +
          `warning threshold.`,
      )
    }
    return current
  }

  /**
   * Overlapping calls share one read. Without this the startup check and the first tick — or
   * two slow ticks — interleave, and `paged` is written by whichever finishes last: the state
   * machine that exists to make pages fire once would start dropping them, or firing twice.
   */
  function check(): Promise<MonitorHealth> {
    if (inFlight) return inFlight
    inFlight = runCheck().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  return {
    check,
    start(): void {
      if (timer) return
      // Both ends matter, and both fail the same way. A NaN interval makes setInterval fire
      // about every millisecond; so does one past 2^31-1, because Node clamps the overflow to 1
      // rather than rejecting it. Either way the "monitor" becomes a hot loop hammering an RPC
      // host, and the setting that caused it looks harmless in a config file.
      if (!Number.isInteger(intervalMs) || intervalMs < 0 || intervalMs > MAX_TIMER_MS) {
        throw new Error(
          `funding monitor interval must be an integer between 0 and ${MAX_TIMER_MS}, not ` +
            `${String(intervalMs)}`,
        )
      }
      if (intervalMs === 0) return
      timer = setInterval(() => void check(), intervalMs)
      // unref so a poll timer can never be the reason a process refuses to exit.
      timer.unref()
    },
    stop(): void {
      if (timer) clearInterval(timer)
      timer = null
    },
    health: () => current,
    // Driven by the last DEFINITE measurement, never by `current`. Before anything has been
    // measured there is nothing to act on, so the gate stays open; after that it reflects what
    // was actually seen, and a later failed read leaves it exactly where the measurement put it.
    userState: () => (lastDefinite === null ? 'ok' : userFacingState(lastDefinite)),
  }
}
