//
// The account lifecycle's sentences, byte-exact (Wave 1).
//
// The `backup-copy.test.ts` contract: `toBe`, one assertion per sentence, and a second assertion
// on the property that made the sentence necessary. A test that only pinned the bytes would pass
// on a rewording that inverted the meaning as long as somebody updated the expectation — so each
// block below also states what the sentence must NOT do.
//
import { describe, it, expect } from 'vitest'

import * as copy from '../src/account-copy.js'
import * as history from '../src/history-copy.js'
import { FORBIDDEN_CLAIMS } from '../src/forbidden-claims.js'

describe('locking says what it does, and refuses the word it would be easiest to use', () => {
  it('names the exposure it does not remove', () => {
    expect(copy.LOCK_WHAT_IT_DOES).toBe(
      'Locking drops the key out of this page and leaves it in this browser’s storage. It is a ' +
        'screen lock, not encryption: anything that can already read this browser can still read ' +
        'the key.',
    )
    // The whole point. `session-key.ts` accepts plaintext-at-rest as an argued risk; a lock that
    // implied encryption would tell someone that closing a tab protects them from an extension.
    expect(copy.LOCK_WHAT_IT_DOES).toMatch(/not encryption/)
    expect(copy.LOCK_WHAT_IT_DOES).not.toMatch(/\bsafe\b|\bsecure\b|\bprotect(s|ed)?\b/i)
  })

  it('the locked screen says nothing was destroyed, because that is the fear', () => {
    expect(copy.LOCKED_HEADLINE).toBe('Locked')
    expect(copy.LOCKED_BODY).toBe(
      'Nothing was deleted and nothing moved. Unlock to read your balance and spend again.',
    )
    expect(copy.UNLOCK_ACTION).toBe('Unlock')
  })

  it('a lock that could not be written down says so instead of reporting success', () => {
    expect(copy.LOCK_NOT_SAVED).toBe(
      'The key is out of this page, but the lock could not be saved — reloading will open this ' +
        'wallet again. Close the tab if you need it shut.',
    )
    // The two halves of a lock fail independently. The sentence has to concede the half that
    // failed, or someone closes the tab believing the wallet is shut behind them.
    expect(copy.LOCK_NOT_SAVED).toMatch(/reloading will open this wallet again/)
    expect(copy.LOCK_NOT_SAVED).not.toBe(copy.LOCK_WHAT_IT_DOES)
  })

  it('the one unlock failure is about the identity, not a password nobody set', () => {
    expect(copy.UNLOCK_DIFFERENT_IDENTITY).toBe(
      'The stored key no longer derives the address recorded beside it, so this is not the ' +
        'account that was locked. Nothing has been overwritten. Import your recovery file to get ' +
        'back in.',
    )
    // There is no password on this path, so the copy must never ask for one.
    expect(copy.UNLOCK_DIFFERENT_IDENTITY).not.toMatch(/password/i)
    expect(copy.UNLOCK_DIFFERENT_IDENTITY).toMatch(/Nothing has been overwritten/)
  })
})

describe('importing tells a typo apart from a file that belongs to someone else', () => {
  it('a wrong code blames the code and says nothing changed', () => {
    expect(copy.IMPORT_CODE_WRONG).toBe(
      'That code did not open this file. Nothing was changed — check it and try again.',
    )
  })

  it('an unreadable file tells the user to keep it', () => {
    expect(copy.IMPORT_FILE_UNREADABLE).toBe(
      'That is not a Passbook recovery file, or it has been damaged. Keep it — try the original ' +
        'download rather than a copy that has been through anything that rewrites text.',
    )
    expect(copy.IMPORT_FILE_UNREADABLE).not.toMatch(/delete|replace it|make a new/i)
  })

  it('a newer file is intact, and the copy must never invite its deletion', () => {
    expect(copy.IMPORT_UNSUPPORTED_VERSION).toBe(
      'This recovery file was written by a newer version of Passbook. Do not delete it — it ' +
        'still opens there. Update this app and try again.',
    )
    // `identity.ts`'s argument, as a test: the file opens elsewhere, and a key cannot be reissued.
    expect(copy.IMPORT_UNSUPPORTED_VERSION).toMatch(/Do not delete it/)
  })

  it('a mismatched identity is its own sentence, distinct from a wrong code', () => {
    expect(copy.IMPORT_DIFFERENT_IDENTITY).toBe(
      'That file opened, but the key inside it does not derive the address the file’s own header ' +
        'records. The two halves do not describe one account, so nothing was imported.',
    )
    // The distinction is the value of the check — collapsing them tells a user to retype a code
    // that was never wrong.
    expect(copy.IMPORT_DIFFERENT_IDENTITY).not.toBe(copy.IMPORT_CODE_WRONG)
    expect(copy.IMPORT_DIFFERENT_IDENTITY).not.toMatch(/try again/i)
  })

  it('re-importing an account already held is reported as what happened, not as a failure', () => {
    expect(copy.IMPORT_ALREADY_HERE).toBe(
      'This browser already holds that account, so it was switched to rather than added twice.',
    )
    expect(copy.IMPORT_NO_KEY).toBe(
      'That file opened, and what came out is not a Stark private key. Nothing was imported.',
    )
  })

  it('the import panel asks for both halves and says why', () => {
    expect(copy.IMPORT_TITLE).toBe('Import an account')
    expect(copy.IMPORT_BODY).toBe(
      'Choose the recovery file you saved, then type the recovery code that opens it. You need ' +
        'both — either one on its own is useless, which is the point of having two.',
    )
  })
})

describe('switching states what a second account is not', () => {
  it('says the accounts are unlinked here and on chain', () => {
    expect(copy.SWITCH_TITLE).toBe('Switch account')
    expect(copy.SWITCH_BODY).toBe(
      'Each account is a separate key with its own address, its own balance and its own history. ' +
        'Nothing on chain joins them up, and neither does this app.',
    )
  })

  it('the one-account case is a fact with an action, not an empty list', () => {
    expect(copy.SWITCH_NOTHING_TO_SWITCH_TO).toBe(
      'This is the only account in this browser. Import one, or create another, to have ' +
        'something to switch between.',
    )
  })

  it('creation warns about the state a new account starts in', () => {
    expect(copy.CREATE_ACTION).toBe('Create another account')
    expect(copy.CREATE_BODY).toBe(
      'A new account starts with nothing: no funds, no registration, and no recovery file. It ' +
        'cannot register with the pool until you have saved one.',
    )
    // The registration gate is real (`backup-gate.ts`), so the sentence has to name it.
    expect(copy.CREATE_BODY).toMatch(/recovery file/)
  })
})

describe('the drawer states what the address is', () => {
  it('the address is exact before deployment, and money sent there waits', () => {
    expect(copy.ADDRESS_IS_EXACT_BEFORE_DEPLOY).toBe(
      'This address is exact before the account is deployed. Anything sent here waits for it.',
    )
  })

  it('the clipboard and export labels', () => {
    expect(copy.COPIED).toBe('Copied')
    expect(copy.COPY_ADDRESS).toBe('Copy address')
    expect(copy.EXPORT_ROW_LABEL).toBe('Export recovery file')
    expect(copy.EXPORT_ROW_DETAIL).toBe(
      'Writes a fresh recovery file and a code that opens it. The old one keeps working.',
    )
  })

  it('an unread balance and an unreadable one are different sentences', () => {
    expect(copy.DRAWER_BALANCE_UNREAD).toBe('Balance not read yet')
    expect(copy.DRAWER_BALANCE_UNKNOWN).toBe('The pool could not be read')
    // The fail-closed rule as copy: an outage must never render as an empty account.
    expect(copy.DRAWER_BALANCE_UNKNOWN).not.toBe(copy.DRAWER_BALANCE_UNREAD)
    expect(copy.DRAWER_BALANCE_UNKNOWN).not.toMatch(/\b0\b|nothing|empty/i)
  })
})

describe("the history's copy", () => {
  it('the grouping note says these are block distances, not dates', () => {
    expect(history.HISTORY_GROUPING_NOTE).toBe(
      'The pool publishes block numbers, not clock times, so these groups are block distance ' +
        'from the head — near enough to read at a glance, and never a date we did not measure.',
    )
    expect(history.HISTORY_GROUPING_NOTE).toMatch(/block numbers, not clock times/)
  })

  it('the four group headers are approximations and say so', () => {
    expect(history.HISTORY_GROUP_IN_PROGRESS).toBe('In progress')
    expect(history.HISTORY_GROUP_RECENT).toBe('About the last day')
    expect(history.HISTORY_GROUP_WEEK).toBe('Earlier this week')
    expect(history.HISTORY_GROUP_OLDER).toBe('Older')
    // "Today" and "Yesterday" are the two words this feed may not use: both are calendar claims,
    // and no row in it carries a timestamp.
    for (const header of [history.HISTORY_GROUP_RECENT, history.HISTORY_GROUP_WEEK]) {
      expect(header).not.toMatch(/today|yesterday/i)
    }
  })

  it('the two tabs get different empty sentences, because they are different facts', () => {
    expect(history.HISTORY_GLOBAL_EMPTY).toBe(
      'Nothing was published to the pool in the blocks this read covers. That is a quiet window, ' +
        'not an empty pool.',
    )
    expect(history.HISTORY_PERSONAL_EMPTY).toBe(
      'None of the transactions in this window are yours. Receive something, or make your first ' +
        'send, and it appears here.',
    )
    expect(history.HISTORY_FILTERED_EMPTY).toBe(
      'Every row in this window is a system note, and the filter is hiding them. Turn it back on ' +
        'to see them.',
    )
    expect(history.HISTORY_GLOBAL_EMPTY).not.toBe(history.HISTORY_PERSONAL_EMPTY)
    // Global empty is a claim about the WINDOW, never about the pool as a whole.
    expect(history.HISTORY_GLOBAL_EMPTY).toMatch(/this read covers/)
  })

  it('an unreadable amount is a dash with a reason behind it, never a zero', () => {
    expect(history.AMOUNT_UNREADABLE).toBe('—')
    expect(history.AMOUNT_UNREADABLE_WHY).toBe(
      'This note’s amount is encrypted to its owner, so the pool does not publish a number for it.',
    )
    expect(history.AMOUNT_UNREADABLE).not.toBe('0')
  })

  it('every category label is a word the chain or this browser can justify', () => {
    expect(history.CATEGORY_SENT).toBe('Sent')
    expect(history.CATEGORY_RECEIVED).toBe('Received')
    expect(history.CATEGORY_DEPOSIT).toBe('Deposit')
    expect(history.CATEGORY_WITHDRAWAL).toBe('Withdrawal')
    expect(history.CATEGORY_REGISTRATION).toBe('Registration')
    expect(history.CATEGORY_SWAP).toBe('Swap')
    expect(history.CATEGORY_BRIDGE).toBe('Bridge')
    expect(history.CATEGORY_MESSAGE).toBe('Message')
    expect(history.CATEGORY_SYSTEM).toBe('System note')
    expect(history.CATEGORY_NOTE).toBe('Note')
  })
})

describe('neither module states a claim this protocol cannot keep', () => {
  it('no forbidden claim appears in any exported sentence', () => {
    const sentences = [...Object.values(copy), ...Object.values(history)].filter(
      (value): value is string => typeof value === 'string',
    )
    expect(sentences.length).toBeGreaterThan(20)
    for (const sentence of sentences) {
      for (const claim of FORBIDDEN_CLAIMS) {
        expect(sentence.toLowerCase()).not.toContain(claim)
      }
    }
  })
})
