import { createFileRoute } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

import { BlockedButton } from '../components/BlockedButton'
import { Surface } from '../shell/Surface'
import { currentBlocker, getHealth, subscribeHealth } from '../shell/pool-health'

export const Route = createFileRoute('/chat')({
  component: Chat,
})

//
// CHAT IS STRUCTURALLY IMMUNE TO EVERY POOL DEGRADATION, and its money affordance is not.
//
// Messages are zero-deposit and travel off-chain, so a paused pool cannot stop them — that is a
// property of the transport, not a promise we are making. Sending MONEY in a thread is a pool
// transaction like any other, so it degrades like any other: the button relabels with the live
// reason and stays pressable, because a silently dead control in a chat window reads as the app
// being broken rather than as the pool being paused.
//
// THE DEGRADED REASON IS READ, NEVER ASSERTED. An earlier draft of this file hardcoded the paused
// blocker to show the wiring, which made the button claim the pool was paused whenever anyone
// opened /chat. That is the overclaim the anti-demo gate exists to catch, committed in the file
// that was supposed to demonstrate honesty about it.
//

// `Route.fullPath` — never `Route.id`, never `location.pathname`. See `../shell/Surface.tsx` for
// which of those three the gates read and why the other two fail a healthy route.
function Chat() {
  // Subscribed rather than read once: the pool can pause while this surface is open, and a blocker
  // computed at mount would go stale in exactly the situation it exists for. The blocker is derived
  // from the RETURNED SNAPSHOT rather than by calling back into module state during render — the
  // two are the same value today, and deriving from the snapshot is what keeps them the same value.
  const reading = useSyncExternalStore(subscribeHealth, getHealth, getHealth)

  const blocker = currentBlocker(reading) ?? 'Chat is not built yet'

  return (
    <Surface routeId={Route.fullPath}>
      <h1 className="text-heading3">Chat</h1>
      <p className="text-body3 text-neutral2">
        Messages that travel with a payment will be written and read here. The chat surface is built
        in a later story.
      </p>

      <BlockedButton
        blocker={blocker}
        action="Send money in a thread"
        // The seam the real handler goes into, same as `/swap`'s. Empty rather than a throw: this
        // is unreachable while the blocker chain always ends in a reason.
        onPress={() => {}}
      />
    </Surface>
  )
}
