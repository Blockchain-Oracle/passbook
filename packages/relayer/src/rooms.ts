//
// The chat transport: a broadcast bus for ciphertext, and deliberately nothing more.
//
// WHAT THIS PROCESS CAN AND CANNOT LEARN. It routes envelopes by a 128-bit room id and never
// holds a key, so it cannot read a message. It also cannot compute a room id from anything
// public: the id comes out of the two parties' shared ECDH secret (`protocol/src/room.ts`), so
// even a full scrape of every registration on the pool does not let this host turn its room table
// into a social graph. What it does see is unavoidable and should be said plainly rather than
// waved at: that a room exists, how many connections it has, and when traffic happens.
//
// MEMORY ONLY, ON PURPOSE. Everything here dies with the process. The relayer's other state — two
// spend ledgers — is file-backed because a reset would hand a visitor a fresh spend cap, and that
// argument runs the other way for ciphertext: durable chat backlog is a liability that grows, and
// nothing about a lost message costs anyone money. There is no store path, no volume, no flush.
//
// THE HISTORY BUFFER IS A DELIBERATE, BOUNDED RETENTION and it is the one honest cost of the
// design. Without it, a message sent while the other person's tab is closed is simply gone, which
// is not a chat product. With it, this host holds a few dozen envelopes it cannot read for a
// bounded time. Both numbers are constants below rather than settings, so what the privacy page
// claims is checkable against one file.
//
// WHY EVERY LIMIT HERE IS A REFUSAL RATHER THAN A BACKPRESSURE KNOB. A funded signer's host
// answering an unbounded number of subscriptions is a host that can be made to stop signing by
// anyone with a socket. Each cap below turns an unbounded resource into a bounded one, and each
// one is a number an attacker meets rather than a limit a crowd meets.
//

/** The exact shape `protocol/src/room.ts` derives. Anything else is not one of our rooms. */
export const ROOM_ID_PATTERN = /^[0-9a-f]{32}$/

/**
 * How many envelopes a room keeps for someone who joins late, and how long an idle room lives.
 *
 * These two numbers ARE the retention claim on the privacy page. Changing either changes what
 * this host holds about a conversation it cannot read, so change them here and regenerate the
 * page (`pnpm run render:privacy`) rather than editing the sentence.
 */
export const ROOM_HISTORY = 50
export const ROOM_IDLE_MS = 30 * 60 * 1000

/**
 * The ceiling on one envelope, in bytes of JSON.
 *
 * Set above `MAX_MESSAGE_BYTES` (2,000 plaintext) with room for base64 expansion, the GCM tag and
 * the envelope's own fields. The relayer cannot check a plaintext length — it has no plaintext —
 * so this is the only size rule it can enforce, and it exists so one caller cannot turn a room's
 * history buffer into megabytes of this host's memory.
 */
export const MAX_ENVELOPE_BYTES = 4_000

/** Rooms tracked at once. Reached by an attacker opening rooms, never by a demo. */
export const MAX_ROOMS = 500

/** Connections to one room. A two-party conversation across a few tabs, with headroom. */
export const MAX_SUBSCRIBERS_PER_ROOM = 8

/** Publishes per room per minute. A fast typist sends single digits; a script sends thousands. */
export const MAX_PUBLISH_PER_MINUTE = 60

/**
 * One connected listener. An interface rather than a `ServerResponse` so the fan-out rules are
 * testable without sockets — every refusal below is a rule worth a test, and a rule that can only
 * be exercised through an HTTP server is a rule that ends up untested.
 */
export interface RoomSubscriber {
  /** Deliver one already-serialised payload. Must not throw; a dead socket is the hub's problem. */
  deliver(payload: string): void
  /** Close the connection. Called when the hub drops a subscriber for its own reasons. */
  end(): void
}

export type PublishRefusal =
  | 'bad-room-id'
  | 'bad-envelope'
  | 'envelope-too-large'
  | 'too-many-rooms'
  | 'rate-limited'

export type SubscribeRefusal = 'bad-room-id' | 'too-many-rooms' | 'room-full'

interface Room {
  readonly subscribers: Set<RoomSubscriber>
  /** Ciphertext only, oldest first, capped at ROOM_HISTORY. */
  readonly history: string[]
  /** Publish timestamps inside the current minute, for the rate limit. */
  publishes: number[]
  lastSeen: number
}

/** What the relayer knows about a room. Also what it could be compelled to hand over. */
export interface RoomStats {
  readonly rooms: number
  readonly subscribers: number
  readonly buffered: number
}

export class RoomHub {
  private readonly rooms = new Map<string, Room>()

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * Attach a listener and hand back its history. Returns an unsubscribe function, or a refusal.
   *
   * The history goes out on subscribe rather than being pushed later so that a client has exactly
   * one ordering rule to implement: everything it receives, in the order it receives it.
   */
  subscribe(
    roomId: string,
    subscriber: RoomSubscriber,
  ): { ok: true; history: readonly string[]; unsubscribe: () => void } | { ok: false; reason: SubscribeRefusal } {
    if (!ROOM_ID_PATTERN.test(roomId)) return { ok: false, reason: 'bad-room-id' }

    this.sweep()
    let room = this.rooms.get(roomId)
    if (room === undefined) {
      // A subscription creates a room, which is why it is capped: otherwise "how many rooms can
      // exist" is answered by whoever connects fastest rather than by this file.
      if (this.rooms.size >= MAX_ROOMS) return { ok: false, reason: 'too-many-rooms' }
      room = { subscribers: new Set(), history: [], publishes: [], lastSeen: this.now() }
      this.rooms.set(roomId, room)
    }
    if (room.subscribers.size >= MAX_SUBSCRIBERS_PER_ROOM) return { ok: false, reason: 'room-full' }

    room.subscribers.add(subscriber)
    room.lastSeen = this.now()
    const history = [...room.history]

    return {
      ok: true,
      history,
      unsubscribe: () => {
        const current = this.rooms.get(roomId)
        if (current === undefined) return
        current.subscribers.delete(subscriber)
        current.lastSeen = this.now()
        // An empty room is NOT deleted here. Its history is the whole point: the other party may
        // be mid-reconnect, and dropping the buffer the moment the last socket closes would lose
        // exactly the messages the buffer exists for. `sweep()` reclaims it on the idle timer.
      },
    }
  }

  /**
   * Fan one envelope out to everyone in the room, including the sender's other tabs.
   *
   * The envelope is passed through as an OPAQUE STRING. This host does not parse it, does not
   * validate its fields beyond the shape check the caller already did, and cannot: the only
   * thing that authenticates an envelope is a GCM tag under a key it does not hold. A subscriber
   * that receives a forgery rejects it locally; that is the design, not a gap in it.
   */
  publish(roomId: string, envelope: string): { ok: true; delivered: number } | { ok: false; reason: PublishRefusal } {
    if (!ROOM_ID_PATTERN.test(roomId)) return { ok: false, reason: 'bad-room-id' }
    if (envelope.length === 0) return { ok: false, reason: 'bad-envelope' }
    if (Buffer.byteLength(envelope, 'utf8') > MAX_ENVELOPE_BYTES) {
      return { ok: false, reason: 'envelope-too-large' }
    }

    this.sweep()
    const at = this.now()
    let room = this.rooms.get(roomId)
    if (room === undefined) {
      if (this.rooms.size >= MAX_ROOMS) return { ok: false, reason: 'too-many-rooms' }
      // Publishing into a room nobody is listening to is legitimate — it is what happens when the
      // recipient's tab is shut — so the room is created and the message buffered.
      room = { subscribers: new Set(), history: [], publishes: [], lastSeen: at }
      this.rooms.set(roomId, room)
    }

    room.publishes = room.publishes.filter((t) => at - t < 60_000)
    if (room.publishes.length >= MAX_PUBLISH_PER_MINUTE) return { ok: false, reason: 'rate-limited' }
    room.publishes.push(at)
    room.lastSeen = at

    room.history.push(envelope)
    if (room.history.length > ROOM_HISTORY) room.history.shift()

    let delivered = 0
    for (const subscriber of room.subscribers) {
      // A subscriber whose socket died between the last write and this one must not take the
      // whole fan-out down with it — the other party is still listening and has done nothing
      // wrong. Drop the broken one and carry on.
      try {
        subscriber.deliver(envelope)
        delivered += 1
      } catch {
        room.subscribers.delete(subscriber)
      }
    }
    return { ok: true, delivered }
  }

  /** Drop rooms nobody has touched inside the idle window, subscribers and history alike. */
  sweep(): number {
    const at = this.now()
    let dropped = 0
    for (const [id, room] of this.rooms) {
      if (at - room.lastSeen < ROOM_IDLE_MS) continue
      // A room can only be idle-expired once every socket on it has gone quiet for the full
      // window, so ending them is a courtesy to a client that has stopped reading rather than a
      // disconnection of an active conversation.
      for (const subscriber of room.subscribers) {
        try {
          subscriber.end()
        } catch {
          // Already gone. Nothing to do and nobody to tell.
        }
      }
      this.rooms.delete(id)
      dropped += 1
    }
    return dropped
  }

  stats(): RoomStats {
    let subscribers = 0
    let buffered = 0
    for (const room of this.rooms.values()) {
      subscribers += room.subscribers.size
      buffered += room.history.length
    }
    return { rooms: this.rooms.size, subscribers, buffered }
  }
}

/**
 * The shape check the server runs before an envelope reaches the hub.
 *
 * It mirrors `protocol/src/room.ts`'s `isRoomEnvelope` and stops deliberately short of it: this
 * side must never come to depend on a field's MEANING, only on the envelope being a small JSON
 * object of strings. The day this function starts reading `from` for anything other than "it is a
 * string" is the day the relayer has an opinion about who is in a conversation.
 */
export function isWireEnvelope(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const e = value as Record<string, unknown>
  return e.v === 1 && typeof e.iv === 'string' && typeof e.ct === 'string' && typeof e.from === 'string'
}
