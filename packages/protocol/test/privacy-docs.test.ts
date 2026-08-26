//
// The doc generator, driven as data (story 6.7, FR-058).
//
// `vitest.config.ts` collects `packages/*/test/**` only, so nothing under `scripts/` is executed by
// the suite. `render-privacy-matrix.mjs` is pure over the DOCUMENT TEXT for exactly this reason —
// `render(source)` and `checkFreshness({ source })` both take the doc as a string — so every branch
// can be driven here without writing a file or breaking the working tree.
//
// WHAT THIS COVERS THAT THE BUILD GATE DOES NOT. `pnpm run build:web` proves the committed document
// matches the modules right now. These prove the mechanism that claim rests on: that the render is
// deterministic, that a drifted document is REPORTED rather than silently re-rendered, and that a
// missing marker is a hard error instead of a section that quietly never appears — which would look
// exactly like a document that is up to date.
//
import { describe, it, expect } from 'vitest'
// @ts-expect-error - a .mjs generator with no type declarations; the point is to drive it as data.
import { checkFreshness, currentDoc, headlineFor, render, staleMessage } from '../../../scripts/render-privacy-matrix.mjs'

import { forbiddenClaimsIn, FORBIDDEN_CLAIMS } from '../src/forbidden-claims.js'
import { matrixFor, VISIBILITY_CONTEXTS } from '../src/visibility-matrix.js'

const doc = (): string => currentDoc()

describe('the committed document matches the modules', () => {
  it('is fresh right now', () => {
    const result = checkFreshness()
    expect(result.fresh, result.fresh ? '' : staleMessage(result)).toBe(true)
  })

  it('carries a generated section for every review context', () => {
    // A context with no section is a privacy claim the document does not make, and the reader has
    // no way to notice the absence. `render` throws on it; this is the positive half.
    for (const context of VISIBILITY_CONTEXTS) {
      expect(doc(), context).toContain(`<!-- generated:${context} -->`)
      expect(doc(), context).toContain(`<!-- /generated:${context} -->`)
    }
  })
})

describe('the render is deterministic', () => {
  it('produces the same bytes twice from the same input', () => {
    const source = doc()
    expect(render(source)).toBe(render(source))
  })

  it('is idempotent — rendering rendered output changes nothing', () => {
    const once = render(doc())
    expect(render(once)).toBe(once)
  })

  it('carries a source hash and NO timestamp, so an unchanged regeneration is a no-op diff', () => {
    const line = render(doc())
      .split('\n')
      .find((l: string) => l.startsWith('*Generated from'))
    expect(line).toMatch(/sha256 [0-9a-f]{64}\./)
    // A timestamp would turn the freshness gate into "who ran it last" and make every regeneration
    // a diff — `render-design-tokens.mjs:490-491`'s rule, applied here.
    expect(line).not.toMatch(/\d{4}-\d{2}-\d{2}/)
    expect(line).toContain('pnpm run render:privacy')
  })

  it('leaves the hand-written prose between the markers alone', () => {
    const source = doc().replace(
      'Colour is never the first channel in the app',
      'Colour is never the first channel in the application',
    )
    expect(render(source)).toContain('first channel in the application')
  })
})

describe('a drifted document is reported, not silently accepted', () => {
  it('reports a mutated cell as stale, with the line it happens on', () => {
    // The same failure a mutated module produces: the committed tables no longer match what the
    // modules render. Mutating the doc is the reachable half of that pair in a unit test.
    const source = doc().replace(
      '| **Amount** | Sees | Hidden | Hidden | Sees |',
      '| **Amount** | Sees | Sees | Hidden | Sees |',
    )
    expect(source).not.toBe(doc())

    const result = checkFreshness({ source })
    expect(result.fresh).toBe(false)
    expect(result.hashOnly).toBe(false)
    expect(result.firstDiffLine).toBeGreaterThan(0)
    expect(staleMessage(result)).toContain('pnpm run render:privacy')
    expect(staleMessage(result)).toContain(`line ${result.firstDiffLine}`)
  })

  it('reports a stale SOURCE HASH as a module edit rather than as "line 17 differs"', () => {
    const source = doc().replace(/sha256 [0-9a-f]{64}/, `sha256 ${'0'.repeat(64)}`)
    expect(source).not.toBe(doc())

    const result = checkFreshness({ source })
    expect(result.fresh).toBe(false)
    expect(result.hashOnly).toBe(true)
    expect(result.firstDiffLine).toBeNull()
    expect(staleMessage(result)).toContain('a module was edited and the document was not regenerated')
  })

  it('names the module to edit, never the document', () => {
    const result = checkFreshness({ source: doc().replace('| **Timing** |', '| **When** |') })
    expect(result.fresh).toBe(false)
    expect(staleMessage(result)).toContain('packages/protocol/src/visibility-matrix.ts')
    expect(staleMessage(result)).toContain('Do not hand-edit')
  })
})

describe('a marker mismatch is a hard error, never a silent skip', () => {
  it('throws when a section this script generates has no block in the document', () => {
    const source = doc().replace(
      /<!-- generated:launch-sell -->[\s\S]*?<!-- \/generated:launch-sell -->/,
      '',
    )
    expect(() => render(source)).toThrow(/launch-sell/)
    expect(() => render(source)).toThrow(/privacy claim the docs do not make/)
  })

  it('throws when the document has a block this script does not generate', () => {
    const source = doc().replace(
      '<!-- generated:legend -->',
      '<!-- generated:not-a-section -->\n<!-- /generated:not-a-section -->\n<!-- generated:legend -->',
    )
    expect(() => render(source)).toThrow(/no section named "not-a-section"/)
  })

  it('throws on a duplicated marker, which would otherwise render nothing and look up to date', () => {
    const source = doc().replace(
      '<!-- /generated:legend -->',
      '<!-- /generated:legend -->\n<!-- /generated:legend -->',
    )
    expect(() => render(source)).toThrow(/exactly one open and one close marker for "legend"/)
  })
})

//
// THE DOCUMENT IS A USER-FACING ARTIFACT CARRYING PRIVACY CLAIMS, so it goes through the same sweep
// every copy module does.
//
// It was the one surface in this story with no claims check at all: the generated tables come from
// modules that ARE swept, but the hand-written prose between the markers is owned by whoever edited
// it last and reached nothing. `forbidden-claims.ts` is a substring guard over whole files, which
// is exactly the shape this needs — and this page is the single most likely place for one of the
// ten to be typed, because it is the page whose whole subject is what is and is not private.
//
describe('the rendered page makes none of the ten refused claims', () => {
  it('sweeps the whole document, generated tables and hand-written prose alike', () => {
    expect(forbiddenClaimsIn(render(doc()))).toEqual([])
  })

  it('holds the sweep to all ten, so it cannot quietly narrow', () => {
    expect(FORBIDDEN_CLAIMS).toHaveLength(10)
  })

  it('and would catch one if it were typed into the prose a human owns', () => {
    // Proves the sweep is pointed at the whole page rather than at the generated blocks: the phrase
    // is planted OUTSIDE every marker, where nothing else in this repository was looking.
    const planted = doc().replace(
      'Your six surfaces are **unlinkable to other users**.',
      'Your six surfaces are unlinkable across surfaces.',
    )
    expect(forbiddenClaimsIn(planted)).toContain('unlinkable across surfaces')
  })
})

describe('an authored context without a headline is refused, not rendered as "undefined"', () => {
  it('throws rather than writing a placeholder into a page of privacy facts', () => {
    // `DISCLOSURE_HEADLINE` is keyed by plain strings — `disclosure-copy.ts` imports nothing, so it
    // cannot name `VisibilityContext` — and the render was `> ${DISCLOSURE_HEADLINE[context]}` with
    // no guard. The freshness check cannot help: a deterministic render of `undefined` matches a
    // committed `undefined` exactly.
    expect(() => headlineFor('markets-exit')).toThrow(/no headline in disclosure-copy/)
    expect(() => headlineFor('not-a-context')).toThrow(/no headline in disclosure-copy/)
  })

  it('returns the sentence for every context that has one', () => {
    for (const context of VISIBILITY_CONTEXTS) {
      const matrix = matrixFor(context)
      if (!matrix.authored) continue
      expect(headlineFor(context).trim(), context).not.toBe('')
    }
  })
})

describe('a duplicated OPEN marker is caught before the splice, not after it', () => {
  it('throws instead of silently swallowing everything between the two', () => {
    // The section regex is non-greedy, so a doc with two open markers matches from the FIRST open
    // to the close and eats the prose in between — then writes exactly one open and one close. The
    // old check counted in the OUTPUT, found 1/1, and reported a document it had just deleted
    // content from as healthy.
    const source = doc().replace(
      '<!-- generated:legend -->',
      '<!-- generated:legend -->\nProse a human owns.\n<!-- generated:legend -->',
    )
    expect(() => render(source)).toThrow(/exactly one open and one close marker for "legend"/)
    expect(() => render(source)).toThrow(/swallow everything between the two/)
  })

  it('still reports a MISSING section with the message that names it', () => {
    // Counting comes first now, so the zero case has to fall through deliberately or it would steal
    // the better error.
    const source = doc().replace(
      /<!-- generated:launch-sell -->[\s\S]*?<!-- \/generated:launch-sell -->/,
      '',
    )
    expect(() => render(source)).toThrow(/privacy claim the docs do not make/)
  })
})
