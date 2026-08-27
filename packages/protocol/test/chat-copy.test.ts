//
// The chat surface's sentences, byte-exact (Wave 2).
//
// The `backup-copy.test.ts` contract: `toBe`, one assertion per sentence, plus a second assertion
// on the property that made the sentence necessary — so a reword that inverted the meaning fails
// even if somebody updated the expectation to match.
//
import { describe, it, expect } from 'vitest'

import * as copy from '../src/chat-copy.js'
import { CHAT_LOG_BOUND } from '../src/chat-log.js'
import { FORBIDDEN_CLAIMS } from '../src/forbidden-claims.js'

describe('what this browser keeps, and what nobody keeps', () => {
  it('says local history is the only history, and that the relay is not a record', () => {
    expect(copy.CHAT_HISTORY_IS_LOCAL).toBe(
      'These conversations live in this browser and nowhere else. Clearing site data deletes them, ' +
        'and nothing can bring them back — the relay keeps a short buffer to reconnect through, ' +
        'not a record.',
    )
    // The distinction the whole design rests on: a buffer is not a backup, and a user who thinks
    // the relay is holding their history will clear site data expecting to get it back.
    expect(copy.CHAT_HISTORY_IS_LOCAL).toMatch(/not a record/)
    expect(copy.CHAT_HISTORY_IS_LOCAL).not.toMatch(/backup|restore|recover/i)
  })

  it('names the gap a conversation list makes visible', () => {
    expect(copy.CHAT_OFFLINE_GAP).toBe(
      'Anything sent while this browser was closed for more than half an hour is not here — it was ' +
        'never stored anywhere it could be fetched from later.',
    )
  })

  it('carries no copy of the storage bound, so the number cannot drift', () => {
    // `CHAT_LOG_BOUND` is the bound. A sentence quoting "200" would be a second copy of a value
    // nothing keeps in step — the shape is what the copy owes the reader.
    for (const sentence of [copy.CHAT_HISTORY_IS_LOCAL, copy.CHAT_OFFLINE_GAP]) {
      expect(sentence).not.toContain(String(CHAT_LOG_BOUND))
    }
  })
})

describe('the multiplexed socket is disclosed rather than sold as private', () => {
  it('says the relay can group the conversations, and that timing already did', () => {
    expect(copy.CHAT_MULTIPLEX_DISCLOSURE).toBe(
      'Your open conversations share one connection, so the relay can see that they belong to the ' +
        'same person. It could already tell from the timing; this does not hide it and does not ' +
        'pretend to.',
    )
    // The overclaim this exists to refuse: implying the previous one-socket-per-room shape was
    // hiding something it was not.
    expect(copy.CHAT_MULTIPLEX_DISCLOSURE).toMatch(/does not pretend to/)
    expect(copy.CHAT_MULTIPLEX_DISCLOSURE).not.toMatch(/private|anonymous|hidden from/i)
  })
})

describe('a public directory is described as public', () => {
  it('says a claimed name is readable by anyone and cannot really be taken back', () => {
    expect(copy.DIRECTORY_IS_PUBLIC).toBe(
      'A name in the directory is public. Anyone can read the list and see which address it points ' +
        'to, and taking it back removes it from the list rather than from anyone who already ' +
        'copied it.',
    )
    // No delete pretense. The ledger is file-backed and restorable; "deleted" would be false.
    expect(copy.DIRECTORY_IS_PUBLIC).toMatch(/rather than from anyone who already copied it/)
    expect(copy.DIRECTORY_IS_PUBLIC).not.toMatch(/\bdelete[ds]?\b|\berase/i)
  })

  it('says the search never leaves the browser, which users assume the other way', () => {
    expect(copy.DIRECTORY_SEARCH_IS_LOCAL).toBe(
      'Search runs in this browser against the whole list, so the relay never learns who you looked ' +
        'for.',
    )
  })

  it('separates a claimed label from the address underneath it', () => {
    expect(copy.DIRECTORY_NAME_IS_NOT_IDENTITY).toBe(
      'A name is a label somebody claimed, not proof of who they are. The address underneath it is ' +
        'the part that cannot be swapped.',
    )
  })

  it('the claim screen labels and refusals', () => {
    expect(copy.DIRECTORY_TITLE).toBe('Claim a name')
    expect(copy.DIRECTORY_SEARCH_PLACEHOLDER).toBe('A name, or an address starting 0x')
    expect(copy.DIRECTORY_NAME_TAKEN).toBe('That name is already claimed by another address.')
    expect(copy.DIRECTORY_NAME_MALFORMED).toBe(
      'Names are 3 to 20 characters, lower-case letters, numbers and underscores.',
    )
    expect(copy.DIRECTORY_CLAIM_NEEDS_REGISTRATION).toBe(
      'Claiming a name proves you hold the key registered to this address, so the account has to be ' +
        'registered with the pool first.',
    )
  })
})

describe('the empty and unreachable states each get their own sentence', () => {
  it('an empty sidebar states the property that makes starting one free', () => {
    expect(copy.CHAT_NO_CONVERSATIONS).toBe(
      'No conversations yet. Anyone who has registered with the pool can be reached — starting one ' +
        'publishes nothing and asks nobody.',
    )
    expect(copy.CHAT_PICK_A_CONVERSATION).toBe('Pick a conversation, or start a new one.')
  })

  it('an unregistered peer is a product state with an action, not an error', () => {
    expect(copy.CHAT_PEER_UNREGISTERED).toBe(
      'This address has not registered with the pool, so there is no key to derive a room from. ' +
        'They need to open the app once.',
    )
    expect(copy.CHAT_PEER_SELF).toBe('That is your own address.')
    expect(copy.CHAT_PEER_INVALID).toBe('That is not a Starknet address.')
    // Three different facts about a stranger's account. Collapsing them tells someone their friend
    // has not signed up when the truth is that an RPC timed out.
    const three = [copy.CHAT_PEER_UNREGISTERED, copy.CHAT_PEER_SELF, copy.CHAT_PEER_INVALID]
    expect(new Set(three).size).toBe(3)
  })

  it('the empty thread says what sealing means and where it happens', () => {
    expect(copy.CHAT_THREAD_EMPTY).toBe(
      'No messages yet. What you type is sealed in this browser before it leaves.',
    )
  })
})

describe('nothing here states a claim this protocol cannot keep', () => {
  it('no forbidden claim appears in any exported sentence', () => {
    // The auditor holds an escrowed copy of the viewing keys these room keys derive from, so
    // "end-to-end" and "only you can" are false HERE specifically — the exact trap a chat surface
    // walks into. `disclosure-copy.ts`'s `CHAT_AUDITOR_DERIVES` is the sentence that tells the
    // truth; nothing in this module may contradict it.
    const sentences = Object.values(copy).filter((v): v is string => typeof v === 'string')
    expect(sentences.length).toBeGreaterThan(12)
    for (const sentence of sentences) {
      for (const claim of FORBIDDEN_CLAIMS) {
        expect(sentence.toLowerCase()).not.toContain(claim)
      }
    }
  })
})
