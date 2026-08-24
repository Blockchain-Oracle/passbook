import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as copy from '../src/session-copy.js'
import { DEFAULT_LOCK_CHANNEL, SUBMIT_LOCK_ALREADY_HELD } from '../src/session-lock.js'
import { SESSION_KEYS } from '../src/session-store.js'

// Byte-exact, `toBe`, one assertion per sentence — the convention `backup-copy.test.ts`
// establishes. The non-leader sentence in particular travels three hops before a user reads
// it (thrown by the lock, stringified into `register.ts`'s failure, rendered by epic 6), and
// a `toContain` at any of them would let it drift a word at a time.
describe('session copy ships byte-exact (AC3)', () => {
  it('the non-leader sentence', () => {
    expect(copy.ACCOUNT_OPEN_IN_ANOTHER_TAB).toBe(
      'This account is open in another tab. That tab is submitting.',
    )
  })

  it('says what the other tab is DOING, not merely that it exists', () => {
    // The second sentence is why this tab is refusing. Without it the message reads as a
    // warning the user should look for a way around.
    expect(copy.ACCOUNT_OPEN_IN_ANOTHER_TAB).toContain('That tab is submitting.')
  })

  it('never promises a retry the lock does not implement', () => {
    // The lock is not a queue. The other tab holds it for the length of its registration, and
    // nothing here resolves when that finishes.
    expect(copy.ACCOUNT_OPEN_IN_ANOTHER_TAB).not.toMatch(/try again|retry|wait|moment|shortly/i)
  })

  it('the already-submitting sentence, and it says THIS tab', () => {
    expect(copy.SUBMISSION_ALREADY_IN_PROGRESS).toBe('A submission is already in progress in this tab.')
    // The distinction from the two-tab sentence is the whole point. Telling somebody their
    // account is open in another tab, when the other submission is the one they just started
    // here, sends them hunting for a tab that does not exist.
    expect(copy.SUBMISSION_ALREADY_IN_PROGRESS).toContain('this tab')
    expect(copy.SUBMISSION_ALREADY_IN_PROGRESS).not.toBe(copy.ACCOUNT_OPEN_IN_ANOTHER_TAB)
  })

  it('the reentrancy refusal LEADS with that sentence and keeps the detail behind it', () => {
    // `register.ts` stringifies whatever is thrown into `lock-unavailable`'s reason, and epic 6
    // renders the reason. This is the most common refusal the tier produces — the double-click —
    // so it was the most likely developer string to end up on a screen.
    expect(SUBMIT_LOCK_ALREADY_HELD.startsWith(copy.SUBMISSION_ALREADY_IN_PROGRESS)).toBe(true)
    expect(SUBMIT_LOCK_ALREADY_HELD).toContain('(this tab already holds the submit lock')
  })

  it('the no-storage sentence names a fix the user can perform', () => {
    expect(copy.SESSION_STORAGE_UNAVAILABLE).toBe(
      "This browser won't let us save anything, so we can't create an account here — we'd lose " +
        'the key the moment you closed the tab. Leave private browsing, or allow storage for this ' +
        'site, and reload.',
    )
    expect(copy.SESSION_STORAGE_UNAVAILABLE).toMatch(/private browsing|allow storage/)
  })

  it('no two sentences are the same string', () => {
    const values = Object.values(copy).filter((v): v is string => typeof v === 'string')
    expect(values.length).toBeGreaterThanOrEqual(2)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('the stored names are a compatibility contract, not an implementation detail (S7)', () => {
  //
  // THESE FOUR STRINGS ARE PART OF THE PRODUCT, in the same way a database column name is.
  //
  // Every browser that has ever run this app has data sitting under these exact keys. Renaming
  // one does not migrate anything and does not fail anything — the new name reads as absent, the
  // account key is regenerated, and the user's existing account is orphaned on the pool, which
  // wrote its viewing key once and will not write another. A rename is silent, total and
  // unrecoverable, and until this test existed all 896 of the others waved it straight through:
  // they all build their keys from `SESSION_KEYS`, so they follow a rename wherever it goes.
  //
  // The channel name is the same class of promise with a smaller blast radius: two builds using
  // different names cannot see each other, so during a staged rollout both tabs would lead.
  //
  // Changing any of these means writing a migration first. Editing the literal below is not one.
  //
  it('the account key lives at passbook.account-key', () => {
    expect(SESSION_KEYS.accountKey).toBe('passbook.account-key')
  })

  it('the ceremony projection lives at passbook.backup-ceremony', () => {
    expect(SESSION_KEYS.ceremony).toBe('passbook.backup-ceremony')
  })

  it('the cadence record lives at passbook.backup-cadence', () => {
    expect(SESSION_KEYS.cadence).toBe('passbook.backup-cadence')
  })

  it('the leader election runs on passbook.submit-lock', () => {
    expect(DEFAULT_LOCK_CHANNEL).toBe('passbook.submit-lock')
  })

  it('and there are still exactly three of them', () => {
    // A fourth key is a decision the spec reserves, not a line somebody adds.
    expect(Object.values(SESSION_KEYS)).toEqual([
      'passbook.account-key',
      'passbook.backup-ceremony',
      'passbook.backup-cadence',
    ])
  })
})

describe('the claims-lint trap applies to the session tier too', () => {
  // Read out of the lint script rather than retyped, so this test cannot drift from the lint
  // it defends — and so this file does not itself carry the banned strings as literals.
  //
  // MATCH-OR-THROW, not `!`. A bare non-null assertion on a scrape of somebody else's source is
  // the one way this test can silently stop testing: the lint script is reformatted, the regex
  // stops matching, and the assertion crashes with `Cannot read property 1 of null` — or worse,
  // matches something empty and passes over an empty list. The count assertion below is the
  // backstop; this is the message that says what actually went wrong.
  const FORBIDDEN = (() => {
    const path = new URL('../../../scripts/lint-claims.mjs', import.meta.url)
    const src = readFileSync(path, 'utf8')
    const block = /const FORBIDDEN = \[([\s\S]*?)\]/.exec(src)
    if (!block?.[1]) {
      throw new Error(`could not find the FORBIDDEN list in ${path.pathname}: the lint script's shape changed`)
    }
    const phrases = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1] ?? '')
    if (phrases.length === 0 || phrases.some((p) => !p)) {
      throw new Error(`the FORBIDDEN list scraped as ${JSON.stringify(phrases)}, which cannot be right`)
    }
    return phrases
  })()

  it('reads the real banned list out of the lint script', () => {
    expect(FORBIDDEN).toHaveLength(10)
  })

  it('every session source file is clean, comments included', () => {
    // The lint is line-based over the whole file, so a comment can trip it as easily as a
    // shipped sentence. Resolved from this file's own location rather than the working
    // directory, so the suite does not depend on where it was started from.
    const src = (name: string) => new URL(`../src/${name}`, import.meta.url)
    for (const name of [
      'session.ts',
      'session-cadence-store.ts',
      'session-copy.ts',
      'session-key.ts',
      'session-lock.ts',
      'session-store.ts',
    ]) {
      const text = readFileSync(src(name), 'utf8').toLowerCase()
      for (const phrase of FORBIDDEN) {
        expect(text, `${name} contains "${phrase}"`).not.toContain(phrase)
      }
    }
  })
})
