//
// THE PLANTS, AUTOMATED. Story 6.4's review found that its reserved-height gate was checking a
// declaration was SPELLED rather than that it RESERVED anything, and that four planted DELETIONS
// all went red while a planted WEAKENING sailed through. The lesson recorded there is the reason
// this file exists: deletion and weakening are different failure modes, and a plant-and-watch pass
// that only deletes is not evidence a gate works.
//
// It also closes a deferred item: neither `designProblems` nor `reservedHeightProblems` is executed
// by `pnpm test`, because `vitest.config.ts` collects `packages/*&#47;test/**` and `scripts/` sits
// outside it. The functions are pure over fabricated input specifically so a suite could drive
// them, and nothing did. Importing the `.mjs` directly needs no config change.
//
import { describe, it, expect } from 'vitest'
// @ts-expect-error - a .mjs gate with no type declarations; the whole point is to drive it as data.
import { readDesign, progressProblems } from '../../../scripts/assert-design-shipped.mjs'

/**
 * A stylesheet shaped like the emitted one: tokens first, then the rules that reference them.
 * `overrides` replaces whole declarations so a test can plant a deletion or a weakening.
 */
function sheet(overrides: Record<string, string> = {}) {
  const decls: Record<string, string> = {
    stepRowMinHeight: 'min-height: var(--spacing-s40);',
    stepRowHeight: 'height: var(--spacing-s40);',
    ringName: 'animation-name: pb-ring-spin;',
    ringEasing: 'animation-timing-function: var(--ease-linear);',
    ringDuration: 'animation-duration: var(--transition-duration-ring);',
    ringIterations: 'animation-iteration-count: infinite;',
    connector: 'border-inline-start: var(--spacing-s2) dotted var(--color-neutral3);',
    connectorHeight: 'height: var(--spacing-s8);',
    reconsent: 'min-height: var(--spacing-s40);',
    pipeline: 'min-height: var(--spacing-s40);',
    reducedMotion: 'animation-name: none;',
    ...overrides,
  }

  return `
    :root {
      --color-ground: #fcfaf6;
      --spacing-s0: 0px;
      --spacing-s2: 2px;
      --spacing-s8: 8px;
      --spacing-s40: 40px;
      --transition-duration-ring: 750ms;
      --ease-linear: linear;
      --ease-snap: cubic-bezier(0.17,0.67,0.45,1);
    }
    .step-row { ${decls.stepRowMinHeight} ${decls.stepRowHeight} }
    @keyframes pb-ring-spin { to { transform: rotate(360deg) } }
    .step-ring { ${decls.ringName} ${decls.ringEasing} ${decls.ringDuration} ${decls.ringIterations} }
    .step-connector { ${decls.connector} ${decls.connectorHeight} }
    .reconsent-row { ${decls.reconsent} }
    .pipeline-row { ${decls.pipeline} }
    @media (prefers-reduced-motion: reduce) { .step-ring { ${decls.reducedMotion} } }
  `
}

const verdict = (overrides?: Record<string, string>) =>
  progressProblems({ read: readDesign({ css: sheet(overrides), html: '<link rel=stylesheet>' }) })

describe('the gate passes a correctly built machine', () => {
  it('finds nothing wrong with the real shape', () => {
    expect(verdict()).toEqual([])
  })
})

describe('PLANTED DELETIONS all go red', () => {
  it('the row loses its min-height', () => {
    expect(verdict({ stepRowMinHeight: '' }).join(' ')).toContain('.step-row')
  })

  it('the row loses its height ceiling', () => {
    expect(verdict({ stepRowHeight: '' }).join(' ')).toContain('.step-row')
  })

  it('the ring loses its timing function', () => {
    expect(verdict({ ringEasing: '' }).join(' ')).toContain('linear')
  })

  it('the ring loses its animation-name', () => {
    // Added with story 6.6: the hole one property over from the duration check. The ring stops
    // turning while the curve, the duration and the iteration count all still read correctly.
    expect(verdict({ ringName: '' }).join(' ')).toContain('no animation-name')
  })

  it('the ring names a keyframes block that does not exist', () => {
    expect(verdict({ ringName: 'animation-name: pb-ring-spin-v2;' }).join(' ')).toContain(
      '@keyframes pb-ring-spin-v2',
    )
  })

  it('the ring stops iterating', () => {
    expect(verdict({ ringIterations: '' }).join(' ')).toContain('infinitely')
  })

  it('the connector is deleted', () => {
    expect(verdict({ connector: '' }).join(' ')).toContain('.step-connector')
  })

  it('the reduced-motion override is deleted', () => {
    // Deleting it ships an infinite spinner to a reader who asked the OS for stillness, with a
    // green build and no other symptom. The blanket `*` rule cannot cover it — a class selector
    // outranks the universal one.
    expect(verdict({ reducedMotion: '' }).join(' ')).toContain('reduced-motion')
  })
})

describe('PLANTED WEAKENINGS all go red — the mode 6.4 missed', () => {
  it('a row reserving zero instead of forty', () => {
    // Spelled correctly, reserves nothing. This is the exact plant that passed 6.4's first gate.
    const problems = verdict({ stepRowMinHeight: 'min-height: var(--spacing-s0);' })
    expect(problems.join(' ')).toContain('0px')
  })

  it('a row one pixel short', () => {
    const problems = verdict({ stepRowMinHeight: 'min-height: 39px;' })
    expect(problems.join(' ')).toContain('39px')
  })

  it('a row one pixel tall — constant means both ends, not just a floor', () => {
    expect(verdict({ stepRowHeight: 'height: 41px;' }).join(' ')).toContain('41px')
  })

  it('an EASED ring, which is the honesty defect rather than a layout one', () => {
    // Declared, resolvable, and a real curve from the sheet — every naive check passes it, and it
    // makes an indeterminate spinner appear to report progress it cannot see.
    const problems = verdict({ ringEasing: 'animation-timing-function: var(--ease-snap);' })
    expect(problems.join(' ')).toContain('cubic-bezier')
  })

  it('a ring on an unresolvable duration, which browsers drop to 0s in silence', () => {
    const problems = verdict({ ringDuration: 'animation-duration: var(--transition-duration-typo);' })
    expect(problems.join(' ')).toContain('duration')
  })

  it('a solid connector — dotted is the channel, not merely a border', () => {
    const problems = verdict({
      connector: 'border-inline-start: var(--spacing-s2) solid var(--color-neutral3);',
    })
    expect(problems.join(' ')).toContain('dotted')
  })

  it('a re-consent row shorter than the row it swaps into', () => {
    const problems = verdict({ reconsent: 'min-height: var(--spacing-s0);' })
    expect(problems.join(' ')).toContain('.reconsent-row')
  })

  it('a shell pipeline row shorter than the row height', () => {
    expect(verdict({ pipeline: 'min-height: var(--spacing-s0);' }).join(' ')).toContain(
      '.pipeline-row',
    )
  })

  it('A CONNECTOR WITH A BORDER AND NO HEIGHT — the one that actually shipped', () => {
    // This is the defect the review found in this very story: an empty block with a dotted border
    // and no height resolves to 0px, the channel disappears, and every wording check still passes.
    // It is the 6.4 failure — a declaration verified for its spelling rather than its effect —
    // committed again inside the story that added a gate to prevent it.
    const problems = verdict({ connectorHeight: '' })
    expect(problems.join(' ')).toContain('no readable height')
  })

  it('a connector collapsed to zero height', () => {
    expect(verdict({ connectorHeight: 'height: var(--spacing-s0);' }).join(' ')).toContain('0px')
  })

  it('a reduced-motion block that keeps the ring spinning', () => {
    // Present, non-empty, and does not stop the animation — the weakening a presence check misses.
    const problems = verdict({ reducedMotion: 'border-color: var(--color-neutral3);' })
    expect(problems.join(' ')).toContain('reduced-motion')
  })
})

describe('the gate reads the artifact, not the authored spelling', () => {
  it('accepts a minified duration in seconds', () => {
    // The minifier ships `750ms` as `.75s`. A check written against the authored unit passes only
    // on input the build never emits — this failed exactly once, for real, before being fixed.
    const css = sheet().replace('--transition-duration-ring: 750ms;', '--transition-duration-ring: .75s;')
    expect(progressProblems({ read: readDesign({ css, html: '' }) })).toEqual([])
  })

  it('an unreadable stylesheet is a failure, never a pass', () => {
    expect(progressProblems({ read: null }).length).toBe(1)
  })
})
