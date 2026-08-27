//
// The price chart, drawn on a canvas.
//
// Ported from `reference/yosuku/lib/charts/canvasChart.ts` — the drawing technique, not the file,
// and deliberately not a charting library. Recharts would be ~90 kB for one line with a threshold
// on it, and the one thing this chart does that a library will not is the verdict mode below.
//
// ── DPR-SAFE MEANS: BACKING STORE IN DEVICE PIXELS, DRAWING CODE IN CSS PIXELS ───────────
//
// Every coordinate the drawing functions compute is a CSS pixel and matches what the reader sees.
// Three details in `setup` are load-bearing and each is a real bug if dropped — see there.
//
// ── THE VERDICT MODE IS THE POINT ────────────────────────────────────────────────────────
//
// A market is "will the price be over or under X". So the chart answers that WITHOUT a legend: the
// whole thing is drawn twice, in two colours, each pass clipped to a half-plane split at the strike
// line. No crossing is ever computed — the rectangle clip does that arithmetic exactly, at any
// number of crossings, for free.
//

/** What `setup` hands back: a context, and the size in the units everything else works in. */
export interface Surface {
  ctx: CanvasRenderingContext2D
  /** CSS pixels. NEVER `canvas.width`, which is device pixels. */
  w: number
  h: number
}

/**
 * Size the backing store to the device and put the context in CSS-pixel space.
 *
 * THE DIMENSION GUARD IS MANDATORY. Assigning `canvas.width` clears the canvas AND resets the
 * transform even when the value is unchanged, so an unguarded version reallocates the buffer every
 * animation frame. It is the single most common DPR bug.
 *
 * `setTransform`, NOT `scale`. `scale` multiplies onto whatever is already there, so the second
 * frame would be at dpr². `setTransform` is absolute and therefore idempotent.
 *
 * And `Math.max(1, …)`: a canvas whose parent is `display:none` measures zero, and a zero-size
 * backing store produces an unusable context.
 */
export function setup(canvas: HTMLCanvasElement): Surface | null {
  const dpr = window.devicePixelRatio || 1
  const rect = canvas.getBoundingClientRect()
  const nextW = Math.max(1, Math.round(rect.width * dpr))
  const nextH = Math.max(1, Math.round(rect.height * dpr))

  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW
    canvas.height = nextH
  }

  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  // CSS pixels out, so `clearRect(0, 0, w, h)` and every projection below agree with the layout.
  return { ctx, w: rect.width, h: rect.height }
}

/**
 * A colour plus an alpha, as `rgba()`. Canvas has no colour-mix.
 *
 * ── IT HANDLES `rgb()` TOO, AND THAT IS NOT DEFENSIVENESS ────────────────────────────────
 *
 * An invalid colour string assigned to `fillStyle` is a SILENT NO-OP in Canvas 2D — the previous
 * colour stays. So a naive hex parser fed `rgba(19,19,19,0.08)` produces `rgba(NaN,NaN,NaN,0.2)`
 * and the chart draws in whatever was set last, with no error anywhere. The design tokens already
 * mix both forms (`--color-settled` is hex, `--color-surface3` is `rgba()`), so the two families
 * are one token edit apart from making verdict mode paint its up and down halves identically.
 */
export function withAlpha(colour: string, alpha: number): string {
  const trimmed = colour.trim()

  const channels = /^rgba?\(([^)]+)\)$/i.exec(trimmed)
  if (channels) {
    const parts = channels[1]!.split(/[,/\s]+/).filter((p) => p !== '')
    const [r, g, b] = parts
    // The source alpha is dropped rather than multiplied: every caller here is asking for an
    // explicit opacity, and compounding a token's own transparency would make a fill invisible.
    if (r !== undefined && g !== undefined && b !== undefined) return `rgba(${r},${g},${b},${alpha})`
    return trimmed
  }

  const m = trimmed.replace('#', '')
  // `#rgb` shorthand expands; anything else is handed back untouched so a valid CSS colour this
  // function does not understand still paints, rather than becoming NaN.
  const hex = m.length === 3 ? [...m].map((c) => c + c).join('') : m
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return trimmed

  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

export interface PriceLineOptions {
  /** The series, oldest first. Fewer than two points draws nothing. */
  series: readonly number[]
  /** The strike. When set, the chart is drawn in verdict mode. */
  target?: number | null
  /** The single colour used when there is no target. */
  color?: string
  /** Above-strike ink. */
  up?: string
  /** Below-strike ink. */
  down?: string
  /** Gridline and label ink — passed in so the caller can resolve it from the theme. */
  grid?: string
  padX?: number
  padTop?: number
  padBot?: number
}

const UP = '#0c8911'
const DOWN = '#e10f0f'

/**
 * Draw the line.
 *
 * The sequence below IS the z-order, so the steps must not be reordered: grid, then the fill and
 * line, then the strike, then the live dot on top of everything.
 */
export function drawPriceLine(canvas: HTMLCanvasElement, options: PriceLineOptions): void {
  const surface = setup(canvas)
  if (surface === null) return
  const { ctx, w, h } = surface
  ctx.clearRect(0, 0, w, h)

  const series = options.series
  if (series.length < 2) return

  const padX = options.padX ?? 12
  const padTop = options.padTop ?? 14
  const padBot = options.padBot ?? 12
  const grid = options.grid ?? 'rgba(128,128,128,0.18)'
  const up = options.up ?? UP
  const down = options.down ?? DOWN
  const target = options.target ?? null

  //
  // THE RANGE INCLUDES THE STRIKE, so a market whose price has run far from its target still shows
  // the target — otherwise the one line the reader is looking for is off-canvas exactly when it is
  // most interesting.
  //
  let lo = Math.min(...series)
  let hi = Math.max(...series)
  if (target !== null) {
    lo = Math.min(lo, target)
    hi = Math.max(hi, target)
  }
  // 12% headroom, with a FLAT-SERIES FALLBACK: a dead-flat line has zero range, and without the
  // fallback every point divides by zero and lands on one row of pixels.
  const headroom = (hi - lo) * 0.12 || Math.max(1e-9, Math.abs(hi) * 0.0005)
  lo -= headroom
  hi += headroom
  const range = hi - lo || 1

  const xFor = (i: number) => padX + (i / (series.length - 1)) * (w - padX * 2)
  // Inverted: a higher value is a SMALLER y.
  const yFor = (v: number) => padTop + ((hi - v) * (h - padTop - padBot)) / range

  // ── Gridlines ───────────────────────────────────────────────────────────────────────────
  ctx.strokeStyle = grid
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i += 1) {
    const y = padTop + (i / 4) * (h - padTop - padBot)
    ctx.beginPath()
    // The half-pixel offset puts a 1px line on a pixel boundary instead of straddling two.
    ctx.moveTo(padX, Math.round(y) + 0.5)
    ctx.lineTo(w - padX, Math.round(y) + 0.5)
    ctx.stroke()
  }

  const points = series.map((v, i) => ({ x: xFor(i), y: yFor(v) }))

  //
  // ── QUADRATIC MIDPOINT SMOOTHING ──────────────────────────────────────────────────────
  //
  // Each data point is a CONTROL point and each segment ends at the midpoint between consecutive
  // points. Midpoints are on-curve by construction, so the result is C¹-continuous with no tangent
  // bookkeeping, no overshoot, and no Catmull-Rom conversion.
  //
  // The first and last points are hit EXACTLY — `moveTo` and the closing `lineTo`. That is not an
  // artefact: the last point is the live price and it must land on its own value rather than be
  // smoothed away from it.
  //
  const trace = () => {
    ctx.moveTo(points[0]!.x, points[0]!.y)
    for (let i = 1; i < points.length - 1; i += 1) {
      const xc = (points[i]!.x + points[i + 1]!.x) / 2
      const yc = (points[i]!.y + points[i + 1]!.y) / 2
      ctx.quadraticCurveTo(points[i]!.x, points[i]!.y, xc, yc)
    }
    ctx.lineTo(points[points.length - 1]!.x, points[points.length - 1]!.y)
  }

  const traceArea = () => {
    // The skirt closes on `h - padBot`, NOT `h`: the fill has to stop where the axis area starts.
    ctx.moveTo(points[0]!.x, h - padBot)
    ctx.lineTo(points[0]!.x, points[0]!.y)
    for (let i = 1; i < points.length - 1; i += 1) {
      const xc = (points[i]!.x + points[i + 1]!.x) / 2
      const yc = (points[i]!.y + points[i + 1]!.y) / 2
      ctx.quadraticCurveTo(points[i]!.x, points[i]!.y, xc, yc)
    }
    ctx.lineTo(points[points.length - 1]!.x, points[points.length - 1]!.y)
    ctx.lineTo(points[points.length - 1]!.x, h - padBot)
    ctx.closePath()
  }

  const paint = (colour: string) => {
    const gradient = ctx.createLinearGradient(0, padTop, 0, h - padBot)
    gradient.addColorStop(0, withAlpha(colour, 0.2))
    gradient.addColorStop(1, withAlpha(colour, 0))
    ctx.fillStyle = gradient
    ctx.beginPath()
    traceArea()
    ctx.fill()

    ctx.strokeStyle = colour
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.lineCap = 'round'
    ctx.beginPath()
    trace()
    ctx.stroke()
  }

  if (target === null) {
    paint(options.color ?? up)
  } else {
    //
    // ── THE TWO CLIPPED PASSES ──────────────────────────────────────────────────────────
    //
    // The crossing is never computed. Each pass draws the WHOLE chart clipped to one side of the
    // strike, so the stroke is two-tone at every crossing, pixel-exact and antialiased for free.
    //
    // `Math.max(0, …)` guards a strike that is off-canvas: a negative-height rect is a silent
    // no-op in some engines and garbage in others.
    //
    const yT = yFor(target)

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, w, Math.max(0, yT))
    ctx.clip()
    paint(up)
    ctx.restore()

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, yT, w, Math.max(0, h - yT))
    ctx.clip()
    paint(down)
    ctx.restore()

    // The strike itself, dashed so it never reads as data.
    ctx.save()
    ctx.setLineDash([5, 4])
    ctx.strokeStyle = withAlpha(down, 0.75)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(padX, yT)
    ctx.lineTo(w - padX, yT)
    ctx.stroke()
    ctx.restore()
  }

  // ── The live dot ────────────────────────────────────────────────────────────────────────
  const lastPoint = points[points.length - 1]!
  const lastValue = series[series.length - 1]!
  const dotColour = target === null ? (options.color ?? up) : lastValue >= target ? up : down

  // Scaled to the strip's height so a short chart does not get swallowed by its own halo — but the
  // dot itself is UNSCALED, so the live price is the same size everywhere it appears.
  const k = Math.min(1, h / 220)
  ctx.fillStyle = withAlpha(dotColour, 0.16)
  ctx.beginPath()
  ctx.arc(lastPoint.x, lastPoint.y, 6 * k, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = withAlpha(dotColour, 0.32)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(lastPoint.x, lastPoint.y, 7.5 * k, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = dotColour
  ctx.beginPath()
  ctx.arc(lastPoint.x, lastPoint.y, 3.2, 0, Math.PI * 2)
  ctx.fill()
}

/**
 * A sparkline: no smoothing, no padding, edge to edge.
 *
 * Deliberately NOT the same function with options. A sparkline is read as a shape rather than as a
 * chart, so smoothing it would round off the very spikes it exists to show, and axis padding would
 * waste a third of a 48px-wide box.
 */
export function drawSparkline(
  canvas: HTMLCanvasElement,
  series: readonly number[],
  colour: string,
): void {
  const surface = setup(canvas)
  if (surface === null) return
  const { ctx, w, h } = surface
  ctx.clearRect(0, 0, w, h)
  if (series.length < 2) return

  const lo = Math.min(...series)
  const hi = Math.max(...series)
  const range = hi - lo || 1

  ctx.strokeStyle = colour
  ctx.lineWidth = 1.4
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.beginPath()
  series.forEach((v, i) => {
    const x = (i / (series.length - 1)) * w
    // 4px of vertical pad baked in, so the extremes are not clipped by the element's own edge.
    const y = 4 + (1 - (v - lo) / range) * (h - 8)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
}
