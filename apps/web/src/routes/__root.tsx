//
// THE SHELL. Seven coequal modes, one chrome, and one account gate above every route.
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
// throwing surface degrade to `__error__` while this header and all seven links survive. The
// consequence, accepted rather than worked around: this boundary never fires for a child's throw. It
// is here for the root's own failures, which are the ones that take the whole shell with them.
//
import { Suspense, lazy, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { createRootRoute, Link, Outlet, useNavigate } from '@tanstack/react-router'
import { ACTIVE_NETWORK, NET } from '@strk20/protocol/constants'

import { MODES, MODE_LABELS, MODE_ROUTES, type Mode } from '../shell/modes'
import { ERROR_ROUTE_ID, NotFoundSurface, Surface } from '../shell/Surface'
import { bindPaletteChord, bindPaletteShortcut, bindShortcutsOverlay } from '../shell/palette-binding'
import type { PaletteCommand } from '../shell/CommandPalette'
import { PipelineRow } from '../shell/PipelineRow'
import { getHealth, setHealth, subscribeHealth, watchConnectivity } from '../shell/pool-health'
import { AccountChip } from '../components/AccountChip'
import { BrandIntro } from '../components/onboarding/BrandIntro'
import { UnreadBadge } from '../components/ConversationList'
import { useTotalUnread } from '../shell/chat-bus'
import { useDirectory } from '../shell/use-directory'
import { shortenFelt } from '../shell/session'
import { DegradedStrip } from '../components/DegradedStrip'
import { ToastViewport } from '../shell/ToastViewport'
import { Icon } from '../components/icons'
import { MobileTabBar } from '../shell/MobileTabBar'
import { OnboardingGate } from '../components/onboarding/OnboardingGate'

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
const ShortcutsOverlay = lazy(() =>
  import('../shell/ShortcutsOverlay').then((m) => ({ default: m.ShortcutsOverlay })),
)

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
const PALETTE_COMMANDS: readonly PaletteCommand[] = [
  //
  // ACTIONS FIRST, then destinations.
  //
  // A palette that can only navigate is a nav menu with a text field in front of it. These two are
  // what somebody opening it actually wants — and they are ranked above the routes because "Send"
  // typed into a palette means the verb, not the page it happens to live on.
  //
  // Both resolve to a route today, because that is where the form is. They are separate entries
  // rather than aliases so their LABELS can be the verb while their destinations stay honest.
  //
  { id: 'action:send', label: 'Send', detail: 'Pay someone' },
  { id: 'action:receive', label: 'Receive', detail: 'Show your address' },
  ...PALETTE_DESTINATIONS.map(({ to, label }) => ({ id: to, label, detail: to })),
]

/**
 * Where each action lands.
 *
 * Its own union rather than `PalettePath`, because an ACTION is not a nav destination: `/send` is a
 * real route but not one of the seven modes, so it is deliberately absent from the nav type. Widening
 * `PalettePath` to admit it would have put Send in the navigation bar as a side effect of adding a
 * palette command.
 */
type ActionPath = '/send' | '/wallet'

const PALETTE_ACTIONS: Readonly<Record<string, ActionPath>> = {
  'action:send': '/send',
  'action:receive': '/wallet',
}

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
  // PEOPLE ARE COMMANDS. The directory is fetched once per session and searched locally (the
  // relayer never learns who is looked for — `use-directory.ts`'s whole argument), so every
  // claimed name rides the palette: typing `al` surfaces `@alice` under the actions, and Enter
  // opens her page. Memoised on the entries' identity so the items array stays stable per load —
  // the module-scope-array rule above, kept under a dynamic source.
  //
  const { entries } = useDirectory()
  const paletteCommands = useMemo<readonly PaletteCommand[]>(
    () => [
      ...PALETTE_COMMANDS,
      ...entries.map((entry) => ({
        id: `person:${entry.name}`,
        label: `@${entry.name}`,
        detail: `${shortenFelt(entry.address, 6, 4)} — person`,
      })),
    ],
    [entries],
  )

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
  // Same two-state split as the palette, for the same reason: the overlay's chunk is fetched on the
  // first `?` and never thrown away afterwards.
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [shortcutsMounted, setShortcutsMounted] = useState(false)

  const openPalette = useCallback(() => {
    setMounted(true)
    setOpen(true)
  }, [])

  const openShortcuts = useCallback(() => {
    setShortcutsMounted(true)
    setShortcutsOpen(true)
  }, [])

  // THREE BINDINGS, TWO EVENT TYPES, and the split is not arbitrary — `palette-binding.ts` has the
  // full reasoning. `/` and `?` are CHARACTERS and bind on keyup so they cannot leak into the field
  // the overlay just focused; `⌘K` is a chord that produces no character and must bind on keydown,
  // because that is the only place the browser's own address-bar shortcut can be taken from it.
  useEffect(() => bindPaletteShortcut(openPalette), [openPalette])
  useEffect(() => bindPaletteChord(openPalette), [openPalette])
  useEffect(() => bindShortcutsOverlay(openShortcuts), [openShortcuts])

  const runCommand = useCallback(
    (command: PaletteCommand) => {
      // An action resolves through its own map first; a destination is looked up by id. Two
      // lookups rather than one merged list, so an action id can never collide with a route path.
      const action = PALETTE_ACTIONS[command.id]
      if (action) {
        void navigate({ to: action })
        return
      }
      if (command.id.startsWith('person:')) {
        void navigate({ to: '/u/$name', params: { name: command.id.slice('person:'.length) } })
        return
      }
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
          className="focus-ring flex items-center gap-s8 justify-self-start text-neutral1 no-underline"
        >
          <span aria-hidden="true" className="brand-mark" />
          <span className="display text-heading3">Passbook</span>
        </Link>

        {/*
          The seven modes as STUDIO's centre pill, from the enum, in enum order. Driven from
          `MODE_ROUTES` rather than written out so the coupling is real in both directions: delete
          `markets.tsx` and this `<Link>` is one of the four places tsc names.

          `data-status="active"` and `aria-current="page"` are set by the router on the active link
          with no configuration — the active style keys off the first in authored CSS, and the second
          is what a screen reader announces. Below 768px this nav is display:none and the same seven
          links render in the tab bar at the bottom of the viewport — one enum, two projections.
        */}
        <nav aria-label="Modes" className="nav-pill">
          {MODES.map((mode) => (
            <Link key={mode} to={MODE_ROUTES[mode]} className="nav-item focus-ring">
              <Icon name={mode} />
              {MODE_LABELS[mode]}
              {/*
                THE UNREAD COUNT, and it is honest about being a local count. Messages that arrive
                while chat is unmounted sit in the relayer's bounded buffer rather than here, so
                this reports what this browser has actually received and catches up when chat opens.
                The alternative — a badge fed by a background subscription — would mean holding a
                socket open on every surface for a number.
              */}
              {mode === 'chat' ? <ChatUnread /> : null}
            </Link>
          ))}
        </nav>

        {/*
          Settings sits OUTSIDE the modes nav on purpose. It is not a seventh mode — it is chrome
          that the seven modes share — and the cold-open rule is seven enabled, unbadged nav items. It is
          here because the theme control lives on `/settings` and a route nothing links to is a route
          nobody can reach.
        */}
        <div className="app-header-end">
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
            aria-label="Search"
            className="icon-pill focus-ring"
          >
            <Icon name="search" size={14} />
            <span className="numeric hidden font-mono text-body4 md:inline">⌘K</span>
          </button>
          <Link to="/settings" aria-label="Settings" className="icon-pill focus-ring px-s8">
            <Icon name="sliders" />
          </Link>
          {/*
            NO THEME TOGGLE HERE — [STUDIO] the header carries search, settings and the account,
            and the theme is a Settings control. The toggle's row cost was also real: it is what
            pushed the right rail into the pill nav at 1280.
          */}
          {/*
            The network the artifact actually resolved to — still mounted, still truthful, now
            spoken rather than shown: the prototype's right rail is search · settings · account and
            nothing else, and a raw chain-id hex wrapping beside the chip was the one element on
            the header nobody designed. A screen reader still gets both values.
          */}
          <span data-testid="network" className="sr-only">
            {ACTIVE_NETWORK} · {NET.chainId}
          </span>
          {/*
            THE ACCOUNT, WHICH EXISTS BECAUSE THE PAGE OPENED.

            Derived in the browser on first load (AD-4/AD-7) — no wallet to connect, nothing to
            paste. It is the visible half of the login-free claim, and it arrives a beat after
            first paint because the crypto that derives it is behind a lazy boundary the build
            gate enforces.
          */}
          <AccountChip />
        </div>
      </header>

      {/*
        THE DEGRADED STRIP SITS UNDER THE CHROME AND ABOVE EVERY SURFACE, because every state it
        renders is app-wide — a paused pool stops all seven surfaces at once, and repeating that
        sentence per surface would be seven places for it to drift.
      */}
      <ShellHealth />

      {/*
        THE PIPELINE ROW IS ABOVE THE OUTLET, AND THAT PLACEMENT IS THE ENTIRE DETACH MECHANISM.
        Navigation swaps the outlet's subtree; anything mounted outside it never unmounts, so a
        running pipeline cannot be lost at the crossing. Moving this inside the `<div>` below would
        silently reintroduce the bug it exists to prevent, with no test able to see it.
      */}
      <PipelineRow />

      {/* Account creation is shell state, so no route or deep link can render around it. */}
      <OnboardingGate />

      <div>
        <Outlet />
      </div>

      {/*
        The phone's bottom bar — a stylesheet swap with the header's pill nav, not a JS one. It
        sits AFTER the outlet in document order and carries `z-fixed` from the adopted stacking
        scale, so it paints over surface content without relying on paint order.
      */}
      <MobileTabBar onPlus={openPalette} />

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
            commands={paletteCommands}
            onRun={runCommand}
          />
        </Suspense>
      ) : null}

      {/* Same latch, same `fallback={null}` reasoning as the palette above. */}
      {shortcutsMounted ? (
        <Suspense fallback={null}>
          <ShortcutsOverlay open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        </Suspense>
      ) : null}

      <ToastViewport />

      {/*
        THE COLD OPEN, MOUNTED LAST AND MOUNTED EAGERLY.

        Last in document order for the same paint-order reason the mobile bar is: it must cover the
        header, and this is the shell's own stacking discipline rather than a z-index race.

        EAGER, not lazy, and that is the opposite of the call made for the palette and the shortcuts
        overlay. Those are chrome most sessions never open, so their parse cost is worth deferring.
        This one runs on the FIRST frame of the FIRST visit — a lazy boundary would put a network
        round-trip in front of the thing whose entire job is to be instant, and would guarantee the
        black stage arrived after the shell had already painted behind it. It is ~2 kB of markup and
        a `new Audio()`; the mp3 itself is fetched by the browser, not bundled.

        It renders `null` for everybody who has seen it, decided in the state initialiser rather
        than in an effect, so the returning-user cost is one function call.
      */}
      <BrandIntro />
    </>
  )
}

/**
 * The live pool-health poll and the strip it feeds.
 *
 * ── IT RENDERS NOTHING UNTIL IT KNOWS SOMETHING ───────────────────────────────────────────
 *
 * The initial state is `null` — no strip, no skeleton, no space held. A degraded strip that
 * appears optimistically and retracts is worse than one that arrives a second late: the first
 * paint would claim a pool state nobody had read yet, on a surface whose entire argument is that
 * it never claims what it has not measured.
 *
 * The read is behind a dynamic import (see `pool-health.ts`) so the chain client never enters the
 * eager chunk. The poll runs at block cadence, not faster — §5 is explicit that this is a block
 * cadence question, and a tighter loop would spend a user's battery on a value that cannot change
 * between blocks.
 */
function ShellHealth() {
  // ONE READER FOR THE WHOLE APP. Surfaces read the same store to relabel their own CTAs — see
  // `pool-health.ts` on why re-deriving this per surface is both wasteful and unsafe.
  const reading = useSyncExternalStore(subscribeHealth, getHealth, getHealth)

  // Connectivity is the one degraded state the browser answers on its own, for zero bytes. The
  // chain-backed modes are wired where chain reads have a byte budget — `build:web` rejects the
  // starknet graph in ANY chunk of this bundle, lazy included, and it was right to.
  useEffect(() => watchConnectivity(), [])

  return (
    <DegradedStrip
      mode={reading.mode}
      upgrade={reading.upgrade}
      //
      // §5 MAKES THE CHAT LINE CONDITIONAL, so the strip needs the two facts to choose between
      // "Chat still works" and "New rooms can't open". Zero rooms and an unhealthy transport is
      // the truthful answer until the chat surface exists — and it is the CONSERVATIVE branch,
      // which renders the limitation rather than the promise. Passing nothing at all, as the first
      // version did, meant §5's sentence could never appear on any paused strip.
      //
      chat={{ openRooms: 0, transportHealthy: false }}
      // The only actionable degraded state in the table, and its button is gated on this handler.
      // Re-reading is what "Try again" means; today that is re-evaluating connectivity.
      onRetry={() => setHealth({ mode: null })}
    />
  )
}

/**
 * The chat nav item's unread count.
 *
 * Its own component so the badge's subscription re-renders the badge rather than the whole shell:
 * `useTotalUnread` fires on every message that arrives in any conversation, and the header holds
 * the palette, the theme toggle and the account chip.
 */
function ChatUnread() {
  const unread = useTotalUnread()

  //
  // THE COUNT ALSO GOES IN THE TAB TITLE, which is the only place it is visible when the tab is
  // in the background — and a background tab is exactly when an unread count is worth having.
  //
  // THE BASE TITLE IS CAPTURED ONCE, at module scope rather than per effect run. Reading it inside
  // the effect would read back a title this effect had already prefixed, so the count would
  // compound — `(1) (2) (3) Passbook` — the classic version of this bug.
  //
  useEffect(() => {
    document.title = unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${BASE_TITLE}` : BASE_TITLE
    // Restored on unmount so a shell that is being torn down does not leave a stale count in a
    // tab title nothing is updating any more.
    return () => {
      document.title = BASE_TITLE
    }
  }, [unread])

  return <UnreadBadge count={unread} />
}

/** The document's own title, read before anything has had a chance to prefix it. */
const BASE_TITLE = typeof document === 'undefined' ? 'Passbook' : document.title

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
