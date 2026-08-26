//
// THE PLANTS, AUTOMATED — the disclosure panel's fifth verdict (story 6.7).
//
// Same discipline as `progress-gate.test.ts` and `activity-gate.test.ts`, for the reason recorded
// in the first of them: deletion and weakening are different failure modes, and a plant-and-watch
// pass that only deletes is not evidence a gate works. Every declaration `disclosureProblems` reads
// is planted twice — once removed, once replaced by something present, spelled and inert.
//
// The weakenings are the interesting half, because every real risk in this story is one: a dot state
// that differs from its neighbour by COLOUR ALONE, two dot states drawing the SAME shape, a panel
// that acquires an animation, a transition with nothing to travel from, a second `.cta` severity
// rule added below the blocked one, and a recipe number that no longer matches the authority. Each
// of those leaves every presence check green while breaking the thing it was pointed at.
//
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// ONE LINE ON PURPOSE: `@ts-expect-error` suppresses the NEXT line only, and tsc reports an
// untyped-module error on the specifier — which on a wrapped import is several lines further down,
// leaving the directive itself unused and the error unsuppressed.
// @ts-expect-error - a .mjs gate with no type declarations; the whole point is to drive it as data.
import { CTA_SEVERITIES, PRIVACY_COLORS, disclosureProblems, expectedDisclosure, readDesign } from '../../../scripts/assert-design-shipped.mjs'

import { ctaSeverity, PRIVACY_SEVERITY, type PrivacyColor, type PrivacySeverity } from '../src/privacy.js'
import { CELL_ENCODING, VISIBILITY_CELL_STATES } from '../src/visibility-matrix.js'

const TOKENS_YAML = 'apps/web/design/tokens.yaml'
const INDEX_CSS = 'apps/web/src/index.css'

/** The shipped recipe. Read from the authority, which is the whole point of the fifth verdict. */
const EXPECTED = expectedDisclosure(TOKENS_YAML)

/**
 * The numbers the fabricated sheet below is built around.
 *
 * Held to the authority in ONE place rather than twenty. If `components.disclosure.padding` moves,
 * this assertion fails with the reason on it instead of every plant in the file failing with
 * "expected 12, got 16" and no clue why.
 */
describe('the recipe comes from the design authority, not from the gate', () => {
  it('parses the block the panel is held to', () => {
    expect(EXPECTED).toEqual({ fill: 'inset', radius: 16, padding: 12, gap: 12, dotSize: 10 })
  })

  it('refuses a yaml with no recipe rather than silently checking nothing', () => {
    expect(() => expectedDisclosure('packages/protocol/package.json')).toThrow(/components\.disclosure/)
  })
})

/** A stylesheet shaped like the emitted one: tokens first, then the rules that reference them. */
function sheet(overrides: Record<string, string> = {}) {
  const decls: Record<string, string> = {
    fill: 'background-color: var(--color-inset);',
    radius: 'border-radius: var(--radius-card);',
    padding: 'padding: var(--spacing-s12);',
    gap: 'gap: var(--spacing-s12);',
    restOpacity: 'opacity: 1;',
    transition: 'transition-property: opacity;',
    animation: '',
    startingStyle: '@starting-style{.disclosure-panel{opacity:0}}',
    sevNeutral: 'color: var(--color-neutral1);',
    sevExposed: 'color: var(--color-exposed);',
    sevIrreversible: 'color: var(--color-irreversible);',
    sevQuiet: 'color: var(--color-neutral2);',
    bodyColor: 'color: var(--color-neutral2);',
    bodySize: 'font-size: var(--text-body3);',
    markerColor: 'color: var(--color-neutral2);',
    dotSize: 'width: 10px; height: 10px;',
    dotBorder: 'border: var(--spacing-s2) solid var(--color-neutral2);',
    dotSees: 'background-color: var(--color-neutral1); border-color: var(--color-neutral1);',
    dotHidden: 'background-color: transparent; border-color: var(--color-neutral2);',
    dotConditional:
      'border-color: var(--color-neutral1); background-image: linear-gradient(to right, var(--color-neutral1) 50%, transparent 50%);',
    dotAbsent:
      'border-color: transparent; background-image: linear-gradient(to right, var(--color-neutral3), var(--color-neutral3));',
    // Written as whole rules rather than as declarations, because what is under test for these
    // three is their ORDER and their COMPLETENESS — all are specificity 0,2,0.
    ctaRules:
      '.cta[data-severity=exposed]{background-color:var(--color-exposed)}\n' +
      '.cta[data-severity=irreversible]{background-color:var(--color-irreversible)}\n' +
      '.cta[aria-disabled=true]{background-color:var(--color-accent2);color:var(--color-neutral1)}',
    ...overrides,
  }

  return `
    :root {
      --color-ground: #fcfaf6;
      --color-neutral1: #211a12;
      --color-neutral2: rgba(33,26,18,0.63);
      --color-neutral3: rgba(33,26,18,0.35);
      --color-inset: #f4f0e8;
      --color-raised: #fffdf9;
      --color-accent2: rgba(140,47,30,0.08);
      --color-exposed: #7a5a00;
      --color-irreversible: #a32318;
      --color-settled: #2e6b35;
      --spacing-s0: 0px;
      --spacing-s2: 2px;
      --spacing-s8: 8px;
      --spacing-s12: 12px;
      --radius-card: 16px;
      --radius-badge: 6px;
      --radius-pill: 9999px;
      --text-body3: 14px;
      --text-body4: 12px;
      --transition-duration-quick: 200ms;
      --ease-glide: cubic-bezier(0.25,0.46,0.45,0.94);
    }
    .disclosure-panel { ${decls.fill} ${decls.radius} ${decls.padding} ${decls.gap} ${decls.restOpacity} ${decls.transition} ${decls.animation} }
    ${decls.startingStyle}
    .disclosure-panel[data-severity=neutral] { ${decls.sevNeutral} }
    .disclosure-panel[data-severity=exposed] { ${decls.sevExposed} }
    .disclosure-panel[data-severity=irreversible] { ${decls.sevIrreversible} }
    .disclosure-panel[data-severity=quiet] { ${decls.sevQuiet} }
    .disclosure-body { ${decls.bodyColor} ${decls.bodySize} }
    .disclosure-marker { ${decls.markerColor} }
    .visibility-dot { ${decls.dotSize} ${decls.dotBorder} }
    .visibility-dot[data-state=sees] { ${decls.dotSees} }
    .visibility-dot[data-state=hidden] { ${decls.dotHidden} }
    .visibility-dot[data-state=conditional] { ${decls.dotConditional} }
    .visibility-dot[data-state=absent] { ${decls.dotAbsent} }
    ${decls.ctaRules}
  `
}

const verdict = (overrides?: Record<string, string>): string[] =>
  disclosureProblems({
    read: readDesign({ css: sheet(overrides), html: '<link rel=stylesheet>' }),
    expected: EXPECTED,
  })

describe('the gate passes a correctly built panel', () => {
  it('finds nothing wrong with the real shape', () => {
    expect(verdict()).toEqual([])
  })

  it('and reports the read failing rather than passing vacuously', () => {
    expect(disclosureProblems({ read: null, expected: EXPECTED }).join(' ')).toContain('could not be read')
  })

  it('and refuses to run with no recipe rather than passing everything', () => {
    const read = readDesign({ css: sheet(), html: '<link rel=stylesheet>' })
    expect(disclosureProblems({ read, expected: null }).join(' ')).toContain('no recipe was supplied')
  })
})

//
// A GATE THAT CRASHES REPORTS NOTHING. The first version promised tolerance with `read.reserved ??
// {}` and then called `.trim()` on three values it had just admitted might be missing, so a partial
// read died with a TypeError instead of returning findings — and a thrown gate is a build that
// fails for the wrong reason with the real defect never named.
//
describe('the verdict never throws, however broken the read is', () => {
  for (const [label, read] of [
    ['an empty object', {}],
    ['an object with no reserved block', { linked: true }],
    ['a reserved block with nothing in it', { reserved: {} }],
    ['a reserved block full of nulls', { reserved: { disclosureTransition: null, severityColors: null, colorTokens: null } }],
  ] as [string, object][]) {
    it(`survives ${label} and returns findings`, () => {
      let problems: string[] = []
      expect(() => {
        problems = disclosureProblems({ read, expected: EXPECTED })
      }).not.toThrow()
      expect(problems.length).toBeGreaterThan(0)
    })
  }
})

describe('the lists this .mjs transcribes still cover the unions they copy', () => {
  it('names every PrivacyColor, and no sixth one', () => {
    // A hand-transcribed list in a gate is a list that silently stops covering the union it copied.
    // Both directions: a colour added to the union with no entry here leaves that severity rule
    // unchecked, and an entry here for a colour that no longer exists reports a phantom absence.
    const fromUnion: PrivacyColor[] = ['neutral', 'exposed', 'irreversible', 'quiet']
    expect(new Set(PRIVACY_COLORS)).toEqual(new Set(fromUnion))
  })

  it('names exactly the levels ctaSeverity() can return', () => {
    const levels = Object.keys(PRIVACY_SEVERITY) as PrivacySeverity[]
    const returned = levels.map((l) => ctaSeverity(l)).filter((c): c is 'exposed' | 'irreversible' => c !== null)
    expect(new Set(CTA_SEVERITIES)).toEqual(new Set(returned))
  })
})

describe('PLANTED DELETIONS all go red', () => {
  it('the container loses its fill and stops being a container', () => {
    expect(verdict({ fill: '' }).join(' ')).toContain('inset')
  })

  it('the container loses its radius', () => {
    expect(verdict({ radius: '' }).join(' ')).toContain('border-radius')
  })

  it('the container loses its padding', () => {
    expect(verdict({ padding: '' }).join(' ')).toContain('padding')
  })

  it('the container loses its gap', () => {
    expect(verdict({ gap: '' }).join(' ')).toContain('gap')
  })

  it('the panel stops transitioning anything', () => {
    expect(verdict({ transition: '' }).join(' ')).toContain('opacity and only opacity')
  })

  it('the appearance loses its starting value', () => {
    expect(verdict({ startingStyle: '' }).join(' ')).toContain('@starting-style')
  })

  it('the panel loses its resting opacity', () => {
    expect(verdict({ restOpacity: '' }).join(' ')).toContain('resting opacity')
  })

  it('the body stops being forced to neutral2', () => {
    expect(verdict({ bodyColor: '' }).join(' ')).toContain('.disclosure-body')
  })

  it('the MARKER stops being forced to neutral2, so it inherits the severity', () => {
    expect(verdict({ markerColor: '' }).join(' ')).toContain('.disclosure-marker')
  })

  it('the body stops being forced to body3', () => {
    expect(verdict({ bodySize: '' }).join(' ')).toContain('--text-body3')
  })

  it('a severity rule goes missing', () => {
    expect(verdict({ sevExposed: '' }).join(' ')).toContain('data-severity=exposed')
    expect(verdict({ sevQuiet: '' }).join(' ')).toContain('data-severity=quiet')
  })

  it('the dot loses its size on either axis', () => {
    expect(verdict({ dotSize: 'height: 10px;' }).join(' ')).toContain('resolves its width')
    expect(verdict({ dotSize: 'width: 10px;' }).join(' ')).toContain('resolves its height')
  })

  it('the dot loses its border, so the hollow state stops being a shape', () => {
    expect(verdict({ dotBorder: '' }).join(' ')).toContain('hollow state is nothing but its border')
  })

  it('the seen dot loses its fill', () => {
    expect(verdict({ dotSees: '' }).join(' ')).toContain('data-state=sees')
  })

  it('the hidden dot loses its transparent declaration', () => {
    expect(verdict({ dotHidden: '' }).join(' ')).toContain('data-state=hidden')
  })

  it('the two qualified states lose their shapes', () => {
    expect(verdict({ dotConditional: '' }).join(' ')).toContain('data-state=conditional')
    expect(verdict({ dotAbsent: '' }).join(' ')).toContain('data-state=absent')
  })

  it('severity never reaches the CTA at all', () => {
    expect(
      verdict({ ctaRules: '.cta[aria-disabled=true]{background-color:var(--color-accent2)}' }).join(' '),
    ).toContain('never reaches the CTA')
  })

  it('ONE of the two CTA levels goes missing, which a single-rule check never noticed', () => {
    const problems = verdict({
      ctaRules:
        '.cta[data-severity=irreversible]{background-color:var(--color-irreversible)}\n' +
        '.cta[aria-disabled=true]{background-color:var(--color-accent2)}',
    })
    expect(problems.join(' ')).toContain('.cta[data-severity=exposed]')
  })

  it('the blocked downgrade disappears', () => {
    expect(
      verdict({ ctaRules: '.cta[data-severity=irreversible]{background-color:var(--color-irreversible)}' }).join(' '),
    ).toContain('never downgrade')
  })
})

describe('PLANTED WEAKENINGS — present, spelled, inert, and the real risk', () => {
  it('a radius that is spelled but is not the recipe', () => {
    expect(verdict({ radius: 'border-radius: var(--radius-badge);' }).join(' ')).toContain(
      'tokens.yaml says 16',
    )
  })

  it('padding that reserves nothing', () => {
    expect(verdict({ padding: 'padding: var(--spacing-s0);' }).join(' ')).toContain('tokens.yaml says 12')
  })

  it('a gap collapsed to zero', () => {
    expect(verdict({ gap: 'gap: var(--spacing-s0);' }).join(' ')).toContain('tokens.yaml says 12')
  })

  it('a transparent "fill", which paints exactly like no container', () => {
    expect(verdict({ fill: 'background-color: transparent;' }).join(' ')).toContain('inset')
  })

  it('A REAL COLOUR THAT IS THE WRONG ONE — the panel painted as a card', () => {
    // The failure a non-empty check cannot see: `raised` resolves fine and is a perfectly good
    // colour, and the panel stops being a well while the build prints "inset fill".
    expect(verdict({ fill: 'background-color: var(--color-raised);' }).join(' ')).toContain(
      'names `inset`',
    )
  })

  it('A PANEL THAT ANIMATES — in the longhand', () => {
    expect(verdict({ animation: 'animation-name: pb-pulse;' }).join(' ')).toContain('holds still')
  })

  it('AND IN THE SHORTHAND, which a longhand-only check would pass', () => {
    expect(verdict({ animation: 'animation: pb-pulse 1.2s ease-in-out infinite;' }).join(' ')).toContain(
      'holds still',
    )
  })

  it('a transition that has quietly grown a second property', () => {
    expect(verdict({ transition: 'transition-property: transform, opacity;' }).join(' ')).toContain(
      'opacity and only opacity',
    )
  })

  it('A STARTING VALUE THAT IS NOT ZERO, so the fade travels nowhere visible', () => {
    expect(verdict({ startingStyle: '@starting-style{.disclosure-panel{opacity:1}}' }).join(' ')).toContain(
      '@starting-style',
    )
  })

  it('a @starting-style block aimed at something else entirely', () => {
    expect(verdict({ startingStyle: '@starting-style{.pb-dialog{opacity:0}}' }).join(' ')).toContain(
      '@starting-style',
    )
  })

  it('a resting opacity that leaves the panel half-faded forever', () => {
    expect(verdict({ restOpacity: 'opacity: 0.5;' }).join(' ')).toContain('resting opacity')
  })

  it('a body forced to the wrong grey', () => {
    expect(verdict({ bodyColor: 'color: var(--color-neutral3);' }).join(' ')).toContain('.disclosure-body')
  })

  it('a marker given a colour of its own that is not the body’s', () => {
    expect(verdict({ markerColor: 'color: var(--color-irreversible);' }).join(' ')).toContain(
      '.disclosure-marker',
    )
  })

  it('a body set at the wrong step', () => {
    expect(verdict({ bodySize: 'font-size: var(--text-body4);' }).join(' ')).toContain('--text-body3')
  })

  it('A FOURTH SEVERITY RULE COPIED FROM THE THIRD, so `blocked` starts rendering red', () => {
    const problems = verdict({ sevQuiet: 'color: var(--color-irreversible);' })
    expect(problems.join(' ')).toContain('both resolve to')
    expect(problems.join(' ')).toContain('most severe state has started rendering as red')
  })

  it('any two severity colours collapsing, not just that pair', () => {
    expect(verdict({ sevExposed: 'color: var(--color-neutral1);' }).join(' ')).toContain('both resolve to')
  })

  it('a dot sized off the recipe', () => {
    expect(verdict({ dotSize: 'width: 8px; height: 8px;' }).join(' ')).toContain('visibilityDot.size')
  })

  it('A DOT THAT IS A LOZENGE — right on one axis, wrong on the other', () => {
    const problems = verdict({ dotSize: 'width: 10px; height: 24px;' })
    expect(problems.join(' ')).toContain('resolves its height')
    expect(problems.filter((p) => p.includes('resolves its width'))).toHaveLength(0)
  })

  it('a border spelled at zero width, so the hollow ring renders nothing', () => {
    expect(verdict({ dotBorder: 'border: var(--spacing-s0) solid var(--color-neutral2);' }).join(' ')).toContain(
      'hollow state is nothing but its border',
    )
  })

  it('A DOT SET WHOSE ONLY DIFFERENCE IS COLOUR — the seen dot unfilled', () => {
    const problems = verdict({ dotSees: 'background-color: transparent; border-color: var(--color-neutral1);' })
    expect(problems.join(' ')).toContain('same picture')
  })

  it('and the hidden dot filled, which is the same failure from the other end', () => {
    expect(
      verdict({ dotHidden: 'background-color: var(--color-neutral1); border-color: var(--color-neutral2);' }).join(' '),
    ).toContain('differs from a "sees" dot by colour')
  })

  it('a transparency the minifier spells the modern way', () => {
    // `rgb(0 0 0 / 0)` is the space-separated form. A pattern that only knew the comma form read it
    // as a colour and reported a transparent "sees" dot as filled — the exact inversion.
    expect(
      verdict({ dotSees: 'background-color: rgb(0 0 0 / 0); border-color: var(--color-neutral1);' }).join(' '),
    ).toContain('same picture')
  })

  it('a conditional cell reduced to a recoloured hidden dot', () => {
    expect(verdict({ dotConditional: 'border-color: var(--color-exposed);' }).join(' ')).toContain(
      'riskiest cell',
    )
  })

  it('an absent cell reduced to a recoloured hidden dot', () => {
    expect(verdict({ dotAbsent: 'border-color: var(--color-neutral3);' }).join(' ')).toContain(
      'data-state=absent',
    )
  })

  it('TWO DOT STATES DRAWING THE SAME SHAPE, which every presence check passes', () => {
    // Paste the `absent` declaration into `conditional` and both cells are dashes. The colours got
    // a distinctness scan from the start; the shapes did not, and shape is the channel that is
    // supposed to survive when colour does not.
    const problems = verdict({
      dotConditional:
        'border-color: transparent; background-image: linear-gradient(to right, var(--color-neutral3), var(--color-neutral3));',
    })
    expect(problems.join(' ')).toContain('draw the same shape')
  })

  it('THE TWO CTA RULES IN THE WRONG ORDER, which is valid CSS and silently red', () => {
    const problems = verdict({
      ctaRules:
        '.cta[aria-disabled=true]{background-color:var(--color-accent2)}\n' +
        '.cta[data-severity=exposed]{background-color:var(--color-exposed)}\n' +
        '.cta[data-severity=irreversible]{background-color:var(--color-irreversible)}',
    })
    expect(problems.join(' ')).toContain('appears BEFORE')
    expect(problems.join(' ')).toContain('specificity 0,2,0')
  })

  it('A SECOND SEVERITY RULE ADDED BELOW THE BLOCKED ONE, which a first-match check never saw', () => {
    // Both original rules stay exactly where they were, so `indexOf` still reported severity first
    // and the check stayed green — while the rule that actually wins the cascade had moved below
    // the downgrade. "Which of these comes last" is the question, and only the last occurrence of
    // each can answer it.
    const problems = verdict({
      ctaRules:
        '.cta[data-severity=exposed]{background-color:var(--color-exposed)}\n' +
        '.cta[aria-disabled=true]{background-color:var(--color-accent2)}\n' +
        '.cta[data-severity=irreversible]{background-color:var(--color-irreversible)}',
    })
    expect(problems.join(' ')).toContain('appears BEFORE')
  })
})

describe('the anchoring that keeps the base rule and its states apart', () => {
  it('a state rule cannot answer for the base rule’s geometry', () => {
    // `ruleBody` returns the FIRST match and both selectors start with `.visibility-dot`. Without
    // the `\{` anchor the state rules would answer for the base one, and a dot with no size and no
    // border would be reported as correct because a sibling rule happened to declare a colour.
    // Asserted by CONTENT, never by count: a length assertion breaks the day another check lands.
    const problems = verdict({ dotSize: '', dotBorder: '' })
    expect(problems.filter((p) => p.includes('visibilityDot.size'))).toHaveLength(2)
    expect(problems.filter((p) => p.includes('hollow state is nothing but its border'))).toHaveLength(1)
    expect(problems.filter((p) => p.includes('same picture'))).toHaveLength(0)
  })

  it('reads the panel rule rather than one of its severity variants', () => {
    expect(verdict()).toEqual([])
    expect(verdict({ sevNeutral: 'color: var(--color-neutral1); padding: var(--spacing-s0);' })).toEqual([])
  })
})

//
// THE ONE THING THE STYLESHEET GATE STRUCTURALLY CANNOT SEE, and the docblock that claimed it could.
//
// `CELL_ENCODING` says the legend in `docs/privacy.md` and the stylesheet "cannot describe different
// encodings", and until this block existed nothing compared them: the document could have said
// "half filled" over a rule that drew a dash, and every check in this file would have stayed green
// because both halves were internally consistent.
//
// A SOURCE-TEXT CHECK, said out loud rather than dressed up as something stronger — it holds the
// authored stylesheet to the word the module publishes, which is weaker than proving what a browser
// paints. There is no DOM runner in this repository and reinstating one was ruled out. It is still
// the difference between catching this here and catching it in a screenshot.
//
describe('the word the document prints and the rule the sheet draws are the same encoding', () => {
  const css = readFileSync(INDEX_CSS, 'utf8')

  const ruleFor = (state: string): string =>
    css.match(new RegExp(`\\.visibility-dot\\[data-state='${state}'\\]\\s*\\{([^}]*)\\}`))?.[1] ?? ''

  /** What each published word has to be true of, in the authored sheet. */
  const DRAWS: Record<string, (rule: string) => boolean> = {
    // A fill, and not a transparent one.
    filled: (rule) => /background-color:\s*var\(--color-[\w-]+\)/.test(rule),
    // No fill at all — the border is the whole mark.
    hollow: (rule) => /background-color:\s*transparent/.test(rule),
    // Half of the box painted: a gradient with a hard stop at the midpoint.
    'half filled': (rule) => /background-image:[^;]*50%/.test(rule),
    // A bar across the middle, which needs a gradient AND a height for it.
    'a dash': (rule) => /background-image:/.test(rule),
  }

  it('publishes a word for every state, and each word is one the sheet can draw', () => {
    for (const state of VISIBILITY_CELL_STATES) {
      const word = CELL_ENCODING[state]
      expect(Object.keys(DRAWS), `${state} publishes "${word}", which this test has no predicate for`).toContain(word)
    }
  })

  it('draws what it says, state by state', () => {
    for (const state of VISIBILITY_CELL_STATES) {
      const rule = ruleFor(state)
      expect(rule, `no .visibility-dot[data-state='${state}'] rule in ${INDEX_CSS}`).not.toBe('')
      const word = CELL_ENCODING[state]
      expect(
        DRAWS[word]?.(rule),
        `${state} is published as "${word}" and its rule is: ${rule.trim()}`,
      ).toBe(true)
    }
  })

  it('and the dash is a bar rather than an invisible gradient', () => {
    // `background-image` alone would satisfy the predicate above while painting the whole box, so
    // the one thing that makes it a DASH is asserted separately.
    const rule = ruleFor('absent')
    expect(rule).toMatch(/background-size:\s*100%\s*var\(--spacing-s\d+\)/)
    expect(rule).toMatch(/background-position:\s*center/)
  })
})
