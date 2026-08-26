import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import * as copy from '../src/activity-copy.js'
import { FORBIDDEN_CLAIMS } from '../src/forbidden-claims.js'

// Byte-exact, `toBe`, one assertion per sentence — the `backup-copy.test.ts` contract. These
// are the sentences that tell a user what can be seen, what a file can do, and whether an empty
// screen means "nothing here" or "we could not look", which is the last place paraphrase belongs.
describe('the book\'s copy ships byte-exact (AC5)', () => {
  it('the standing line claims only what is true, and names who sees more', () => {
    expect(copy.SURFACES_STANDING_LINE).toBe(
      'Your six surfaces are unlinkable to other users — this view is assembled in your browser, ' +
        'not stored on-chain. The auditor and the relayer see more.',
    )
    // The amendment is the point. The banned original claimed nobody could join the surfaces
    // up, which is false on a protocol with escrowed viewing keys and a relayer in the path.
    expect(copy.SURFACES_STANDING_LINE).toContain('to other users')
    expect(copy.SURFACES_STANDING_LINE).toMatch(/auditor and the relayer see more/)
    expect(copy.SURFACES_STANDING_LINE).not.toMatch(/nobody can|no one can|cannot be linked/i)
  })

  it('discovery honesty states what the RPC host observes', () => {
    expect(copy.DISCOVERY_RPC_HOST_SEES).toBe(
      'Your viewing key stays in this browser. The Starknet node answering these reads sees which ' +
        'parts of the pool this browser asks for, and the network address asking.',
    )
    expect(copy.DISCOVERY_NO_KEY_HANDOVER).toBe(
      'Nothing here hands your viewing key to a service to read your notes for you.',
    )
    // It must not overclaim in the other direction either — the host does see something.
    expect(copy.DISCOVERY_RPC_HOST_SEES).toMatch(/sees which/)
  })

  it('the three balance states never share a sentence', () => {
    expect(copy.BOOK_EMPTY).toBe('No notes yet. Anything sent to you shows up here.')
    expect(copy.BOOK_NOT_REGISTERED).toBe(
      "This account isn't registered on the pool yet, so nothing can have been sent to it.",
    )
    expect(copy.BOOK_UNKNOWN).toBe(
      "We couldn't finish reading your notes, so this isn't your balance — it's what we could reach. " +
        'Try again in a moment.',
    )
    // The fail-closed rule as copy: an outage must never read as an empty account.
    expect(copy.BOOK_UNKNOWN).not.toBe(copy.BOOK_EMPTY)
    expect(copy.BOOK_UNKNOWN).not.toMatch(/no notes|empty|nothing here/i)
  })

  it('the block stamp says "about", because the walk cannot be pinned', () => {
    expect(copy.asOfBlock(13_818_013)).toBe('as of about block 13818013')
    // Takes the number rather than carrying one — no hardcoded runtime values anywhere.
    expect(copy.asOfBlock(1)).toBe('as of about block 1')
  })

  it('the dust line explains the notation rather than apologising for it', () => {
    expect(copy.DUST_EXACT_VALUE).toBe(
      'Shown to the last unit — this balance is smaller than the display rounds to.',
    )
  })

  it('the feed sentences', () => {
    expect(copy.PERSONAL_FEED_EMPTY).toBe(
      'Nothing of yours in this range yet. Showing everything the pool did instead.',
    )
    expect(copy.FEED_RANGE_INCOMPLETE).toBe(
      'This is a window, not your whole history — there are older entries past the range loaded here.',
    )
    expect(copy.FEE_UNREADABLE).toBe("We couldn't read what this transaction was charged.")
    expect(copy.AMOUNT_NOT_OURS_TO_READ).toBe(
      'Encrypted to its owner. The amount is not in the public record.',
    )
  })

  it('the export disclosure is the verbatim sentence, exactly', () => {
    // Non-negotiable, and the reason the feature exists: on this protocol the key that reads an
    // account is the key that spends it, so a file is the only safe thing to hand anybody.
    expect(copy.EXPORT_KEY_DISCLOSURE).toBe(
      'Your Account Key can also spend, so never hand it over. Hand over this file instead.',
    )
    expect(copy.EXPORT_FILE_SCOPE).toBe(
      'This file lists activity only. It carries no key, and nothing in it can move money.',
    )
    expect(copy.EXPORT_IN_BROWSER).toBe('This file was built in your browser. Nothing was uploaded.')
  })

  it('the export range lines take their numbers rather than carrying them', () => {
    expect(copy.exportRangeLine(13_000_000, 13_800_000)).toBe('Covers blocks 13000000 to 13800000.')
    expect(copy.EXPORT_RANGE_INCOMPLETE).toBe(
      'The range above stopped at a page limit, so older entries exist that are not in this file.',
    )
  })

  it('no sentence implies an observer credential exists', () => {
    // There is no spend-safe key on this protocol, so no sentence may imply one is being
    // shared, and no padlock language may suggest a capability the pool does not have.
    for (const [name, value] of Object.entries(copy)) {
      if (typeof value !== 'string') continue
      expect(value, name).not.toMatch(/padlock|🔒|read access|share a key|observer link/i)
    }
  })

  it('no two sentences are the same string', () => {
    const values = Object.values(copy).filter((v): v is string => typeof v === 'string')
    expect(values.length).toBeGreaterThanOrEqual(12)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('the claims-lint trap (AC5)', () => {
  // IMPORTED, not retyped and no longer scraped. The list used to be regex-lifted out of
  // `scripts/lint-claims.mjs`; that script was removed 2026-08-26 and the list moved to
  // `src/forbidden-claims.ts`, which is where product knowledge belongs. A plain import cannot
  // silently stop testing the way a scrape of somebody else's source could.
  const FORBIDDEN = FORBIDDEN_CLAIMS

  it('holds the copy to all ten refused claims', () => {
    expect(FORBIDDEN).toHaveLength(10)
  })

  it('every sentence in the book is clean', () => {
    for (const [name, value] of Object.entries(copy)) {
      if (typeof value !== 'string') continue
      for (const phrase of FORBIDDEN) {
        expect(value.toLowerCase(), `${name} contains "${phrase}"`).not.toContain(phrase)
      }
    }
  })

  it('every source file this story adds is clean, comments included', () => {
    // The lint is line-based over whole files, so a comment explaining the trap trips it as
    // easily as a shipped sentence does. THREE of the banned strings are the hyphenated
    // capability words a visibility matrix and an export disclosure reach for first, which is
    // why this list has to include every file of the story rather than just the copy module.
    for (const path of [
      'packages/protocol/src/activity-copy.ts',
      'packages/protocol/src/activity.ts',
      'packages/protocol/src/activity-entry.ts',
      'packages/protocol/src/balances.ts',
      'packages/protocol/src/discovery.ts',
      'packages/protocol/src/export.ts',
      'packages/protocol/src/pool-events.ts',
      'packages/protocol/src/transaction.ts',
      // Story 6.6's surfaces. THE APP FILES BELONG IN THIS SWEEP TOO, and their absence would have
      // been the hole: three of the ten banned phrases are the hyphenated capability words a feed
      // header and a receipt reach for first, and a sentence typed straight into a component is
      // exactly the one no copy-module test can see.
      'packages/protocol/src/activity-store.ts',
      'apps/web/src/components/ActivityFeed.tsx',
      'apps/web/src/components/ActivityRow.tsx',
      'apps/web/src/routes/activity.$id.tsx',
      'apps/web/src/routes/wallet.tsx',
    ]) {
      const text = readFileSync(path, 'utf8').toLowerCase()
      for (const phrase of FORBIDDEN) {
        expect(text, `${path} contains "${phrase}"`).not.toContain(phrase)
      }
    }
  })
})

// Story 6.6's four authored sentences. The feed's own copy, byte-exact for the same reason as
// everything above it: these are the strings that say whether an empty list is empty or unread,
// what a 1-wei row is doing there, and that a submitted transaction has not been lost.
describe("the feed's copy ships byte-exact (story 6.6)", () => {
  it('unread and empty are two sentences, and never the same one', () => {
    expect(copy.ACTIVITY_EMPTY_NOTHING).toBe(
      'No activity yet. Actions you take appear here as they confirm.',
    )
    expect(copy.FEED_UNREAD).toBe("The pool hasn't been read yet — this list is unread, not empty.")
    // THE DISTINCTION IS THE WHOLE POINT OF THE `initialized` FLAG. "No activity yet" is a claim
    // about the chain; before a read has run we have not looked, and a user shown that sentence
    // during an outage has been told their history is gone.
    expect(copy.FEED_UNREAD).not.toBe(copy.ACTIVITY_EMPTY_NOTHING)
    expect(copy.FEED_UNREAD).toMatch(/unread, not empty/)
  })

  it('the system note is told as structure, never as anomaly', () => {
    expect(copy.SYSTEM_NOTE_LABEL).toBe(
      'System note — the pool requires one per message-only transaction.',
    )
    // "Requires" is load-bearing: the row exists because the protocol demands it, not because
    // something went wrong. A row a user cannot account for is a row they assume is a leak.
    expect(copy.SYSTEM_NOTE_LABEL).toMatch(/requires/)
  })

  it('a submitted transaction that has not appeared says so, in two parts', () => {
    expect(copy.NOT_YET_INDEXED).toBe('Submitted, not yet indexed')
    expect(copy.CHECK_ON_VOYAGER).toBe('check on Voyager')
    // Parts, because the second half is a link. One flat string would make a component find the
    // anchor text inside the sentence again — the re-parsing `noResultsSentence` avoids.
    expect(copy.NOT_YET_INDEXED).not.toContain(copy.CHECK_ON_VOYAGER)
  })

  it('the filter states which way it is set, not what pressing it would do', () => {
    expect(copy.SYSTEM_NOTES_SHOWN).toBe('System notes: shown')
    expect(copy.SYSTEM_NOTES_HIDDEN).toBe('System notes: hidden')
    // §5 requires "visible filter state". A label naming its action leaves the state to be
    // inferred from styling, and an invisible filter state is how a reader decides rows went
    // missing. Neither string is an imperative.
    expect(copy.SYSTEM_NOTES_SHOWN).not.toMatch(/^(show|hide)\b/i)
    expect(copy.SYSTEM_NOTES_HIDDEN).not.toMatch(/^(show|hide)\b/i)
  })
})
