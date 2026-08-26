import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { NOTE_LIFECYCLE_STATES, lifecycleChip } from '../src/note-lifecycle.js'
import type { NoteLifecycle } from '../src/note-lifecycle.js'
import { badgeFromChip } from '../src/option-row.js'
import { forbiddenClaimsIn } from '../src/forbidden-claims.js'

describe('the note lifecycle is six states and no more', () => {
  it('holds exactly the six the authorities list', () => {
    expect(NOTE_LIFECYCLE_STATES).toEqual([
      'pending-proof',
      'maturing',
      'spendable',
      'spent',
      'expiring',
      'expired',
    ])
  })

  it('every state pairs with a one-sentence next action', () => {
    for (const state of NOTE_LIFECYCLE_STATES) {
      const chip = lifecycleChip(state)
      expect(chip.nextAction, state).not.toBe('')
      expect(chip.nextAction.trim(), state).toMatch(/[.!]$/)
      expect(chip.label, state).not.toBe('')
    }
  })
})

describe('colour is spent deliberately (§7.9)', () => {
  it('expiring is the ONLY amber state', () => {
    const amber = NOTE_LIFECYCLE_STATES.filter((s) => lifecycleChip(s).status === 'exposed')
    expect(amber).toEqual(['expiring'])
  })

  it('nothing in the lifecycle is irreversible — expired renders calmest, not loudest', () => {
    for (const state of NOTE_LIFECYCLE_STATES) {
      expect(lifecycleChip(state).status, state).not.toBe('irreversible')
    }
    expect(lifecycleChip('expired').status).toBe('quiet')
  })

  it('only spendable is green', () => {
    const green = NOTE_LIFECYCLE_STATES.filter((s) => lifecycleChip(s).status === 'settled')
    expect(green).toEqual(['spendable'])
  })

  it('the two not-yet-real states carry the dotted underline, not grey alone', () => {
    const notYetReal = NOTE_LIFECYCLE_STATES.filter((s) => lifecycleChip(s).notYetReal)
    expect(notYetReal).toEqual(['pending-proof', 'maturing'])
  })
})

describe('maturation is counted, never a percentage', () => {
  it('puts the real counter in the label when it is known', () => {
    const chip = lifecycleChip('maturing', { confirmed: 6, required: 10 })
    expect(chip.label).toBe('Maturing 6/10 blocks')
    expect(chip.nextAction).toBe('This note can be spent once 10 blocks have confirmed it.')
  })

  it('never renders a percentage or a bar', () => {
    const chip = lifecycleChip('maturing', { confirmed: 6, required: 10 })
    expect(chip.label).not.toMatch(/%/)
    expect(chip.nextAction).not.toMatch(/%/)
  })

  it('with no counter it stays bare rather than inventing a denominator', () => {
    // The maturation depth is a chain read. A hardcoded "10" here would be the runtime-truth
    // violation this project fails builds over, dressed up as a sensible default.
    const chip = lifecycleChip('maturing')
    expect(chip.label).toBe('Maturing')
    expect(chip.nextAction).not.toMatch(/\d/)
  })

  it('the counter is ignored for every other state', () => {
    for (const state of NOTE_LIFECYCLE_STATES.filter((s) => s !== 'maturing')) {
      expect(lifecycleChip(state, { confirmed: 6, required: 10 })).toEqual(lifecycleChip(state))
    }
  })
})

describe('the sentences say the true thing', () => {
  it('a spent note explains why it is still on screen', () => {
    // History is never rewritten. Without the second half the row reads like a bug.
    expect(lifecycleChip('spent').nextAction).toBe('Already spent. Kept here for the record.')
  })

  it('an expired proof names what did NOT happen', () => {
    expect(lifecycleChip('expired').nextAction).toContain('nothing was charged')
  })

  it('a chip cannot be mutated through the table it came from', () => {
    const first = lifecycleChip('spendable')
    first.label = 'tampered'
    expect(lifecycleChip('spendable').label).toBe('Spendable')
  })
})

describe('a chip survives the trip into a row badge', () => {
  it('carries the not-yet-real flag across, for exactly the two states that have it', () => {
    // The badge slot USED to be `{ label, status }`, so this flag was dropped on the floor by the
    // only shape the type permitted — and a `pending-proof` chip then rendered identically to a
    // settled one, with grey as its sole carrier. That is the encoding the design authority
    // ratified against, and nothing would have failed.
    const carried = NOTE_LIFECYCLE_STATES.filter((s) => badgeFromChip(lifecycleChip(s)).notYetReal)
    expect(carried).toEqual(['pending-proof', 'maturing'])
  })

  it('carries the label and the status unchanged', () => {
    for (const state of NOTE_LIFECYCLE_STATES) {
      const chip = lifecycleChip(state)
      expect(badgeFromChip(chip), state).toEqual({
        label: chip.label,
        status: chip.status,
        notYetReal: chip.notYetReal,
      })
    }
  })
})

describe('the copy this module ships is clean', () => {
  it('every string is free of the refused claims', () => {
    for (const state of NOTE_LIFECYCLE_STATES) {
      const chip = lifecycleChip(state)
      expect(forbiddenClaimsIn(chip.label), state).toEqual([])
      expect(forbiddenClaimsIn(chip.nextAction), state).toEqual([])
    }
  })

  it('names no refused claim anywhere in the file, comments included', () => {
    const source = readFileSync(new URL('../src/note-lifecycle.ts', import.meta.url), 'utf8')
    expect(forbiddenClaimsIn(source)).toEqual([])
  })
})

// A seventh state is a human decision, so this is the shape that makes adding one loud: the
// compiler rejects the assignment, and the reader is sent to the spec instead of to a switch.
const _seventhIsATypeError: NoteLifecycle extends
  | 'pending-proof'
  | 'maturing'
  | 'spendable'
  | 'spent'
  | 'expiring'
  | 'expired'
  ? true
  : never = true
void _seventhIsATypeError
