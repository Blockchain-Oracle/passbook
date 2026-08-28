// The logo lane: a picked file shrunk to logo size in the browser, or candidates from the relayer's
// generator; either way pinned only at confirm. A 404 from a lane is CONFIGURATION, not failure —
// the relayer serves a lane only when it holds that lane's key.
import { useMutation } from '@tanstack/react-query'

import { RelayerError, relayerPost } from '@/lib/relayer'

const LOGO_EDGE = 256
/** Under the relayer's 256 KB cap with headroom for the data-URI framing. */
const BYTE_CAP = 240_000
const RAMP = [
  { type: 'image/webp', quality: 0.85 },
  { type: 'image/webp', quality: 0.6 },
  { type: 'image/jpeg', quality: 0.8 },
  { type: 'image/jpeg', quality: 0.5 },
] as const

export type Downscaled = { ok: true; dataUri: string } | { ok: false; because: string }

export async function downscaleToLogo(file: File): Promise<Downscaled> {
  if (!/^image\//.test(file.type)) return { ok: false, because: 'That is not an image file.' }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { ok: false, because: 'The image could not be read.' }
  }
  const scale = Math.min(1, LOGO_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) return { ok: false, because: 'This browser could not draw the image.' }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  for (const step of RAMP) {
    const dataUri = canvas.toDataURL(step.type, step.quality)
    // A browser without webp answers with a PNG data URI — detected by prefix, not trusted.
    if (!dataUri.startsWith(`data:${step.type}`)) continue
    if (dataUri.length <= BYTE_CAP) return { ok: true, dataUri }
  }
  const png = canvas.toDataURL('image/png')
  if (png.length <= BYTE_CAP) return { ok: true, dataUri: png }
  return { ok: false, because: 'The image would not compress to logo size — try a simpler one.' }
}

export type LogoLane<T> = { ok: true; value: T } | { ok: false; unconfigured: boolean; because: string }

async function lane<T>(path: string, body: unknown, read: (answer: unknown) => T | null): Promise<LogoLane<T>> {
  try {
    const answer = await relayerPost<unknown>(path, body, AbortSignal.timeout(45_000))
    const value = read(answer)
    return value === null ? { ok: false, unconfigured: false, because: 'The answer was not in the expected shape.' } : { ok: true, value }
  } catch (error) {
    if (error instanceof RelayerError && error.status === 404) {
      return { ok: false, unconfigured: true, because: 'This deployment does not offer it.' }
    }
    return { ok: false, unconfigured: false, because: error instanceof Error ? error.message : String(error) }
  }
}

/** Pin one picture; back comes the `ipfs://CID` that goes on chain. */
export function pinLogo(image: string): Promise<LogoLane<{ uri: string; cid: string }>> {
  return lane('/api/logo/pin', { image }, (answer) => {
    const a = answer as { uri?: unknown; cid?: unknown } | null
    return typeof a?.uri === 'string' && typeof a?.cid === 'string' ? { uri: a.uri, cid: a.cid } : null
  })
}

export function generateLogo(input: { name: string; symbol: string; brief?: string }): Promise<LogoLane<string[]>> {
  return lane('/api/logo/generate', input, (answer) => {
    const a = answer as { images?: unknown } | null
    return Array.isArray(a?.images) && a.images.length > 0 && a.images.every((i) => typeof i === 'string')
      ? (a.images as string[])
      : null
  })
}

export function useGenerateLogo() {
  return useMutation({ mutationKey: ['logo', 'generate'], mutationFn: generateLogo })
}

export function useDownscaleLogo() {
  return useMutation({ mutationKey: ['logo', 'downscale'], mutationFn: downscaleToLogo })
}
