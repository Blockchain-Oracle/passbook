//
// The note field (story 6.7b, DESIGN:423, C08:229, C10:101).
//
// ── ONE COMPONENT, TWO MOUNTS, AND THAT IS THE WHOLE POINT ────────────────────────────────
//
// DESIGN:423 says the privacy explanation and the waiting screen are "*the same picture*", and
// calls that the product's signature move. Written as two drawings kept in sync by hand it would
// be a promise; written as one component mounted twice it is a fact about the code that a grep can
// check — which is what the story's acceptance criterion actually asserts.
//
// ── CANVAS, NOT SVG ───────────────────────────────────────────────────────────────────────
//
// C10:101 requires the field be designed at 142 points AND at 10,000. Ten thousand DOM nodes is a
// layout cost no amount of care removes. The app renders no SVG and no canvas anywhere today, so
// there is no existing idiom being broken — this is the first, and the node MODEL stays in
// `linkability.ts` as data so what the field draws is testable even though the drawing is not.
//
// ── NO ANIMATION, IN EITHER SPELLING ──────────────────────────────────────────────────────
//
// The build gate asserts `.note-field` declares none, and this file draws once per change rather
// than on a frame loop. C08:229 imagines nodes "filling/lighting during prove" — that is motion
// standing for progress on a computation we do not own, which is the same thing `index.css`'s
// `linear` ruling refuses for the spinner beside it. The field shows the CROWD; it does not
// pretend to watch the prover.
//
// ── THE HIGHLIGHT SURVIVES GREYSCALE ──────────────────────────────────────────────────────
//
// DESIGN:503 makes the non-colour channel a code rule with a test, not a style note. Yours is
// bigger, filled, ringed, and at the centre. Any one of those alone would do; all four means the
// mark survives greyscale, colour-blindness, and a screenshot in a judge's slide deck.
//
import { useEffect, useRef } from 'react'
import type { NoteFieldModel } from '@strk20/protocol/linkability'

export interface NoteFieldProps {
  field: NoteFieldModel
  /** What this picture is OF. Canvas has no accessible content of its own. */
  label: string
}

/** Reads a CSS custom property off an element, so the canvas paints in the sheet's own colours. */
function token(element: HTMLElement, name: string, fallback: string): string {
  const value = getComputedStyle(element).getPropertyValue(name).trim()
  return value === '' ? fallback : value
}

export function NoteField({ field, label }: NoteFieldProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const draw = () => {
      const box = canvas.getBoundingClientRect()
      if (box.width === 0) return

      // Device pixels, so the dots are not soft on a retina screen. Set every draw because the
      // element can be resized between paints and a stale backing store stretches.
      const ratio = window.devicePixelRatio || 1
      canvas.width = Math.round(box.width * ratio)
      canvas.height = Math.round(box.height * ratio)
      context.setTransform(ratio, 0, 0, ratio, 0, 0)
      context.clearRect(0, 0, box.width, box.height)

      const others = token(canvas, '--color-neutral3', 'rgba(33,26,18,0.35)')
      const mine = token(canvas, '--color-neutral1', '#211A12')
      const behind = token(canvas, '--color-inset', '#F4F0E8')

      // Dots shrink as the field fills, so 142 reads as a scatter and 10,000 as a texture rather
      // than a solid block. Clamped at both ends: below the floor they disappear, above the
      // ceiling they merge.
      const count = Math.max(field.nodes.length, 1)
      const radius = Math.min(3.5, Math.max(0.6, box.width / (Math.sqrt(count) * 6)))

      context.fillStyle = others
      for (const node of field.nodes) {
        if (node.mine) continue
        context.beginPath()
        context.arc(node.x * box.width, node.y * box.height, radius, 0, Math.PI * 2)
        context.fill()
      }

      const you = field.nodes.find((node) => node.mine)
      if (you) {
        const x = you.x * box.width
        const y = you.y * box.height
        // A halo in the container's own fill, so the mark stays findable even where the field is
        // densest. This is the "position" channel doing its work: nothing else is at the centre.
        const big = Math.max(radius * 2.4, 4)
        context.fillStyle = behind
        context.beginPath()
        context.arc(x, y, big + 2.5, 0, Math.PI * 2)
        context.fill()

        context.fillStyle = mine
        context.beginPath()
        context.arc(x, y, big, 0, Math.PI * 2)
        context.fill()

        context.strokeStyle = mine
        context.lineWidth = 1
        context.beginPath()
        context.arc(x, y, big + 3.5, 0, Math.PI * 2)
        context.stroke()
      }
    }

    draw()

    // Redraw on resize only. NOT a frame loop — see the header on why this component has no
    // animation of any kind.
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [field])

  return (
    <div className="note-field">
      <canvas
        ref={canvasRef}
        className="note-field-canvas"
        role="img"
        // Canvas content is invisible to assistive technology, so the picture's meaning has to be
        // stated. It says the same thing the sentence beside it does, which is the point.
        aria-label={label}
      />
      {/*
        SAYS IT DOWNSAMPLED, rather than quietly drawing fewer dots than the sentence claims. A
        picture showing 10,000 marks beside a sentence saying 40,000 is the picture contradicting
        the count, and the count is the one that is true.
      */}
      {field.downsampled ? (
        <p className="note-field-note text-body4 text-neutral2">
          {`Showing ${field.nodes.length.toLocaleString('en-US')} of ${field.total.toLocaleString('en-US')} — the picture is a sample, the count is not.`}
        </p>
      ) : null}
    </div>
  )
}
