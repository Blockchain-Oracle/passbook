import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  SEARCH_DEBOUNCE_MS,
  SECTION_HEADINGS,
  filterRows,
  filterSections,
  nextHighlight,
  noResultsSentence,
} from '../src/option-row.js'
import type { OptionRow } from '../src/option-row.js'
import { forbiddenClaimsIn } from '../src/forbidden-claims.js'

const row = (id: string, over: Partial<OptionRow> = {}): OptionRow => ({ id, title: id, ...over })

const TOKENS: OptionRow[] = [
  row('strk', { title: 'STRK', titleSuffix: 'Starknet Token', subtitle: 'Shielded' }),
  row('usdc', { title: 'USDC', titleSuffix: 'USD Coin', tag: 'Stablecoin' }),
  row('eth', { title: 'ETH', titleSuffix: 'Ether', disabled: true }),
]

describe('one debounce, one constant (§7.2)', () => {
  it('is 200ms', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(200)
  })
})

describe('the two section headings are verbatim', () => {
  it('names the shielded pool and states what the public one costs', () => {
    expect(SECTION_HEADINGS.shielded).toBe('In your shielded pool')
    expect(SECTION_HEADINGS.public).toBe('Public balance (will reveal)')
  })

  it('there are exactly two', () => {
    expect(Object.keys(SECTION_HEADINGS)).toEqual(['shielded', 'public'])
  })
})

describe('filtering', () => {
  it('an empty query returns everything, so a fresh list is never blank', () => {
    expect(filterRows(TOKENS, '')).toHaveLength(3)
    expect(filterRows(TOKENS, '   ')).toHaveLength(3)
  })

  it('matches the title, the suffix and the tag, case-insensitively', () => {
    expect(filterRows(TOKENS, 'strk').map((r) => r.id)).toEqual(['strk'])
    expect(filterRows(TOKENS, 'coin').map((r) => r.id)).toEqual(['usdc'])
    expect(filterRows(TOKENS, 'STABLE').map((r) => r.id)).toEqual(['usdc'])
  })

  it('matches a note by its lifecycle badge', () => {
    const notes = [row('n1', { title: 'Note', badge: { label: 'Spendable', status: 'settled' } })]
    expect(filterRows(notes, 'spendable').map((r) => r.id)).toEqual(['n1'])
  })

  it('does not match on the right-hand value — nobody searches a list by balance', () => {
    const withBalance = [row('a', { title: 'AAA', right: { value: '12.5', confidence: 'dated' } })]
    expect(filterRows(withBalance, '12.5')).toHaveLength(0)
  })

  it('keeps disabled rows visible — they are readable, just not choosable', () => {
    expect(filterRows(TOKENS, 'eth').map((r) => r.id)).toEqual(['eth'])
  })

  it('drops a section that has nothing left, and keeps the ones that do', () => {
    const sections = [
      { key: 'shielded' as const, rows: [TOKENS[0]!] },
      { key: 'public' as const, rows: [TOKENS[1]!] },
    ]
    expect(filterSections(sections, 'strk').map((s) => s.key)).toEqual(['shielded'])
    expect(filterSections(sections, 'zzz')).toEqual([])
  })
})

describe('the no-results sentence', () => {
  it('comes back in parts so the query can be the one thing at full contrast', () => {
    expect(noResultsSentence('zzz')).toEqual({ before: 'Nothing here is called ', query: 'zzz', after: '.' })
  })

  it('reassembles into one sentence with no card and no illustration to build around', () => {
    const s = noResultsSentence('  wbtc  ')
    expect(`${s.before}${s.query}${s.after}`).toBe('Nothing here is called wbtc.')
  })
})

describe('hover and keyboard are one highlight', () => {
  it('moves down and up through the list', () => {
    expect(nextHighlight(TOKENS, 'strk', 1)).toBe('usdc')
    expect(nextHighlight(TOKENS, 'usdc', -1)).toBe('strk')
  })

  it('wraps at both ends', () => {
    // 'eth' is disabled, so down from 'usdc' skips it and comes round to the top.
    expect(nextHighlight(TOKENS, 'usdc', 1)).toBe('strk')
    expect(nextHighlight(TOKENS, 'strk', -1)).toBe('usdc')
  })

  it('never lands on a disabled row', () => {
    for (const start of ['strk', 'usdc', 'eth', null]) {
      for (const delta of [1, -1] as const) {
        expect(nextHighlight(TOKENS, start, delta)).not.toBe('eth')
      }
    }
  })

  it('the first Down with nothing highlighted lands on the first row', () => {
    expect(nextHighlight(TOKENS, null, 1)).toBe('strk')
  })

  it('the first Up with nothing highlighted lands on the last choosable row', () => {
    expect(nextHighlight(TOKENS, null, -1)).toBe('usdc')
  })

  it('a highlight whose row was filtered away restarts rather than sticking', () => {
    expect(nextHighlight(TOKENS, 'gone', 1)).toBe('strk')
  })

  it('terminates when EVERY row is disabled — a real state, not a defensive guess', () => {
    const allOff = [row('a', { disabled: true }), row('b', { disabled: true })]
    expect(nextHighlight(allOff, null, 1)).toBeNull()
    expect(nextHighlight(allOff, 'a', 1)).toBeNull()
  })

  it('an empty list has nothing to highlight', () => {
    expect(nextHighlight([], null, 1)).toBeNull()
  })

  it('a single choosable row stays put rather than flickering', () => {
    const one = [row('only')]
    expect(nextHighlight(one, 'only', 1)).toBe('only')
    expect(nextHighlight(one, 'only', -1)).toBe('only')
  })
})

describe('the copy this module ships is clean', () => {
  it('names no refused claim anywhere in the file, comments included', () => {
    const source = readFileSync(new URL('../src/option-row.ts', import.meta.url), 'utf8')
    expect(forbiddenClaimsIn(source)).toEqual([])
  })
})
