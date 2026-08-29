// Helpers every route module shares: visitor hashing, JSON answers and body reading with the
// old 400 shape, a capped upstream reader, and the SSE framing (POST + heartbeat + cleanup).
import type { Context } from 'hono'
import { streamSSE, type SSEStreamingApi } from 'hono/streaming'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

import type { AppEnv } from '../context.js'
import { visitorId } from '../sponsorship.js'

export type Ctx = Context<AppEnv>

/** Heartbeat comment cadence — well under the 60 s idle timeout of common middleboxes. */
export const HEARTBEAT_MS = 20_000

/** One JSON answer with any status the spec names; the cast keeps Hono's status typing honest. */
export function reply(c: Ctx, status: number, body: unknown): Response {
  return c.json(body as Record<string, unknown>, status as ContentfulStatusCode)
}

export function jsonError(c: Ctx, status: number, error: string, extra: Record<string, unknown> = {}): Response {
  return reply(c, status, { error, ...extra })
}

/** Every route answers this when its feature is absent from the context. */
export function notFound(c: Ctx): Response {
  return jsonError(c, 404, 'not found')
}

/** The opaque, day-scoped id a visitor is metered under. Socket IP, never x-forwarded-for. */
export function visitorOf(c: Ctx, salt: string, now = Date.now()): string {
  return visitorId(c.var.clientIp, salt, now)
}

export type JsonBody = { ok: true; value: unknown } | { ok: false; res: Response }

/** Parse the JSON body; a parse failure answers 400 `{error}` the way the old server did. */
export async function readJson(c: Ctx): Promise<JsonBody> {
  try {
    return { ok: true, value: await c.req.json() }
  } catch (e) {
    return { ok: false, res: jsonError(c, 400, String(e)) }
  }
}

/** Read the body only to discard it — read routes accept `{}` and tolerate none at all. */
export async function discardJson(c: Ctx): Promise<void> {
  try {
    await c.req.json()
  } catch {
    // A bare POST is fine for a read.
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read an upstream body under a hard cap, enforced while streaming — never after. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, cap: number): Promise<string> {
  if (!body) return ''
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > cap) {
      await reader.cancel()
      throw new Error(`upstream response exceeded ${cap} bytes`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** What a hub hands frames to. `deliver` throws once the socket is gone — the hub's drop signal. */
export interface SseSubscriber {
  deliver(payload: string): void
  end(): void
}

/**
 * A subscriber a hub can attach BEFORE the response starts (so a refusal still answers JSON).
 * Deliveries queue until `open` binds the stream, then replay in order — history first, live after.
 */
export function createSseSubscriber(): SseSubscriber & { open(c: Ctx, cleanup: () => void): Response } {
  let stream: SSEStreamingApi | null = null
  let finish: (() => void) | null = null
  const pending: string[] = []

  const write = (payload: string) => {
    // Hono's write swallows socket errors, so the closed flags carry the drop signal.
    if (!stream || stream.aborted || stream.closed) throw new Error('stream closed')
    void stream.write(`data: ${payload}\n\n`)
  }

  return {
    deliver(payload) {
      if (stream) write(payload)
      else pending.push(payload)
    },
    end() {
      finish?.()
    },
    open(c, cleanup) {
      const res = streamSSE(c, async (s) => {
        stream = s
        for (const payload of pending.splice(0)) write(payload)
        const heartbeat = setInterval(() => void s.write(': hb\n\n'), HEARTBEAT_MS)
        heartbeat.unref()
        // Held open until the client goes away or a hub ends it; either way cleanup runs once.
        await new Promise<void>((resolve) => {
          finish = resolve
          s.onAbort(resolve)
        })
        clearInterval(heartbeat)
        cleanup()
      })
      // streamSSE fixes `no-cache`; the spec's framing is `no-store` plus the nginx unbuffer flag.
      res.headers.set('cache-control', 'no-store')
      res.headers.set('x-accel-buffering', 'no')
      return res
    },
  }
}
