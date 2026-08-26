//
// ONE popup that is a centred dialog above 640px and a bottom sheet below it.
//
// THE WHOLE POINT IS THAT NOTHING REMOUNTS AT THE THRESHOLD. The obvious build — `<Dialog>` on one
// side, `<Drawer>` on the other, chosen by a ternary — swaps the component TYPE, and React tears
// the subtree down and rebuilds it every time the viewport crosses 640. Measured on exactly that
// shape: the typed value survives (it is hoisted), and focus, caret position, scrollTop and every
// uncontrolled field die, with the mount count climbing 1 → 2 → 3 across two crossings. A user
// rotating a tablet mid-form loses their place and the code looks correct.
//
// So there is ONE `Drawer.Root` on both sides and the geometry is a class. `Drawer`'s parts are a
// superset of `Dialog`'s — eleven of Dialog's parts exist on Drawer, five of them as the SAME
// function reference — so nothing is given up by picking the wider one, and swipe-to-dismiss and
// the snap machinery come with it on the side of the threshold where a thumb is the input device.
//
// IF YOU EVER COME BACK TO TEST THIS, the assertion is the MOUNT COUNT plus focus, caret and
// scrollTop across a live 700 → 500 crossing — not the typed value. A forked tree with hoisted
// state keeps the value too, so a value-only assertion passes on the exact build this file exists
// to avoid.
//
import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { Drawer } from '@base-ui/react/drawer'

import { useThreshold } from './useThreshold'

/** The design authority's dialog↔sheet threshold (`components.modal.sheetBelow`). */
export const SHEET_BELOW = 640

/**
 * The duration the closing overlay is given before the popup is torn out from under it.
 *
 * Read from the sheet at call time rather than written here as a number. The design authority
 * publishes it as `motion.lazy`, the generator emits it as this custom property, and a literal in
 * this file would be a second copy of a ratified value that nothing keeps in step.
 */
const OVERLAY_EXIT_DURATION = '--transition-duration-lazy'

/**
 * How long to hold the popup mounted after a close, in milliseconds.
 *
 * WHY THIS EXISTS AT ALL. The library tears the whole portal down when the POPUP's animation ends,
 * so a backdrop authored to fade slower than the sheet is ripped out of the document mid-fade —
 * measured disappearing at opacity 0.584. The library's own answer is `preventUnmountOnClose()`
 * plus an imperative `unmount()` once the slower thing has finished, which is what the caller below
 * does with this number.
 *
 * ZERO IS A CORRECT ANSWER, not a fallback: under `prefers-reduced-motion` there is no fade to
 * outlive, and if the custom property cannot be read there is no ratified duration to honour — so
 * it unmounts on the next frame rather than inventing a delay nobody designed.
 */
function overlayExitMs(): number {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0
  const raw = getComputedStyle(document.documentElement).getPropertyValue(OVERLAY_EXIT_DURATION).trim()
  const parsed = /^(\d*\.?\d+)(ms|s)$/.exec(raw)
  if (!parsed) return 0
  return Number(parsed[1]) * (parsed[2] === 's' ? 1000 : 1)
}

export interface ResponsiveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /**
   * The popup's accessible name. Required rather than optional: a dialog with no name is announced
   * as "dialog" and nothing else, which is the same as not being announced.
   */
  label: string
  /**
   * MODALITY IS EXPLICIT HERE BECAUSE THE LIBRARY'S DEFAULT IS `true`.
   *
   * `Drawer.Root` and `Dialog.Root` both default `modal: true` — measured in the shipped `.d.ts`,
   * and measured on a page: an app with no `modal` prop written anywhere renders a full scrim,
   * locks body scroll and swallows every click behind it. "Not modal" is therefore something you
   * have to say, and the CONVENTION in this app is that every popup root says which it is. This
   * default is what makes the quiet answer the safe one.
   *
   * The app ships exactly one modal — the trust-boundary self-submit dialog — and it is not this
   * story, so nothing passes this truthy today. The `preventUnmountOnClose` path below therefore
   * has no production call site yet; it is four lines and it is correct, and it is what the first
   * caller will need.
   */
  modal?: boolean | 'trap-focus'
  children: ReactNode
}

export function ResponsiveDialog({
  open,
  onOpenChange,
  label,
  modal = false,
  children,
}: ResponsiveDialogProps) {
  const isDesktop = useThreshold(SHEET_BELOW)
  const actions = useRef<Drawer.Root.Actions | null>(null)
  const exitTimer = useRef<number | null>(null)

  // A close animation in flight when this unmounts would otherwise fire its timer against a torn-
  // down tree. Cheap to clear, and the alternative is a warning nobody can place.
  useEffect(
    () => () => {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current)
    },
    [],
  )

  const handleOpenChange = useCallback(
    (next: boolean, details: Drawer.Root.ChangeEventDetails) => {
      //
      // Only on the way OUT, and only when there is a backdrop to outlive. A non-modal popup has no
      // scrim, so holding the portal open past the popup's own animation would buy nothing and cost
      // a window in which a closed popup is still in the document.
      //
      if (!next && modal) {
        details.preventUnmountOnClose()
        exitTimer.current = window.setTimeout(() => {
          // One frame past the duration. The library times its own unmount off the computed
          // transition, and unmounting on the exact millisecond the last one ends is a race the
          // reader cannot see; a frame is the smallest honest amount of slack.
          requestAnimationFrame(() => actions.current?.unmount())
        }, overlayExitMs())
      }
      onOpenChange(next)
    },
    [modal, onOpenChange],
  )

  return (
    <Drawer.Root open={open} modal={modal} actionsRef={actions} onOpenChange={handleOpenChange}>
      {/*
        `keepMounted` is deliberately absent: the default is `false`, and that default is what makes
        a closed popup literally nothing in the DOM. The geometric scrim probe cannot report a box
        that is not there, and a kept-mounted portal would have to be argued about instead.
      */}
      <Drawer.Portal>
        {/*
          THE BACKDROP, and its absence was a real defect rather than a deferred nicety.

          Without it a confirmation dialog floats over a fully-lit page: nothing separates the thing
          being agreed to from the form behind it, every control behind stays live, and the popup
          reads as a card that happened to land on top rather than as a decision to make. It is
          rendered only for a modal popup, because a non-modal one deliberately leaves the app
          reachable — that is the whole difference between the two, and DESIGN §7.11's rule.

          `--color-scrim` is the design authority's own, so it re-themes; a hand-rolled `rgba(0,0,0,…)`
          would be a literal that goes wrong in dark mode.
        */}
        {modal ? <Drawer.Backdrop className="pb-scrim" /> : null}
        {/*
          THE VIEWPORT IS MANDATORY, not decoration. Omitting it kills swipe-to-dismiss and touch
          scroll-lock, and says so through a console error that only exists in a development build —
          so the failure is invisible in exactly the artifact that ships. Its height is also the
          denominator the snap fractions are computed against.

          It covers the whole viewport, so it is `pointer-events: none` in the stylesheet and the
          popup turns them back on. Without that a non-modal popup would block every click on the
          app behind it while looking like it did not — and the scrim probe, which skips boxes that
          cannot be clicked, would agree with the look rather than with the behaviour.
        */}
        <Drawer.Viewport className={isDesktop ? 'pb-viewport items-center' : 'pb-viewport items-end'}>
          {/*
            `initialFocus` is passed EXPLICITLY, and `true` is not the library's default here: left
            out, it resolves to the popup ELEMENT, so the popup takes focus and the control inside
            it does not. For a palette that means the caret is nowhere and the first thing typed
            goes into the void. `true` means "the first tabbable thing inside", falling back to the
            popup when there is nothing tabbable — which is the right answer for a plain dialog too.
          */}
          <Drawer.Popup
            className={isDesktop ? 'pb-dialog' : 'pb-sheet'}
            aria-label={label}
            initialFocus
          >
            {/*
              `Drawer.Content` IS the drag-propagation mechanic — a 250px mouse drag started inside
              it does not dismiss the desktop dialog, which a bare `<div>` would not give you. It is
              here on both sides of the threshold because the tree is the same tree.

              `display: contents` so the popup's own column IS the layout: without it `Content`
              becomes a second flex item that does not stretch, and a scrollable child inside it
              stops being able to work out how tall it may be. The element stays in the DOM and
              events still bubble through it, which is all the drag mechanic needs.
            */}
            <Drawer.Content className="contents">
              {isDesktop ? null : <div aria-hidden className="pb-grabber" />}
              {children}
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
