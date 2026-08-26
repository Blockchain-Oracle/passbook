//
// The matrix (story 6.7). EVERY CELL IN IT IS A PRIVACY CLAIM, so these are not shape tests: they
// are the mechanism that keeps a claim from being half-written, silently qualified, or quietly
// replaced by an empty grid.
//
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

import { forbiddenClaimsIn } from '../src/forbidden-claims.js'
import {
  ACTOR_LABELS,
  CELL_ENCODING,
  CELL_LABEL,
  CELL_MEANING,
  CONTEXT_LABELS,
  CONTEXT_SURFACE,
  FACT_LABELS,
  MATRICES,
  cellAnnouncement,
  footnoteText,
  matrixDelta,
  matrixFor,
  matrixNotes,
  NOTE_STATED_ABOVE,
  noteNumber,
  receiptContext,
  SURFACE_CONTEXT,
  VISIBILITY_ACTORS,
  VISIBILITY_CELL_STATES,
  VISIBILITY_CONTEXTS,
  VISIBILITY_FACTS,
  type VisibilityContext,
} from '../src/visibility-matrix.js'

/** Declared unauthored on purpose — both are recorded in the module with the sentence that says why. */
const UNAUTHORED: VisibilityContext[] = ['markets-exit', 'launch-sell']

describe('the two axes are the ones the design authority wrote', () => {
  it('names the four columns in order', () => {
    expect([...VISIBILITY_ACTORS]).toEqual(['you', 'relayer', 'everyone', 'auditor'])
  })

  it('names the five rows in order', () => {
    expect([...VISIBILITY_FACTS]).toEqual(['amount', 'sender', 'recipient', 'timing', 'ip'])
  })

  it('labels every one of them, with no duplicates on either axis', () => {
    const actors = VISIBILITY_ACTORS.map((a) => ACTOR_LABELS[a])
    const facts = VISIBILITY_FACTS.map((f) => FACT_LABELS[f])
    expect(actors.every(Boolean)).toBe(true)
    expect(facts.every(Boolean)).toBe(true)
    expect(new Set(actors).size).toBe(actors.length)
    expect(new Set(facts).size).toBe(facts.length)
  })
})

describe('the four cell states each carry a word, a shape and a meaning', () => {
  it('covers all four in every table', () => {
    expect([...VISIBILITY_CELL_STATES]).toEqual(['sees', 'hidden', 'conditional', 'absent'])
    for (const state of VISIBILITY_CELL_STATES) {
      expect(CELL_LABEL[state], state).toBeTruthy()
      expect(CELL_ENCODING[state], state).toBeTruthy()
      expect(CELL_MEANING[state], state).toBeTruthy()
    }
  })

  it('gives each state a DISTINCT word and a DISTINCT shape', () => {
    // The word and the shape are the two channels that survive greyscale and colour vision
    // deficiency. Two states sharing either one collapse to a cell separated by hue alone, which is
    // the failure DESIGN §2.3 measured and made a code rule.
    const words = VISIBILITY_CELL_STATES.map((s) => CELL_LABEL[s])
    const shapes = VISIBILITY_CELL_STATES.map((s) => CELL_ENCODING[s])
    expect(new Set(words).size).toBe(words.length)
    expect(new Set(shapes).size).toBe(shapes.length)
  })
})

describe('every review context resolves to something', () => {
  it('declares ten, and the table covers exactly those ten', () => {
    expect(VISIBILITY_CONTEXTS).toHaveLength(10)
    expect(Object.keys(MATRICES).sort()).toEqual([...VISIBILITY_CONTEXTS].sort())
  })

  it('never returns undefined, for any of them', () => {
    for (const context of VISIBILITY_CONTEXTS) {
      expect(matrixFor(context), context).toBeDefined()
      expect(matrixFor(context).context, context).toBe(context)
      expect(CONTEXT_LABELS[context], context).toBeTruthy()
    }
  })

  it('authors eight and refuses two, by name', () => {
    const authored = VISIBILITY_CONTEXTS.filter((c) => matrixFor(c).authored)
    const refused = VISIBILITY_CONTEXTS.filter((c) => !matrixFor(c).authored)
    expect(authored).toHaveLength(8)
    expect(refused).toEqual(UNAUTHORED)
  })
})

describe('an authored matrix is COMPLETE over both axes', () => {
  it('fills every one of the twenty cells with a declared state', () => {
    for (const context of VISIBILITY_CONTEXTS) {
      const matrix = matrixFor(context)
      if (!matrix.authored) continue

      expect(Object.keys(matrix.cells).sort(), context).toEqual([...VISIBILITY_FACTS].sort())
      let cells = 0
      for (const fact of VISIBILITY_FACTS) {
        expect(Object.keys(matrix.cells[fact]).sort(), `${context}/${fact}`).toEqual(
          [...VISIBILITY_ACTORS].sort(),
        )
        for (const actor of VISIBILITY_ACTORS) {
          const cell = matrix.cells[fact][actor]
          expect(VISIBILITY_CELL_STATES, `${context}/${fact}/${actor}`).toContain(cell.state)
          cells += 1
        }
      }
      // A PARTIALLY FILLED GRID IS THE FAILURE THIS COUNTS. Twenty is the whole matrix; nineteen
      // renders a blank cell that a reader takes for "nothing to see here".
      expect(cells, context).toBe(VISIBILITY_FACTS.length * VISIBILITY_ACTORS.length)
    }
  })

  it('carries a non-empty condition on every conditional cell', () => {
    let conditionals = 0
    for (const context of VISIBILITY_CONTEXTS) {
      const matrix = matrixFor(context)
      if (!matrix.authored) continue
      for (const fact of VISIBILITY_FACTS) {
        for (const actor of VISIBILITY_ACTORS) {
          const cell = matrix.cells[fact][actor]
          if (cell.state !== 'conditional') continue
          conditionals += 1
          expect(cell.note.trim(), `${context}/${fact}/${actor}`).not.toBe('')
        }
      }
    }
    // There is at least one, or this whole test is passing vacuously over a table that never uses
    // the arm the union exists for.
    expect(conditionals).toBeGreaterThan(0)
  })

  it('keeps the auditor column present on every authored context', () => {
    // §5.5: the Auditor column is honest and PERMANENT. Dropping it from one context is how a
    // matrix quietly stops making the product's least comfortable true statement.
    for (const context of VISIBILITY_CONTEXTS) {
      const matrix = matrixFor(context)
      if (!matrix.authored) continue
      for (const fact of VISIBILITY_FACTS) {
        expect(matrix.cells[fact].auditor, `${context}/${fact}`).toBeDefined()
      }
    }
  })
})

describe('an unauthored context is a value, never an empty grid', () => {
  it('returns the reason and no cells at all', () => {
    for (const context of UNAUTHORED) {
      const matrix = matrixFor(context)
      expect(matrix.authored, context).toBe(false)
      if (matrix.authored) continue
      expect(matrix.because.trim().length, context).toBeGreaterThan(40)
      expect('cells' in matrix, context).toBe(false)
    }
  })

  it('names why in a sentence a reader can act on', () => {
    const exit = matrixFor('markets-exit')
    const sell = matrixFor('launch-sell')
    if (exit.authored || sell.authored) throw new Error('both are declared unauthored')
    expect(exit.because).toMatch(/FR-051|hand review/)
    expect(sell.because).toMatch(/FR-046|unwritten/)
    // And they are DIFFERENT refusals, not one sentence pasted twice: the market exit has no
    // denomination cover, the launch sell has no shipped sell path at all.
    expect(exit.because).not.toBe(sell.because)
  })
})

describe('matrixDelta shows the difference and nothing else', () => {
  it('returns only the cells that changed between the two send paths', () => {
    const changes = matrixDelta('pool-send', 'self-submit')
    expect(changes.length).toBeGreaterThan(0)
    expect(changes.length).toBeLessThan(VISIBILITY_FACTS.length * VISIBILITY_ACTORS.length)

    for (const change of changes) {
      const before = matrixFor('pool-send')
      const after = matrixFor('self-submit')
      if (!before.authored || !after.authored) throw new Error('both are authored')
      expect(before.cells[change.fact][change.actor]).toEqual(change.from)
      expect(after.cells[change.fact][change.actor]).toEqual(change.to)
      expect(change.from).not.toEqual(change.to)
    }
  })

  it('reports the sender going public, which is the whole cost of self-submitting', () => {
    const changes = matrixDelta('pool-send', 'self-submit')
    const senderToEveryone = changes.find((c) => c.fact === 'sender' && c.actor === 'everyone')
    expect(senderToEveryone?.from).toEqual({ state: 'hidden' })
    expect(senderToEveryone?.to).toEqual({ state: 'sees' })
  })

  it('reports nothing for a context against itself', () => {
    for (const context of VISIBILITY_CONTEXTS) {
      if (!matrixFor(context).authored) continue
      expect(matrixDelta(context, context), context).toEqual([])
    }
  })

  it('THROWS on an unauthored side rather than returning an empty delta', () => {
    // "Nothing changed" and "one side was never written" are opposite claims, and an empty array is
    // how the second silently becomes the first on a trust-boundary modal.
    expect(() => matrixDelta('markets-bet', 'markets-exit')).toThrow(/no authored matrix/)
    expect(() => matrixDelta('launch-sell', 'launch-buy')).toThrow(/no authored matrix/)
    expect(() => matrixDelta('markets-exit', 'launch-sell')).toThrow(/no authored matrix/)
  })
})

describe('the review vocabulary maps onto the six surfaces', () => {
  it('gives every context a surface', () => {
    for (const context of VISIBILITY_CONTEXTS) {
      expect(CONTEXT_SURFACE[context], context).toBeTruthy()
    }
  })

  it('gives every surface a default review context that is a real one', () => {
    const surfaces = new Set(VISIBILITY_CONTEXTS.map((c) => CONTEXT_SURFACE[c]))
    expect(Object.keys(SURFACE_CONTEXT).sort()).toEqual([...surfaces].sort())
    for (const [surface, context] of Object.entries(SURFACE_CONTEXT)) {
      expect(VISIBILITY_CONTEXTS, surface).toContain(context)
      // And the round trip is consistent: a surface's default context lives on that surface.
      expect(CONTEXT_SURFACE[context], surface).toBe(surface)
    }
  })

  it('defaults the wallet to the relayed path, never to self-submit', () => {
    // `degradedFromHealth`'s rule, applied to a receipt: an ambiguous reading resolves to the
    // claim that is safe to be wrong about. Saying a user's own address was published when it was
    // not is the worse of the two mistakes.
    expect(SURFACE_CONTEXT.wallet).toBe('pool-send')
  })

  it('never points a surface at a context nobody wrote', () => {
    for (const [surface, context] of Object.entries(SURFACE_CONTEXT)) {
      expect(matrixFor(context).authored, `${surface} → ${context}`).toBe(true)
    }
  })
})

describe('what a receipt shows, which is the one branch the chain forces', () => {
  // `Transaction.surface` is `null` on every reconstructed row (6.6, `transaction.ts:101`). This
  // used to be a ternary in `activity.$id.tsx` — a `.tsx` no runner executes — which is 6.6's own
  // fifth review finding: the tested function with the untested caller.
  it('falls back to the pool baseline for a row this browser did not originate', () => {
    expect(receiptContext(null)).toBe('pool-send')
  })

  it('NEVER falls back to self-submit, which would publish an address that was not published', () => {
    // The one-word edit this test exists to catch. `pool-send` and `self-submit` differ on exactly
    // the sender row, and getting it wrong invents a disclosure rather than omitting one.
    expect(receiptContext(null)).not.toBe('self-submit')
    const senderDelta = matrixDelta('pool-send', 'self-submit').filter((c) => c.fact === 'sender')
    expect(senderDelta.length, 'the two paths must differ on sender, or this test proves nothing')
      .toBeGreaterThan(0)
  })

  it('shows that surface’s own matrix for a row we did originate', () => {
    for (const [surface, context] of Object.entries(SURFACE_CONTEXT)) {
      expect(receiptContext(surface as keyof typeof SURFACE_CONTEXT), surface).toBe(context)
    }
    expect(receiptContext('swap')).toBe('swap')
  })

  it('resolves every surface AND null to a matrix that is actually authored', () => {
    const everything = [null, ...Object.keys(SURFACE_CONTEXT)] as (keyof typeof SURFACE_CONTEXT | null)[]
    for (const surface of everything) {
      expect(matrixFor(receiptContext(surface)).authored, String(surface)).toBe(true)
    }
  })
})

describe('the copy this module ships is clean', () => {
  it('every authored sentence is free of the refused claims', () => {
    for (const context of VISIBILITY_CONTEXTS) {
      const matrix = matrixFor(context)
      expect(forbiddenClaimsIn(CONTEXT_LABELS[context]), context).toEqual([])
      if (!matrix.authored) {
        expect(forbiddenClaimsIn(matrix.because), context).toEqual([])
        continue
      }
      for (const fact of VISIBILITY_FACTS) {
        for (const actor of VISIBILITY_ACTORS) {
          const cell = matrix.cells[fact][actor]
          if (cell.state === 'conditional') {
            expect(forbiddenClaimsIn(cell.note), `${context}/${fact}/${actor}`).toEqual([])
          }
        }
      }
    }
    for (const state of VISIBILITY_CELL_STATES) {
      expect(forbiddenClaimsIn(CELL_LABEL[state]), state).toEqual([])
      expect(forbiddenClaimsIn(CELL_MEANING[state]), state).toEqual([])
    }
  })

  it('names no refused claim anywhere in the file, comments included', () => {
    // The trap this story walks straight into: three of the ten refused claims are the hyphenated
    // capability words a visibility matrix reaches for first.
    const source = readFileSync(new URL('../src/visibility-matrix.ts', import.meta.url), 'utf8')
    expect(forbiddenClaimsIn(source)).toEqual([])
  })
})

//
// HOW A CELL REACHES A READER — the half that used to live in a `.tsx` no runner executes.
//
describe('a qualified cell says its qualifier, wherever it renders', () => {
  it('announces the word alone for the three unqualified states', () => {
    expect(cellAnnouncement({ state: 'sees' })).toBe('Sees')
    expect(cellAnnouncement({ state: 'hidden' })).toBe('Hidden')
    expect(cellAnnouncement({ state: 'absent' })).toBe('Not applicable')
  })

  it('carries the note on the one state that has one', () => {
    const announced = cellAnnouncement({ state: 'conditional', note: 'only on a Tuesday' })
    expect(announced).toContain('Conditional')
    expect(announced).toContain('only on a Tuesday')
  })

  it('NEVER announces a bare word for a conditional cell, over every authored context', () => {
    // The one-word regression this function exists to make impossible: collapsing the announcement
    // to `CELL_LABEL[cell.state]` makes `markets-bet` say "Conditional" with its condition nowhere,
    // and every other test in this repository stays green.
    let checked = 0
    for (const context of VISIBILITY_CONTEXTS) {
      const matrix = matrixFor(context)
      if (!matrix.authored) continue
      for (const fact of VISIBILITY_FACTS) {
        for (const actor of VISIBILITY_ACTORS) {
          const cell = matrix.cells[fact][actor]
          const announced = cellAnnouncement(cell)
          expect(announced, `${context}/${fact}/${actor}`).toContain(CELL_LABEL[cell.state])
          if (cell.state !== 'conditional') continue
          checked += 1
          expect(announced, `${context}/${fact}/${actor}`).toContain(cell.note)
          expect(announced.length, `${context}/${fact}/${actor}`).toBeGreaterThan(
            CELL_LABEL.conditional.length + 10,
          )
        }
      }
    }
    expect(checked, 'no conditional cell was reached, so this proves nothing').toBeGreaterThan(0)
  })
})

describe('one footnote numbering, for both consumers', () => {
  it('lists each distinct qualifier once, in row-then-column order', () => {
    for (const context of VISIBILITY_CONTEXTS) {
      const matrix = matrixFor(context)
      if (!matrix.authored) continue
      const notes = matrixNotes(matrix)
      expect(new Set(notes).size, context).toBe(notes.length)
      for (const note of notes) expect(note.trim(), context).not.toBe('')
    }
  })

  it('numbers a cell by its position in that list, and unqualified cells not at all', () => {
    const bet = matrixFor('markets-bet')
    if (!bet.authored) throw new Error('markets-bet is authored')
    const notes = matrixNotes(bet)
    expect(notes).toHaveLength(1)
    expect(noteNumber(notes, bet.cells.sender.everyone)).toBe(1)
    expect(noteNumber(notes, bet.cells.sender.you)).toBeNull()
    expect(noteNumber(notes, { state: 'conditional', note: 'not in this matrix' })).toBeNull()
  })

  it('is DERIVED rather than accumulated, so calling it twice gives the same numbers', () => {
    // The failure it replaces: a closure in the generator and a `Set` walk in the component,
    // agreeing only because both happened to iterate rows before columns.
    const matrix = matrixFor('self-submit')
    if (!matrix.authored) throw new Error('self-submit is authored')
    expect(matrixNotes(matrix)).toEqual(matrixNotes(matrix))
  })
})

describe('a footnote never repeats the sentence directly above it', () => {
  it('points at the prose when the prose already states it in full', () => {
    expect(footnoteText('the condition', 'A sentence containing the condition in it.')).toBe(
      NOTE_STATED_ABOVE,
    )
  })

  it('prints the note in full when nothing above says it', () => {
    expect(footnoteText('the condition', '')).toBe('the condition')
    expect(footnoteText('the condition', 'Something else entirely.')).toBe('the condition')
  })

  it('deduplicates the Markets footnote, which IS its own headline’s second clause', () => {
    const bet = matrixFor('markets-bet')
    if (!bet.authored) throw new Error('markets-bet is authored')
    const [note] = matrixNotes(bet)
    const cell = bet.cells.sender.everyone
    if (cell.state !== 'conditional') throw new Error('the Markets sender cell is conditional')
    // The receipt renders the matrix with nothing above it, and there the qualifier has to print in
    // full or it is nowhere at all.
    expect(footnoteText(note!, '')).toBe(cell.note)
  })
})

describe('the self-submit network cell names the observer that replaced the relayer', () => {
  it('is qualified rather than absent', () => {
    // `absent` on the Relayer column is TRUE about the relayer and FALSE as a picture: it reads as
    // "nobody on the network sees you". The observer moved; it did not disappear.
    const matrix = matrixFor('self-submit')
    if (!matrix.authored) throw new Error('self-submit is authored')
    const cell = matrix.cells.ip.relayer
    expect(cell.state).toBe('conditional')
    if (cell.state !== 'conditional') return
    expect(cell.note).toContain('node')
    expect(cell.note).toContain('network address')
  })

  it('keeps the rest of that column absent, where nothing observes in the relayer’s place', () => {
    const matrix = matrixFor('self-submit')
    if (!matrix.authored) throw new Error('self-submit is authored')
    for (const fact of ['amount', 'sender', 'recipient', 'timing'] as const) {
      expect(matrix.cells[fact].relayer.state, fact).toBe('absent')
    }
  })
})
