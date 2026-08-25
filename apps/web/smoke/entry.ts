//
// The committed COMBINED-graph smoke: React 19 + TanStack Router + `@strk20/protocol` + the privacy
// SDK, in one bundle, evaluated in a real browser.
//
// This is the permanent regression gate for the thing nobody had ever built before story 6-1 — every
// pillar had only been probed in isolation. It lives here rather than in `apps/web/src/main.tsx` on
// purpose: the app must NOT eagerly import the SDK (that is the deferred load-order story's whole
// point), but the combined graph still has to be proved by something that runs on every change
// rather than by a paragraph in a report that quietly rots. This file is that something.
//
// The protocol imports use the BARE specifier deliberately. The retired `.tmp-probe` measurement
// imported `discovery.ts` and `identity.ts` by relative path and never touched `send.ts` or
// `register.ts`, which is why its 116 kB figure never described this graph.
//
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createRouter } from '@tanstack/react-router'

import { planSend, MAX_INPUT_NOTES } from '@strk20/protocol/send'
import { proveRegistration, registerSponsored, DEFAULT_RELAYER_URL } from '@strk20/protocol/register'
import { discoverWallet, poolContractFor } from '@strk20/protocol/discovery'
import { ACTIVE_NETWORK, NET } from '@strk20/protocol/constants'

// The app's real, committed route tree — not a fixture. If codegen or a route file breaks the
// bundle, this build is where it shows up. No router plugin runs here: the tree is committed, and
// a second generator writing it during the smoke would be the "build heals the tree" hazard again.
import { routeTree } from '../src/routeTree.gen'

declare global {
  interface Window {
    __SMOKE__?: Record<string, unknown>
  }
}

// Published rather than merely imported: an unreferenced import is shakeable, and a graph that got
// shaken away proves nothing. Reading this back out of a real browser is the assertion.
const surface = {
  planSend: typeof planSend,
  proveRegistration: typeof proveRegistration,
  registerSponsored: typeof registerSponsored,
  discoverWallet: typeof discoverWallet,
  poolContractFor: typeof poolContractFor,
  maxInputNotes: MAX_INPUT_NOTES,
  relayerUrl: DEFAULT_RELAYER_URL,
  network: ACTIVE_NETWORK,
  chainId: NET.chainId,
}

const el = document.getElementById('root')
if (!el) throw new Error('smoke/index.html is missing #root — nothing to mount into.')

const router = createRouter({ routeTree })
createRoot(el).render(createElement(RouterProvider, { router }))

//
// The global is published only AFTER React has committed DOM, and carries what was rendered.
//
// "It mounted without throwing" is the weak version of this check — an empty container throws
// nothing. `__root.tsx` renders `{ACTIVE_NETWORK} · {NET.chainId}`, so asserting that text reached
// the DOM proves the whole chain end to end: the router resolved a route, React committed it, and
// the value it printed came out of `@strk20/protocol` inside a bundle that also carries the SDK.
//
// Polled rather than fired on a single timeout, because a one-macrotask assumption about when a
// concurrent React render commits is exactly the kind of thing that passes here and flakes in CI.
//
const deadline = Date.now() + 5_000
const publishWhenRendered = () => {
  const rendered = el.textContent ?? ''
  if (rendered.trim() || Date.now() > deadline) {
    window.__SMOKE__ = { ...surface, rendered }
    return
  }
  setTimeout(publishWhenRendered, 25)
}
publishWhenRendered()
