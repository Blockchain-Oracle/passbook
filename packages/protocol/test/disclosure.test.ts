//
// The panel model (story 6.7), and the two duplications it is allowed to carry.
//
// `disclosure-copy.ts` retypes two sentences that already exist in `register.ts` and `send.ts`,
// because importing them would drag a chain client into the browser bundle behind every component
// that wants a disclosure line AND would break the doc generator, which loads the copy module with
// plain `node`. A duplicated sentence is a sentence that drifts; the `toBe` assertions below are
// what make the duplication safe, exactly as `route-contract.ts` does for its duplicated `Mode`
// list.
//
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

import * as copy from '../src/disclosure-copy.js'
import { forbiddenClaimsIn, FORBIDDEN_CLAIMS } from '../src/forbidden-claims.js'
import { POOL_SEES_DISCLOSURE } from '../src/register.js'
import { SELF_SUBMIT_DISCLOSURE } from '../src/send.js'
import { getPrivacyColor, PRIVACY_SEVERITY, type PrivacySeverity } from '../src/privacy.js'
import {
  assertHonestLine,
  contradicts,
  disclosureFor,
  panelSeverity,
} from '../src/disclosure.js'
import { matrixFor, VISIBILITY_CONTEXTS, type VisibilityContext } from '../src/visibility-matrix.js'

const UNAUTHORED: VisibilityContext[] = ['markets-exit', 'launch-sell']

describe('the two sentences that already existed are the same sentences', () => {
  it('carries the sanctioned relayer sentence byte for byte', () => {
    expect(copy.POOL_SEES).toBe(POOL_SEES_DISCLOSURE)
  })

  it('carries the self-submit sentence byte for byte', () => {
    expect(copy.SELF_SUBMIT_SENDER).toBe(SELF_SUBMIT_DISCLOSURE)
  })

  it('keeps escalation as string containment, which is the shape send.ts already models', () => {
    expect(copy.SELF_SUBMIT_SENDER).toContain(copy.POOL_SEES)
  })
})

describe('every review context resolves to a panel or to a refusal', () => {
  it('covers all ten', () => {
    for (const context of VISIBILITY_CONTEXTS) {
      expect(disclosureFor(context), context).toBeDefined()
      expect(disclosureFor(context).context, context).toBe(context)
    }
  })

  it('refuses exactly the two the docs never wrote, with the matrix’s own sentence', () => {
    const refused = VISIBILITY_CONTEXTS.filter((c) => !disclosureFor(c).authored)
    expect(refused).toEqual(UNAUTHORED)

    for (const context of UNAUTHORED) {
      const panel = disclosureFor(context)
      const matrix = matrixFor(context)
      if (panel.authored || matrix.authored) throw new Error('both halves are declared unauthored')
      // ONE refusal, read from one place. Two hand-typed copies of "nobody wrote this" is how the
      // two halves of a review end up disagreeing about whether it was written.
      expect(panel.because, context).toBe(matrix.because)
    }
  })

  it('opens every authored panel with the headline the docs page also prints', () => {
    for (const context of VISIBILITY_CONTEXTS) {
      const panel = disclosureFor(context)
      if (!panel.authored) continue
      expect(panel.lines.length, context).toBeGreaterThan(1)
      const headline = (copy.DISCLOSURE_HEADLINE as Record<string, string>)[context]
      expect(headline, context).toBeTruthy()
      expect(panel.lines[0]?.text, context).toBe(headline)
    }
  })
})

describe('panel severity is the max of its lines, resolved through one colour function', () => {
  it('keeps an ordinary shielded send calm', () => {
    const panel = disclosureFor('pool-send')
    if (!panel.authored) throw new Error('pool-send is authored')
    expect(panelSeverity(panel)).toBe('low')
    expect(getPrivacyColor(panelSeverity(panel))).toBe('neutral')
  })

  it('escalates the two contexts that publish a link, and only through the max', () => {
    for (const context of ['self-submit', 'bridge-exit'] as const) {
      const panel = disclosureFor(context)
      if (!panel.authored) throw new Error(`${context} is authored`)
      expect(panelSeverity(panel), context).toBe('high')
      expect(getPrivacyColor(panelSeverity(panel)), context).toBe('irreversible')
      // The max, not the first line: bridge-exit leads with a `medium` scope sentence and takes its
      // colour from the irreversibility line underneath it.
      expect(panel.lines.some((l) => l.severity === 'high'), context).toBe(true)
    }
  })

  it('puts chat at exposed, where the relay sees the graph', () => {
    const panel = disclosureFor('chat-payment')
    if (!panel.authored) throw new Error('chat-payment is authored')
    expect(panelSeverity(panel)).toBe('medium')
    expect(getPrivacyColor(panelSeverity(panel))).toBe('exposed')
  })

  it('leaves the swap CTA ink, because the design authority pins it there', () => {
    // EXPERIENCE §S1.4: the swap CTA is ink `{accent3}` and "the only loud element is the
    // disclosure block". Severity routes to the CTA, so anything above `low` here would repaint a
    // button the authority already decided.
    const panel = disclosureFor('swap')
    if (!panel.authored) throw new Error('swap is authored')
    expect(panelSeverity(panel)).toBe('low')
    expect(getPrivacyColor(panelSeverity(panel))).toBe('neutral')
  })

  it('leaves the two crowd-conditional contexts to the meter, not to a constant', () => {
    // The "you are alone at this size" escalation reads a LIVE count. A constant cannot know
    // whether the condition holds, and colouring the CTA as though it always does would spend the
    // warning on every bet ever placed.
    for (const context of ['markets-bet', 'launch-buy'] as const) {
      const panel = disclosureFor(context)
      if (!panel.authored) throw new Error(`${context} is authored`)
      expect(panelSeverity(panel), context).toBe('low')
    }
  })
})

describe('a green tick beside a critical claim is a lie', () => {
  it('holds every shipped line to the rule', () => {
    for (const context of VISIBILITY_CONTEXTS) {
      const panel = disclosureFor(context)
      if (!panel.authored) continue
      for (const line of panel.lines) {
        expect(contradicts(line), `${context}: ${line.text}`).toBe(false)
      }
    }
  })

  it('rejects a `stays` line above low at runtime, not only in the type system', () => {
    // The union already makes this unspellable, so the only values that can reach the guard came
    // from outside the compiler. Constructing one takes a cast, which is exactly the shape of the
    // edit this exists to stop.
    const smuggled = { text: 'This stays private.', marker: 'stays', severity: 'high' as PrivacySeverity }
    expect(contradicts(smuggled)).toBe(true)
    expect(() => assertHonestLine(smuggled)).toThrow(/stays private/)

    expect(contradicts({ ...smuggled, severity: 'medium' })).toBe(true)
    expect(contradicts({ ...smuggled, severity: 'blocked' })).toBe(true)
  })

  it('leaves an honest line alone', () => {
    for (const severity of ['none', 'low'] as PrivacySeverity[]) {
      const line = { text: 'Nothing about this leaves.', marker: 'stays', severity }
      expect(contradicts(line), severity).toBe(false)
      expect(() => assertHonestLine(line)).not.toThrow()
    }
    // And a `leaves` line may carry anything — the marker points the other way.
    expect(contradicts({ text: 'x', marker: 'leaves', severity: 'high' })).toBe(false)
  })
})

describe('a way out is a label, and only a caller can make it real', () => {
  it('offers one on exactly the two contexts that have a safer path', () => {
    const offered = VISIBILITY_CONTEXTS.filter((c) => {
      const panel = disclosureFor(c)
      return panel.authored && panel.wayOut !== null
    })
    expect(offered).toEqual(['self-submit', 'bridge-exit'])
  })

  it('carries a label and nothing that could be a no-op', () => {
    for (const context of VISIBILITY_CONTEXTS) {
      const panel = disclosureFor(context)
      if (!panel.authored || panel.wayOut === null) continue
      expect(Object.keys(panel.wayOut), context).toEqual(['label'])
      expect(panel.wayOut.label.trim(), context).not.toBe('')
    }
  })

  it('uses FR-036’s exact words for the bridge', () => {
    const panel = disclosureFor('bridge-exit')
    if (!panel.authored) throw new Error('bridge-exit is authored')
    expect(panel.wayOut?.label).toBe('Use a fresh address instead')
  })
})

describe('the claims-lint trap', () => {
  it('holds the copy to all ten refused claims', () => {
    expect(FORBIDDEN_CLAIMS).toHaveLength(10)
  })

  it('every sentence in the copy module is clean', () => {
    for (const [name, value] of Object.entries(copy)) {
      if (typeof value !== 'string') continue
      expect(forbiddenClaimsIn(value), `${name}`).toEqual([])
    }
  })

  it('every line of every shipped panel is clean', () => {
    for (const context of VISIBILITY_CONTEXTS) {
      const panel = disclosureFor(context)
      if (!panel.authored) {
        expect(forbiddenClaimsIn(panel.because), context).toEqual([])
        continue
      }
      for (const line of panel.lines) {
        expect(forbiddenClaimsIn(line.text), `${context}: ${line.text}`).toEqual([])
      }
      if (panel.wayOut) expect(forbiddenClaimsIn(panel.wayOut.label), context).toEqual([])
    }
  })

  it('every source file this story adds is clean, comments included', () => {
    // Line-based over whole files, so a comment explaining the trap trips it as easily as a shipped
    // sentence — and the chat room's own sourced disclosure contains one of the ten in the very
    // clause where it disclaims it. `CHAT_AUDITOR_DERIVES` is reworded for exactly that reason.
    for (const path of [
      'packages/protocol/src/privacy.ts',
      'packages/protocol/src/visibility-matrix.ts',
      'packages/protocol/src/disclosure.ts',
      'packages/protocol/src/disclosure-copy.ts',
      'apps/web/src/components/Disclosure.tsx',
      'apps/web/src/components/VisibilityMatrix.tsx',
    ]) {
      const source = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')
      expect(forbiddenClaimsIn(source), path).toEqual([])
    }
  })
})

//
// THE SENTENCES HELD IN TWO MODULES.
//
// `visibility-matrix.ts` and `disclosure-copy.ts` cannot import each other — both are loaded by
// `render-privacy-matrix.mjs` under plain Node, which does not follow a `.js` specifier onto a `.ts`
// file — so two of this story's sentences live in both. A duplicated sentence is a sentence that
// drifts, and NEAR-duplicates are worse than exact ones: two sentences differing by a word are two
// privacy claims nobody decided to make differently. These assertions are what keep each pair one
// claim, and `footnoteText` is what stops the renderers printing it twice on one screen.
//
describe('the sentences the matrix and the panel share are one sentence', () => {
  const noteOn = (context: Parameters<typeof matrixFor>[0], fact: 'sender' | 'ip', actor: 'everyone' | 'relayer') => {
    const matrix = matrixFor(context)
    if (!matrix.authored) throw new Error(`${context} is authored`)
    const cell = matrix.cells[fact][actor]
    if (cell.state !== 'conditional') throw new Error(`${context}/${fact}/${actor} is conditional`)
    return cell.note
  }

  it('states FR-009 once: the Markets headline CONTAINS its own matrix qualifier', () => {
    expect(copy.MARKETS_BET_VISIBLE).toContain(noteOn('markets-bet', 'sender', 'everyone'))
  })

  it('states the launch crowd line once, byte for byte', () => {
    expect(noteOn('launch-buy', 'sender', 'everyone')).toBe(copy.LAUNCH_CROWD)
  })

  it('states the self-submit node line once, byte for byte', () => {
    expect(noteOn('self-submit', 'ip', 'relayer')).toBe(copy.SELF_SUBMIT_NO_RELAYER)
  })

  it('and every one of them is a line the panel actually renders', () => {
    // A pin against a sentence nobody ships proves nothing. Both halves have to be live.
    const launch = disclosureFor('launch-buy')
    const self = disclosureFor('self-submit')
    if (!launch.authored || !self.authored) throw new Error('both are authored')
    expect(launch.lines.map((l) => l.text)).toContain(copy.LAUNCH_CROWD)
    expect(self.lines.map((l) => l.text)).toContain(copy.SELF_SUBMIT_NO_RELAYER)
  })
})

describe('the headline table covers exactly the authored contexts', () => {
  it('has a headline for every panel and none for a context nobody wrote', () => {
    // `DISCLOSURE_HEADLINE` is keyed by plain strings — `disclosure-copy.ts` imports nothing, so it
    // cannot name `VisibilityContext` and cannot `satisfies` anything. This is the pin, and without
    // it the doc generator writes the literal text "undefined" into a page of privacy facts.
    const authored = VISIBILITY_CONTEXTS.filter((c) => disclosureFor(c).authored)
    expect(Object.keys(copy.DISCLOSURE_HEADLINE).sort()).toEqual([...authored].sort())
  })
})

describe('an unknown severity is refused, not waved through', () => {
  it('throws rather than reporting the value it exists to catch as honest', () => {
    // The hole: `PRIVACY_SEVERITY['urgent']` is `undefined`, `undefined > 1` is `false`, so a
    // `stays` line carrying a level nobody declared was reported HONEST. The one input that reaches
    // this guard from outside the compiler was the one input it passed.
    const smuggled = { text: 'x', marker: 'stays', severity: 'urgent' as PrivacySeverity }
    expect(() => contradicts(smuggled)).toThrow(/unknown privacy severity/)
    expect(() => assertHonestLine(smuggled)).toThrow(/unknown privacy severity/)
  })

  it('names the closed ladder in the message, so the fix is obvious', () => {
    try {
      contradicts({ text: 'x', marker: 'leaves', severity: '' as PrivacySeverity })
      throw new Error('expected a throw')
    } catch (error) {
      expect(String(error)).toContain('blocked')
      expect(String(error)).toContain('none')
    }
  })

  it('still answers normally for every level the ladder does name', () => {
    for (const severity of Object.keys(PRIVACY_SEVERITY) as PrivacySeverity[]) {
      expect(() => contradicts({ text: 'x', marker: 'leaves', severity })).not.toThrow()
    }
  })
})

describe('the two halves of a review are written together or neither is', () => {
  it('never puts an authored panel over an unauthored matrix', () => {
    // Coloured privacy claims sitting directly above "Nobody has written this one down" is the
    // overclaim this story refuses, and nothing structural stopped it: the panel table and the
    // matrix table are separate `satisfies` records over the same context union.
    for (const context of VISIBILITY_CONTEXTS) {
      expect(disclosureFor(context).authored, context).toBe(matrixFor(context).authored)
    }
  })
})
