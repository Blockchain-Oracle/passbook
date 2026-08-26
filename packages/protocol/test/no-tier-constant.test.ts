import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boundaryFor } from '../src/crowd.js'
import { tierFor } from '../src/linkability.js'
import type { CrowdReading } from '../src/crowd.js'

//
// FR-052 and EPICS:709 — "a test asserts no hardcoded tier constant".
//
// ── WHY THIS IS TWO GUARDS AND NOT ONE ────────────────────────────────────────────────────
//
// A SOURCE GREP ALONE is defeated by `const B = Math.floor(20)`, by a number imported from
// elsewhere, and by anything the regex did not imagine. A BEHAVIOURAL TEST ALONE passes a boundary
// that is a function of the wrong thing, and reports nothing useful about where the problem is.
//
// Together they are hard to route around: the behavioural half proves the boundary MOVES with the
// sample it was derived from, which no constant can do, and the source half names the file when
// someone reintroduces a literal. Neither is decorative and neither is sufficient.
//
// ── AND WHY THE FILE LIST IS DERIVED, NOT TYPED ───────────────────────────────────────────
//
// A hand-written list of "the tier modules" is a guard you escape by adding a third module. The
// list below is checked against every module that actually calls the tier machinery, so a new
// consumer either joins the sweep or fails this file.
//

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

/** The modules whose job is to decide a tier. Verified complete against the source tree below. */
const TIER_MODULES = ['crowd.ts', 'linkability.ts']

function sourceFiles(): string[] {
  return readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts'))
}

const read = (file: string) => readFileSync(join(SRC, file), 'utf8')

//
// The two shapes a hardcoded threshold takes. Both are matched in either direction, because
// `candidates <= 20` and `20 >= candidates` are the same bug written two ways.
//
// RELATIONAL OPERATORS ONLY, AND THAT IS A RULING RATHER THAN AN OVERSIGHT. A threshold is a
// statement about MAGNITUDE — "smaller than this is a small crowd" — which needs `<`, `<=`, `>` or
// `>=`. Equality against one specific count cannot express a boundary; it can only test a single
// case. The case the codebase actually has is `candidates === 1`, the authored "you are alone"
// sentence the I/O matrix requires be named in words, and banning it would be banning the
// requirement. The relational guard still catches every ladder built around it.
//
const COUNT_AGAINST_LITERAL = /(?:candidates\s*(?:<=|>=|<|>)\s*-?\d)|(?:-?\d+\s*(?:<=|>=|<|>)\s*[\w.]*candidates)/
const NAMED_THRESHOLD_LITERAL = /(?:threshold|boundary)\w*\s*(?::\s*number\s*)?=\s*-?\d/i

describe('the sweep is not vacuous', () => {
  it('found the source tree', () => {
    // A walk that silently found nothing is a guard that passes by doing nothing.
    expect(sourceFiles().length).toBeGreaterThan(10)
  })

  it('found every module it is supposed to be policing', () => {
    for (const file of TIER_MODULES) {
      expect(sourceFiles()).toContain(file)
      expect(read(file).length).toBeGreaterThan(500)
    }
  })

  it('policing list covers every module that touches the tier machinery', () => {
    // Adding a third module that calls `boundaryFor` or `tierFor` without adding it here fails.
    const callers = sourceFiles().filter((file) => {
      const text = read(file)
      return /\bboundaryFor\s*\(/.test(text) || /\btierFor\s*\(/.test(text)
    })
    expect(callers.sort()).toEqual([...TIER_MODULES].sort())
  })

  it('the patterns actually fire on the thing they exist to catch', () => {
    // Without this, a typo in either regex turns the whole file green forever.
    expect(COUNT_AGAINST_LITERAL.test('if (reading.candidates <= 20) return 1')).toBe(true)
    expect(COUNT_AGAINST_LITERAL.test('if (20 >= reading.candidates) return 1')).toBe(true)
    expect(COUNT_AGAINST_LITERAL.test('if (reading.candidates < 20) return 1')).toBe(true)
    expect(COUNT_AGAINST_LITERAL.test('return candidates > 100 ? 0 : 1')).toBe(true)
    expect(NAMED_THRESHOLD_LITERAL.test('const TIER_1_BOUNDARY = 20')).toBe(true)
    expect(NAMED_THRESHOLD_LITERAL.test('const smallCrowdThreshold: number = 25')).toBe(true)
  })

  it('the one equality it deliberately permits is the authored alone case', () => {
    // Visible as a decision rather than a silent hole. If this ever stops being the only equality
    // against a count in the tier modules, that is worth a second look by hand.
    expect(COUNT_AGAINST_LITERAL.test('const alone = reading.candidates === 0')).toBe(false)
    const equalities = TIER_MODULES.flatMap((file) =>
      read(file)
        .split('\n')
        .filter((line) => /candidates\s*===\s*-?\d/.test(line.trim()))
        .map((line) => line.trim()),
    )
    expect(equalities).toEqual([
      'const alone = reading.candidates === 0 || reading.candidates === 1',
    ])
  })
})

describe('no tier boundary survives as a literal', () => {
  for (const file of TIER_MODULES) {
    it(`${file} never compares a count against a typed number`, () => {
      const offending = read(file)
        .split('\n')
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*'))
        .filter(({ line }) => COUNT_AGAINST_LITERAL.test(line))
      expect(offending.map((o) => `${file}:${o.number} ${o.line}`)).toEqual([])
    })

    it(`${file} declares no named threshold with a literal value`, () => {
      const offending = read(file)
        .split('\n')
        .map((line, index) => ({ line: line.trim(), number: index + 1 }))
        .filter(({ line }) => !line.startsWith('//') && !line.startsWith('*'))
        .filter(({ line }) => NAMED_THRESHOLD_LITERAL.test(line))
      expect(offending.map((o) => `${file}:${o.number} ${o.line}`)).toEqual([])
    })
  }
})

describe('the boundary is a function of what was read', () => {
  const reading = (distribution: readonly number[], candidates: number): CrowdReading => ({
    state: 'measured',
    candidates,
    window: 'the last 24 hours',
    blockNumber: 1,
    largestEverWei: null,
    distribution,
  })

  it('two samples give two boundaries — the property no constant has', () => {
    expect(boundaryFor([1, 2, 3, 4])).not.toBe(boundaryFor([100, 200, 300, 400]))
  })

  it('the SAME count lands on different tiers under different samples', () => {
    // This is the assertion a hardcoded threshold cannot survive: 50 candidates is a small crowd
    // among hundreds and a healthy one among tens, and only a derived boundary can say both.
    expect(tierFor(reading([10, 20, 30, 40], 50), null)).toBe(0)
    expect(tierFor(reading([100, 200, 300, 400], 50), null)).toBe(1)
  })

  it('scales with the sample rather than sitting at some remembered number', () => {
    const scaled = [10, 20, 30, 40].map((n) => n * 1000)
    expect(boundaryFor(scaled)).toBe(boundaryFor([10, 20, 30, 40])! * 1000)
  })
})
