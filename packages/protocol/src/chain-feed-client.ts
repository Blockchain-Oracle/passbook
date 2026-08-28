//
// The browser half of the chain feed: hold the stream open, hand frames up, reconnect forever.
//
// A deliberate sibling of `room-transport.ts`'s `openRoomStream`, not a refactor of it. The two
// loops share a shape — POST, SSE framing, backoff ramp — but not a contract: rooms dedupe on an
// envelope nonce and validate a sealed shape, this one validates `isFeedFrame` and needs no dedupe
// because every frame is state, not a message (applying a `markets` frame twice is applying it
// once). Merging them would couple the chat bus's wire to the feed's, and they must be free to
// move apart.
//
import { isFeedFrame, chainStreamEndpoint, type FeedFrame } from './chain-feed-wire.js'
import { DEFAULT_RELAYER_URL } from './register.js'

/** Same ramp as the chat stream, same argument: a feed that reconnects slowly is down. */
const RECONNECT_BACKOFF_MS = [500, 1_000, 2_000, 5_000, 10_000] as const

export type ChainFeedState = 'connecting' | 'live' | 'retrying'

export interface ChainFeedHandle {
  /** Stop reading and stop reconnecting. Idempotent. */
  close(): void
}

export interface ChainFeedInput {
  /** Called for each frame, in arrival order. The hello arrives first on every (re)connect. */
  onFrame: (frame: FeedFrame) => void
  /** Called on every state change, so a surface can say "live" honestly. */
  onState?: (state: ChainFeedState) => void
  fetch?: typeof fetch
  relayerUrl?: string
}

export function openChainFeed(input: ChainFeedInput): ChainFeedHandle {
  const fetchImpl = input.fetch ?? fetch
  const url = chainStreamEndpoint(input.relayerUrl ?? DEFAULT_RELAYER_URL)

  let closed = false
  let attempt = 0
  let controller: AbortController | null = null

  const announce = (state: ChainFeedState) => {
    if (!closed) input.onState?.(state)
  }

  const deliver = (payload: string) => {
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch {
      return
    }
    if (!isFeedFrame(parsed)) return
    try {
      input.onFrame(parsed)
    } catch {
      // A store that throws on one frame must not kill the socket carrying the next one.
    }
  }

  const run = async () => {
    while (!closed) {
      announce(attempt === 0 ? 'connecting' : 'retrying')
      controller = new AbortController()
      try {
        // The body is an empty JSON object: the feed has one channel and nothing to select. It is
        // still a POST with a content-type for the relayer's CSRF gate — see ROOM_STREAM_PATHS.
        const response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}',
          signal: controller.signal,
        })
        if (!response.ok || response.body === null) {
          throw new Error(`feed refused: HTTP ${response.status}`)
        }

        announce('live')
        attempt = 0

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          // Frame boundaries fall anywhere in a chunk; the tail past the last separator is a
          // partial frame kept for the next read — `room-transport.ts`'s rule, same reason.
          const frames = buffer.split('\n\n')
          buffer = frames.pop() ?? ''
          for (const frame of frames) {
            if (frame.startsWith('data: ')) deliver(frame.slice('data: '.length))
          }
        }
      } catch {
        // Every failure is the same failure: the socket is not carrying frames.
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
