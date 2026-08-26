//
// The router smoke surface, and nothing more. These are NOT the product's routes — story 6-3 owns
// those. What this file has to prove is narrow: that file-based codegen, the React 19 mount and the
// `@strk20/protocol` import all survive one real build together.
//
// It RENDERS a value derived from `@strk20/protocol/constants` rather than merely importing one.
// An import alone is shakeable; a rendered value is what makes the built artifact assertable.
//
import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { ACTIVE_NETWORK, NET } from '@strk20/protocol/constants'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <>
      <header>
        <nav>
          <Link to="/">Home</Link> <Link to="/settings">Settings</Link>
        </nav>
        <p data-testid="network">
          {ACTIVE_NETWORK} · {NET.chainId}
        </p>
      </header>
      {/* A plain wrapper, NOT a <main>. Each leaf renders its own <main data-route-id="…"> as the
          route-identity marker the build gate asserts, and a <main> here would nest one inside the
          other — invalid, and exactly the kind of structure a later `querySelector('main')` reads
          the wrong half of. */}
      <div>
        <Outlet />
      </div>
    </>
  )
}
