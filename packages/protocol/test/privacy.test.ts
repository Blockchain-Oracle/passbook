//
// The severity spine (story 6.7). Small surface, and every assertion on it is a design ruling that
// was written down three times and implemented nowhere before this module existed.
//
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  ctaSeverity,
  getPrivacyColor,
  maxSeverity,
  PRIVACY_SEVERITY,
  severityRank,
  type PrivacySeverity,
} from '../src/privacy.js'
import { forbiddenClaimsIn } from '../src/forbidden-claims.js'

const LEVELS = Object.keys(PRIVACY_SEVERITY) as PrivacySeverity[]

describe('the ladder is the one DESIGN §2.3 writes', () => {
  it('carries the gap-numbered values verbatim', () => {
    expect(PRIVACY_SEVERITY).toEqual({ none: 0, low: 1, medium: 5, high: 10, blocked: 11 })
  })

  it('leaves room to insert a level without renumbering', () => {
    // The gaps are the reason `maxSeverity` is a numeric compare rather than a precedence table.
    // A contiguous 0..4 would force a renumber the first time a sixth level lands between two
    // existing ones, and a renumber is where a stored severity silently changes meaning.
    expect(PRIVACY_SEVERITY.medium - PRIVACY_SEVERITY.low).toBeGreaterThan(1)
    expect(PRIVACY_SEVERITY.high - PRIVACY_SEVERITY.medium).toBeGreaterThan(1)
  })

  it('is strictly ascending in declaration order', () => {
    const values = LEVELS.map((l) => PRIVACY_SEVERITY[l])
    expect(values).toEqual([...values].sort((a, b) => a - b))
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('one getPrivacyColor(), and the most severe state renders calmest', () => {
  it('maps every level, and only two of the five take a colour', () => {
    expect(getPrivacyColor('none')).toBe('neutral')
    expect(getPrivacyColor('low')).toBe('neutral')
    expect(getPrivacyColor('medium')).toBe('exposed')
    expect(getPrivacyColor('high')).toBe('irreversible')
  })

  it('renders BLOCKED grey — not red — which is the whole ruling', () => {
    // DESIGN §2.3: "`Blocked` — the most severe — renders grey (neutral1 on surface3), not red."
    // Asserted from both ends: the value it takes, and the value it must never take.
    expect(getPrivacyColor('blocked')).toBe('quiet')
    expect(getPrivacyColor('blocked')).not.toBe('irreversible')
  })

  it('never returns a fifth colour for any level', () => {
    for (const level of LEVELS) {
      expect(['neutral', 'exposed', 'irreversible', 'quiet'], level).toContain(getPrivacyColor(level))
    }
  })
})

describe('maxSeverity picks the loudest', () => {
  it('is `none` for an empty set rather than a crash', () => {
    // A panel with nothing to disclose is a real state. `Math.max()` over nothing is `-Infinity`,
    // which resolves to no level at all and dies one call later inside `getPrivacyColor`.
    expect(maxSeverity([])).toBe('none')
    expect(getPrivacyColor(maxSeverity([]))).toBe('neutral')
  })

  it('returns the single member of a singleton', () => {
    for (const level of LEVELS) expect(maxSeverity([level]), level).toBe(level)
  })

  it('picks the loudest regardless of order', () => {
    expect(maxSeverity(['low', 'high', 'none'])).toBe('high')
    expect(maxSeverity(['high', 'low', 'none'])).toBe('high')
    expect(maxSeverity(['low', 'medium'])).toBe('medium')
  })

  it('puts blocked above high, because the ladder says so', () => {
    expect(maxSeverity(['high', 'blocked'])).toBe('blocked')
    // And the loudest level is still the calmest colour — the two facts have to hold together.
    expect(getPrivacyColor(maxSeverity(['high', 'blocked']))).toBe('quiet')
  })
})

describe('the CTA channel is narrower than the panel’s', () => {
  it('colours exactly the two levels §7.5 names', () => {
    expect(ctaSeverity('medium')).toBe('exposed')
    expect(ctaSeverity('high')).toBe('irreversible')
  })

  it('returns null for the three it does not', () => {
    expect(ctaSeverity('none')).toBeNull()
    expect(ctaSeverity('low')).toBeNull()
    // The load-bearing one: `index.css` rules that blocked is an emphasis DOWNGRADE and does not
    // take the irreversible colour. A channel here would reverse that ruling from another file.
    expect(ctaSeverity('blocked')).toBeNull()
  })

  it('never widens to the panel’s four values', () => {
    for (const level of LEVELS) {
      const channel = ctaSeverity(level)
      expect(channel === null || channel === 'exposed' || channel === 'irreversible', level).toBe(true)
      expect(channel, level).not.toBe('quiet')
      expect(channel, level).not.toBe('neutral')
    }
  })
})

describe('a level the ladder does not name is refused, never treated as calm', () => {
  it('ranks every declared level', () => {
    for (const level of LEVELS) expect(severityRank(level), level).toBe(PRIVACY_SEVERITY[level])
  })

  it('THROWS on an undeclared one rather than answering', () => {
    // Every bare `PRIVACY_SEVERITY[level] > …` comparison against `undefined` is `false`, so an
    // unknown level was silently the calmest value on the scale for every consumer at once: it lost
    // every `max`, and it passed the contradiction guard. The one input that reaches this code from
    // outside the compiler was the one input nothing checked.
    expect(() => severityRank('urgent' as PrivacySeverity)).toThrow(/unknown privacy severity/)
    expect(() => severityRank('' as PrivacySeverity)).toThrow(/ladder is closed/)
  })

  it('so maxSeverity refuses a set containing one, instead of skipping it', () => {
    expect(() => maxSeverity(['low', 'urgent' as PrivacySeverity])).toThrow(/unknown privacy severity/)
    // And the empty set is still the one case that answers rather than throwing — an empty panel is
    // a fact about the surface, an unknown level is a fact about the code.
    expect(maxSeverity([])).toBe('none')
  })
})

describe('the copy this module ships is clean', () => {
  it('names no refused claim anywhere in the file, comments included', () => {
    const source = readFileSync(new URL('../src/privacy.ts', import.meta.url), 'utf8')
    expect(forbiddenClaimsIn(source)).toEqual([])
  })
})
