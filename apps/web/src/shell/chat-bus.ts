//
// ONE SOCKET FOR EVERY CONVERSATION, and the store the whole chat surface reads.
//
// ── WHY THIS REPLACED `use-room.ts` ──────────────────────────────────────────────────────
//
// That hook was correct for the product it was written for: one thread, held in React state, torn
// down on navigation. A conversation list breaks all three of those.
//
//   - N threads meant N held streams, and the browser reaches the relayer through a same-origin
//     proxy — so six conversations exhausts HTTP/1.1's six-connections-per-host budget and the
//     seventh starves the balance walk rather than failing where anyone can see it.
//   - A thread in React state dies on navigation, so switching conversations lost the messages you
//     had just read. The log is now `packages/protocol/src/chat-log.ts`, which survives a reload.
//   - Messages for a conversation you are not looking at have to arrive anyway, or an unread badge
//     is a decoration. That needs a bus mounted above the route, not a hook inside it.
//
// ── ROUTING NEEDS NO WIRE CHANGE, AND THAT IS THE PROTOCOL'S OWN DOING ───────────────────
//
// `RoomEnvelope.from` is the sender's viewing public key x, and `room.ts` already defines it as
// "the routing hint that tells the recipient WHICH of its two directional keys to open with". One
// room per address pair means one peer per key, so `from` identifies the conversation exactly.
//
// A FORGED `from` CANNOT MISDELIVER. Point it at another of my rooms and the envelope is opened
// with keys derived from THAT room's shared secret, which the forger does not hold — GCM fails the
// tag and the message drops. Misrouting can only produce a drop, never a message in the wrong
// thread. That property is why routing on an unauthenticated field is safe here, and it is worth
// re-checking before anyone widens what `from` decides.
//
// ── THE SDK STAYS LAZY, AND THIS FILE IS IN THE EAGER GRAPH ──────────────────────────────
//
// The nav badge reads `useTotalUnread` from the root layout, so this module IS eager. Every import
// that reaches `starknet` — `room`, `room-transport`, `pool`, `registration` — is therefore
// dynamic, and only `chat-log` (whose sole import is a type) is static. Adding a static import of
// any of the others here is a 268 kB regression that compiles clean and only `build:web` refuses.
//
import { useCallback, useSyncExternalStore } from 'react'

import {
  openChatLog,
  type ChatLog,
  type ChatLogEntry,
  type ConversationSummary,
} from '@strk20/protocol/chat-log'
import type { RoomMessage } from '@strk20/protocol/room-message'
import type { RoomStreamState } from '@strk20/protocol/room-transport'

/** What is known about one peer. The thread header and the new-message dialog both render it. */
export type PeerStatus =
  /** Reading their key off the chain. */
  | { readonly kind: 'checking' }
  /** Not a felt. */
  | { readonly kind: 'invalid' }
  /** Your own address. Derivable, but a room of one is not a conversation. */
  | { readonly kind: 'self' }
  /** No viewing key on chain, so there is nothing to derive a room against. */
  | { readonly kind: 'unregistered' }
  /** The chain could not be read — we do not know, rather than know. */
  | { readonly kind: 'unreadable'; readonly because: string }
  /** The room exists. */
  | { readonly kind: 'open'; readonly roomId: string }

export interface ChatBusState {
  /** The socket, or `idle` when no conversation has been opened yet. */
  readonly connection: RoomStreamState | 'idle'
  /** Per peer address, lowercased. */
  readonly statuses: Readonly<Record<string, PeerStatus>>
  /** True once the log for the active account is open — before that, lists are empty by ignorance. */
  readonly ready: boolean
}

export interface ChatSession {
  readonly address: string
  readonly accountKey: string
  readonly viewingKey: bigint
}

/**
 * The most rooms one socket may carry — the relayer's own `MAX_ROOMS_PER_STREAM`.
 *
 * DUPLICATED RATHER THAN IMPORTED, for this file's stated reason: `packages/relayer` is a server
 * package and nothing in the browser bundle may reach it. `chat-bus.test.ts` pins the two to the
 * same number so the copy cannot drift into a client that asks for 33 and is refused wholesale.
 */
export const MAX_ROOMS_PER_STREAM = 32

// ── The singleton ─────────────────────────────────────────────────────────────────────────

type Derived = {
  /** The room's opaque relayer label. */
  id: string
  /** `deriveRoom`'s return, kept opaque — nothing here touches a key directly. */
  room: Awaited<ReturnType<typeof import('@strk20/protocol/room').deriveRoom>>
}

let session: ChatSession | null = null
let log: ChatLog | null = null
let logAccount: string | null = null
let unsubscribeLog: (() => void) | null = null

/** Peer address (lowercased) → its derived room. The cache that makes switching threads instant. */
const rooms = new Map<string, Derived>()
/** `BigInt(from).toString()` → peer address. The routing table the envelope's `from` indexes. */
const byPublicKey = new Map<string, string>()

let stream: { close(): void } | null = null
/** The room ids the OPEN stream was built with, so a no-op change does not reconnect. */
let streamRooms = ''
let active: string | null = null

let state: ChatBusState = { connection: 'idle', statuses: {}, ready: false }
const listeners = new Set<() => void>()

function publish(next: Partial<ChatBusState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function setStatus(peer: string, status: PeerStatus): void {
  publish({ statuses: { ...state.statuses, [peer.toLowerCase()]: status } })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const snapshot = () => state

export function useChatBus(): ChatBusState {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

// ── The account ───────────────────────────────────────────────────────────────────────────

/**
 * Point the bus at an account, or at nothing.
 *
 * IDEMPOTENT ON THE ADDRESS, because the chat layout calls it from an effect that re-runs whenever
 * the session object's identity changes — which `useSession` does on every lock, unlock and
 * balance publish. Re-opening the log there would drop the routing cache and reconnect the socket
 * several times a minute for no reason.
 *
 * A CHANGE OF ACCOUNT DROPS EVERYTHING. The log is keyed per account, the rooms were derived from
 * the old viewing key, and the routing table maps keys that belong to the old identity's rooms.
 * Carrying any of it across a switch would show one account's conversations under another's name.
 */
export function setChatSession(next: ChatSession | null): void {
  const nextAccount = next?.address.toLowerCase() ?? null
  if (nextAccount === logAccount && session?.accountKey === next?.accountKey) return

  closeStream()
  rooms.clear()
  byPublicKey.clear()
  unsubscribeLog?.()
  unsubscribeLog = null
  active = null

  session = next
  logAccount = nextAccount

  if (next === null) {
    log = null
    publish({ connection: 'idle', statuses: {}, ready: false })
    return
  }

  // `null` storage is a real answer, not a failure: `openChatLog` degrades to an in-memory log,
  // which is the honest behaviour for a browser that cannot persist — chat still works for this
  // session, and the disclosure already says local history is the only history.
  log = openChatLog(next.address, safeStorage())
  unsubscribeLog = log.subscribe(() => {
    for (const listener of listeners) listener()
  })
  publish({ connection: 'idle', statuses: {}, ready: true })

  // Re-derive the rooms for every conversation this browser remembers, so messages arrive for
  // threads the user has not opened yet — which is the whole point of an unread badge.
  for (const conversation of log.list()) void openConversation(conversation.peer)
}

/** `localStorage`, or `null` where touching it throws. Safari private mode throws on access. */
function safeStorage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

// ── Conversations ─────────────────────────────────────────────────────────────────────────

/**
 * Derive the room for one peer, cache it, and make sure the socket carries it.
 *
 * SAFE TO CALL REPEATEDLY — the new-message dialog calls it on every keystroke that produces a
 * plausible address, and the layout calls it for every remembered conversation on boot. A peer
 * already derived returns immediately without a chain read.
 */
export async function openConversation(peer: string): Promise<PeerStatus> {
  const key = peer.trim().toLowerCase()
  const current = session
  if (current === null) return { kind: 'checking' }
  if (rooms.has(key)) {
    const held = rooms.get(key)!
    const status: PeerStatus = { kind: 'open', roomId: held.id }
    setStatus(key, status)
    return status
  }

  setStatus(key, { kind: 'checking' })

  const [{ maybeAddress, sameAddress }, { getPublicKey }, roomModule, { deriveRegisteredPublicKey }] =
    await Promise.all([
      import('@strk20/protocol/address'),
      import('@strk20/protocol/pool'),
      import('@strk20/protocol/room'),
      import('@strk20/protocol/registration'),
    ])

  // The session can change while four chunks load. Deriving against the account that has since
  // been switched away from would cache a room nothing can open.
  if (session !== current) return { kind: 'checking' }

  if (maybeAddress(peer.trim()) === null) return refuse(key, { kind: 'invalid' })
  if (sameAddress(peer.trim(), current.address)) return refuse(key, { kind: 'self' })

  let theirKey: bigint
  try {
    theirKey = await getPublicKey(peer.trim())
  } catch (e) {
    return refuse(key, { kind: 'unreadable', because: String(e) })
  }
  if (session !== current) return { kind: 'checking' }
  if (theirKey === 0n) return refuse(key, { kind: 'unregistered' })

  let derived: Derived['room']
  try {
    derived = await roomModule.deriveRoom({
      myViewingKey: current.viewingKey,
      // Through `deriveRegisteredPublicKey` rather than derived here, so this agrees with what
      // registration actually wrote on chain — including its odd-length-hex correction, which is
      // exactly the detail a second derivation gets wrong once and disagrees about forever.
      myPublicKey: deriveRegisteredPublicKey(current.accountKey),
      theirPublicKey: theirKey,
    })
  } catch (e) {
    // A key on chain that is not a point on the curve, or a viewing key out of range. Both are
    // "we cannot build this room" rather than "they are not registered".
    return refuse(key, { kind: 'unreadable', because: String(e) })
  }
  if (session !== current) return { kind: 'checking' }

  rooms.set(key, { id: derived.id, room: derived })
  byPublicKey.set(theirKey.toString(), key)
  const status: PeerStatus = { kind: 'open', roomId: derived.id }
  setStatus(key, status)
  reconcileStream()
  return status
}

function refuse(peer: string, status: PeerStatus): PeerStatus {
  setStatus(peer, status)
  return status
}

/** Create the sidebar row before any message exists — the new-message flow's first step. */
export function rememberConversation(peer: string): void {
  log?.ensure(peer.trim().toLowerCase())
  void openConversation(peer)
}

/**
 * Which thread is on screen.
 *
 * Two jobs: an active thread accrues no unread, and opening one clears what it had. Passing `null`
 * on unmount matters — otherwise a thread left "active" after navigating away silently swallows
 * every unread it should have counted.
 */
export function setActiveThread(peer: string | null): void {
  active = peer === null ? null : peer.trim().toLowerCase()
  if (active !== null) log?.markRead(active)
}

export function setNickname(peer: string, nickname: string | null): void {
  log?.setNickname(peer.trim().toLowerCase(), nickname)
}

// ── The socket ────────────────────────────────────────────────────────────────────────────

function closeStream(): void {
  stream?.close()
  stream = null
  streamRooms = ''
}

/**
 * Make the open socket carry exactly the rooms we hold, and no more.
 *
 * ONE SOCKET, REBUILT ON CHANGE. There is no protocol for adding a room to a live subscription, so
 * a new conversation means a reconnect — cheap, because the relayer replays each room's backlog on
 * subscribe and the log de-duplicates by iv, so nothing is lost or doubled by the churn.
 *
 * The comparison is on the JOINED, SORTED ids rather than a length or a set identity: deriving a
 * room a second time produces the same id, and reconnecting for an unchanged set would drop
 * messages during the gap for no gain.
 */
function reconcileStream(): void {
  const carried = carriedRooms()
  //
  // THE SIGNATURE IS ORDER-INDEPENDENT, AND THAT IS NOT A DETAIL.
  //
  // `carriedRooms` orders by recency, so every message that arrives changes the order — and a
  // signature built from that order would differ on every message, tearing the socket down and
  // rebuilding it each time anyone said anything. Sorting before joining means only a change of
  // MEMBERSHIP reconnects, which is the thing that actually requires a new subscribe.
  //
  const signature = [...carried].sort().join(',')

  if (signature === streamRooms) return
  closeStream()
  if (carried.length === 0) {
    publish({ connection: 'idle' })
    return
  }

  streamRooms = signature
  void (async () => {
    const { openRoomStream } = await import('@strk20/protocol/room-transport')
    // Another reconcile may have run while the chunk loaded. The signature check is what stops the
    // two from both opening a socket.
    if (streamRooms !== signature) return
    stream = openRoomStream({
      rooms: carried,
      onState: (connection) => publish({ connection }),
      onEnvelope: (envelope) => void receive(envelope),
    })
  })()
}

/**
 * The rooms one socket should carry, MOST RECENT FIRST.
 *
 * ── THE CAP HAS TO CHOOSE, SO IT CHOOSES BY RECENCY ──────────────────────────────────────
 *
 * `MAX_ROOMS_PER_STREAM` is the relayer's limit and it is all-or-nothing on subscribe, so asking
 * for 33 rooms fails the whole stream rather than the extra one. The client therefore picks which
 * 32 — and the first draft picked whichever ids sorted first alphabetically, which is to say at
 * random. Somebody with 40 conversations would have had their active ones silently dropped in
 * favour of the ones whose room hash happened to start with a zero.
 *
 * `log.list()` is already ordered most-recent-first, so the conversations a person is actually
 * having are the ones the socket carries. The remainder still appear in the sidebar with their
 * stored history; they just do not receive live messages until they become recent again.
 */
function carriedRooms(): string[] {
  const ordered: string[] = []
  const seen = new Set<string>()

  for (const conversation of log?.list() ?? []) {
    const held = rooms.get(conversation.peer.toLowerCase())
    if (held === undefined || seen.has(held.id)) continue
    seen.add(held.id)
    ordered.push(held.id)
    if (ordered.length === MAX_ROOMS_PER_STREAM) return ordered
  }

  // A room derived but not yet in the log: the new-message flow resolves the peer BEFORE it
  // remembers the conversation, so between those two steps the room exists and the row does not.
  // Without this the first message of a brand-new conversation would arrive on no socket at all.
  for (const held of rooms.values()) {
    if (seen.has(held.id)) continue
    seen.add(held.id)
    ordered.push(held.id)
    if (ordered.length === MAX_ROOMS_PER_STREAM) break
  }

  return ordered
}

/**
 * One envelope, routed and opened.
 *
 * DROPPED SILENTLY ON ANY FAILURE, and that is deliberate rather than lazy: a stranger who guessed
 * a room id, or a peer who forged `from`, must not be able to make a row appear in somebody's
 * sidebar. The only things that reach the log are envelopes that authenticated under a key derived
 * from a shared secret.
 */
async function receive(envelope: { from: string; iv: string }): Promise<void> {
  const current = session
  const store = log
  if (current === null || store === null) return

  let peer: string | undefined
  try {
    peer = byPublicKey.get(BigInt(envelope.from).toString())
  } catch {
    // `from` that is not a felt. Noise on the bus, and there is no conversation it could belong to.
    return
  }
  // Our own echo routes to nothing — `selfPublicKey` is not in the peer table — and that is the
  // right answer: the message this browser sent is already in the log, rendered before it was sent.
  if (peer === undefined) return

  const held = rooms.get(peer)
  if (held === undefined) return

  const [roomModule, { decodeRoomMessage }] = await Promise.all([
    import('@strk20/protocol/room'),
    import('@strk20/protocol/room-message'),
  ])

  let plaintext: string
  try {
    plaintext = await roomModule.openMessage(held.room, envelope as never)
  } catch {
    return
  }

  let message: RoomMessage
  try {
    message = decodeRoomMessage(plaintext)
  } catch {
    // Authenticated, so it genuinely came from the peer — but this build cannot read its shape.
    // Dropping beats rendering a message whose meaning we are guessing at.
    return
  }

  // The session can change across two dynamic imports and a decrypt.
  if (session !== current || log !== store) return
  store.insert(peer, { id: envelope.iv, mine: false, message, at: Date.now() }, { active: peer === active })
}

// ── Sending ───────────────────────────────────────────────────────────────────────────────

/**
 * Seal and send. Resolves to `null` on success or a sentence on failure.
 *
 * RENDERED BEFORE IT IS SENT, AND CORRECTED AFTER. Waiting for the round trip makes every message
 * feel like a form submission; the correction is the point — a failure MARKS the entry rather than
 * removing it, so nothing the user typed silently disappears.
 */
export async function sendMessage(peer: string, message: RoomMessage): Promise<string | null> {
  const key = peer.trim().toLowerCase()
  const store = log
  const held = rooms.get(key)
  if (store === null) return 'There is no account open to send from.'
  if (held === undefined) return 'This thread is not open yet.'

  const [{ sealMessage }, { sendEnvelope }, { encodeRoomMessage }] = await Promise.all([
    import('@strk20/protocol/room'),
    import('@strk20/protocol/room-transport'),
    import('@strk20/protocol/room-message'),
  ])

  let envelope: Awaited<ReturnType<typeof sealMessage>>
  try {
    envelope = await sealMessage(held.room, encodeRoomMessage(message))
  } catch (e) {
    return e instanceof Error ? e.message : 'That message could not be sealed.'
  }

  store.insert(key, { id: envelope.iv, mine: true, message, at: Date.now() }, { active: true })

  const result = await sendEnvelope(held.id, envelope)
  if (result.ok) return null

  const because =
    result.failure.kind === 'unreachable'
      ? 'Not delivered — the relay could not be reached.'
      : `Not delivered — the relay refused it (${result.failure.reason}).`
  // THROUGH `markUndelivered`, NOT A SECOND `insert`. `insert` returns early on an id it already
  // holds — that is the replay dedupe — so re-inserting the entry with `undelivered` set would do
  // nothing at all, and the message would sit in the thread looking delivered.
  store.markUndelivered(key, envelope.iv, because)
  return because
}

// ── The reads ─────────────────────────────────────────────────────────────────────────────

const NO_CONVERSATIONS: readonly ConversationSummary[] = Object.freeze([])
const NO_ENTRIES: readonly ChatLogEntry[] = Object.freeze([])

/**
 * The sidebar's rows.
 *
 * `log.list()` returns a stable snapshot between mutations — `chat-log.ts`'s own contract — which
 * is what `useSyncExternalStore` requires. A frozen module-level empty array covers the no-account
 * case for the same reason: a fresh `[]` per read is a new identity for an unchanged fact, and
 * React loops forever on it.
 */
export function useConversations(): readonly ConversationSummary[] {
  return useSyncExternalStore(
    subscribe,
    () => log?.list() ?? NO_CONVERSATIONS,
    () => NO_CONVERSATIONS,
  )
}

export function useThread(peer: string | null): readonly ChatLogEntry[] {
  const key = peer === null ? null : peer.trim().toLowerCase()
  const read = useCallback(
    () => (key === null ? NO_ENTRIES : (log?.thread(key) ?? NO_ENTRIES)),
    [key],
  )
  return useSyncExternalStore(subscribe, read, () => NO_ENTRIES)
}

/**
 * Every unread message, for the nav badge.
 *
 * HONEST WHEN THE BUS IS CLOSED, which is most of the time: messages that arrive while chat is
 * unmounted sit in the relayer's buffer rather than here, so this counts what this browser has
 * actually received. It catches up when chat opens, and the disclosure says the buffer is bounded.
 */
export function useTotalUnread(): number {
  return useSyncExternalStore(
    subscribe,
    () => log?.totalUnread() ?? 0,
    () => 0,
  )
}
