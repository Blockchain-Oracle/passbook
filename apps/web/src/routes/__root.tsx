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
import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { createRootRoute, Link, Outlet, useNavigate } from '@tanstack/react-router'
import { ACTIVE_NETWORK, NET } from '@strk20/protocol/constants'

import { MODES, MODE_LABELS, MODE_ROUTES, type Mode } from '../shell/modes'
import { ERROR_ROUTE_ID, NotFoundSurface, Surface } from '../shell/Surface'
import { bindPaletteShortcut } from '../shell/palette-binding'
import type { PaletteCommand } from '../shell/CommandPalette'

//
// THE PALETTE IS CODE-SPLIT, AND NOT FOR THE BYTE GATE.
//
// That gate sums every emitted `.js` in `dist`, so moving code into its own chunk changes the total
// by rounding error and buys exactly nothing there. What it buys is first-paint parse and execute
// cost: this is chrome that most sessions never open, and the combobox machinery behind it is the
// largest single thing the component library ships. `src/main.tsx` preloads the chunk in the same
// deferred window as the five lazy surfaces, so the first `/` is not the first network request.
//
// Do not delete the split because "the budget counts it anyway". That is true and it is not the
// reason it is here.
//
const CommandPalette = lazy(() => import('../shell/CommandPalette'))

/** Every path the palette can take you to. Literal types, so the router checks each one. */
type PalettePath = (typeof MODE_ROUTES)[Mode] | '/settings'

/**
 * What the palette offers, derived from the mode enum rather than typed out beside it.
 *
 * Add a seventh mode and it appears here for free; rename one and the label follows. The `detail`
 * column is the destination's own path — the palette does not invent a description of a screen it
 * has not seen.
 */
const PALETTE_DESTINATIONS: readonly { readonly to: PalettePath; readonly label: string }[] = [
  ...MODES.map((mode) => ({ to: MODE_ROUTES[mode], label: MODE_LABELS[mode] })),
  { to: '/settings', label: 'Settings' },
]

/**
 * The commands, as the plain data the palette takes.
 *
 * Built once at module scope rather than per render: a new array every render is a new `items`
 * identity, and the list would re-derive its filtered set and drop the highlight on every keystroke.
 */
const PALETTE_COMMANDS: readonly PaletteCommand[] = PALETTE_DESTINATIONS.map(({ to, label }) => ({
  id: to,
  label,
  detail: to,
}))

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
  const navigate = useNavigate()

  //
  // TWO STATES, NOT ONE, AND THE SECOND IS THE WHOLE POINT OF THE SPLIT.
  //
  // `open` is what the palette is doing. `mounted` is whether its chunk has ever been asked for —
  // it latches true on the first open and never goes back, so closing the palette does not throw
  // the module away and the second `/` is instant. Rendering the lazy element unconditionally would
  // fetch the chunk on the cold open, which is exactly what this is here to avoid.
  //
  const [open, setOpen] = useState(false)
  const [mounted, setMounted] = useState(false)

  const openPalette = useCallback(() => {
    setMounted(true)
    setOpen(true)
  }, [])

  // The `/` shortcut, on keyup and never inside a text field. Both reasons are in
  // `../shell/palette-binding.ts`; neither is something either palette library provides.
  useEffect(() => bindPaletteShortcut(openPalette), [openPalette])

  const runCommand = useCallback(
    (command: PaletteCommand) => {
      const destination = PALETTE_DESTINATIONS.find((d) => d.to === command.id)
      // A command whose destination has been deleted does NOTHING rather than navigating somewhere
      // arbitrary. It cannot happen while both lists come from the same array, which is why this is
      // a guard rather than a fallback.
      if (destination) void navigate({ to: destination.to })
    },
    [navigate],
  )

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
          {/*
            A `<button>`, NEVER a `<Link>`, and that is a correctness rule rather than a preference.
            Exactly one element on a page may carry `aria-current="page"`, and the router stamps
            that onto any `<Link>` pointing at the route you are already on with no prop that can
            suppress it — measured. A palette trigger that pointed at a real route would therefore
            be announced as the current page on that route, alongside the nav item that genuinely
            is. It also is not navigation: it opens a popup and stays where it is.
          */}
          <button
            type="button"
            onClick={openPalette}
            aria-haspopup="dialog"
            aria-keyshortcuts="/"
            className="nav-item focus-ring cursor-pointer"
          >
            Search
          </button>
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

      {/*
        `fallback={null}` because there is nothing honest to show. The chunk is warmed 2 s after the
        cold open, so by the time anyone reaches for `/` it is in memory and this suspends for zero
        frames; on the one visit that beats the warm, a spinner for 40 ms is worse than nothing. A
        chunk that 404s after a redeploy is handled by the `vite:preloadError` listener in
        `main.tsx`, which reloads once — not by a fallback that would sit here forever.
      */}
      {mounted ? (
        <Suspense fallback={null}>
          <CommandPalette
            open={open}
            onOpenChange={setOpen}
            commands={PALETTE_COMMANDS}
            onRun={runCommand}
          />
        </Suspense>
      ) : null}
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

