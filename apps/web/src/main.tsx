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
// and permanently regression-gated by `apps/web/smoke/entry.ts` via `npm run smoke:sdk`. It is not
// this file's job, and doing it here would be undone by the next story.
//
import { ACTIVE_NETWORK, NET } from '@strk20/protocol/constants'

import { routeTree } from './routeTree.gen'

const router = createRouter({ routeTree })

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

const root = document.getElementById('root')
if (!root) throw new Error('index.html is missing #root — nothing to mount into.')

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
