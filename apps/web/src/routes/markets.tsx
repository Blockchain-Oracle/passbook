import { createFileRoute } from '@tanstack/react-router'

import { ComingState } from '../components/ComingState'
import { Text } from '../components/ui/Text'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/markets')({
  component: Markets,
})

function Markets() {
  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s16">
        <Text variant="heading3" as="h1">
          Markets
        </Text>

        <ComingState
          title="Bet without being the bettor"
          //
          // THE PRIVACY CLAIM IS NARROW AND IT IS STATED HERE RATHER THAN IN A FOOTNOTE. Bet sizes
          // and odds are public by design; what is hidden is WHO. FR-009 goes further — a bet is
          // only hidden while your denomination has company, and being alone at a size identifies
          // you. That is exactly what the anonymity-set meter measures, which is why the second
          // claim below is the one that matters on this surface.
          //
          description="Take a side on whether a price ends up over or under, with your identity hidden but the size and the odds public. Being the only one at a given size makes a bet identifiable, so the crowd around you is part of what you are choosing."
          alreadyTrue={[
            'Your account exists in this browser already, with no wallet to connect',
            'The meter that counts how many others share your size reads the pool live',
          ]}
          icon={<MarketsMark />}
        />
      </div>
    </Surface>
  )
}

/** Two bars, one up one down — the binary shape, not a generic chart. */
function MarketsMark() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 20V10M10 20V4M16 20v-7M22 20V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}
