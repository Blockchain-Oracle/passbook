import { useEffect, useRef } from 'react'

const HEX = '0123456789abcdef'

/**
 * The key being made: hex digits rain in from the edges and are pulled into the centre of the
 * stage, where the mark sits. Purely decorative; the real entropy comes from `crypto` and is never
 * drawn here.
 */
export function StageBits({ active, color }: { active: boolean; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !active) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = w * dpr
    canvas.height = h * dpr
    ctx.scale(dpr, dpr)
    ctx.font = '13px "Space Mono", ui-monospace, monospace'

    type Bit = { x: number; y: number; vx: number; vy: number; ch: string; life: number }
    const bits: Bit[] = []
    const cx = w / 2
    const cy = h / 2
    const spawn = (): Bit => {
      const edge = Math.random() * 2 * Math.PI
      const r = Math.max(w, h) * 0.6
      const x = cx + Math.cos(edge) * r
      const y = cy + Math.sin(edge) * r
      return { x, y, vx: (cx - x) / 60, vy: (cy - y) / 60, ch: HEX[Math.floor(Math.random() * 16)]!, life: 1 }
    }

    let frame = 0
    let raf = 0
    const tick = () => {
      frame += 1
      if (frame % 2 === 0 && bits.length < 140) bits.push(spawn())
      ctx.clearRect(0, 0, w, h)
      for (let i = bits.length - 1; i >= 0; i -= 1) {
        const b = bits[i]!
        b.x += b.vx
        b.y += b.vy
        b.life -= 0.012
        if (frame % 6 === 0) b.ch = HEX[Math.floor(Math.random() * 16)]!
        const d = Math.hypot(b.x - cx, b.y - cy)
        if (b.life <= 0 || d < 24) {
          bits.splice(i, 1)
          continue
        }
        ctx.globalAlpha = Math.min(1, b.life) * 0.9
        ctx.fillStyle = color
        ctx.fillText(b.ch, b.x, b.y)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      ctx.clearRect(0, 0, w, h)
    }
  }, [active, color])

  return <canvas ref={ref} aria-hidden className="pointer-events-none absolute inset-0 size-full" />
}
