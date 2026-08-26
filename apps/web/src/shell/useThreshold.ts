//
// The one width question the app is allowed to ask, and the one place it asks it.
//
// The design authority names two responsive thresholds and no others: dialog↔sheet at 640px and
// popover↔sheet at 450px. Both are the SAME question — "is the viewport at least N wide" — so this
// is one hook taking a number rather than two hooks with a literal baked into each.
//
// WHY `matchMedia` AND NOT A ResizeObserver. The component library already creates a ResizeObserver
// per open drawer (eleven runtime files construct them), so "one shared ResizeObserver" is a rule
// about OUR code, not about the page. The threshold needs none at all: `matchMedia` is the
// browser's own answer to this exact question and it fires once per crossing rather than once per
// pixel of a drag. The library ships an `unstable-use-media-query` entry point that would do this
// too — it is not imported here, and the `unstable-` prefix is the whole reason.
//
// WHY `useSyncExternalStore` AND NOT `useState` + an effect. The effect form paints once at the
// wrong width and corrects on the next frame, which is a visible flash of the desktop dialog on a
// phone. This subscribes and reads in the same commit, so the first painted frame is already right.
//
// THE SERVER SNAPSHOT IS `true`, i.e. desktop. Nothing renders this on a server today; the value
// exists because React demands one and because guessing "phone" for a reader whose width is
// genuinely unknown puts a bottom sheet on a 27-inch monitor.
//
import { useCallback, useSyncExternalStore } from 'react'

/**
 * Whether the viewport is at least `px` wide, as a value that re-renders on every crossing.
 *
 * @param px one of the design authority's breakpoints — 640 for dialog↔sheet, 450 for
 *   popover↔sheet. Nothing else is a ratified threshold.
 */
export function useThreshold(px: number): boolean {
  // Built here rather than inline in the callbacks so the two reads provably ask the same
  // question: a query string that differed between `subscribe` and `getSnapshot` would subscribe
  // to one media query and report another, and the symptom is a value that updates only on an
  // unrelated re-render.
  const query = `(min-width: ${px}px)`

  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onStoreChange)
      return () => mql.removeEventListener('change', onStoreChange)
    },
    [query],
  )

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => true,
  )
}
