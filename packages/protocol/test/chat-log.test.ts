import { describe, it, expect, vi } from 'vitest'

import { openChatLog, CHAT_LOG_BOUND, type ChatLogEntry, type ChatLogStorage } from '../src/chat-log.js'

const PEER = '0x' + 'a'.repeat(63)
const OTHER = '0x' + 'b'.repeat(63)

function text(id: string, at: number, mine = false): ChatLogEntry {
  return { id, mine, message: { kind: 'text', text: `msg ${id}` }, at }
}

/** In-memory Storage double — the happy path. */
function memoryStorage(): ChatLogStorage & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  }
}

describe('the conversation log', () => {
  it('replayed envelopes are no-ops — the iv is the primary key', () => {
    const log = openChatLog('0x1', memoryStorage())
    log.insert(PEER, text('iv-1', 1000))
    log.insert(PEER, text('iv-1', 2000)) // the 50-envelope replay after a reload
    expect(log.thread(PEER)).toHaveLength(1)
    expect(log.list()[0]!.unread).toBe(1) // counted once, not twice
  })

  it('bounds a conversation and drops from the OLD end', () => {
    const log = openChatLog('0x1', memoryStorage())
    for (let i = 0; i < CHAT_LOG_BOUND + 5; i++) log.insert(PEER, text(`iv-${i}`, i))
    const thread = log.thread(PEER)
    expect(thread).toHaveLength(CHAT_LOG_BOUND)
    expect(thread[0]!.id).toBe('iv-5') // the five oldest fell off
    expect(thread[thread.length - 1]!.id).toBe(`iv-${CHAT_LOG_BOUND + 4}`)
  })

  it('unread counts theirs-while-away, never mine, never the active thread', () => {
    const log = openChatLog('0x1', memoryStorage())
    log.insert(PEER, text('a', 1))
    log.insert(PEER, text('b', 2, true)) // mine
    log.insert(PEER, text('c', 3), { active: true }) // on screen
    expect(log.list()[0]!.unread).toBe(1)
    log.markRead(PEER)
    expect(log.list()[0]!.unread).toBe(0)
    expect(log.totalUnread()).toBe(0)
  })

  it('derives the sidebar preview from the last message, payments as money sentences', () => {
    const log = openChatLog('0x1', memoryStorage())
    log.insert(PEER, text('a', 1))
    log.insert(PEER, {
      id: 'b',
      mine: true,
      at: 2,
      message: { kind: 'payment', amount: '25.00', symbol: 'USDC', token: '0x2', transactionHash: '0x3' },
    })
    expect(log.list()[0]!.preview).toBe('Sent 25.00 USDC')
    log.insert(PEER, {
      id: 'c',
      mine: false,
      at: 3,
      message: { kind: 'payment', amount: '1.5', symbol: 'STRK', token: '0x2', transactionHash: '0x4' },
    })
    expect(log.list()[0]!.preview).toBe('Received 1.5 STRK')
  })

  it('sorts the sidebar most-recent-first and survives a reload byte-for-byte', () => {
    const storage = memoryStorage()
    const first = openChatLog('0x1', storage)
    first.insert(PEER, text('a', 1000))
    first.insert(OTHER, text('b', 2000))
    first.setNickname(OTHER, 'sam')

    const reloaded = openChatLog('0x1', storage)
    const list = reloaded.list()
    expect(list.map((c) => c.peer)).toEqual([OTHER, PEER])
    expect(list[0]!.nickname).toBe('sam')
    expect(reloaded.thread(PEER)).toEqual(first.thread(PEER))
  })

  it('keeps identities apart — one account cannot read another’s log', () => {
    const storage = memoryStorage()
    openChatLog('0xAAA', storage).insert(PEER, text('a', 1))
    expect(openChatLog('0xBBB', storage).list()).toHaveLength(0)
  })

  it('a corrupt record starts empty instead of refusing — this is a cache, not a ledger', () => {
    const storage = memoryStorage()
    storage.data.set('passbook-chat-0x1', '{ not json')
    const log = openChatLog('0x1', storage)
    expect(log.list()).toHaveLength(0)
    log.insert(PEER, text('a', 1))
    expect(log.thread(PEER)).toHaveLength(1)
  })

  it('an unknown version starts empty — no guessing at future shapes', () => {
    const storage = memoryStorage()
    storage.data.set('passbook-chat-0x1', JSON.stringify({ v: 2, conversations: {} }))
    expect(openChatLog('0x1', storage).list()).toHaveLength(0)
  })

  it('storage that throws leaves the session working from memory', () => {
    const throwing: ChatLogStorage = {
      getItem: () => {
        throw new Error('private mode')
      },
      setItem: () => {
        throw new Error('private mode')
      },
    }
    const log = openChatLog('0x1', throwing)
    log.insert(PEER, text('a', 1))
    expect(log.thread(PEER)).toHaveLength(1)
  })

  it('ensure creates an empty row once, for the new-message flow', () => {
    const log = openChatLog('0x1', memoryStorage())
    log.ensure(PEER)
    log.ensure(PEER)
    expect(log.list()).toHaveLength(1)
    expect(log.list()[0]!.preview).toBe('')
  })

  it('notifies subscribers on every mutation and hands back stable list identity between them', () => {
    const log = openChatLog('0x1', memoryStorage())
    const listener = vi.fn()
    log.subscribe(listener)
    log.insert(PEER, text('a', 1))
    expect(listener).toHaveBeenCalledTimes(1)
    expect(log.list()).toBe(log.list()) // same reference until the next mutation
  })
})

//
// The failed-send marker (Wave 2).
//
// It exists as its own door because `insert` returns early on a repeated id — the replay dedupe,
// and the load-bearing line of this module. The bug it closes is silent by construction: the
// obvious implementation (re-insert with `undelivered` set) does nothing, and the message sits in
// the thread looking delivered.
//
describe('marking a sent message undelivered', () => {
  it('annotates in place, and a re-insert of the same id would NOT have', () => {
    const log = openChatLog('0x1', memoryStorage())
    log.insert(PEER, text('iv1', 1, true))
    log.insert(PEER, text('iv2', 2, true))

    // The trap, asserted directly so nobody re-introduces it: insert ignores the repeat.
    log.insert(PEER, { ...text('iv1', 1, true), undelivered: 'nope' })
    expect(log.thread(PEER)[0]!.undelivered).toBeUndefined()

    log.markUndelivered(PEER, 'iv1', 'Not delivered — the relay could not be reached.')
    const thread = log.thread(PEER)
    expect(thread[0]!.undelivered).toBe('Not delivered — the relay could not be reached.')
    // In place: a failed message must not jump to the bottom past ones sent after it.
    expect(thread.map((e) => e.id)).toEqual(['iv1', 'iv2'])
    expect(thread[1]!.undelivered).toBeUndefined()
  })

  it('is a no-op for an unknown peer or id, never a throw', () => {
    const log = openChatLog('0x1', memoryStorage())
    log.insert(PEER, text('iv1', 1, true))
    expect(() => log.markUndelivered(OTHER, 'iv1', 'x')).not.toThrow()
    expect(() => log.markUndelivered(PEER, 'no-such-iv', 'x')).not.toThrow()
    expect(log.thread(PEER)[0]!.undelivered).toBeUndefined()
  })

  it('survives a reload, because a failure the user saw must not un-happen', () => {
    const storage = memoryStorage()
    const log = openChatLog('0x1', storage)
    log.insert(PEER, text('iv1', 1, true))
    log.markUndelivered(PEER, 'iv1', 'Not delivered — the relay refused it (rate-limited).')

    expect(openChatLog('0x1', storage).thread(PEER)[0]!.undelivered).toBe(
      'Not delivered — the relay refused it (rate-limited).',
    )
  })
})
