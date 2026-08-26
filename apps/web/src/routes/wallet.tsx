import { createFileRoute } from '@tanstack/react-router'

import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/wallet')({
  //
  // KEPT EAGER, DELIBERATELY, and this is the lever rather than a `vite.config.ts` edit.
  //
  // `/wallet` is where the cold open lands: `/` redirects here before anything paints, so this
  // surface is on the critical path of literally every first visit. The router plugin's default
  // groupings split `component`, `errorComponent` and `notFoundComponent` into their own chunks —
  // for this one route that turns first paint into a second round trip.
  //
  // An empty grouping list means "group nothing away". The plugin reads `codeSplitGroupings` off the
  // route options with a babel pass and it takes precedence over both the plugin-level
  // `splitBehavior` and the global default (`fromCode.groupings ?? pluginSplitBehavior ?? global`),
  // so this literal is the whole mechanism — it must stay an inline array literal in this call, not
  // a constant imported from somewhere, or the babel pass cannot see it.
  //
  codeSplitGroupings: [],
  component: Wallet,
})

function Wallet() {
  return (
    <Surface routeId={Route.fullPath}>
      <h1 className="text-heading3">Wallet</h1>
      <p className="text-body3 text-neutral2">
        Balances and recent activity will be shown here. The wallet surface is built in a later
        story; this shell is what every surface stands on.
      </p>
    </Surface>
  )
}
