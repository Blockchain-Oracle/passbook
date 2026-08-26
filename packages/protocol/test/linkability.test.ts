import { describe, it, expect } from 'vitest'
import type { CrowdReading } from '../src/crowd.js'
import {
  meterFor,
  noteField,
  severityOf,
  tierFor,
  FIELD_DENSITY_CEILING,
} from '../src/linkability.js'
import {
  ALONE_SENTENCE,
  EXIT_ANYWAY,
  INDEXER_UNREACHABLE,
  LARGEST_EVER_SENTENCE,
  SPLIT_THE_AMOUNT,
  WAIT_FOR_DEPOSITS,
  capitalize,
  caretDelta,
  provenanceCaption,
  spellOut,
  verdictSentence,
} from '../src/linkability-copy.js'
import { forbiddenClaimsIn } from '../src/forbidden-claims.js'
import { ctaSeverity, getPrivacyColor } from '../src/privacy.js'

const USDC = 6
const LARGEST_EVER = 45_000000n

// Quartile of [10, 20, 30, 40] is 17.5, so 26 is a healthy crowd and 12 is a small one.
const measured = (over: Partial<Extract<CrowdReading, { state: 'measured' }>> = {}): CrowdReading => ({
  state: 'measured',
  candidates: 26,
  window: 'the last 24 hours',
  blockNumber: 1_234_567,
  largestEverWei: LARGEST_EVER,
  distribution: [10, 20, 30, 40],
  ...over,
})

const UNMEASURABLE: CrowdReading = { state: 'unmeasurable', because: INDEXER_UNREACHABLE }

const meter = (reading: CrowdReading, amountWei: bigint | null = 1_000000n) =>
  meterFor({ reading, amountWei, decimals: USDC })

describe('the three tiers', () => {
  it('a healthy crowd is Tier 0 and states the count without judging it', () => {
    const model = meter(measured())
    expect(model.state === 'measured' && model.tier).toBe(0)
    expect(model.state === 'measured' && model.severity).toBe('low')
    expect(model.state === 'measured' && model.headline).toBe('Your exit is one of 26 possible sources.')
    expect(model.state === 'measured' && model.alternatives).toEqual([])
    expect(model.state === 'measured' && model.ctaLabel).toBeNull()
  })

  it('a small set is Tier 1, amber, with two named alternatives', () => {
    const model = meter(measured({ candidates: 12 }))
    expect(model.state === 'measured' && model.tier).toBe(1)
    expect(model.state === 'measured' && model.severity).toBe('medium')
    expect(model.state === 'measured' && model.headline).toBe(
      'Your exit is one of 12 possible sources. Twelve is not enough to hide you.',
    )
    expect(model.state === 'measured' && model.alternatives).toEqual([
      WAIT_FOR_DEPOSITS,
      SPLIT_THE_AMOUNT,
    ])
  })

  it('an amount above every crossing ever read is Tier 2 and relabels the CTA', () => {
    const model = meter(measured(), LARGEST_EVER + 1n)
    expect(model.state === 'measured' && model.tier).toBe(2)
    expect(model.state === 'measured' && model.severity).toBe('high')
    expect(model.state === 'measured' && model.headline).toBe(LARGEST_EVER_SENTENCE)
    expect(model.state === 'measured' && model.ctaLabel).toBe(EXIT_ANYWAY)
  })

  it('exactly the largest ever is NOT above it', () => {
    // Strictly greater, because equalling the record does not make an exit the largest ever made.
    expect(tierFor(measured(), LARGEST_EVER)).toBe(0)
  })
})

describe('when the two axes disagree, the louder one wins', () => {
  it('a healthy crowd carrying a unique amount is still Tier 2', () => {
    // The time axis says Tier 0 (26 is well above the boundary) and the amount axis says Tier 2.
    const model = meter(measured({ candidates: 26 }), LARGEST_EVER + 1n)
    expect(model.state === 'measured' && model.tier).toBe(2)
    expect(model.state === 'measured' && model.severity).toBe('high')
  })

  it('resolves to ONE colour, never two shades of bad', () => {
    const model = meter(measured({ candidates: 12 }), LARGEST_EVER + 1n)
    const severity = model.state === 'measured' ? model.severity! : 'none'
    expect(getPrivacyColor(severity)).toBe('irreversible')
  })
})

describe('an unmeasurable crowd', () => {
  it('renders no count, no tier and no warning', () => {
    const model = meter(UNMEASURABLE)
    expect(model.state).toBe('unmeasurable')
    expect(model).toEqual({ state: 'unmeasurable', because: INDEXER_UNREACHABLE })
    // The union is what makes the wrong thing unspellable: there is no `candidates` to reach for.
    expect('candidates' in model).toBe(false)
    expect('tier' in model).toBe(false)
  })

  it('uses the sourced offline sentence rather than a new one', () => {
    expect(INDEXER_UNREACHABLE).toBe('Our indexer is unreachable')
  })

  it('has no tier at all, which is a separate arm from Tier 0', () => {
    expect(tierFor(UNMEASURABLE, 1_000000n)).toBeNull()
  })
})

describe('measured but not judgeable', () => {
  it('states the count and delivers no verdict when the sample cannot support a boundary', () => {
    // "Healthy" is a verdict. Delivering it without the measurement behind it is the invented
    // claim FR-051 bans, so the tier is null rather than 0.
    const model = meter(measured({ distribution: [10, 20] }))
    expect(model.state === 'measured' && model.tier).toBeNull()
    expect(model.state === 'measured' && model.severity).toBeNull()
    expect(model.state === 'measured' && model.candidates).toBe(26)
  })

  it('can still reach Tier 2, because the amount axis does not need the distribution', () => {
    expect(tierFor(measured({ distribution: [] }), LARGEST_EVER + 1n)).toBe(2)
  })
})

describe('a crowd of one is stated in words', () => {
  it('never says "one of 1 possible sources"', () => {
    const model = meter(measured({ candidates: 1 }))
    expect(model.state === 'measured' && model.headline).toBe(ALONE_SENTENCE)
    expect(model.state === 'measured' && model.headline).not.toContain('one of 1')
  })

  it('keeps stating it even when a louder headline takes the top line', () => {
    // Both facts are true; dropping either leaves the louder one standing alone as if it were the
    // only problem.
    const model = meter(measured({ candidates: 1 }), LARGEST_EVER + 1n)
    expect(model.state === 'measured' && model.headline).toBe(LARGEST_EVER_SENTENCE)
    expect(model.state === 'measured' && model.lines).toContain(ALONE_SENTENCE)
  })
})

describe('provenance is the reading’s own, never now', () => {
  it('renders the block the reading carried', () => {
    const model = meter(measured({ blockNumber: 999 }))
    expect(model.state === 'measured' && model.provenance).toBe(
      'Drawn in your browser from on-chain events · as of block 999',
    )
  })

  it('a stale reading is stamped with its own older block, not re-stamped as current', () => {
    const stale = meter(measured({ blockNumber: 1 }))
    const fresh = meter(measured({ blockNumber: 2 }))
    expect(stale.state === 'measured' && stale.provenance).not.toBe(
      fresh.state === 'measured' ? fresh.provenance : '',
    )
  })
})

describe('the amount axis quotes the live read, never a typed figure', () => {
  it('interpolates the largest-ever value into both sentences', () => {
    const model = meter(measured({ candidates: 12 }))
    const lines = model.state === 'measured' ? model.lines.join('\n') : ''
    expect(lines).toContain('The largest crossing this pool has ever carried is 45 USDC.')
    expect(lines).toContain('A crossing above ~45 USDC is currently unique')
  })

  it('moves with the reading — no figure is baked in', () => {
    const model = meter(measured({ candidates: 12, largestEverWei: 90_000000n }))
    const lines = model.state === 'measured' ? model.lines.join('\n') : ''
    expect(lines).toContain('~90 USDC')
    expect(lines).not.toContain('~45')
  })

  it('says nothing about an amount it did not read', () => {
    const model = meter(measured({ candidates: 12, largestEverWei: null }))
    const lines = model.state === 'measured' ? model.lines.join('\n') : ''
    expect(lines).not.toContain('largest crossing')
    expect(lines).not.toContain('currently unique')
  })

  it('states the time axis with its window', () => {
    const model = meter(measured())
    expect(model.state === 'measured' && model.lines[0]).toBe(
      '26 addresses shielded USDC in the last 24 hours.',
    )
  })
})

describe('the field', () => {
  it('puts exactly one node at the centre and marks it as yours', () => {
    const field = noteField(142)
    expect(field.nodes).toHaveLength(142)
    expect(field.nodes.filter((n) => n.mine)).toHaveLength(1)
    expect(field.nodes[0]).toEqual({ x: 0.5, y: 0.5, mine: true })
  })

  it('is deterministic, so a poll carrying the same count does not re-scatter it', () => {
    expect(noteField(142)).toEqual(noteField(142))
  })

  it('keeps every node inside the box at both design sizes', () => {
    for (const total of [142, 10_000]) {
      for (const node of noteField(total).nodes) {
        expect(node.x).toBeGreaterThanOrEqual(0)
        expect(node.x).toBeLessThanOrEqual(1)
        expect(node.y).toBeGreaterThanOrEqual(0)
        expect(node.y).toBeLessThanOrEqual(1)
      }
    }
  })

  it('draws 10,000 in full, because C10:101 requires that size to be designed for', () => {
    const field = noteField(10_000)
    expect(field.nodes).toHaveLength(10_000)
    expect(field.downsampled).toBe(false)
    expect(FIELD_DENSITY_CEILING).toBeGreaterThanOrEqual(10_000)
  })

  it('downsamples above the ceiling and SAYS it downsampled', () => {
    const field = noteField(50, 10)
    expect(field.nodes).toHaveLength(10)
    expect(field.total).toBe(50)
    expect(field.downsampled).toBe(true)
  })

  it('quotes the real total, never the number of dots it drew', () => {
    // The sentence says "one of 50". A field that reported 10 would make the picture contradict
    // the sentence beside it.
    expect(noteField(50, 10).total).toBe(50)
  })

  it('handles the degenerate counts without dividing by zero', () => {
    expect(noteField(0).nodes).toEqual([])
    expect(noteField(1).nodes).toEqual([{ x: 0.5, y: 0.5, mine: true }])
  })
})

describe('severity routes through the ladder that already shipped', () => {
  it('maps the three tiers onto three existing levels', () => {
    expect(severityOf(0)).toBe('low')
    expect(severityOf(1)).toBe('medium')
    expect(severityOf(2)).toBe('high')
  })

  it('never comes out calmer than the panel it sits beside', () => {
    // `swap`'s disclosure panel is already `low`. Tier 0 as `none` would let a combined
    // `maxSeverity` render calmer than the panel alone.
    expect(severityOf(0)).not.toBe('none')
  })

  it('escalates the CTA through the one existing channel', () => {
    expect(ctaSeverity(severityOf(0))).toBeNull()
    expect(ctaSeverity(severityOf(1))).toBe('exposed')
    expect(ctaSeverity(severityOf(2))).toBe('irreversible')
  })
})

describe('the authored copy is byte-exact', () => {
  it('reproduces the verdict exactly as four documents write it', () => {
    expect(verdictSentence(12)).toBe(
      'Your exit is one of 12 possible sources. Twelve is not enough to hide you.',
    )
  })

  it('reproduces the caret with U+25B2', () => {
    expect(caretDelta(3)).toBe('▲ +3 since you opened this screen.')
    expect(caretDelta(3).charCodeAt(0)).toBe(0x25b2)
  })

  it('reproduces AD-14’s caption with its middle dot', () => {
    expect(provenanceCaption(9)).toBe('Drawn in your browser from on-chain events · as of block 9')
  })

  it('trips no banned claim, on any sentence the meter can render', () => {
    const everySentence = [
      ALONE_SENTENCE,
      LARGEST_EVER_SENTENCE,
      INDEXER_UNREACHABLE,
      WAIT_FOR_DEPOSITS,
      SPLIT_THE_AMOUNT,
      EXIT_ANYWAY,
      ...[0, 1, 2, 12, 26].flatMap((n) => {
        const model = meter(measured({ candidates: Math.max(n, 1) }))
        return model.state === 'measured' ? [model.headline, ...model.lines] : []
      }),
    ]
    for (const sentence of everySentence) {
      expect(forbiddenClaimsIn(sentence), sentence).toEqual([])
    }
  })
})

describe('the number speller', () => {
  it('spells the case the canon uses', () => {
    expect(capitalize(spellOut(12))).toBe('Twelve')
  })

  it('hyphenates compounds and capitalises only the first letter', () => {
    expect(spellOut(26)).toBe('twenty-six')
    expect(capitalize(spellOut(26))).toBe('Twenty-six')
  })

  it('is total across the range it claims', () => {
    for (let n = 0; n <= 9999; n += 1) {
      expect(typeof spellOut(n)).toBe('string')
      expect(spellOut(n).length).toBeGreaterThan(0)
    }
  })

  it('spells the shapes that are easy to get wrong', () => {
    expect(spellOut(0)).toBe('zero')
    expect(spellOut(15)).toBe('fifteen')
    expect(spellOut(20)).toBe('twenty')
    expect(spellOut(100)).toBe('one hundred')
    expect(spellOut(106)).toBe('one hundred six')
    expect(spellOut(1000)).toBe('one thousand')
    expect(spellOut(1206)).toBe('one thousand two hundred six')
  })

  it('refuses a number that cannot reach the sentence, rather than printing a digit', () => {
    expect(() => spellOut(10_000)).toThrow(/0–9999/)
    expect(() => spellOut(-1)).toThrow(/0–9999/)
    expect(() => spellOut(1.5)).toThrow(/0–9999/)
  })
})
