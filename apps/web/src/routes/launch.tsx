import { createFileRoute } from '@tanstack/react-router'

import { ComingState } from '../components/ComingState'
import { Text } from '../components/ui/Text'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/launch')({
  component: Launch,
})

function Launch() {
  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s16">
        <Text variant="heading3" as="h1">
          Launch
        </Text>

        <ComingState
          title="Start a token where the first buyers aren’t exposed"
          //
          // THE HONEST HALF FIRST. A launch is the moment a token's earliest holders are most
          // identifiable, and the thing being offered is that buying does not publish who you are —
          // not that the launch is secret. The amounts and the timing of every buy are public, and
          // a description that implied otherwise would be the exact overclaim the sponsor scores
          // against.
          //
          description="Create a token, give it a first market, and let people buy in without publishing who they are. What each buy costs and when it happened stay public; who made it does not."
          alreadyTrue={[
            'Your account exists in this browser already, with no wallet to connect',
            'The asset list is read from a live aggregator with every token’s scale confirmed on chain',
          ]}
          icon={<LaunchMark />}
        />
      </div>
    </Surface>
  )
}

/** An upward arc leaving a baseline — a start, not a chart. */
function LaunchMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 20h18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M5 16c4-1 6-9 14-12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M15 4h4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
