// The relayer is reached same-origin at `/api/...`; in `vite dev` the proxy forwards it, in
// production the Vercel shim adds the auth header. The browser never holds the token.

export class RelayerError extends Error {
  readonly status: number
  readonly reason: string | undefined
  readonly notice: string | undefined
  /** The whole refusal body — a 409 carries the state the caller must merge with. */
  readonly body: Record<string, unknown>

  constructor(status: number, message: string, reason?: string, notice?: string, body: Record<string, unknown> = {}) {
    super(message)
    this.name = 'RelayerError'
    this.status = status
    this.reason = reason
    this.notice = notice
    this.body = body
  }
}

interface ErrorBody {
  error?: string
  reason?: string
  notice?: string
}

async function readError(res: Response): Promise<RelayerError> {
  let body: ErrorBody & Record<string, unknown> = {}
  try {
    body = (await res.json()) as ErrorBody & Record<string, unknown>
  } catch {
    // A non-JSON failure (a proxy 502, say) still has a status worth surfacing.
  }
  return new RelayerError(res.status, body.error ?? `relayer answered ${res.status}`, body.reason, body.notice, body)
}

/** POST JSON, expect JSON. Every relayer route except the fee recipient is shaped like this. */
export async function relayerPost<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) throw await readError(res)
  return (await res.json()) as T
}

export async function relayerGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, { signal })
  if (!res.ok) throw await readError(res)
  return (await res.json()) as T
}

/**
 * Server-sent events over a POST body. The relayer's streams are POST on purpose (so the auth
 * gate applies), which rules out `EventSource`; this reads `data:` frames off the response body.
 * Resolves when the server closes the stream; rejects on a non-2xx status or an aborted signal.
 */
export async function relayerStream<T>(
  path: string,
  body: unknown,
  onFrame: (frame: T) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok || !res.body) throw await readError(res)

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    let end = buffer.indexOf('\n\n')
    while (end !== -1) {
      const event = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data) onFrame(JSON.parse(data) as T)
      end = buffer.indexOf('\n\n')
    }
  }
}
