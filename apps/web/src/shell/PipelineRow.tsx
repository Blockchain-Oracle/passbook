//
// The detached pipeline row (EXPERIENCE §4.2: "the pipeline detaches to a shell row on navigation").
//
// Mounted above the router outlet in `__root.tsx`. That placement IS the detach mechanism —
// navigating replaces the outlet's subtree and never unmounts this, so a running pipeline cannot
// be lost at the crossing because there is no crossing for it to be lost at.
//
import { useEffect, useState, useSyncExternalStore } from 'react'
import { elapsedLabel, isCurrent, provingLabel, stepsFor } from '@strk20/protocol/progress'
import { STAGE_TITLES } from '@strk20/protocol/pipeline-stage'
import {
  canCancel,
  cancelPipeline,
  getPipeline,
  subscribe,
} from './pipeline-store.js'

export function PipelineRow() {
  const pipeline = useSyncExternalStore(subscribe, getPipeline, getPipeline)
  const elapsedMs = useElapsed(pipeline?.startedAt ?? null)

  if (!pipeline) return null

  const steps = stepsFor({
    stages: pipeline.stages,
    reached: pipeline.reached,
    failedAt: pipeline.failedAt,
    replaced: pipeline.replaced,
  })
  const current = steps.find((step) => isCurrent(step.status))

  //
  // A TERMINAL PIPELINE SAYS SO AND STOPS COUNTING. The first version fell back to "Finishing"
  // whenever no step was current — which is exactly the failed case and the all-complete case — so
  // a failed send left the shell reading "Finishing · 12:03", ticking upward forever. Naming what
  // happened and freezing the clock is the difference between a status row and a stuck one.
  //
  const failed = pipeline.failedAt !== null
  const done = !failed && !current

  const detail = failed
    ? 'Stopped'
    : done
      ? `Done · ${elapsedLabel(elapsedMs)}`
      : // The shell row is wide enough for a sentence, which is why the escalating proving ladder
        // lives here and the 40px step row gets `mm:ss`. §7.7: the narrator is the label, not the
        // visual.
        current!.stage === 'prove'
        ? provingLabel(elapsedMs)
        : `${STAGE_TITLES[current!.stage]} · ${elapsedLabel(elapsedMs)}`

  return (
    <div className="pipeline-row" role="status" aria-label={pipeline.label}>
      <span className="text-body3">{pipeline.label}</span>
      {/*
        `aria-hidden` on the ticking half, and it is not a detail. This row is a polite live region;
        a counter that changes every second re-announces the whole row every second for the life of
        the pipeline, which is a screen reader talking over everything else the user is doing. The
        stage name still announces on change, which is the part that carries information.
      */}
      <span className="text-body4 numeric" aria-hidden="true">
        {detail}
      </span>
      <span className="sr-only">{failed ? 'Stopped' : done ? 'Done' : STAGE_TITLES[current!.stage]}</span>

      {/*
        Present only while cancelling is real. A greyed-out or no-op Cancel would be exactly the
        overclaim this epic's review gate exists to catch — see `pipeline-store.ts` on why
        submission is the boundary.
      */}
      {canCancel(pipeline) ? (
        <button
          type="button"
          className="focus-ring text-buttonLabel4"
          onClick={cancelPipeline}
        >
          Cancel
        </button>
      ) : null}
    </div>
  )
}

/**
 * A once-a-second tick, and only while something is running.
 *
 * The interval is torn down when the pipeline ends rather than left spinning against a null — an
 * idle app should not wake up every second forever, and this component lives in the shell where
 * "forever" is the whole session.
 */
function useElapsed(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (startedAt === null) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [startedAt])

  // The clock is derived, never accumulated: `Date.now() - startedAt` cannot drift, whereas a
  // counter incremented per tick loses time whenever the tab is backgrounded and the interval is
  // throttled — which is precisely what happens during a long prove.

  return startedAt === null ? 0 : Math.max(0, now - startedAt)
}
