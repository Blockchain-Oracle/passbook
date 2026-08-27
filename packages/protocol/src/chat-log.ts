//
// The conversation log — what a chat app remembers between reloads.
//
// ── WHY THE CLIENT HOLDS IT, AND NOBODY ELSE ─────────────────────────────────────────────
//
// The relayer's whole design withholds the membership graph: it buffers 50 ciphertext envelopes
// for 30 idle minutes and forgets (`rooms.ts`). A server-side conversation list would hand it the
// exact map the room-id derivation exists to hide, and an on-chain list would cost a proof and a
// fee per edit. So the list lives HERE, in this browser's storage, keyed by identity — and this
// is the ONLY place it lives. Clearing site data is permanent loss; the relayer's buffer cannot
// restore what it never held. `CHAT_RELAY_METADATA` says the metadata half out loud; this header
// says the durability half.
//
// It is stored beside the account key, in plaintext, deliberately: encrypting a history at rest
// with material derived from a key in the SAME storage buys a lock whose key hangs on the door.
//
// ── THE IV IS THE PRIMARY KEY, AND DEDUPE LIVES AT THE STORE, NOT THE TRANSPORT ──────────
//
// The transport's seen-set dies with the page. The bus replays up to 50 envelopes on every
// attach, so the first reload after a conversation would double its recent messages if insertion
// were not idempotent. Every envelope's GCM nonce is already unique per message and already the
// id the thread renders by — so `insert` keys on it and a replay is a no-op by construction.
//
// ── WHY packages/protocol AND NOT apps/web/src/shell ─────────────────────────────────────
//
// `vitest.config.ts` collects `packages/*/test/**` only — a store under the app is a store no
// test can execute (the reasoning `activity-store.ts` already records). The invariants here —
// dedupe, bounds, unread arithmetic — are exactly the kind that invert in one word.
//
import type { RoomMessage } from './room-message.js'

/** One rendered message, exactly the shape the thread UI already uses (`ThreadEntry`). */
export interface ChatLogEntry {
  /** The envelope nonce — unique per message, the transport's and this store's dedupe key. */
  readonly id: string
  readonly mine: boolean
  readonly message: RoomMessage
  /** When THIS browser saw it. Not a claim about when it was sent — nothing signs a clock. */
  readonly at: number
  readonly undelivered?: string
}

export interface ConversationSummary {
  /** The peer's address — the canonical conversation id. Nicknames are display, never identity. */
  readonly peer: string
  readonly nickname: string | null
  /** One line for the sidebar row, derived on insert. */
  readonly preview: string
  readonly lastAt: number
  readonly unread: number
}

interface Conversation {
  nickname: string | null
  entries: ChatLogEntry[]
  lastAt: number
  unread: number
}

interface Serialized {
  v: 1
  conversations: Record<string, { n: string | null; e: ChatLogEntry[]; la: number; u: number }>
}

/**
 * Messages kept per conversation. The cap bounds STORAGE, not the conversation — older messages
 * fall off the local record exactly as they fall off the relayer's much shorter buffer, and the
 * disclosure copy owns telling the user that history here is a bounded local record.
 */
export const CHAT_LOG_BOUND = 200

/** Just enough of `Storage`, so a test can hand in one that throws (the `theme.ts` pattern). */
export type ChatLogStorage = Pick<Storage, 'getItem' | 'setItem'>

const KEY_PREFIX = 'passbook-chat-'

function preview(entry: ChatLogEntry): string {
  const m = entry.message
  switch (m.kind) {
    case 'text':
      return m.text
    case 'payment':
      return `${entry.mine ? 'Sent' : 'Received'} ${m.amount} ${m.symbol}`
    default:
      return 'Message'
  }
}

function parse(raw: string | null): Map<string, Conversation> {
  if (raw === null) return new Map()
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    // A corrupt local cache is not the invite ledger: refusing to start would brick chat over a
    // record whose complete loss the design already tolerates. Start empty and say nothing.
    return new Map()
  }
  const s = data as Serialized | null
  if (s?.v !== 1 || typeof s.conversations !== 'object' || s.conversations === null) return new Map()
  const out = new Map<string, Conversation>()
  for (const [peer, c] of Object.entries(s.conversations)) {
    if (!Array.isArray(c.e)) continue
    out.set(peer, {
      nickname: typeof c.n === 'string' ? c.n : null,
      entries: c.e,
      lastAt: typeof c.la === 'number' ? c.la : 0,
      unread: typeof c.u === 'number' ? c.u : 0,
    })
  }
  return out
}

export interface ChatLog {
  /** Sidebar order: most recent conversation first. Stable snapshot identity between mutations. */
  list(): readonly ConversationSummary[]
  thread(peer: string): readonly ChatLogEntry[]
  /**
   * Idempotent on `entry.id`. `active` marks the thread currently on screen — an active thread
   * accrues no unread, and neither does anything this browser sent itself.
   */
  insert(peer: string, entry: ChatLogEntry, opts?: { active?: boolean }): void
  /** Create the conversation row before any message exists — the new-message flow's first step. */
  ensure(peer: string): void
  markRead(peer: string): void
  setNickname(peer: string, nickname: string | null): void
  totalUnread(): number
  subscribe(listener: () => void): () => void
}

export function openChatLog(account: string, storage: ChatLogStorage | null): ChatLog {
  const key = KEY_PREFIX + account.toLowerCase()

  let read: string | null = null
  try {
    read = storage?.getItem(key) ?? null
  } catch {
    // Private-mode storage throws on READ too; an unreadable record and an absent one start the
    // same way. Writes below keep trying — storage may come back, and memory carries the session.
  }
  const conversations = parse(read)

  const listeners = new Set<() => void>()
  let listCache: readonly ConversationSummary[] | null = null

  function persist() {
    const s: Serialized = { v: 1, conversations: {} }
    for (const [peer, c] of conversations) {
      s.conversations[peer] = { n: c.nickname, e: c.entries, la: c.lastAt, u: c.unread }
    }
    try {
      storage?.setItem(key, JSON.stringify(s))
    } catch {
      // Memory remains authoritative for this session; the loss surface is the reload, and the
      // header above already owns that truth.
    }
  }

  function mutated() {
    listCache = null
    persist()
    for (const l of listeners) l()
  }

  return {
    list() {
      if (listCache === null) {
        listCache = [...conversations.entries()]
          .map(([peer, c]) => ({
            peer,
            nickname: c.nickname,
            preview: c.entries.length ? preview(c.entries[c.entries.length - 1]!) : '',
            lastAt: c.lastAt,
            unread: c.unread,
          }))
          .sort((a, b) => b.lastAt - a.lastAt)
      }
      return listCache
    },

    thread(peer: string) {
      return conversations.get(peer)?.entries ?? []
    },

    insert(peer: string, entry: ChatLogEntry, opts?: { active?: boolean }) {
      let c = conversations.get(peer)
      if (!c) {
        c = { nickname: null, entries: [], lastAt: 0, unread: 0 }
        conversations.set(peer, c)
      }
      if (c.entries.some((e) => e.id === entry.id)) return // the replay case — a no-op, silently
      c.entries.push(entry)
      if (c.entries.length > CHAT_LOG_BOUND) c.entries.splice(0, c.entries.length - CHAT_LOG_BOUND)
      c.lastAt = Math.max(c.lastAt, entry.at)
      if (!entry.mine && !opts?.active) c.unread += 1
      mutated()
    },

    ensure(peer: string) {
      if (conversations.has(peer)) return
      conversations.set(peer, { nickname: null, entries: [], lastAt: Date.now(), unread: 0 })
      mutated()
    },

    markRead(peer: string) {
      const c = conversations.get(peer)
      if (!c || c.unread === 0) return
      c.unread = 0
      mutated()
    },

    setNickname(peer: string, nickname: string | null) {
      const c = conversations.get(peer)
      if (!c) return
      c.nickname = nickname
      mutated()
    },

    totalUnread() {
      let n = 0
      for (const c of conversations.values()) n += c.unread
      return n
    },

    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
