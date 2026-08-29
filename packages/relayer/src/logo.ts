//
// The logo studio: a token's picture, made or brought, pinned where the chain can point at it.
//
// TWO UPSTREAMS, BOTH KEYED, BOTH SERVER-SIDE — the first real use of the proxy discipline's
// `injectsCredential` arm (D-35a). The browser never holds the Pinata JWT or the Gemini key; it
// posts a picture (or a name) to its own origin, and THIS process talks to the world. What each
// upstream learns is the relay's address and the content itself — never the visitor's IP, which
// is the whole argument for the hop.
//
// NO KEY, NO ROUTE. A relayer without `RELAYER_PINATA_JWT` serves no `/logo/pin`; without
// `RELAYER_GEMINI_KEY`, no `/logo/generate` — the faucet's rule (404, nothing to retry), so the
// create form degrades to the seeded disc honestly instead of offering a button that 500s.
//
// EVERY LIMIT IS A REFUSAL: an upload cap (this is a logo, not a poster), per-visitor and global
// daily meters on both routes (generation is somebody's money; pinning is somebody's storage),
// upstream timeouts, and response caps read while receiving — `readCapped`'s argument.
//
import type { IncomingMessage, ServerResponse } from 'node:http'

/** The uploads endpoint, v3 — the current shape (Context7, 28 Aug 2026): multipart + Bearer JWT. */
const PINATA_UPLOADS_URL = 'https://uploads.pinata.cloud/v3/files'

/**
 * Gemini through its OpenAI-compatibility images endpoint — one POST, `n` candidates back as
 * base64, no SDK. The model rides env so a better image model is a config change, not a deploy.
 */
const GEMINI_IMAGES_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/images/generations'
export const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image'

/** A logo, not a poster: ~256KB of image is generous at the 96–512px sizes anything renders. */
export const MAX_LOGO_BYTES = 262_144

/** Candidates per generation. Two is a choice; four is a bill. */
export const GENERATED_CANDIDATES = 2

const UPSTREAM_TIMEOUT_MS = 30_000
const MAX_UPSTREAM_RESPONSE_BYTES = 8 * 1024 * 1024

const DATA_URI_PATTERN = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/

export interface LogoCounterLike {
  tryConsume(visitor: string, now: number): boolean
}

export interface LogoService {
  /** Present iff `RELAYER_PINATA_JWT` is set. */
  readonly pinataJwt?: string
  /** Present iff `RELAYER_GEMINI_KEY` is set. */
  readonly geminiKey?: string
  readonly imageModel?: string
  /** Meters, one per route — generation spends money, pinning spends storage. */
  readonly pinCounter: LogoCounterLike
  readonly generateCounter: LogoCounterLike
  /** Injected so tests never touch the network. */
  readonly fetchUpstream?: typeof fetch
  readonly now?: () => number
}

type Send = (res: ServerResponse, status: number, body: unknown) => void

/** Decode and bound an incoming logo data URI, or say exactly why not. */
export function parseLogoDataUri(
  value: unknown,
): { ok: true; bytes: Buffer; mime: string } | { ok: false; because: string } {
  if (typeof value !== 'string') return { ok: false, because: 'image must be a data URI string' }
  const match = DATA_URI_PATTERN.exec(value)
  if (!match) {
    return { ok: false, because: 'image must be a base64 data URI of type png, jpeg or webp' }
  }
  let bytes: Buffer
  try {
    bytes = Buffer.from(match[2]!, 'base64')
  } catch {
    return { ok: false, because: 'the base64 payload did not decode' }
  }
  if (bytes.length === 0) return { ok: false, because: 'the image is empty' }
  if (bytes.length > MAX_LOGO_BYTES) {
    return { ok: false, because: `the image is ${bytes.length} bytes; a logo is at most ${MAX_LOGO_BYTES}` }
  }
  return { ok: true, bytes, mime: `image/${match[1]!}` }
}

/**
 * The generation prompt, built HERE and not in the browser, so what we spend money on is our
 * sentence with the user's words inside it — bounded, control-characters stripped — rather than
 * an arbitrary instruction to an image model billed to this key.
 */
export function logoPrompt(name: string, symbol: string, brief: string): string {
  const clean = (s: string, cap: number) => s.replace(/[\p{Cc}\p{Cf}]/gu, ' ').trim().slice(0, cap)
  const n = clean(name, 48)
  const s = clean(symbol, 12)
  const b = clean(brief, 160)
  return (
    `A minimal, iconic token logo for a cryptocurrency named "${n}" (ticker ${s}). ` +
    `Flat vector style, bold simple geometry, one strong silhouette, centered on a solid ` +
    `background, no text, no letters, no watermark. High contrast, works at 40 pixels.` +
    (b ? ` Creator's note: ${b}.` : '')
  )
}

/** `POST /api/logo/pin` — one picture in, one `ipfs://CID` out. */
export async function handleLogoPin(
  req: IncomingMessage,
  res: ServerResponse,
  service: LogoService,
  visitor: string,
  body: unknown,
  send: Send,
): Promise<void> {
  const parsed = parseLogoDataUri((body as { image?: unknown } | null)?.image)
  if (!parsed.ok) {
    send(res, 400, { error: parsed.because })
    return
  }
  // Charged BEFORE the upstream call — the budget-gate ordering rule: recording after the await
  // window is how a cap of fifty pins five hundred.
  if (!service.pinCounter.tryConsume(visitor, (service.now ?? Date.now)())) {
    send(res, 429, { error: 'the pinning cap for today is spent — try again after 00:00 UTC' })
    return
  }

  const fetchImpl = service.fetchUpstream ?? fetch
  const form = new FormData()
  form.append('file', new File([new Uint8Array(parsed.bytes)], 'logo', { type: parsed.mime }))
  form.append('network', 'public')

  let upstream: Response
  try {
    upstream = await fetchImpl(PINATA_UPLOADS_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${service.pinataJwt}` },
      body: form,
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (e) {
    send(res, 502, { error: `the pinning service did not answer: ${String(e)}` })
    return
  }
  // Bounded like the generate path: an upstream that streams forever must not hold this process.
  const text = await readBounded(upstream, MAX_UPSTREAM_RESPONSE_BYTES).catch(() => '')
  if (!upstream.ok) {
    // The status is ours to relay; the body is not — an upstream error page is not our JSON.
    send(res, 502, { error: `the pinning service answered ${upstream.status}` })
    return
  }
  let cid: string | null = null
  try {
    const answer = JSON.parse(text) as { data?: { cid?: unknown } }
    if (typeof answer.data?.cid === 'string' && answer.data.cid.length > 0) cid = answer.data.cid
  } catch {
    // Fall through to the refusal below.
  }
  if (!cid) {
    send(res, 502, { error: 'the pinning service answered without a CID' })
    return
  }
  send(res, 200, { cid, uri: `ipfs://${cid}` })
}

/** `POST /api/logo/generate` — a name in, candidate logos out, previewed before anything pins. */
export async function handleLogoGenerate(
  req: IncomingMessage,
  res: ServerResponse,
  service: LogoService,
  visitor: string,
  body: unknown,
  send: Send,
): Promise<void> {
  const input = (body ?? {}) as { name?: unknown; symbol?: unknown; brief?: unknown }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const symbol = typeof input.symbol === 'string' ? input.symbol.trim() : ''
  const brief = typeof input.brief === 'string' ? input.brief : ''
  if (name === '' || symbol === '') {
    send(res, 400, { error: 'name and symbol are required — the prompt is built from them' })
    return
  }
  if (!service.generateCounter.tryConsume(visitor, (service.now ?? Date.now)())) {
    send(res, 429, { error: 'the generation cap for today is spent — try again after 00:00 UTC' })
    return
  }

  const fetchImpl = service.fetchUpstream ?? fetch
  let upstream: Response
  try {
    upstream = await fetchImpl(GEMINI_IMAGES_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${service.geminiKey}`,
      },
      body: JSON.stringify({
        model: service.imageModel ?? DEFAULT_IMAGE_MODEL,
        prompt: logoPrompt(name, symbol, brief),
        response_format: 'b64_json',
        n: GENERATED_CANDIDATES,
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
  } catch (e) {
    send(res, 502, { error: `the image service did not answer: ${String(e)}` })
    return
  }

  let text: string
  try {
    text = await readBounded(upstream, MAX_UPSTREAM_RESPONSE_BYTES)
  } catch (e) {
    send(res, 502, { error: String(e) })
    return
  }
  if (!upstream.ok) {
    send(res, 502, { error: `the image service answered ${upstream.status}` })
    return
  }

  const images: string[] = []
  try {
    const answer = JSON.parse(text) as { data?: Array<{ b64_json?: unknown }> }
    for (const item of answer.data ?? []) {
      if (typeof item.b64_json === 'string' && item.b64_json.length > 0) {
        images.push(`data:image/png;base64,${item.b64_json}`)
      }
    }
  } catch {
    // Fall through.
  }
  if (images.length === 0) {
    send(res, 502, { error: 'the image service answered without an image' })
    return
  }
  send(res, 200, { images })
}

/** `readCapped`'s rule, locally: never buffer whatever an upstream chooses to send. */
async function readBounded(response: Response, cap: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.length
    if (size > cap) {
      await reader.cancel()
      throw new Error(`the image service's response exceeded ${cap} bytes`)
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}
