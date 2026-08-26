//
// The global degraded strip (EXPERIENCE §5).
//
// ── A STRIP, NOT A BANNER, AND NEVER A MODAL ──────────────────────────────────────────────
//
// Every state this renders is something the user cannot fix and did not cause. A dialog would
// demand an acknowledgement for a fact, and §3's rule is that a warning implies a choice — most of
// what this app discloses is not a choice. So it is a hairline strip that states the situation and
// gets out of the way, and the CTA it affects carries its own reason via the blocker chain.
//
import {
  PAUSED_STOPPED,
  PAUSED_WORKS,
  degradedCopy,
  pausedChatLine,
  upgradedBody,
  type DegradedMode,
  type DegradedReading,
} from '@strk20/protocol/degraded'

export interface DegradedStripProps {
  mode: DegradedMode | null
  /**
   * Present only for `upgraded`. Taken from `DegradedReading` rather than restated, so the block
   * number's OPTIONALITY travels with it — a local restatement that made it required is what let
   * "at block 0" become expressible in the first place.
   */
  upgrade?: DegradedReading['upgrade']
  /** Present only for `paused` — §5 makes the chat line conditional on the reader having chat. */
  chat?: { openRooms: number; transportHealthy: boolean }
  onRetry?: () => void
}

export function DegradedStrip({ mode, upgrade, chat, onRetry }: DegradedStripProps) {
  // Nothing wrong, nothing rendered. Not an empty strip holding space — a healthy pool should
  // leave no trace in the chrome at all.
  if (mode === null) return null

  const copy = degradedCopy(mode)

  //
  // AN `action`-SCOPED STATE IS NEVER THE GLOBAL STRIP, and this guard is the enforcement rather
  // than the convention. `degraded.ts` argues at length that rendering `screening-declined`
  // app-wide would tell every user they were personally refused — and then this component rendered
  // whatever mode it was handed. The type carries the distinction; something has to read it.
  //
  if (copy.scope !== 'global') return null

  // `upgraded`'s body names a block when it has one, so the table cannot hold it as a constant.
  const body = mode === 'upgraded' ? (upgrade ? upgradedBody(upgrade.blockNumber) : null) : copy.body

  if (body === null || body === '') return null

  return (
    <div
      className="degraded-strip text-body3"
      data-severity={copy.severity}
      // `status`, not `alert`: polite. An interrupting announcement for a condition the user can
      // do nothing about talks over whatever they were actually reading.
      role="status"
    >
      <p>{body}</p>

      {mode === 'paused' && chat ? (
        <p>{pausedChatLine(chat.openRooms, chat.transportHealthy)}</p>
      ) : null}

      {mode === 'paused' ? (
        <>
          <p className="degraded-list text-body4">
            <span>Still works:</span>
            {PAUSED_WORKS.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </p>
          <p className="degraded-list text-body4">
            <span>Stopped:</span>
            {PAUSED_STOPPED.map((item) => (
              <span key={item}>{item}</span>
            ))}
          </p>
        </>
      ) : null}

      {/* Both hashes, and only when both are actually present — a labelled empty mono span is a
          field claiming to hold a value it does not have. */}
      {mode === 'upgraded' && upgrade?.pinned && upgrade.onchain ? (
        <p className="degraded-list text-body4">
          <span className="degraded-hash">pinned {upgrade.pinned}</span>
          <span className="degraded-hash">on-chain {upgrade.onchain}</span>
        </p>
      ) : null}

      {copy.retryAction && onRetry ? (
        <button type="button" className="focus-ring text-buttonLabel4" onClick={onRetry}>
          {copy.retryAction}
        </button>
      ) : null}
    </div>
  )
}
