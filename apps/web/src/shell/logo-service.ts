//
// The browser's door to the logo studio — two same-origin POSTs, each with an honest "off" arm.
//
// A 404 from either route is CONFIGURATION, not failure: the relayer serves a lane only when it
// holds that lane's key (`server.ts`, the no-key-no-route rule). The create form reads
// `unconfigured` and quietly does not offer the button, which is the difference between a
// degraded product and a broken one.
//
const JSON_HEADERS = { 'content-type': 'application/json' }

export type LogoServiceResult<T> =
  | ({ ok: true } & T)
  | { ok: false; unconfigured: boolean; because: string }

async function post<T>(path: string, body: unknown, read: (answer: unknown) => T | null): Promise<LogoServiceResult<T>> {
  let response: Response
  try {
    response = await fetch(path, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45_000),
    })
  } catch (e) {
    return { ok: false, unconfigured: false, because: `Nothing answered: ${String(e)}` }
  }
  const answer = (await response.json().catch(() => null)) as { error?: unknown } | null
  if (response.status === 404) {
    return { ok: false, unconfigured: true, because: 'This deployment does not offer it.' }
  }
  if (!response.ok) {
    return {
      ok: false,
      unconfigured: false,
      because: typeof answer?.error === 'string' ? answer.error : `HTTP ${response.status}`,
    }
  }
  const parsed = read(answer)
  if (parsed === null) {
    return { ok: false, unconfigured: false, because: 'The answer was not in the expected shape.' }
  }
  return { ok: true, ...parsed }
}

/** Pin one picture; back comes the `ipfs://CID` that goes on chain. */
export function pinLogo(imageDataUri: string): Promise<LogoServiceResult<{ uri: string; cid: string }>> {
  return post('/api/logo/pin', { image: imageDataUri }, (answer) => {
    const a = answer as { uri?: unknown; cid?: unknown } | null
    return typeof a?.uri === 'string' && typeof a?.cid === 'string' ? { uri: a.uri, cid: a.cid } : null
  })
}

/** Ask for candidate logos. The prompt is built server-side from exactly these fields. */
export function generateLogo(input: {
  name: string
  symbol: string
  brief?: string
}): Promise<LogoServiceResult<{ images: string[] }>> {
  return post('/api/logo/generate', input, (answer) => {
    const a = answer as { images?: unknown } | null
    return Array.isArray(a?.images) && a.images.every((i): i is string => typeof i === 'string') && a.images.length > 0
      ? { images: a.images }
      : null
  })
}
