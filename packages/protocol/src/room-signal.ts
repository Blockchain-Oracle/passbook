//
// The two frames on the room socket that are NOT a message.
//
// ── WHY THEY EXIST ───────────────────────────────────────────────────────────────────────
//
// A chat surface that can only render what somebody typed cannot answer the two questions people
// ask of one constantly — is anyone there, and are they replying. Both answers are already
// visible to the relayer (it knows who is connected to what, and it sees the timing of every
// send), so putting them on the wire tells that host nothing it did not have. What it changes is
// who else knows.
//
// ── WHY THEY ARE NEVER STORED, AND NEVER A MESSAGE ───────────────────────────────────────
//
// Neither frame goes through `sealMessage`, so neither is ciphertext, and neither is authenticated
// — a `typing` frame is a hint a liar could forge, and the worst forgery available is a dot that
// says somebody is typing when they are not. That is why nothing here may ever carry content.
// The moment one of these frames means something a reader would act on, it needs the GCM tag
// `room.ts` gives real messages, and this file stops being the right place for it.
//
// They are also never written to the log: presence and typing are true at an instant, and a chat
// history full of "was typing" is a history of nothing. Both expire on their own short clocks and
// leave nothing behind.
//

/**
 * The relayer's count of live presence beacons in a room — OURS INCLUDED. See `othersFrom` below.
 *
 * Not a count of sockets. The relayer cannot trust socket liveness behind a serverless proxy, so
 * clients assert presence on a repeating beacon and it expires — see the relayer's `rooms.ts`.
 */
export interface RoomPresenceFrame {
  readonly t: 'presence'
  readonly room: string
  readonly count: number
}

/** A peer's keystroke ping. `from` is the sender's public key hint, exactly as an envelope's is. */
export interface RoomTypingFrame {
  readonly t: 'typing'
  readonly room: string
  readonly from: string
}

export type RoomSignalFrame = RoomPresenceFrame | RoomTypingFrame

/**
 * How long a single ping keeps the indicator lit, in ms.
 *
 * Comfortably longer than `TYPING_PING_MS` so an uninterrupted typist never flickers, and short
 * enough that a peer who closes their laptop mid-word stops "typing" while you are still looking.
 */
export const TYPING_TTL_MS = 6_000

/** How often a composer with a live draft may ping. One ping per this window, never per keystroke. */
export const TYPING_PING_MS = 2_500

/**
 * How often an open stream re-asserts that it is still there, in ms.
 *
 * Must stay comfortably under the relayer's `PRESENCE_TTL_MS` (30s) — the relayer expires a
 * beacon it has not heard from, so a client that beacons too slowly puts its own dot out. The
 * two constants live apart because they belong to different processes; the relationship between
 * them is the thing to preserve, not the numbers.
 *
 * A beacon exists at all because socket liveness is not observable through a serverless proxy —
 * see the long note in the relayer's `rooms.ts`.
 */
export const PRESENCE_BEACON_MS = 12_000

function frame(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

export function isPresenceFrame(value: unknown): value is RoomPresenceFrame {
  const f = frame(value)
  return f?.t === 'presence' && typeof f.room === 'string' && typeof f.count === 'number' && Number.isFinite(f.count)
}

export function isTypingFrame(value: unknown): value is RoomTypingFrame {
  const f = frame(value)
  return f?.t === 'typing' && typeof f.room === 'string' && typeof f.from === 'string'
}

/**
 * Beacons on the room that are not ours.
 *
 * The relayer cannot subtract this itself — it has no idea which of the beacons it is counting
 * belongs to the asker. We do: exactly one of them is this stream's own.
 *
 * IT IS A COUNT OF CONNECTIONS AND NOT A COUNT OF PEOPLE, and the copy that renders it must not
 * promise otherwise. Your own second tab is somebody else as far as this number knows.
 */
export function othersFrom(count: number): number {
  return Math.max(0, Math.trunc(count) - 1)
}
