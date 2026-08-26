//
// THE SHELL. Six coequal modes, one chrome, ten routes that all take it.
//
// WHY THE CHROME IS HERE AND NOT IN A `_shell` PATHLESS LAYOUT. Every route in this app takes
// identical chrome, so a layout route buys nothing — and it costs the one trap the build gate
// documents by name: `_shell.wallet.tsx` has `Route.id` `/_shell/wallet` and `fullPath` `/wallet`,
// and a marker emitting the id fails a route with nothing wrong with it while the attribute's own
// name (`data-route-id`) argues for exactly that mistake. No layout, no trap.
//
// The `<div>` around the outlet is a plain wrapper and NOT a `<main>`: each surface renders its own
// `<main data-route-id>` (see `../shell/Surface.tsx`), and a `<main>` here would nest one landmark
// inside another.
//
// WHAT THE ROOT'S OWN `errorComponent` IS FOR, since it is not what it looks like. `main.tsx` sets
// `defaultErrorComponent`, which gives EVERY match its own CatchBoundary — that is what makes one
// throwing surface degrade to `__error__` while this header and all six links survive. The
// consequence, accepted rather than worked around: this boundary never fires for a child's throw. It
// is here for the root's own failures, which are the ones that take the whole shell with them.
//
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { ACTIVE_NETWORK, NET } from '@strk20/protocol/constants'

import { MODES, MODE_LABELS, MODE_ROUTES } from '../shell/modes'
import { ERROR_ROUTE_ID, NotFoundSurface, Surface } from '../shell/Surface'

export const Route = createRootRoute({
  component: RootLayout,
  errorComponent: RootError,
  //
  // This SHADOWS the router's `defaultNotFoundComponent` for a globally unmatched URL — the root's
  // `<Outlet/>` calls `renderRouteNotFound`, which prefers the route's own component. Both render
  // the same shared surface, so which one fires is not a fact anyone has to keep track of.
  //
  notFoundComponent: NotFoundSurface,
})

function RootLayout() {
  return (
    <>
      <header className="app-header">
        {/*
          THE BRAND POINTS AT THE APP ROOT, AND IS NEVER THE CURRENT PAGE.

          Pointed at `/wallet` it was active on the cold open, so TWO elements announced as the
          current page — worse for a screen reader than none. `activeProps={{}}` does NOT fix that,
          measured rather than assumed: `useLinkProps` ends its returned object with
          `...isActive && STATIC_ACTIVE_PROPS`, spread after everything the caller supplied, and
          that constant IS `{ 'data-status': 'active', 'aria-current': 'page' }`. There is no prop
          that can suppress it — the only way not to be marked active is not to BE active.

          So the brand links to `/`, which is what a brand links to, with `exact` so it does not
          prefix-match every route in the app. `/` redirects, so it is never the painted route and
          the brand is never active; and in the world where the redirect is gone, `/` would be
          active while `/wallet` was not — either way exactly one element claims the page.
        */}
        <Link
          to="/"
          activeOptions={{ exact: true }}
          className="focus-ring text-buttonLabel1 text-neutral1 no-underline"
        >
          Passbook
        </Link>

        {/*
          The six modes, from the enum, in enum order. Driven from `MODE_ROUTES` rather than written
          out so the coupling is real in both directions: delete `markets.tsx` and this `<Link>` is
          one of the four places tsc names.

          `data-status="active"` and `aria-current="page"` are set by the router on the active link
          with no configuration — the active style keys off the first in authored CSS, and the second
          is what a screen reader announces.
        */}
        <nav aria-label="Modes" className="flex flex-wrap items-center gap-s4">
          {MODES.map((mode) => (
            <Link key={mode} to={MODE_ROUTES[mode]} className="nav-item focus-ring">
              {MODE_LABELS[mode]}
            </Link>
          ))}
        </nav>

        {/*
          Settings sits OUTSIDE the modes nav on purpose. It is not a seventh mode — it is chrome
          that the six modes share — and the cold-open rule is six enabled, unbadged nav items. It is
          here because the theme control lives on `/settings` and a route nothing links to is a route
          nobody can reach.
        */}
        <div className="flex items-center gap-s8">
          <Link to="/settings" className="nav-item focus-ring">
            Settings
          </Link>
          {/*
            The network the artifact actually resolved to. `npm run smoke:sdk` asserts both of these
            values reach the mounted DOM — one assertion covering the whole chain, from the protocol
            package through the router to a committed render — so this line is load-bearing.
          */}
          <span data-testid="network" className="numeric text-body4 text-neutral2">
            {ACTIVE_NETWORK} · {NET.chainId}
          </span>
        </div>
      </header>

      <div>
        <Outlet />
      </div>
    </>
  )
}

/**
 * The root's own failure. Reserved marker, never `/` — a fallback that wears a route's own identity
 * is how a permanently-broken surface ships green.
 */
function RootError() {
  return (
    <Surface routeId={ERROR_ROUTE_ID}>
      <h1 className="text-heading3">Passbook could not start</h1>
      <p className="text-body3 text-neutral2">
        The application shell itself failed to load, so nothing else on this page can be trusted.
        Reloading is the only thing worth trying from here.
      </p>
    </Surface>
  )
}

