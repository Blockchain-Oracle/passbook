import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  PAUSED_STOPPED,
  PAUSED_WORKS,
  degradedCopy,
  degradedFromHealth,
  pausedChatLine,
  upgradedBody,
  type DegradedMode,
} from '../src/degraded.js'
import { forbiddenClaimsIn } from '../src/forbidden-claims.js'

const MODES: DegradedMode[] = [
  'paused',
  'upgraded',
  'screening-flip',
  'screening-declined',
  'prover-down',
  'screener-unreachable',
  'offline',
]

describe('classification precedes copy', () => {
  it('the declined deposit and the policy flip are different states with different scopes', () => {
    const declined = degradedCopy('screening-declined')
    const flip = degradedCopy('screening-flip')
    expect(declined.scope).toBe('action')
    expect(flip.scope).toBe('global')
    expect(declined.body).not.toBe(flip.body)
  })

  it('the flip explicitly disclaims being about the reader — the sentence that keeps them apart', () => {
    expect(degradedCopy('screening-flip').body).toContain("This isn't about your deposit")
  })

  it('the declined deposit says what did NOT happen', () => {
    const body = degradedCopy('screening-declined').body
    expect(body).toContain('Nothing was submitted')
    expect(body).toContain('no fee was charged')
  })

  it('an unreachable screener is never merged with a refusal', () => {
    const unreachable = degradedCopy('screener-unreachable')
    expect(unreachable.body).toContain("couldn't reach")
    expect(unreachable.body).not.toMatch(/approved|declined|refused/i)
  })

  it('the retryable one is the only amber, and the only one with something to press', () => {
    for (const mode of MODES) {
      const copy = degradedCopy(mode)
      if (mode === 'screener-unreachable') {
        expect(copy.severity).toBe('amber')
        expect(copy.retryAction).toBe('Try again')
      } else {
        expect(copy.severity, mode).toBe('grey')
        expect(copy.retryAction, mode).toBeUndefined()
      }
    }
  })
})

describe('every mode carries a blocker sentence for the CTA', () => {
  it('none is empty, and none is a code', () => {
    for (const mode of MODES) {
      const { blocker } = degradedCopy(mode)
      expect(blocker.trim(), mode).not.toBe('')
      // `label = blocker ?? action` renders this AS the button. An identifier here would ship a
      // button reading POOL_PAUSED.
      expect(blocker, mode).not.toMatch(/^[A-Z0-9_]+$/)
    }
  })
})

describe('the paused strip', () => {
  it('names what still works as a list, not prose', () => {
    expect(PAUSED_WORKS).toEqual([
      'Balance',
      'History',
      'Global feed',
      'Open chat rooms',
      'Drafts',
      'Browsing',
    ])
    expect(PAUSED_STOPPED).toEqual(['Every pool transaction'])
  })

  it('promises chat only to people it is true for', () => {
    expect(pausedChatLine(2, true)).toBe('Chat still works — messages travel off-chain.')
  })

  it('and states the limitation to everyone else', () => {
    const limitation = "New rooms can't open while the pool is paused."
    expect(pausedChatLine(0, true)).toBe(limitation)
    expect(pausedChatLine(2, false)).toBe(limitation)
    expect(pausedChatLine(0, false)).toBe(limitation)
  })
})

describe('the upgraded body names a checkable block', () => {
  it('formats the block with separators', () => {
    expect(upgradedBody(13_412_556)).toContain('block 13,412,556')
  })

  it('and states no block at all when there is none, rather than printing a zero', () => {
    // `PoolHealth.upgraded` carries no block number — `readPoolHealth` returns as soon as the class
    // hashes disagree. Defaulting to 0 shipped "The pool was upgraded at block 0", a fabricated
    // fact in the one sentence whose whole job is to be checkable.
    const body = upgradedBody()
    expect(body).toContain('The pool was upgraded.')
    expect(body).not.toContain('block 0')
    expect(body).toContain('Your notes are unaffected')
  })

  it('the real reading produces no block number, so the undated sentence is the normal one', () => {
    const reading = degradedFromHealth(
      { state: 'upgraded', pinned: '0xaaa', onchain: '0xbbb' },
      true,
      false,
    )
    expect(reading.upgrade?.blockNumber).toBeUndefined()
    expect(upgradedBody(reading.upgrade?.blockNumber)).not.toContain('block')
  })

  it('and reassures about notes without claiming actions still work', () => {
    const body = upgradedBody(1)
    expect(body).toContain('Your notes are unaffected')
    expect(body).toContain('stopped new actions')
  })
})

describe('mapping a pool reading onto a named mode', () => {
  it('a healthy pool is no mode at all', () => {
    expect(degradedFromHealth({ state: 'ok' }, true, false)).toEqual({ mode: null })
  })

  it('paused and upgraded map to themselves', () => {
    expect(degradedFromHealth({ state: 'paused' }, true, false).mode).toBe('paused')
    expect(degradedFromHealth({ state: 'upgraded' }, true, false).mode).toBe('upgraded')
  })

  it('an upgrade carries both hashes through for the mono line', () => {
    const reading = degradedFromHealth(
      { state: 'upgraded', pinned: '0xaaa', onchain: '0xbbb', blockNumber: 7 },
      true,
      false,
    )
    expect(reading.upgrade).toEqual({ blockNumber: 7, pinned: '0xaaa', onchain: '0xbbb' })
  })

  it('the screening flip wins over everything, including a healthy pool', () => {
    // It is the state most likely to be mistaken for our own bug, so it is checked first.
    expect(degradedFromHealth({ state: 'ok' }, true, true).mode).toBe('screening-flip')
    expect(degradedFromHealth({ state: 'paused' }, true, true).mode).toBe('screening-flip')
  })

  it('an unreachable pool on a connected browser says NOTHING rather than guessing', () => {
    // §3 rule 4 sanctions three offline strings and none of them fits a failed pool read. Silence
    // beats inventing a fourth, and beats calling it a pause — which is the confusion
    // `classifyPause` exists to prevent.
    expect(degradedFromHealth({ state: 'unreachable' }, true, false)).toEqual({ mode: null })
  })

  it('and says the true thing when the browser reports being offline', () => {
    expect(degradedFromHealth({ state: 'unreachable' }, false, false).mode).toBe('offline')
  })

  it('an unknown state is benign, never a determination we did not receive', () => {
    expect(degradedFromHealth({ state: 'something-new' }, true, false)).toEqual({ mode: null })
  })
})

describe('the leaf stays a leaf', () => {
  it('imports no chain client', () => {
    const source = readFileSync(new URL('../src/degraded.ts', import.meta.url), 'utf8')
    const imports = source.match(/^\s*import[\s\S]*?from\s+'([^']+)'/gm) ?? []
    expect(imports).toEqual([])
    // The predicates stay where the chain reads are; this file is copy only.
    expect(source).not.toContain('pool.js')
    expect(source).not.toContain('rpc.js')
  })
})

describe('the copy is clean', () => {
  it('no banned claim reaches any string', () => {
    for (const mode of MODES) {
      const copy = degradedCopy(mode)
      expect(forbiddenClaimsIn(copy.body), mode).toEqual([])
      expect(forbiddenClaimsIn(copy.blocker), mode).toEqual([])
    }
    expect(forbiddenClaimsIn(upgradedBody(1))).toEqual([])
    expect(forbiddenClaimsIn(pausedChatLine(1, true))).toEqual([])
    expect(forbiddenClaimsIn(pausedChatLine(0, false))).toEqual([])
  })

  it('no operator vocabulary reaches a user string (§3 rule 6)', () => {
    const jargon = /\b(keeper|executor|enclave|zk|mint|settle)\b/i
    for (const mode of MODES) {
      expect(degradedCopy(mode).body, mode).not.toMatch(jargon)
      expect(degradedCopy(mode).blocker, mode).not.toMatch(jargon)
    }
  })

  it('no exclamation marks — there is no congratulation and no alarm (§3 rule 9)', () => {
    for (const mode of MODES) expect(degradedCopy(mode).body, mode).not.toContain('!')
  })
})
