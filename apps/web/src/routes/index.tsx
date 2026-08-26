//
// The cold open. `/` is not a surface — it is a decision that `/wallet` is the product.
//
// No component, deliberately: `beforeLoad` throws before anything can render, so a component here
// would be a screen that exists and is never seen. That is also why this route paints no marker of
// its own — `scripts/build-web.mjs` visits `/`, sees `/wallet`'s marker, and only accepts it because
// `EXPECTED_REDIRECTS` DECLARES the redirect. A `/` that stops redirecting fails the build rather
// than quietly becoming a blank page.
//
// ON `replace`, WHICH IS NOT PASSED HERE AND CANNOT BE: `router-core`'s `followRedirect()` hardcodes
// `replace: true` at all three of its commit sites, spreading the caller's options first and then
// overriding them. Measured byte-identical with and without the flag — `history.length` 2, `/` never
// in history, one Back leaves the document. Passing it would read as though it were what made that
// true, and the next person to remove it would find nothing changed.
//
// The host-level 302 that would save the client round trip is deploy-story work: no host is
// configured yet, and this half is the one every gate actually exercises.
//
import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    //
    // `search: true` and `hash: true` mean "carry what is already there". Without them the redirect
    // silently drops everything after the path on EVERY first visit: `/?ref=x#note` becomes a bare
    // `/wallet`, and since `/` is the address every link, bookmark and campaign points at, that is
    // the one visit where losing the query costs something.
    //
    throw redirect({ to: '/wallet', search: true, hash: true })
  },
})
