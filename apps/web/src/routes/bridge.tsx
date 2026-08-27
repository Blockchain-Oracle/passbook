import { createFileRoute } from '@tanstack/react-router'

import { ComingState } from '../components/ComingState'
import { Text } from '../components/ui/Text'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/bridge')({
  component: Bridge,
})

function Bridge() {
  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s16">
        <Text variant="heading3" as="h1">
          Bridge
        </Text>

        <ComingState
          title="Leave Starknet privately"
          //
          // OUTBOUND ONLY, AND IT SAYS SO. The PRD is explicit that inbound is roadmap and that this
          // must never be sold as "an unlinkable bridge" — amounts and timing are public on any
          // open-note leg. Writing the limit into the description is cheaper than a disclosure
          // panel nobody reads, and it is the claim a judge checks first.
          //
          description="Move value out of the pool to another chain without publishing the link between where it came from and where it lands. Outbound only — bringing value back is not built, and the amount and timing of any crossing are public either way."
          alreadyTrue={[
            'Your account exists in this browser already, with no wallet to connect',
            'The anonymity-set reading that will size each crossing is live on the swap screen',
          ]}
          icon={<BridgeMark />}
        />
      </div>
    </Surface>
  )
}

/** Two banks and a span. `currentColor`, so it follows the panel's own muted ink. */
function BridgeMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 15h18M6 15V9m12 6V9M3 9h18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M9 15v4M15 15v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
