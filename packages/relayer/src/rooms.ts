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
 * Ephemeral control frames per room per minute — typing pings, and nothing else so far.
 *
 * Higher than the publish limit because a ping is cheaper than a message and a two-party room can
 * legitimately produce one every few seconds from each side. It is still a ceiling rather than a
 * knob: a signal costs a fan-out, and a fan-out is this host's CPU.
 */
export const MAX_SIGNALS_PER_MINUTE = 120

/**
 * How long a presence beacon counts for, and how often a client is expected to send one.
 *
 * ── WHY PRESENCE IS NOT "HOW MANY SOCKETS ARE ATTACHED" ──────────────────────────────────
 *
 * That was the obvious implementation and it is wrong here, for a reason measured rather than
 * guessed: this process sits behind a serverless proxy that holds the browser's connection
 * itself. When someone closes a tab, the proxy's own connection to this host stays open until the
 * platform reaps the function — up to five minutes. A subscriber set therefore says who ARRIVED
 * accurately and says nothing trustworthy about who LEFT, and a presence dot built on it lights
 * when a peer joins and never goes out. Two runs against production measured a peer still counted
 * 145 seconds after closing their tab.
 *
 * So presence is a positive assertion with an expiry instead of an inference from liveness. A
 * client repeats a beacon every `PRESENCE_BEACON_MS`; an entry that has not been refreshed inside
 * `PRESENCE_TTL_MS` is dropped. Nothing about it depends on a socket being observably dead, which
 * is exactly the property the proxy took away.
 *
 * The TTL is two and a half times the beacon interval, so one dropped request never blinks a
 * dot, and a closed tab still clears in about half a minute rather than in the five that socket
 * liveness would have taken.
 */
export const PRESENCE_TTL_MS = 30_000
export const PRESENCE_BEACON_MS = 12_000

/** Beacon ids one room will track. Above any real conversation, below "a slot for every visitor". */
export const MAX_PRESENT_PER_ROOM = 8

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

export type SignalRefusal = 'bad-room-id' | 'no-room' | 'rate-limited'

interface Room {
  readonly subscribers: Set<RoomSubscriber>
  /** Ciphertext only, oldest first, capped at ROOM_HISTORY. */
  readonly history: string[]
  /** Publish timestamps inside the current minute, for the rate limit. */
  publishes: number[]
  /** Signal timestamps inside the current minute. Separate bucket: a ping must not spend a send. */
  signals: number[]
  /**
   * Beacon id → when it last asserted itself. NOT an identity and not computable here: the id is a
   * tag the client derives from the room's shared secret, which this host does not hold. It is
   * stable for one party in one room, which is the whole point — it is what makes the count "how
   * many of the two of them are here" rather than "how many connections happen to exist".
   */
  readonly present: Map<string, number>
  lastSeen: number
}

/**
 * The two frames this host writes ITSELF, as opposed to the ciphertext it forwards.
 *
 * ── WHAT THEY ARE AND WHY THEY ARE NOT A NEW DISCLOSURE ──────────────────────────────────
 *
 * `presence` says how many unexpired beacons a room holds. This host has always known who is
 * connected to what — the file header says so in its first paragraph, and `stats()` has always
 * counted it. Sending the number back to the two people it is about tells the RELAYER nothing
 * new; it only stops the relayer being the only party that knows. `typing` is a fan-out of a ping
 * one client sent, and this host already sees the timing of every message in the room.
 *
 * ── WHY THEY ARE NEVER BUFFERED ──────────────────────────────────────────────────────────
 *
 * Both are true only at the instant they are written. A replayed presence count is a lie about
 * now, and a replayed typing ping is a person who stopped typing half an hour ago. So `signal`
 * fans out and forgets, and neither frame ever enters `history` — which also means neither one
 * changes what `ROOM_HISTORY` and `ROOM_IDLE_MS` claim on the privacy page.
 *
 * They are STRUCTURALLY distinguishable from an envelope: an envelope carries `v:1` and never a
 * `t`, so a client written before these existed sees a frame that fails `isRoomEnvelope` and
 * ignores it. That is why the discriminator is a new field rather than a new `v`.
 */
function presenceFrame(roomId: string, count: number): string {
  return JSON.stringify({ t: 'presence', room: roomId, count })
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
      room = { subscribers: new Set(), history: [], publishes: [], signals: [], present: new Map(), lastSeen: this.now() }
      this.rooms.set(roomId, room)
    }
    if (room.subscribers.size >= MAX_SUBSCRIBERS_PER_ROOM) return { ok: false, reason: 'room-full' }

    room.subscribers.add(subscriber)
    room.lastSeen = this.now()
    const history = [...room.history]
    // NO presence announcement here. Attaching is not the claim — the beacon is (`here`), and the
    // client sends its first one the moment this stream opens. Announcing on attach would count a
    // socket, which is the thing measured to be unreliable through the proxy.

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
        // Presence is likewise left alone: it expires on its own clock, which is the point of it.
      },
    }
  }

  /** Tell a room its current beacon count. Called only when that count has actually changed. */
  private announce(roomId: string, room: Room): void {
    if (room.subscribers.size === 0) return
    const frame = presenceFrame(roomId, room.present.size)
    for (const subscriber of room.subscribers) {
      try {
        subscriber.deliver(frame)
      } catch {
        room.subscribers.delete(subscriber)
      }
    }
  }

  /**
   * "I still have this conversation open." Refreshes one beacon and announces if the count moved.
   *
   * Re-registering an id it already holds is a REFRESH, not a second presence — that idempotence
   * is what a second tab and a five-minute reconnect both rely on, and getting it wrong is what
   * made every peer read as online at once.
   *
   * Like `signal`, it will not create a room: a beacon is a claim about a conversation somebody is
   * already streaming, and letting one open a room would hand an unauthenticated caller the room
   * table. It also leaves `lastSeen` alone, so a tab left open cannot extend how long this host
   * retains ciphertext — that window is a published number and only real traffic moves it.
   */
  here(roomId: string, clientId: string): { ok: true; present: number } | { ok: false; reason: SignalRefusal } {
    if (!ROOM_ID_PATTERN.test(roomId)) return { ok: false, reason: 'bad-room-id' }
    const room = this.rooms.get(roomId)
    if (room === undefined) return { ok: false, reason: 'no-room' }

    const at = this.now()
    const before = room.present.size
    this.expire(room, at)
    if (!room.present.has(clientId) && room.present.size >= MAX_PRESENT_PER_ROOM) {
      // The room is full of live beacons. Refuse rather than evict: evicting would let a flood
      // take a real participant's dot away, which is worse than a newcomer having none.
      return { ok: false, reason: 'rate-limited' }
    }
    room.present.set(clientId, at)
    if (room.present.size !== before) this.announce(roomId, room)
    return { ok: true, present: room.present.size }
  }

  /** Drop beacons past their TTL from one room. Returns whether the count changed. */
  private expire(room: Room, at: number): boolean {
    let dropped = false
    for (const [id, seen] of room.present) {
      if (at - seen <= PRESENCE_TTL_MS) continue
      room.present.delete(id)
      dropped = true
    }
    return dropped
  }

  /**
   * Expire stale beacons everywhere and tell the rooms that changed.
   *
   * This is what makes a departure visible AT ALL. Nothing else can: the only other candidate was
   * a dead socket, and the proxy in front of this host makes a dead socket unobservable for
   * minutes. Driven by an interval in `server.ts` rather than by traffic, because the moment a
   * dot should go out is precisely a moment when no traffic is arriving.
   */
  sweepPresence(): number {
    const at = this.now()
    let changed = 0
    for (const [id, room] of this.rooms) {
      if (!this.expire(room, at)) continue
      changed += 1
      this.announce(id, room)
    }
    return changed
  }

  /**
   * Fan an ephemeral frame out to a room that ALREADY EXISTS. No history, no room creation.
   *
   * Both halves of that sentence are refusals. Buffering would replay a "typing" from half an hour
   * ago; creating a room would let a caller with no socket grow this host's room table one ping at
   * a time, which is the exact resource `MAX_ROOMS` exists to bound. It also deliberately leaves
   * `lastSeen` alone: that clock governs how long ciphertext is retained, and a keystroke must not
   * be able to extend a retention window the privacy page states as a number.
   */
  signal(roomId: string, payload: string): { ok: true; delivered: number } | { ok: false; reason: SignalRefusal } {
    if (!ROOM_ID_PATTERN.test(roomId)) return { ok: false, reason: 'bad-room-id' }
    const room = this.rooms.get(roomId)
    if (room === undefined) return { ok: false, reason: 'no-room' }

    const at = this.now()
    room.signals = room.signals.filter((t) => at - t < 60_000)
    if (room.signals.length >= MAX_SIGNALS_PER_MINUTE) return { ok: false, reason: 'rate-limited' }
    room.signals.push(at)

    let delivered = 0
    for (const subscriber of room.subscribers) {
      try {
        subscriber.deliver(payload)
        delivered += 1
      } catch {
        room.subscribers.delete(subscriber)
      }
    }
    return { ok: true, delivered }
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
      room = { subscribers: new Set(), history: [], publishes: [], signals: [], present: new Map(), lastSeen: at }
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
