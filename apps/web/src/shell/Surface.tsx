//
// The route-identity marker, and the app's one page landmark.
//
// Every surface renders exactly one `<main data-route-id="…">` naming the route it IS. Three gates
// read that attribute — `scripts/build-web.mjs` and the anti-demo review gate
// of story 6.10 — so it is written once, here, rather than typed out per route.
//
// TWO RULES THE ATTRIBUTE'S OWN NAME ARGUES AGAINST, both learned the expensive way:
//
//   1. THE VALUE IS THE ROUTE'S `fullPath`, NEVER ITS `Route.id` and never `location.pathname`.
//      For a route under a pathless layout the id and the fullPath differ (`/_shell/wallet` vs
//      `/wallet`), and the gate visits the paths out of the generated `fullPaths:` union — so a
//      surface emitting its id fails a route that is perfectly healthy. `location.pathname` fails
//      for a different reason: on `/pay/$address` it is whatever the URL happened to carry, and any
//      path the router rebuilds from params comes back percent-encoded (`%24address`), which is not
//      a string the gate compares equal to anything.
//
//   2. `__error__` and `__not_found__` are RESERVED, and no route may ever emit one as its own id.
//      An error component wearing `routeId="/markets"` made a surface that throws on EVERY render
//      pass the crawler with `failures: []` — its identity was true and its state was broken, and a
//      marker that cannot tell those apart is not a gate. The build gate enforces the `__` PREFIX,
//      not a list of names, so a pending fallback added later inherits the rule for free.
//
// The constants live here rather than in the build script because that script imports Playwright,
// so no app module can import from it. They are re-typed in the gate against a RULE, not a name.
//
import type { ReactNode } from 'react'

/** The marker every error fallback emits — router-level and route-level alike. */
export const ERROR_ROUTE_ID = '__error__'

/** The marker every not-found fallback emits. */
export const NOT_FOUND_ROUTE_ID = '__not_found__'

/**
 * One surface: the page landmark, carrying its own identity.
 *
 * `<main>` is here and NOT in `__root.tsx` on purpose. The root renders persistent chrome around
 * the outlet, so a `<main>` there would nest one landmark inside another — invalid, and exactly the
 * structure a later `querySelector('main')` reads the wrong half of. It also means the fallbacks
 * get the landmark they would otherwise lack.
 *
 * Nothing is published to `window` from here. A render-time side effect would be double-invoked
 * under StrictMode for no gain: every consumer reads the DOM, which is the thing that is actually
 * true about the page.
 */
export function Surface({ routeId, children }: { routeId: string; children: ReactNode }) {
  return (
    //
    // `key={routeId}` IS WHAT MAKES THE ARRIVAL REPLAY, and without it this is a one-time effect.
    //
    // A CSS animation runs when the element is inserted. React reconciles two `<main>`s at the same
    // position in the tree as the SAME element and only patches its attributes, so navigating from
    // `/send` to `/swap` would mutate the existing node and the animation — already finished —
    // would never run again. The screen would arrive exactly once per full page load, which is the
    // subtlest possible version of this bug: correct on the first screen a reviewer sees and dead
    // everywhere after.
    //
    // Keying on the route's own identity forces an unmount and a fresh insert per surface, which is
    // the same node identity the landmark already claims — so the key is not an extra concept, it
    // is the one this component was already built around.
    //
    <main
      key={routeId}
      data-route-id={routeId}
      className="route-arrive flex flex-col gap-s8 p-s16"
    >
      {children}
    </main>
  )
}

/**
 * The one not-found surface, because there is one not-found situation.
 *
 * Two routes reach it — the router's `defaultNotFoundComponent` and the root route's own
 * `notFoundComponent`, which shadows it for a globally unmatched URL — and they are the same event
 * told to the same person. It lived as two verbatim copies of the same paragraph; the next edit
 * would have moved one of them.
 *
 * The two ERROR fallbacks are deliberately NOT shared: "this screen could not load" and "Passbook
 * could not start" describe different blast radii, and collapsing them would lose the distinction
 * the two-layer contract exists to make.
 */
export function NotFoundSurface() {
  return (
    <Surface routeId={NOT_FOUND_ROUTE_ID}>
      <h1 className="text-heading3">No such page</h1>
      <p className="text-body3 text-neutral2">
        This address does not name anything in Passbook. The six modes in the header are all of it.
      </p>
    </Surface>
  )
}
