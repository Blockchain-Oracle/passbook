//
// THE PLANTS, AUTOMATED — the linkability meter's sixth verdict (story 6.7b).
//
// Same discipline as `disclosure-gate.test.ts`, and the reason `progress-gate.test.ts` recorded
// first: deletion and weakening are different failure modes, and a plant-and-watch pass that only
// deletes is not evidence a gate works. Every declaration `linkabilityProblems` reads is planted
// twice — once removed, once replaced by something present, spelled and inert.
//
// The weakenings are the interesting half here because every real risk in this story is one: a roll
// that runs for the WRONG duration, a stagger declared and never multiplied, a reduced-motion
// override that stops the animation but leaves the transform mid-roll, a field that acquires
// motion, and a meter that paints its severities in a second palette that merely resembles the
// panel's. Each leaves every presence check green while breaking the thing it was pointed at.
//
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// ONE LINE ON PURPOSE: `@ts-expect-error` suppresses the NEXT line only.
// @ts-expect-error - a .mjs gate with no type declarations; the whole point is to drive it as data.
import { TIER_COLORS, expectedOdometer, linkabilityProblems, readDesign } from '../../../scripts/assert-design-shipped.mjs'

import { getPrivacyColor } from '../src/privacy.js'
import { severityOf, type LinkabilityTier } from '../src/linkability.js'

const TOKENS_YAML = 'apps/web/design/tokens.yaml'
const INDEX_CSS = 'apps/web/src/index.css'

/** The shipped recipe, read from the authority — which is the whole point of the verdict. */
const EXPECTED = expectedOdometer(TOKENS_YAML)

describe('the recipe comes from the design authority, not from the gate', () => {
  it('parses the block the digit machine is held to', () => {
    expect(EXPECTED).toEqual({ perDigitMs: 180, staggerMs: 40 })
  })

  it('refuses a yaml with no recipe rather than silently checking nothing', () => {
    expect(() => expectedOdometer('packages/protocol/package.json')).toThrow(/components\.odometer/)
  })
})

describe('the gate’s colour list is pinned to the functions it stands for', () => {
  it('covers exactly the colours a tier can reach', () => {
    // A hand-transcribed list in a `.mjs` is a list that silently stops covering what it copies.
    // `quiet` belongs to `blocked`, which is a REFUSAL — and the meter never refuses.
    const reachable = ([0, 1, 2] as LinkabilityTier[]).map((tier) => getPrivacyColor(severityOf(tier)))
    expect([...TIER_COLORS].sort()).toEqual([...new Set(reachable)].sort())
    expect(TIER_COLORS).not.toContain('quiet')
  })
})

/** A stylesheet shaped like the emitted one: tokens first, then the rules that reference them. */
function sheet(overrides: Record<string, string> = {}) {
  const decls: Record<string, string> = {
    stagger: '--odometer-stagger: 40ms;',
    numeric: 'font-variant-numeric: tabular-nums;',
    rollName: 'animation-name: pb-digit-roll;',
    rollDuration: 'animation-duration: var(--transition-duration-quicker);',
    rollDelay: 'animation-delay: calc(var(--odometer-stagger) * var(--roll-step, 0));',
    reducedName: 'animation-name: none;',
    reducedTransform: 'transform: none;',
    fieldAnimation: '',
    fieldAspect: 'aspect-ratio: 1;',
    sevNeutral: 'color: var(--color-neutral1);',
    sevExposed: 'color: var(--color-exposed);',
    sevIrreversible: 'color: var(--color-irreversible);',
    lineColor: 'color: var(--color-neutral2);',
    // The panel's own severity rules, present because the verdict compares the meter's colours to
    // them — a meter matching a palette that is not there would prove nothing.
    panelRules:
      '.disclosure-panel[data-severity=neutral]{color:var(--color-neutral1)}\n' +
      '.disclosure-panel[data-severity=exposed]{color:var(--color-exposed)}\n' +
      '.disclosure-panel[data-severity=irreversible]{color:var(--color-irreversible)}',
    ...overrides,
  }

  return `
    :root {
      --color-neutral1: #211a12;
      --color-neutral2: rgba(33,26,18,0.63);
      --color-neutral3: rgba(33,26,18,0.35);
      --color-inset: #f4f0e8;
      --color-exposed: #7a5a00;
      --color-irreversible: #a32318;
      --spacing-s8: 8px;
      --spacing-s12: 12px;
      --radius-card: 16px;
      --text-body1: 18px;
      --text-body1--line-height: 24px;
      --transition-duration-simple: 80ms;
      --transition-duration-quicker: 180ms;
      --ease-glide: cubic-bezier(0.25,0.46,0.45,0.94);
    }
    .odometer { ${decls.stagger} ${decls.numeric} }
    .odometer-track { ${decls.rollName} ${decls.rollDuration} ${decls.rollDelay} }
    .note-field { ${decls.fieldAnimation} }
    .note-field-canvas { ${decls.fieldAspect} background-color: var(--color-inset); }
    .linkability-meter[data-severity=neutral] .meter-sentence { ${decls.sevNeutral} }
    .linkability-meter[data-severity=exposed] .meter-sentence { ${decls.sevExposed} }
    .linkability-meter[data-severity=irreversible] .meter-sentence { ${decls.sevIrreversible} }
    .meter-line { ${decls.lineColor} }
    ${decls.panelRules}
    @media (prefers-reduced-motion: reduce) {
      .odometer-track { ${decls.reducedName} ${decls.reducedTransform} }
    }
  `
}

const verdict = (overrides?: Record<string, string>): string[] =>
  linkabilityProblems({
    read: readDesign({ css: sheet(overrides), html: '<link rel=stylesheet>' }),
    expected: EXPECTED,
  })

describe('the gate passes a correctly built meter', () => {
  it('finds nothing wrong with the real shape', () => {
    expect(verdict()).toEqual([])
  })
})

describe('PLANTED DELETIONS all go red', () => {
  it('the roll loses its duration', () => {
    expect(verdict({ rollDuration: '' }).join(' ')).toContain('no readable duration')
  })

  it('the stagger is never declared', () => {
    expect(verdict({ stagger: '' }).join(' ')).toContain('--odometer-stagger')
  })

  it('the delay is never declared', () => {
    expect(verdict({ rollDelay: '' }).join(' ')).toContain('animation-delay')
  })

  it('the keyframes are never named', () => {
    expect(verdict({ rollName: '' }).join(' ')).toContain('pb-digit-roll')
  })

  it('tabular figures are dropped', () => {
    expect(verdict({ numeric: '' }).join(' ')).toContain('tabular')
  })

  it('the reduced-motion override disappears entirely', () => {
    const problems = verdict({ reducedName: '', reducedTransform: '' }).join(' ')
    expect(problems).toContain('prefers-reduced-motion')
    expect(problems).toContain('transform')
  })

  it('the field rule vanishes, so its silence is an absence rather than a decision', () => {
    // The animation check passes trivially on a stylesheet where the class does not exist. Without
    // this, deleting `.note-field-canvas` outright would report clean.
    expect(verdict({ fieldAspect: '' }).join(' ')).toContain('aspect-ratio')
  })

  it('a tier colour rule is deleted', () => {
    expect(verdict({ sevExposed: '' }).join(' ')).toContain('resolves to no colour')
  })

  it('the axis lines lose their colour', () => {
    expect(verdict({ lineColor: '' }).join(' ')).toContain('inherit the meter severity')
  })
})

describe('PLANTED WEAKENINGS all go red — present, spelled, and inert', () => {
  it('a roll that runs for a REAL duration that is the wrong one', () => {
    // 80ms is a token that exists, resolves, and is not what DESIGN:242 says.
    const problems = verdict({ rollDuration: 'animation-duration: var(--transition-duration-simple);' })
    expect(problems.join(' ')).toContain('80ms')
    expect(problems.join(' ')).toContain('180ms')
  })

  it('a stagger that is a real time and the wrong one', () => {
    expect(verdict({ stagger: '--odometer-stagger: 250ms;' }).join(' ')).toContain('250ms')
  })

  it('a stagger that is declared and then never multiplied', () => {
    // THE PLANT THAT MATTERS MOST. Every digit starts on the same frame, the stagger reads
    // perfectly in the stylesheet, and nothing else in the gate would notice.
    expect(verdict({ rollDelay: 'animation-delay: 0ms;' }).join(' ')).toContain('does not multiply')
  })

  it('a delay that uses the stagger but not the ordinal', () => {
    const planted = 'animation-delay: var(--odometer-stagger);'
    expect(verdict({ rollDelay: planted }).join(' ')).toContain('--roll-step')
  })

  it('a reduced-motion override that stops the animation but leaves the transform', () => {
    // Freezes the digit MID-ROLL: half of one glyph above half of another. Strictly worse than
    // either the motion or the still figure, and every presence check stays green.
    const problems = verdict({ reducedTransform: '' }).join(' ')
    expect(problems).toContain('mid-roll')
  })

  it('a reduced-motion override that resets the transform but keeps rolling', () => {
    expect(verdict({ reducedName: '' }).join(' ')).toContain('asked the OS to stop motion')
  })

  it('proportional figures, which look like a font choice and are not', () => {
    expect(verdict({ numeric: 'font-variant-numeric: proportional-nums;' }).join(' ')).toContain('tabular')
  })

  it('a field that acquires motion, in either spelling', () => {
    expect(verdict({ fieldAnimation: 'animation-name: pb-pulse;' }).join(' ')).toContain('note field')
    expect(verdict({ fieldAnimation: 'animation: pb-pulse 1s infinite;' }).join(' ')).toContain('note field')
  })

  it('two tier colours that are the same real colour', () => {
    // Pasting `exposed` into `irreversible` gives two verdicts one appearance, and every presence
    // check passes because both rules exist and both resolve.
    expect(verdict({ sevIrreversible: 'color: var(--color-exposed);' }).join(' ')).toContain(
      'the same colour on screen',
    )
  })

  it('a meter palette that is real, distinct, and NOT the panel’s', () => {
    // The drift the single `getPrivacyColor()` exists to prevent, arriving through a stylesheet
    // instead of through a module. Distinct from each other, so the distinctness scan is happy.
    const problems = verdict({ sevExposed: 'color: var(--color-neutral3);' }).join(' ')
    expect(problems).toContain('while the disclosure panel paints it')
  })

  it('axis lines painted a real colour that is not neutral2', () => {
    expect(verdict({ lineColor: 'color: var(--color-irreversible);' }).join(' ')).toContain(
      'never make one',
    )
  })
})

describe('the verdict reports rather than crashes, however broken the read is', () => {
  const partials = [
    { read: null, expected: EXPECTED },
    { read: {}, expected: EXPECTED },
    { read: { reserved: {} }, expected: EXPECTED },
    { read: { reserved: { odometerDurationMs: null, meterSeverityColors: null } }, expected: EXPECTED },
  ]

  for (const [index, input] of partials.entries()) {
    it(`does not throw on partial read ${index}`, () => {
      // A GATE THAT CRASHES REPORTS NOTHING, and a build that dies inside a verdict looks identical
      // to a build that died anywhere else.
      expect(() => linkabilityProblems(input)).not.toThrow()
      expect(linkabilityProblems(input).length).toBeGreaterThan(0)
    })
  }

  it('says so when no recipe was supplied, rather than measuring against nothing', () => {
    const problems = linkabilityProblems({ read: readDesign({ css: sheet(), html: '' }), expected: null })
    expect(problems.join(' ')).toContain('no odometer recipe')
  })

  it('says so when the stylesheet could not be read', () => {
    expect(linkabilityProblems({ read: null, expected: EXPECTED }).join(' ')).toContain(
      'could not be read',
    )
  })
})

describe('the authored stylesheet carries what the gate expects', () => {
  it('names the odometer track in the reduced-motion block', () => {
    // Read from the SOURCE, not the artifact: the emitted sheet is what `build:web` checks, and
    // this is the half a human edits. Both have to be true.
    const css = readFileSync(INDEX_CSS, 'utf8')
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion'))
    expect(reduced).toContain('.odometer-track')
  })

  it('keeps a bare rule for every class this story adds', () => {
    // `index.css:124-126`'s convention: the lint that enforced it is gone, the convention stands.
    const css = readFileSync(INDEX_CSS, 'utf8')
    for (const name of [
      'linkability-meter',
      'meter-count',
      'meter-sentence',
      'meter-line',
      'meter-caret',
      'meter-provenance',
      'meter-alternatives',
      'meter-alternative',
      'meter-alternative-stated',
      'odometer',
      'odometer-digit',
      'odometer-track',
      'note-field',
      'note-field-canvas',
      'note-field-note',
    ]) {
      expect(css, `.${name} has no bare rule`).toContain(`.${name} {`)
    }
  })
})
