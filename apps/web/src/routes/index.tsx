import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

// `data-route-id` is the route-identity marker the build gate asserts: every surface names the
// route it IS, so "which surface actually rendered" is a fact the gate reads rather than a string
// it hopes for. Three rules, all enforced in `scripts/build-web.mjs`:
//
//   - the value is the route's `fullPath` — what the URL says — NOT its `Route.id`. For a route
//     under a pathless layout those differ (`/_shell/wallet` vs `/wallet`) and the id fails a
//     healthy route, which the attribute's own name unhelpfully argues for;
//   - `__`-prefixed values are reserved for error and not-found fallbacks. A route may never emit
//     one as its own id — that rule is what keeps a permanently-throwing surface from passing
//     while wearing the identity of the route it broke;
//   - exactly ONE element per page carries it. A layout that marks itself around a leaf that marks
//     itself leaves the gate picking by document order, so it refuses both.
function Home() {
  return (
    <main data-route-id="/">
      <p>Passbook scaffold.</p>
    </main>
  )
}
