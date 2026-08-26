import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as copy from '../src/backup-copy.js'
import { FORBIDDEN_CLAIMS } from '../src/forbidden-claims.js'

// Byte-exact, `toBe`, one assertion per sentence. `toContain` or a regex would let a
// re-typed sentence drift a word at a time — and these are the sentences that tell a user
// what a backup does and does not protect, which is the last place paraphrase belongs.
describe('backup copy ships byte-exact (AC6)', () => {
  it('the ceremony frame states no-rotation plainly', () => {
    expect(copy.BACKUP_CEREMONY_FRAME).toBe(
      'Save your key before we write anything on-chain. ' +
      'The key we register can never be replaced — the protocol writes it once.',
    )
  })

  it('the done screen is an inventory, not a congratulation', () => {
    expect(copy.BACKUP_DONE_INVENTORY).toBe(
      'What this protects against: a new laptop, a cleared browser, a lost phone. ' +
      "What it doesn't: anyone who gets both the file and the code has your balance, " +
      'your history and your messages, permanently. There is no revoke and no rotation.',
    )
  })

  it('the done screen says what the backup does NOT protect against', () => {
    // The half that a congratulation would drop. Asserted separately from the byte check so
    // the reason it is there survives a future rewording negotiation.
    expect(copy.BACKUP_DONE_INVENTORY).toContain("What it doesn't:")
    expect(copy.BACKUP_DONE_INVENTORY).toContain('There is no revoke and no rotation.')
    expect(copy.BACKUP_DONE_INVENTORY).not.toMatch(/congratulat|you're all set|success|✓/i)
  })

  it('the in-browser verification line', () => {
    expect(copy.BACKUP_VERIFICATION_IN_BROWSER)
      .toBe('This happens in your browser. Nothing is uploaded.')
  })

  it('the verification-failure line separates the money from the backup', () => {
    expect(copy.BACKUP_VERIFICATION_FAILED).toBe(
      "That file and code don't open your key. Your notes are fine — the backup isn't. " +
      'Make a new one now.',
    )
  })

  it('the re-wrap line never implies revocation', () => {
    expect(copy.BACKUP_REWRAP_NO_REVOCATION).toBe(
      'Your Account Key stays the same — it cannot be changed. Your old Recovery File still ' +
      'opens it with its old code, and nothing can invalidate that. Delete the old file yourself.',
    )
    // The dangerous sentence this exists instead of. There is no revocation on this protocol,
    // so any copy suggesting the old file stopped working is false and would get someone robbed.
    expect(copy.BACKUP_REWRAP_NO_REVOCATION).not.toMatch(/revoke|invalidat\w+ your|no longer works|expired/i)
    expect(copy.BACKUP_REWRAP_NO_REVOCATION).toContain('still')
  })

  it('the nag', () => {
    expect(copy.NO_BACKUP_NAG).toBe('This account has no backup. Save it.')
  })

  it('the single-root claim carries its channel-index caveat (§9 Q5)', () => {
    expect(copy.ONE_BACKUP_COVERS_EVERYTHING).toBe(
      'One backup covers everything — your account key is the single root it all derives from. ' +
      'One part of that is still untested: rebuilding your channel indexes when you restore. ' +
      'Until we have tested it, treat that part as unproven rather than promised.',
    )
    // The caveat is IN the sentence rather than a footnote somebody can drop. It may only be
    // removed when the restore-time channel-index probe has actually run.
    expect(copy.ONE_BACKUP_COVERS_EVERYTHING).toMatch(/untested|unproven/)
  })

  it('the restore-failure sentences', () => {
    expect(copy.WRONG_RECOVERY_CODE).toBe('That file and recovery code do not open this key.')
    expect(copy.MALFORMED_BACKUP_FILE).toBe('That backup file is malformed or truncated.')
    expect(copy.UNSUPPORTED_BACKUP_VERSION).toBe(
      'That backup file was written by a newer version of this app, which this one cannot read. ' +
      'Do not delete it.',
    )
  })

  it('no two sentences are the same string', () => {
    // Two consts holding one sentence is how a "distinct" error message stops being distinct.
    const values = Object.values(copy).filter((v): v is string => typeof v === 'string')
    expect(values.length).toBeGreaterThanOrEqual(10)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('the claims-lint trap (AC6)', () => {
  // IMPORTED, not retyped and no longer scraped. The list used to be regex-lifted out of
  // `scripts/lint-claims.mjs`; that script was removed 2026-08-26 and the list moved to
  // `src/forbidden-claims.ts`, which is where product knowledge belongs. A plain import cannot
  // silently stop testing the way a scrape of somebody else's source could.
  const FORBIDDEN = FORBIDDEN_CLAIMS

  it('holds the copy to all ten refused claims', () => {
    expect(FORBIDDEN).toHaveLength(10)
  })

  it('every backup sentence is clean', () => {
    for (const [name, value] of Object.entries(copy)) {
      if (typeof value !== 'string') continue
      for (const phrase of FORBIDDEN) {
        expect(value.toLowerCase(), `${name} contains "${phrase}"`).not.toContain(phrase)
      }
    }
  })

  it('the whole backup source is clean, comments included', () => {
    // The lint is line-based over the file, so a comment explaining the trap can trip it just
    // as easily as a shipped sentence can. These four files are the ones this story adds.
    for (const path of [
      'packages/protocol/src/backup-copy.ts',
      'packages/protocol/src/backup-gate.ts',
      'packages/protocol/src/backup-cadence.ts',
      'packages/protocol/src/identity.ts',
    ]) {
      const text = readFileSync(path, 'utf8').toLowerCase()
      for (const phrase of FORBIDDEN) {
        expect(text, `${path} contains "${phrase}"`).not.toContain(phrase)
      }
    }
  })
})
