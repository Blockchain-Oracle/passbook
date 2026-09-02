import { Maximize2 } from 'lucide-react'
import { ImageZoom } from 'fumadocs-ui/components/image-zoom'

interface GuideShotProps {
  src: string
  alt: string
  caption: string
  width?: number
  height?: number
  eager?: boolean
}

/** A real product capture, annotated in SVG and opened with Fumadocs' native image zoom. */
export function GuideShot({ src, alt, caption, width = 1280, height = 720, eager = false }: GuideShotProps) {
  return (
    <figure className="not-prose my-7 overflow-hidden rounded-card border border-surface3 bg-raised">
      <ImageZoom
        src={src}
        alt={alt}
        width={width}
        height={height}
        loading={eager ? 'eager' : 'lazy'}
        className="block h-auto w-full"
        zoomInProps={{ alt }}
      />
      <figcaption className="flex items-start gap-2 border-t border-surface3 px-4 py-3 text-body4 text-neutral2">
        <Maximize2 className="mt-0.5 size-3.5 shrink-0 text-accent1" aria-hidden />
        <span>{caption} Click the image to expand it.</span>
      </figcaption>
    </figure>
  )
}
