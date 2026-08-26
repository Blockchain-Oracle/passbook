import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { REGISTRATION_STAGES, SEND_STAGES } from '../src/pipeline-stage.js'
import {
  PROGRESS_CEILING,
  PROGRESS_FLOOR,
  PROVING_ABNORMAL_MS,
  PROVING_PATIENCE_MS,
  blockCountdown,
  clampProgress,
  elapsedLabel,
  foldMonotonic,
  isCurrent,
  monotonic,
  provingLabel,
  stepsFor,
} from '../src/progress.js'
import { forbiddenClaimsIn } from '../src/forbidden-claims.js'

const statuses = (rows: ReturnType<typeof stepsFor>) => rows.map((r) => r.status)

describe('steps as data — the pipeline shape comes from the stage list', () => {
  it('registration renders four rows and no Mature row', () => {
    const rows = stepsFor({ stages: REGISTRATION_STAGES, reached: ['build'] })
    expect(rows).toHaveLength(4)
    expect(rows.map((r) => r.stage)).not.toContain('mature')
    expect(statuses(rows)).toEqual(['active', 'preview', 'preview', 'preview'])
  })

  it('a send renders five, with prove spinning and build complete', () => {
    const rows = stepsFor({ stages: SEND_STAGES, reached: ['build', 'prove'] })
    expect(rows).toHaveLength(5)
    expect(statuses(rows)).toEqual(['complete', 'in-progress', 'preview', 'preview', 'preview'])
  })

  it('nothing reached yet is five previews, not a phantom active step', () => {
    expect(statuses(stepsFor({ stages: SEND_STAGES, reached: [] }))).toEqual([
      'preview',
      'preview',
      'preview',
      'preview',
      'preview',
    ])
  })

  it('reaching the terminal stage completes the pipeline rather than leaving it active forever', () => {
    const rows = stepsFor({ stages: SEND_STAGES, reached: [...SEND_STAGES] })
    expect(statuses(rows)).toEqual(['complete', 'complete', 'complete', 'complete', 'complete'])
  })

  it('a failure stops the pipeline where it failed and activates nothing after it', () => {
    const rows = stepsFor({
      stages: SEND_STAGES,
      reached: ['build', 'prove', 'relay'],
      failedAt: 'relay',
    })
    expect(statuses(rows)).toEqual(['complete', 'complete', 'failed', 'preview', 'preview'])
  })

  it('`Step N of M` appears on the current row only', () => {
    const rows = stepsFor({ stages: SEND_STAGES, reached: ['build', 'prove'] })
    expect(rows.map((r) => r.position)).toEqual([null, 'Step 2 of 5', null, null, null])
  })

  it('registration numbers out of four, not out of five', () => {
    const rows = stepsFor({ stages: REGISTRATION_STAGES, reached: ['build', 'prove', 'relay'] })
    expect(rows[2]!.position).toBe('Step 3 of 4')
  })
})

describe('history is never rewritten', () => {
  const rows = stepsFor({
    stages: SEND_STAGES,
    reached: ['build', 'prove'],
    replaced: ['prove'],
  })

  it('a replaced attempt stays on screen above its retry', () => {
    expect(statuses(rows)).toEqual([
      'complete',
      'replaced',
      'in-progress',
      'preview',
      'preview',
      'preview',
    ])
  })

  it('the dead attempt and the live one have distinct keys', () => {
    // Story 6.4's review found duplicate DOM ids when one token appeared in two sections. Same
    // stage twice in one list is the same defect waiting to happen.
    const keys = rows.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('numbering ignores the replaced row — it is the same step, not a sixth one', () => {
    expect(rows.find((r) => r.status === 'in-progress')!.position).toBe('Step 2 of 5')
  })
})

describe('a failure that is not in this pipeline is refused, never rendered as success', () => {
  it('throws rather than silently dropping a stage the pipeline does not have', () => {
    // `PipelineStage` is the send union, so a registration can legally be handed `mature`.
    // `indexOf` answers -1, which the first version read as "no failure" and rendered as a
    // pipeline still running — silence about a failure is the worst direction to fail in.
    expect(() =>
      stepsFor({ stages: REGISTRATION_STAGES, reached: ['build'], failedAt: 'mature' }),
    ).toThrow(/not one of this pipeline's stages/)
  })

  it('a failure the pipeline does have is fine', () => {
    expect(() =>
      stepsFor({ stages: REGISTRATION_STAGES, reached: ['build'], failedAt: 'build' }),
    ).not.toThrow()
  })
})

describe('a stage replaced twice gets two rows with two keys', () => {
  it('a proof that expired twice keeps both dead attempts, distinctly keyed', () => {
    const rows = stepsFor({
      stages: SEND_STAGES,
      reached: ['build', 'prove'],
      replaced: ['prove', 'prove'],
    })
    const replaced = rows.filter((r) => r.status === 'replaced')
    expect(replaced).toHaveLength(2)
    // One shared key would be the React collision 6.4's review found with duplicated tokens.
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length)
  })
})

describe('the determinate fill is refused for work we do not do', () => {
  it('a fill renders on build, which we compute', () => {
    const rows = stepsFor({ stages: SEND_STAGES, reached: ['build'], fill: 0.4 })
    expect(rows[0]!.fill).toBe(0.4)
  })

  it('a fill passed for the hosted prover comes back null anyway', () => {
    // The call site asked for a determinate bar over somebody else's computation. It does not get
    // one — the refusal lives here so no component can make this mistake.
    const rows = stepsFor({ stages: SEND_STAGES, reached: ['build', 'prove'], fill: 0.9 })
    expect(rows[1]!.status).toBe('in-progress')
    expect(rows[1]!.fill).toBeNull()
  })

  it('relay and mature refuse it too', () => {
    for (const stage of ['relay', 'mature'] as const) {
      const rows = stepsFor({ stages: SEND_STAGES, reached: ['build', 'prove', stage], fill: 0.7 })
      expect(rows.find((r) => r.stage === stage)!.fill, stage).toBeNull()
    }
  })

  it('a completed step carries no fill', () => {
    const rows = stepsFor({ stages: SEND_STAGES, reached: ['build', 'prove'], fill: 0.5 })
    expect(rows[0]!.fill).toBeNull()
  })
})

describe('the clamp', () => {
  it('zero becomes the floor and one becomes the ceiling', () => {
    expect(clampProgress(0)).toBe(PROGRESS_FLOOR)
    expect(clampProgress(1)).toBe(PROGRESS_CEILING)
  })

  it('holds outside the band in both directions', () => {
    expect(clampProgress(-5)).toBe(PROGRESS_FLOOR)
    expect(clampProgress(42)).toBe(PROGRESS_CEILING)
  })

  it('NaN clamps to the floor rather than escaping as NaN', () => {
    expect(clampProgress(Number.NaN)).toBe(PROGRESS_FLOOR)
    expect(clampProgress(Number.POSITIVE_INFINITY)).toBe(PROGRESS_CEILING)
  })
})

describe('progress is physically incapable of retreating', () => {
  it('a descending pair holds', () => {
    expect(foldMonotonic([0.6, 0.2])).toEqual([0.6, 0.6])
  })

  it('property: no output is ever less than the one before it, over arbitrary sequences', () => {
    // Deterministic pseudo-random rather than Math.random, so a failure is reproducible.
    let seed = 20260826
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648
      return seed / 2147483648
    }
    for (let run = 0; run < 200; run++) {
      const sequence = Array.from({ length: 24 }, () => next() * 1.4 - 0.2)
      const folded = foldMonotonic(sequence)
      for (let i = 1; i < folded.length; i++) {
        expect(folded[i]!).toBeGreaterThanOrEqual(folded[i - 1]!)
      }
      for (const value of folded) {
        expect(value).toBeGreaterThanOrEqual(PROGRESS_FLOOR)
        expect(value).toBeLessThanOrEqual(PROGRESS_CEILING)
      }
    }
  })

  it('monotonic clamps both arguments, so a retreat below the floor cannot sneak through', () => {
    expect(monotonic(0.5, -3)).toBe(0.5)
  })
})

describe('the copy ladder escalates by label swap', () => {
  it('under the patience threshold it counts elapsed time', () => {
    expect(provingLabel(14_000)).toBe('Proving — 0:14 elapsed')
  })

  it('at twenty seconds it becomes an instruction', () => {
    expect(provingLabel(PROVING_PATIENCE_MS)).toBe("Still proving. Don't close this tab.")
  })

  it('at ten minutes it says so', () => {
    expect(provingLabel(PROVING_ABNORMAL_MS)).toBe('This is taking longer than normal.')
  })

  it('never claims a duration it has not measured', () => {
    for (const ms of [0, 5_000, 19_999, 20_000, 599_999, 600_000, 3_600_000]) {
      expect(provingLabel(ms), String(ms)).not.toMatch(/about|~|approx/i)
    }
  })
})

describe('elapsed formatting', () => {
  it('pads seconds and not minutes', () => {
    expect(elapsedLabel(0)).toBe('0:00')
    expect(elapsedLabel(9_000)).toBe('0:09')
    expect(elapsedLabel(69_000)).toBe('1:09')
  })

  it('runs past an hour without rolling over into a wrong number', () => {
    expect(elapsedLabel(3_723_000)).toBe('62:03')
  })

  it('negative input floors at zero rather than rendering a minus', () => {
    expect(elapsedLabel(-5_000)).toBe('0:00')
  })

  it('NaN renders as zero, not as `NaN:NaN`', () => {
    // `Math.max(0, NaN)` is NaN, so the negative guard alone let it straight through to the DOM.
    expect(elapsedLabel(Number.NaN)).toBe('0:00')
    expect(elapsedLabel(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})

describe('block waits are counted, never a percentage, never negative', () => {
  it('counts the remainder', () => {
    expect(blockCountdown(6, 10)).toBe('Spendable in 4 more blocks.')
  })

  it('says block, singular, at one', () => {
    expect(blockCountdown(9, 10)).toBe('Spendable in 1 more block.')
  })

  it('at zero it degrades rather than counting down past it', () => {
    expect(blockCountdown(10, 10)).toBe('Available shortly')
    expect(blockCountdown(14, 10)).toBe('Available shortly')
  })

  it('never renders a percent sign', () => {
    for (let confirmed = 0; confirmed <= 12; confirmed++) {
      expect(blockCountdown(confirmed, 10)).not.toContain('%')
    }
  })
})

describe('status helpers', () => {
  it('both live statuses count as current, and no others do', () => {
    expect(isCurrent('active')).toBe(true)
    expect(isCurrent('in-progress')).toBe(true)
    for (const s of ['preview', 'complete', 'failed', 'replaced'] as const) {
      expect(isCurrent(s), s).toBe(false)
    }
  })
})

describe('the copy is clean', () => {
  it('no banned claim reaches any user-facing string in this module', () => {
    const source = readFileSync(new URL('../src/progress.ts', import.meta.url), 'utf8')
    expect(forbiddenClaimsIn(source)).toEqual([])
  })

  it('every ladder rung and countdown is clean', () => {
    const strings = [
      provingLabel(0),
      provingLabel(PROVING_PATIENCE_MS),
      provingLabel(PROVING_ABNORMAL_MS),
      blockCountdown(6, 10),
      blockCountdown(10, 10),
    ]
    for (const s of strings) expect(forbiddenClaimsIn(s), s).toEqual([])
  })
})
