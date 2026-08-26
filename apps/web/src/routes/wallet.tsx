import { createFileRoute } from '@tanstack/react-router'

import { ActivityFeed } from '../components/ActivityFeed'
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

//
// THE NAMESAKE OBLIGATION, PARTLY DISCHARGED.
//
// "A product named Passbook must render the book" — balance and history are the substrate, not a
// dashboard afterthought. The history half lands here. The balance half is the Wallet epic's,
// because a shielded balance needs the discovery walk and the walk needs the privacy SDK, which
// this bundle may not contain.
//
// The feed below is genuinely unread rather than empty, and says so. Nothing in this epic reads a
// chain: `activity-store.ts` explains what wires it and why it is one call.
//
function Wallet() {
  return (
    <Surface routeId={Route.fullPath}>
      <h1 className="text-heading3">Wallet</h1>
      {/*
        NO SPRINT VOCABULARY IN A USER STRING. This said "Balances arrive with the discovery story"
        — "the discovery story" is a sprint artifact, and a sentence a reader has no way to parse is
        worse than no sentence. The fact worth stating is what this browser has and has not read.
      */}
      <p className="text-body3 text-neutral2">
        Your shielded balance isn&apos;t read yet. The record is below.
      </p>
      <ActivityFeed />
    </Surface>
  )
}
