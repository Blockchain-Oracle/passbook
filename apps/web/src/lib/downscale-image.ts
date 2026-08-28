//
// A picked file into a logo-sized data URI — `NameClaim.tsx`'s canvas ramp, at logo scale.
//
// 256px is the ceiling because nothing renders a token mark larger than 48 CSS pixels (96
// device pixels on retina, with headroom), and the relayer refuses uploads past its own byte cap
// anyway — this keeps an honest phone photo from being refused for being a photo. WebP first,
// then JPEG down a quality ramp, until it fits.
//
const LOGO_EDGE = 256
const BYTE_CAP = 240_000
const RAMP: Array<{ type: string; quality: number }> = [
  { type: 'image/webp', quality: 0.85 },
  { type: 'image/webp', quality: 0.6 },
  { type: 'image/jpeg', quality: 0.8 },
  { type: 'image/jpeg', quality: 0.5 },
]

export async function downscaleToLogo(file: File): Promise<{ ok: true; dataUri: string } | { ok: false; because: string }> {
  if (!/^image\//.test(file.type)) return { ok: false, because: 'That is not an image file.' }

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    return { ok: false, because: 'The image could not be read.' }
  }

  const scale = Math.min(1, LOGO_EDGE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) return { ok: false, because: 'This browser could not draw the image.' }
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()

  for (const step of RAMP) {
    const dataUri = canvas.toDataURL(step.type, step.quality)
    // A browser without webp support answers with a png data URI — detected by prefix, not trusted.
    if (!dataUri.startsWith(`data:${step.type}`)) continue
    if (dataUri.length <= BYTE_CAP) return { ok: true, dataUri }
  }
  // The last resort: whatever PNG comes out, if it fits.
  const png = canvas.toDataURL('image/png')
  if (png.length <= BYTE_CAP) return { ok: true, dataUri: png }
  return { ok: false, because: 'The image would not compress to logo size — try a simpler one.' }
}
