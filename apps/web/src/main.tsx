//
// React 19 mount.
//
// `routeTree.gen.ts` is imported from the committed file, not regenerated at runtime. It is
// COMMITTED on purpose: `vite build` regenerates it before bundling, so any pipeline that builds
// before it typechecks can never observe a broken tree — a one-route-stale tree went from tsc
// exit 2 to exit 0 purely because the build healed it. `npm run typecheck` must run first.
//
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'

// The app's only stylesheet entry point. It pulls in the framework, the generated token sheet and
// the typeface; nothing else in the app may import CSS. It costs zero eager JS bytes — the build's
// budget counts `.js` only, and the bundler emits CSS as its own asset.
import './index.css'

//
// `constants` is the ONLY `@strk20/protocol` subpath this file may import, and that is a load-order
// decision, not an oversight. `send`, `register` and `discovery` are what pull `starknet` and the
// privacy SDK in; importing any of them here puts the whole ~700 kB SDK graph in the ROOT chunk,
// eagerly, on first paint — which is precisely what the deferred load-order story (`/wallet` eager,
// the other five surfaces lazy) exists to prevent.
//
// The combined graph — React + router + protocol + SDK in one wrapped, evaluated build — is proved
// and covered by `build:web`'s node-only-module scan once a surface imports it. It is not
// this file's job, and doing it here would be undone by the next story.
//
import { ACTIVE_NETWORK, NET } from '@strk20/protocol/constants'

import { MODES, MODE_ROUTES } from './shell/modes'
import { ERROR_ROUTE_ID, NotFoundSurface, Surface } from './shell/Surface'
import { routeTree } from './routeTree.gen'

//
// THE TWO-LAYER ERROR CONTRACT, and why both fallbacks live HERE rather than on the routes.
//
// Without `defaultErrorComponent`, a route with no error component of its own gets `SafeFragment` —
// which is not a boundary at all. One throwing surface then destroys the entire shell: header gone,
// zero nav links, the document replaced by the router's default text. Setting it here gives EVERY
// match its own CatchBoundary, which is what turns "one surface broke" into "one surface reads
// `__error__` and the other nine still work".
//
// And it is here rather than in a route file because route-level error UI is code-split BY DEFAULT
// (`[['component'],['errorComponent'],['notFoundComponent']]`). A stale deploy would then 404 the
// very chunk whose job is to report the failure. This module is the eager entry; nothing about it
// can arrive late.
//
// Both emit RESERVED markers. A fallback wearing the route's own id is the precise defect the
// reserved rule exists for: it let a surface that throws on every render pass the gate wearing the
// identity of the route it had broken.
//
const router = createRouter({
  routeTree,
  defaultErrorComponent: () => (
    <Surface routeId={ERROR_ROUTE_ID}>
      <h1 className="text-heading3">This screen could not load</h1>
      <p className="text-body3 text-neutral2">
        Something on this page failed while it was being built. The rest of Passbook is unaffected —
        the six modes in the header all still work.
      </p>
    </Surface>
  ),
  defaultNotFoundComponent: NotFoundSurface,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

//
// The artifact-level network assertion, and the reason it is a published value rather than a grep.
//
// The tempting check — "the dist contains the mainnet chain id and not the sepolia one" — is
// unsound: `constants.ts` holds both chain ids inside a single `as const satisfies` object literal
// that `NET` indexes at runtime, so the bundler retains both strings either way. What IS sound is
// evaluating the bundle and reading what it actually resolved to.
//
declare global {
  interface Window {
    __PASSBOOK__?: { network: string; chainId: string }
  }
}
window.__PASSBOOK__ = { network: ACTIVE_NETWORK, chainId: NET.chainId }

//
// A STALE DEPLOY, WHICH IS THE ONE FAILURE A CODE-SPLIT APP INVENTS FOR ITSELF.
//
// Every surface but `/wallet` arrives as its own chunk. Ship a new build while a tab is open and the
// filenames it remembers are gone: the next navigation fails to fetch a module and the app appears
// to freeze on a click. Vite fires `vite:preloadError` for exactly this, and one reload fixes it,
// because the fresh `index.html` names the chunks that exist.
//
// `preventDefault()` IS THE FIRST STATEMENT, AND IT IS NOT TIDINESS. Vite's own helper ends
// `if (!e.defaultPrevented) throw err` — an uncancelled preload error is RETHROWN, so without this
// line every stale-chunk failure also produces an uncaught page error: a crash racing a reload for
// the user, and a red build for the gate, which fails on uncaught errors.
//
// THE LOOP GUARD IS NOT OPTIONAL EITHER. If the fetch fails for a reason a reload cannot fix —
// offline, a broken CDN — an unguarded listener reloads forever. And the deferred warm below fetches
// chunks with NO user interaction, so that loop needs no clicking to run: it is automatic.
// `sessionStorage` is the only place a flag survives the reload it is guarding against, and reading
// it throws outright in private mode, hence the wrap.
//
// WHY THE FLAG IS CLEARED AFTER A CLEAN WARM RATHER THAN AFTER A SUCCESSFUL MOUNT. Clearing on mount
// would make this guard dead: a preload can only fail after the app is running, so the flag would
// always be clear by the time it mattered and the automatic loop above would be back. Waiting for
// the warm to finish without a single preload failure is the first moment there is EVIDENCE that
// chunk fetching works — and once that is known, a later failure is a new deploy rather than a
// broken host, and deserves its own attempt. The ordering is sound rather than lucky: Vite
// dispatches this event synchronously inside the same promise chain `preloadRoute` awaits, so
// `preloadFailed` is already set by the time the warm's `then` runs.
//
// NOT DEMONSTRATED, and named rather than implied: nothing here has been driven by a real stale
// deploy. The listener, the guard and the clearing are each exercised directly; the whole path, from
// a replaced deploy through to a recovered tab, is a known gap.
//
const RELOADED_KEY = 'passbook-preload-reloaded'
let preloadFailed = false

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()

  if (preloadFailed) return
  preloadFailed = true
  try {
    if (sessionStorage.getItem(RELOADED_KEY)) return
    sessionStorage.setItem(RELOADED_KEY, '1')
  } catch {
    // No session storage: the module flag above is the whole guard for this page.
  }
  window.location.reload()
})

//
// THE DEFERRED WARM. Five chunks fetched once the page is idle, so the first click on Chat or Swap
// is not the first time its code is asked for.
//
// `requestIdleCallback` IS NOT THE PRIMARY PATH, whatever the shape of this code suggests. It is
// unimplemented in every released Safari and iOS Safari, so on an iPhone the timeout below is what
// actually fires — 2000 ms is a product decision about how long to stay out of the way, not a safety
// net for a callback that will normally arrive first.
//
// `preloadRoute` swallows load failures, but the location it builds first does not: a bad `to`
// rejects outside that catch. The `.catch()` is therefore load-bearing — an unhandled rejection here
// would surface as a console error, and the build gate fails on console errors.
//
const WARM_DELAY_MS = 2_000

function warmDeferredSurfaces() {
  const warmed = []
  for (const mode of MODES) {
    const to = MODE_ROUTES[mode]
    if (to === MODE_ROUTES.wallet) continue // eager already: it is where the cold open lands
    warmed.push(router.preloadRoute({ to }).catch(() => {}))
  }

  //
  // THE COMMAND PALETTE'S CHUNK, warmed in the same window and for the same reason.
  //
  // It is not a route, so `preloadRoute` cannot reach it — the root layout mounts it through
  // `React.lazy` on the first `/`, and without this that first press pays a network round trip
  // before anything appears. The specifier must stay character-for-character the one
  // `routes/__root.tsx` imports, or the bundler emits two chunks and this warms the wrong one.
  //
  // ITS OWN `.catch()`, JOINED BEFORE THE `Promise.all` BELOW. A rejected preload that reached that
  // `all` would reject it, the `then` would never run, and the reload flag would stay set for the
  // life of the tab — turning a stale deploy into a tab that can never recover a SECOND time. The
  // build gate also fails on unhandled rejections, so this is two failures in one line.
  //
  warmed.push(import('./shell/CommandPalette').then(() => {}).catch(() => {}))

  void Promise.all(warmed).then(() => {
    // Every deferred chunk arrived and nothing reported a preload failure, so there is no loop to
    // guard against any more. Releasing the flag is what keeps a SECOND deploy recoverable in a
    // long-lived tab, which "one reload per tab session" would not be.
    if (preloadFailed) return
    try {
      sessionStorage.removeItem(RELOADED_KEY)
    } catch {
      // Nothing was ever stored, so there is nothing to release.
    }
  })
}

if (typeof window.requestIdleCallback === 'function') {
  // The timeout is not decoration on this branch either: without it a permanently busy tab, or one
  // that is backgrounded before it goes idle, never warms at all — the callback simply never fires.
  window.requestIdleCallback(warmDeferredSurfaces, { timeout: WARM_DELAY_MS })
} else {
  window.setTimeout(warmDeferredSurfaces, WARM_DELAY_MS)
}

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing #root — nothing to mount into.')

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
