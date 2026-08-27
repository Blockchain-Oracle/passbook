//
// The client half of the chat bus: post one envelope, and hold a stream open for the rest.
//
// EVERYTHING THAT MATTERS ABOUT THIS FILE IS WHAT IT DOES NOT DO. It carries ciphertext to and
// from a host that cannot read it (`relayer/src/rooms.ts`), so it has no key, no plaintext, and
// no opinion about what a message means. `room.ts` seals before this and opens after it; the two
// touch only through the opaque envelope. That separation is what makes "the relayer sees
// ciphertext and a room label" checkable rather than a claim about intent.
//
// THE TRANSPORT IS ASSUMED HOSTILE, and the reconnect logic is written that way. It can drop a
// message, deliver one twice, deliver one late, or inject one wholesale. Three of those are
// handled here — replay by the seen-set below, lateness by ordering on arrival, injection by
// `openMessage`'s authentication tag, which rejects anything not sealed under the room key. The
// fourth, dropping, cannot be detected by a receiver and is not pretended away: a message that
// does not arrive is a message that does not arrive.
//
import { isRoomEnvelope, type RoomEnvelope } from './room.js'
import { DEFAULT_RELAYER_URL } from './register.js'

/** How long a `send` may take before it is a failure. Small JSON on the app's own origin. */
export const ROOM_SEND_TIMEOUT_MS = 10_000

/** The reconnect ramp, in milliseconds. Fixed and short — a chat that reconnects slowly is down. */
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000] as const

/**
 * How many recent envelopes are remembered for de-duplication.
 *
 * Every reconnect replays the room's backlog, so without this a flaky network renders the same
 * message once per drop. Keyed on the nonce, which is fresh CSPRNG bytes per message and
 * therefore the one field guaranteed unique — a hash of the ciphertext would also work but is
 * strictly more work for the same answer.
 *
 * Bounded so a long session cannot grow it without limit, and set above the relayer's own history
 * (50) so a full replay never overflows the window that is supposed to suppress it.
 */
const SEEN_LIMIT = 200

/** The two endpoints, derived from the relayer URL the app already has — same rule as invites. */
export function roomEndpoint(relayerUrl: string, leaf: 'send' | 'stream'): string {
  const url = relayerUrl.replace(/\/submit$/, `/room/${leaf}`)
  // A relayer URL that is not a `/submit` endpoint leaves the replace a no-op, which would post a
  // room body at the submit path — where the allowlist would refuse it, confusingly, as an
  // unsignable transaction. Refuse rather than improvise.
  if (url === relayerUrl) {
    throw new Error(
      `cannot derive a room endpoint from ${JSON.stringify(relayerUrl)}: it does not end in /submit`,
    )
  }
  return url
}

export interface RoomTransportDeps {
  fetch?: typeof fetch
  relayerUrl?: string
  timeoutMs?: number
}

export type RoomSendFailure =
  /** Nothing answered: offline, a dead host, a timeout. Retrying may work. */
  | { kind: 'unreachable'; reason: string }
  /** The relayer refused, and said why. Its reasons are `rooms.ts`'s refusal names. */
  | { kind: 'refused'; status: number; reason: string }

export type RoomSendResult =
  | { ok: true; delivered: number }
  | { ok: false; failure: RoomSendFailure }

/**
 * Hand one sealed envelope to the bus.
 *
 * A `delivered: 0` IS A SUCCESS and callers must render it as one. It means nobody had a socket
 * open on the room at that instant — the ordinary shape of the other person's tab being shut —
 * and the envelope is sitting in the relayer's buffer for when they come back. Treating it as a
 * failure would mean showing "not sent" for the most common case in an asynchronous conversation.
 */
export async function sendEnvelope(
  room: string,
  envelope: RoomEnvelope,
  deps: RoomTransportDeps = {},
): Promise<RoomSendResult> {
  const fetchImpl = deps.fetch ?? fetch
  const url = roomEndpoint(deps.relayerUrl ?? DEFAULT_RELAYER_URL, 'send')

  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room, envelope }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? ROOM_SEND_TIMEOUT_MS),
    })
  } catch (e) {
    return { ok: false, failure: { kind: 'unreachable', reason: String(e) } }
  }

  if (!response.ok) {
    // The body is the relayer's refusal name (`rate-limited`, `envelope-too-large`, …). Read it
    // if it is there and fall back to the status, because a proxy in the middle can answer with
    // something that is not our JSON at all.
    let reason = `HTTP ${response.status}`
    try {
      const body = (await response.json()) as { error?: unknown }
      if (typeof body?.error === 'string') reason = body.error
    } catch {
      // Not our JSON. The status is what we have.
    }
    return { ok: false, failure: { kind: 'refused', status: response.status, reason } }
  }

  const body = (await response.json().catch(() => null)) as { delivered?: unknown } | null
  return { ok: true, delivered: typeof body?.delivered === 'number' ? body.delivered : 0 }
}

/** What a subscriber is told about the socket, so a surface can say so rather than look stuck. */
export type RoomStreamState = 'connecting' | 'live' | 'retrying'

export interface RoomStreamHandle {
  /** Stop reading and stop reconnecting. Idempotent. */
  close(): void
}

export interface RoomStreamInput {
  room: string
  /** Called for each envelope, in arrival order, after de-duplication. */
  onEnvelope: (envelope: RoomEnvelope) => void
  /** Called on every state change. A surface that ignores it will still receive messages. */
  onState?: (state: RoomStreamState) => void
  deps?: RoomTransportDeps
}

/**
 * Hold a stream open, and keep holding it.
 *
 * IT RECONNECTS FOREVER, ON PURPOSE. There is no attempt ceiling: a chat window left open across
 * a closed laptop, a train tunnel or a relayer redeploy should come back by itself, and a ceiling
 * would turn any of those into "reload the page to receive messages". The cost is bounded by the
 * backoff ramp, which tops out at ten seconds.
 */
export function openRoomStream(input: RoomStreamInput): RoomStreamHandle {
  const deps = input.deps ?? {}
  const fetchImpl = deps.fetch ?? fetch
  const url = roomEndpoint(deps.relayerUrl ?? DEFAULT_RELAYER_URL, 'stream')

  let closed = false
  let attempt = 0
  let controller: AbortController | null = null
  const seen = new Set<string>()

  const announce = (state: RoomStreamState) => {
    if (!closed) input.onState?.(state)
  }

  /** Remember a nonce, and forget the oldest once the window is full. */
  const isNew = (nonce: string): boolean => {
    if (seen.has(nonce)) return false
    seen.add(nonce)
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value as string)
    return true
  }

  const deliver = (payload: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      // The bus handed us something that is not JSON. There is no recovery and no user-facing
      // meaning; the connection is still good and the next frame may be fine.
      return
    }
    if (!isRoomEnvelope(parsed) || !isNew(parsed.iv)) return
    input.onEnvelope(parsed)
  }

  const run = async () => {
    while (!closed) {
      announce(attempt === 0 ? 'connecting' : 'retrying')
      controller = new AbortController()
      try {
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ room: input.room }),
          signal: controller.signal,
        })
        if (!response.ok || response.body === null) {
          throw new Error(`stream refused: HTTP ${response.status}`)
        }

        announce('live')
        attempt = 0

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        // eslint-disable-next-line no-constant-condition
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // SSE frames are separated by a blank line, and a chunk boundary can fall anywhere —
          // including mid-frame. Whatever is after the last separator is a partial frame and is
          // kept for the next read; splitting without keeping it silently eats messages under
          // exactly the conditions (slow link, big message) where they matter most.
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            // ':' is an SSE comment — our heartbeat. Its only job is to have arrived.
            if (frame.startsWith('data: ')) deliver(frame.slice('data: '.length))
          }
        }
      } catch {
        // Every failure is the same failure here: the socket is not carrying messages. Whether it
        // was a refusal, a timeout or a dropped connection changes nothing about what to do next.
      }
      if (closed) return
      const wait = RECONNECT_BACKOFF_MS[Math.min(attempt, RECONNECT_BACKOFF_MS.length - 1)]!
      attempt += 1
      announce('retrying')
      await new Promise((resolve) => setTimeout(resolve, wait))
    }
  }

  void run()

  return {
    close() {
      closed = true
      controller?.abort()
    },
  }
}
