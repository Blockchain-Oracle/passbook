//
// THE PLANTS, AUTOMATED — the activity feed's fourth verdict (story 6.6).
//
// Same discipline as `progress-gate.test.ts`, for the reason recorded there: deletion and weakening
// are different failure modes, and a plant-and-watch pass that only deletes is not evidence a gate
// works. Every declaration `activityProblems` reads is planted twice.
//
// The two that matter most are the inverses of each other. `.step-ring` MUST animate — the gate
// beside this one fails if its curve is not linear. `.activity-ring-static` must NOT, and this file
// proves the gate notices when someone gives it a spin, which is the regression a still circle
// invites from anyone who thinks it looks unfinished.
//
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
// @ts-expect-error - a .mjs gate with no type declarations; the whole point is to drive it as data.
import { readDesign, activityProblems } from '../../../scripts/assert-design-shipped.mjs'

/** A stylesheet shaped like the emitted one: tokens first, then the rules that reference them. */
function sheet(overrides: Record<string, string> = {}) {
  const decls: Record<string, string> = {
    tabSelector: '.activity-tab[data-active]',
    tabFill: 'background-color: var(--color-inset);',
    tabWeight: 'font-weight: var(--font-weight-medium);',
    rightMinWidth: 'min-width: var(--spacing-s60);',
    ringBorder: 'border: var(--spacing-s2) solid var(--color-neutral3);',
    ringAnimation: '',
    attentionName: 'animation-name: pb-attention;',
    attentionKeyframes:
      '0%, 100% { background-color: transparent } 30% { background-color: var(--color-accent2) }',
    attentionIterations: 'animation-iteration-count: 1;',
    attentionDuration: 'animation-duration: var(--transition-duration-attention);',
    attentionReducedMotion: 'animation-name: none;',
    ...overrides,
  }

  return `
    :root {
      --color-ground: #fcfaf6;
      --spacing-s0: 0px;
      --spacing-s2: 2px;
      --spacing-s60: 60px;
      --color-neutral3: rgba(28,24,19,0.38);
      --color-inset: #f2ede4;
      --color-accent2: rgba(140,47,30,0.08);
      --color-accent2Faint: rgba(140,47,30,0.02);
      --font-weight-medium: 535;
      --transition-duration-attention: 1200ms;
      --transition-duration-simple: 80ms;
      --ease-attention: cubic-bezier(0.17,0.17,0,1);
    }
    ${decls.tabSelector} { ${decls.tabFill} ${decls.tabWeight} }
    .activity-right { ${decls.rightMinWidth} }
    .activity-ring-static { ${decls.ringBorder} ${decls.ringAnimation} }
    @keyframes pb-attention { ${decls.attentionKeyframes} }
    .attention-highlight .option-row-inner {
      ${decls.attentionName} ${decls.attentionIterations} ${decls.attentionDuration}
    }
    @media (prefers-reduced-motion: reduce) {
      .attention-highlight .option-row-inner { ${decls.attentionReducedMotion} }
    }
  `
}

const verdict = (overrides?: Record<string, string>) =>
  activityProblems({ read: readDesign({ css: sheet(overrides), html: '<link rel=stylesheet>' }) })

describe('the gate passes a correctly built feed', () => {
  it('finds nothing wrong with the real shape', () => {
    expect(verdict()).toEqual([])
  })

  it('and reports the read failing rather than passing vacuously', () => {
    expect(activityProblems({ read: null }).join(' ')).toContain('could not be read')
  })
})

describe('PLANTED DELETIONS all go red', () => {
  it('the right edge loses its reserve, so it stops being a slot', () => {
    expect(verdict({ rightMinWidth: '' }).join(' ')).toContain('.activity-right')
  })

  it('the static ring loses its border, so the maturing state renders an empty box', () => {
    expect(verdict({ ringBorder: '' }).join(' ')).toContain('.activity-ring-static')
  })

  it('the attention highlight loses its iteration count', () => {
    // CSS defaults it to 1, so the cue still plays once — but nobody decided that, and the next
    // author who adds `infinite` finds nothing objecting.
    expect(verdict({ attentionIterations: '' }).join(' ')).toContain('exactly one play')
  })

  it('the attention highlight loses its duration', () => {
    expect(verdict({ attentionDuration: '' }).join(' ')).toContain('never plays')
  })

  it('the attention highlight loses its animation-name', () => {
    // The hole one property over from the duration check, and it was open: the cue stops playing
    // while the duration, the iteration count and the reduced-motion override all still read
    // correctly. Nobody misses a highlight they have never seen.
    expect(verdict({ attentionName: '' }).join(' ')).toContain('no animation-name')
  })

  it('the reduced-motion override is deleted', () => {
    expect(verdict({ attentionReducedMotion: '' }).join(' ')).toContain('reduced-motion')
  })
})

describe('THE ATTRIBUTE THE LIBRARY ACTUALLY EMITS', () => {
  it('a tab rule keyed on `data-selected` goes red, because it selects nothing', () => {
    // The defect this catches was committed in this very story and found before it shipped: the
    // component library's contract is `data-active` (`tabs/tab/TabsTabDataAttributes.d.ts`) and it
    // has no `data-selected` at all. The wrong spelling is valid CSS, compiles, ships, and leaves
    // the selected tab looking exactly like the other one.
    const problems = verdict({ tabSelector: '.activity-tab[data-selected]' })
    expect(problems.join(' ')).toContain('data-active')
  })

  it('a tab with a fill and no weight goes red — one channel is not enough', () => {
    expect(verdict({ tabWeight: '' }).join(' ')).toContain('font-weight')
  })

  it('a tab whose fill is transparent goes red', () => {
    // Declared, spelled right, and paints nothing — the weakening mode.
    expect(verdict({ tabFill: 'background-color: transparent;' }).join(' ')).toContain('transparent')
  })
})

describe('PLANTED WEAKENINGS all go red — present, spelled right, and inert', () => {
  it('a slot reserving zero instead of sixty', () => {
    // The 6.4 plant: `min-width: var(--spacing-s0)` is a declaration that reserves nothing, and it
    // passes every check that asks whether the property is present.
    expect(verdict({ rightMinWidth: 'min-width: var(--spacing-s0);' }).join(' ')).toContain('0px')
  })

  it('a slot a few pixels short', () => {
    expect(verdict({ rightMinWidth: 'min-width: 48px;' }).join(' ')).toContain('48px')
  })

  it('a ring with a zero-width border — the 6.4 defect in its exact original form', () => {
    // A border that is declared and draws nothing. `border: 0 solid …` is spelled correctly, names
    // a real colour, and renders an empty 24px box that reads as a row which failed to load.
    expect(verdict({ ringBorder: 'border: var(--spacing-s0) solid var(--color-neutral3);' }).join(' ')).toContain(
      '0px',
    )
  })

  it('A SPINNING "STATIC" RING — the honesty defect, not a layout one', () => {
    // Declared, valid, and it makes a still marker turn. §4.8's whole point is that a maturing note
    // is not being watched: a turning ring claims a computation we can see the progress of, which
    // is the claim the indeterminate spinner in the progress machine exists to make and this one
    // exists NOT to make.
    const problems = verdict({ ringAnimation: 'animation-name: pb-ring-spin;' })
    expect(problems.join(' ')).toContain('pb-ring-spin')
    expect(problems.join(' ')).toContain('still one')
  })

  it('the highlight names a keyframes block that does not exist', () => {
    // Rename `@keyframes pb-attention` without renaming the reference and the browser drops the
    // rule silently. A name check alone would pass this; the gate resolves the name against the
    // blocks the sheet actually defines.
    expect(verdict({ attentionName: 'animation-name: pb-attention-v2;' }).join(' ')).toContain(
      '@keyframes pb-attention-v2',
    )
  })

  it('a spinning static ring written with the SHORTHAND also goes red', () => {
    // `animation: pb-ring-spin 750ms linear infinite` does exactly what the longhand does, and a
    // check that reads only `animation-name` passes it.
    expect(verdict({ ringAnimation: 'animation: pb-ring-spin 750ms linear infinite;' }).join(' ')).toContain(
      'pb-ring-spin',
    )
  })

  it('an explicit `animation-name: none` is not a spin, and does not go red', () => {
    // The distinction the check has to make: absent and explicitly-none are both "does not turn".
    expect(verdict({ ringAnimation: 'animation-name: none;' })).toEqual([])
  })

  it('a highlight that MOVES the row — the seventh §4.8 claim, and the only one inside the keyframes', () => {
    // `transform` looks harmless because it does not reflow the page. It does move the row under
    // the eye, at the exact moment the cue is trying to draw attention to one entry in a list
    // somebody is reading.
    const problems = verdict({
      attentionKeyframes: '0%, 100% { transform: translateY(0) } 30% { transform: translateY(-2px) }',
    })
    expect(problems.join(' ')).toContain('transform')
    expect(problems.join(' ')).toContain('background cue')
  })

  it('A CUE NOBODY CAN SEE — the 6.5 defect, asked about this time', () => {
    // 6.5 proved a spinner honest and invisible: its gate checked the curve, the duration and the
    // iteration count over a ring painted in an 8% tint used as ink. The question that was never
    // asked was whether it rendered. It is asked here.
    const problems = verdict({
      attentionKeyframes:
        '0%, 100% { background-color: transparent } 30% { background-color: var(--color-accent2Faint) }',
    })
    expect(problems.join(' ')).toContain('under 5%')
  })

  it('a cue that animates from transparent to transparent', () => {
    expect(
      verdict({ attentionKeyframes: '0%, 100% { background-color: transparent } 30% { background-color: transparent }' }).join(' '),
    ).toContain('nothing to nothing')
  })

  it('a cue whose colour token does not resolve', () => {
    expect(
      verdict({ attentionKeyframes: '0%, 100% { background-color: transparent } 30% { background-color: var(--color-nope) }' }).join(' '),
    ).toContain('nothing to nothing')
  })

  it('a highlight that repeats forever — the toast wearing another shape', () => {
    expect(verdict({ attentionIterations: 'animation-iteration-count: infinite;' }).join(' ')).toContain(
      'infinite',
    )
  })

  it('a highlight that plays twice', () => {
    expect(verdict({ attentionIterations: 'animation-iteration-count: 2;' }).join(' ')).toContain('2')
  })

  it('a duration that names a token which does not exist', () => {
    // An unresolved `var()` leaves the animation at the UA default of 0s: a cue that never plays,
    // with nothing failing anywhere. `resolved()` follows the hop, so the gate sees the empty
    // string rather than the spelling.
    expect(verdict({ attentionDuration: 'animation-duration: var(--transition-duration-nope);' }).join(' ')).toContain(
      'never plays',
    )
  })

  it('a reduced-motion block that shortens the cue instead of stopping it', () => {
    // The shape that looks compliant: the animation still runs, just faster. §4.8's cue is a colour
    // pulse, and a fast flash is worse for the reader who asked for stillness than a slow one.
    expect(
      verdict({ attentionReducedMotion: 'animation-duration: var(--transition-duration-simple);' }).join(' '),
    ).toContain('reduced-motion')
  })
})

describe('the anchoring that keeps the two rules apart', () => {
  it('the base rule cannot answer for the reduced-motion override', () => {
    // `ruleBody` returns the FIRST match, so a check that was not anchored on the media query would
    // read the base rule — which declares `animation-iteration-count: 1`, not `animation-name:
    // none` — and report an override that is not there. Deleting only the override must go red
    // while the base rule is left perfectly intact.
    // Asserted by CONTENT, not by count: `toHaveLength(1)` would break the day any other check is
    // added to `activityProblems`, which is a test that fails for being right.
    const problems = verdict({ attentionReducedMotion: '' })
    expect(problems.filter((p: string) => p.includes('outranks the universal one'))).toHaveLength(1)
    expect(problems.filter((p: string) => p.includes('exactly one play'))).toHaveLength(0)
  })
})

//
// THE ONE THING THE STYLESHEET GATE STRUCTURALLY CANNOT SEE.
//
// `activityProblems` proves `.activity-ring-static` has no animation. It cannot prove the component
// USES it — swap the class for `.step-ring` in the JSX and every CSS assertion above still passes
// while a maturing note spins. That is the honesty defect this story exists to prevent, so it is
// asserted where it is visible: in the source.
//
// A SOURCE-TEXT CHECK, said out loud rather than dressed up as something stronger. It proves the
// two class names appear on the sides they belong to, which is weaker than proving what renders —
// there is no DOM runner in this repository and reinstating one was ruled out. It is still the
// difference between catching this in a test and catching it on camera.
//
describe('the component reaches for the right ring', () => {
  const source = readFileSync('apps/web/src/components/ActivityRow.tsx', 'utf8')

  it('gives the still ring to the maturing case and the spinner to the in-flight one', () => {
    // THE INDICES ARE CHECKED FIRST. A renamed or reordered arm makes `indexOf` return -1, and
    // `slice(-1, n)` yields an empty string — on which every `not.toContain` below passes
    // vacuously. A source-text check that can silently measure nothing is worse than none.
    const spinnerAt = source.indexOf("case 'spinner'")
    const staticAt = source.indexOf("case 'static-ring'")
    const failedAt = source.indexOf("case 'failed'")
    expect(spinnerAt, 'spinner arm').toBeGreaterThan(-1)
    expect(staticAt, 'static-ring arm after spinner').toBeGreaterThan(spinnerAt)
    expect(failedAt, 'failed arm after static-ring').toBeGreaterThan(staticAt)

    const staticCase = source.slice(staticAt, failedAt)
    const spinnerCase = source.slice(spinnerAt, staticAt)

    expect(staticCase).toContain('activity-ring-static')
    expect(staticCase).not.toContain('step-ring')
    expect(spinnerCase).toContain('step-ring')
    expect(spinnerCase).not.toContain('activity-ring-static')
  })

  it('renders every one of the five slot shapes — a missing case is a blank right edge', () => {
    // The union is closed and `renderSlot` switches on it exhaustively, which tsc enforces; this
    // asserts the arms are actually here rather than trusting a `default` nobody wrote.
    for (const kind of ['block', 'spinner', 'static-ring', 'failed', 'not-indexed']) {
      expect(source, `no arm for ${kind}`).toContain(`case '${kind}'`)
    }
  })
})
