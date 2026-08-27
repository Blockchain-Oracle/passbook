import { createFileRoute } from '@tanstack/react-router'
import { useSyncExternalStore } from 'react'

import { BlockedButton } from '../components/BlockedButton'
import { ComingState } from '../components/ComingState'
import { Text } from '../components/ui/Text'
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
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s16">
        <Text variant="heading3" as="h1">
          Chat
        </Text>

        <ComingState
          title="Money as a message"
          //
          // THE ONE SURFACE WHOSE CONTRACT IS ALREADY ON MAINNET. `evidence/deployment.json` records
          // the MessageBook deploy and its class hash was verified live before this copy was
          // written — so the claim below is checkable rather than a promise, which is the only kind
          // worth putting on a page like this.
          //
          description="Send a message and send value in the same thread, so a payment reads like part of the conversation instead of a receipt from somewhere else. Messages carry no deposit and travel off-chain; sending money is a pool transaction like any other."
          alreadyTrue={[
            'The message contract is deployed on Starknet mainnet',
            'Your account exists in this browser already, with no wallet to connect',
          ]}
          icon={<ChatMark />}
        />

        <BlockedButton
          blocker={blocker}
          action="Send money in a thread"
          // The seam the real handler goes into, same as `/swap`'s. Empty rather than a throw: this
          // is unreachable while the blocker chain always ends in a reason.
          onPress={() => {}}
        />
      </div>
    </Surface>
  )
}

/** A bubble with a value mark inside it — the thing this surface is actually about. */
function ChatMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M12 8v8M9.5 10.5h5M9.5 13.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
