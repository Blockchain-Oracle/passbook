import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { SEND_STAGES } from '@strk20/protocol/pipeline-stage'
import { stepsFor } from '@strk20/protocol/progress'
import { meterFor } from '@strk20/protocol/linkability'
import { maxSeverity } from '@strk20/protocol/privacy'
import type { TokenInfo } from '@strk20/protocol/token-list'

import { BlockedButton } from '../components/BlockedButton'
import { CurrencyPanel } from '../components/CurrencyPanel'
import { LinkabilityMeter } from '../components/LinkabilityMeter'
import { NoteField } from '../components/NoteField'
import { ProgressMachine } from '../components/ProgressMachine'
import { SwapDirectionButton } from '../components/SwapDirectionButton'
import { TokenSelector } from '../components/TokenSelector'
import { Text } from '../components/ui/Text'
import { currentBlocker, getHealth, subscribeHealth } from '../shell/pool-health'
import { useCrowd } from '../shell/use-crowd'
import { useTokenList } from '../shell/use-token-list'
import { Surface } from '../shell/Surface'

// Computed once at module scope: the rows are a pure function of the stage list, and nothing on
// this surface can change them until a swap can actually start.
const PREVIEW_STEPS = stepsFor({ stages: SEND_STAGES, reached: [] })

export const Route = createFileRoute('/swap')({
  component: Swap,
})

//
// THE SWAP SURFACE.
//
// ── WHAT IS REAL ON THIS SCREEN AND WHAT IS NOT, STATED PLAINLY ───────────────────────────
//
// REAL: the asset list (fetched from AVNU's routable set, every entry's `decimals()` confirmed
// against its own contract), the token marks, the crowd reading behind the linkability meter (a
// live bounded read over on-chain events), and every state the CTA can be in.
//
// NOT REAL YET: the quote and the execution. There is no price on this screen, and the CTA says so
// rather than showing a number nobody computed. When the quote pipeline lands, it fills the output
// panel and the blocker chain loses its last link — nothing else here moves.
//
// That split is the same discipline the progress machine below keeps: `preview` steps are an
// HONEST render of a pipeline that has not started, not a fixture made to look busy.
//

/**
 * Which side of the form a token selection is for.
 *
 * `null` means the picker is closed. One piece of state rather than two booleans, because "both
 * pickers open" is a state that must not be representable.
 */
type PickerSide = 'sell' | 'buy' | null

function Swap() {
  const health = useSyncExternalStore(subscribeHealth, getHealth, getHealth)
  const { tokens, loading: tokensLoading } = useTokenList()
  const crowd = useCrowd()

  const [sellToken, setSellToken] = useState<TokenInfo | null>(null)
  const [buyToken, setBuyToken] = useState<TokenInfo | null>(null)
  const [sellAmount, setSellAmount] = useState('')
  const [picker, setPicker] = useState<PickerSide>(null)

  // The list is volume-ordered, so the first entry is the deepest market. Defaulting the sell side
  // to it means the form is usable on arrival instead of asking for two decisions before anything
  // can happen. The BUY side is deliberately left empty — picking what you want is the user's
  // decision, and pre-filling it would put a pair on screen nobody chose.
  const defaultedSell = sellToken ?? tokens[0] ?? null

  const flip = useCallback(() => {
    setSellToken(buyToken)
    setBuyToken(defaultedSell)
    // The typed figure belonged to the old sell side. Carrying it across would silently restate an
    // amount of one asset as an amount of another.
    setSellAmount('')
  }, [buyToken, defaultedSell])

  const meter = useMemo(
    () => meterFor({ reading: crowd, amountWei: null, decimals: defaultedSell?.decimals ?? null }),
    [crowd, defaultedSell],
  )

  const meterSeverity = maxSeverity(
    meter.state === 'measured' && meter.severity !== null ? [meter.severity] : [],
  )

  //
  // THE BLOCKER CHAIN (§7.10), ordered so the reason a person can act on comes first.
  //
  // The global stop leads: a paused pool outranks every local question, because entering a valid
  // amount does not become possible when the pool returns — it becomes RELEVANT again.
  //
  // "Swap is not built yet" is LAST even though it is the one nothing can clear. First would be
  // more literal and less useful: the form's own states would never reach the button they are
  // supposed to be reported on, and the user would learn nothing about what they typed.
  //
  const blocker =
    currentBlocker(health) ??
    (tokensLoading ? 'Loading assets' : null) ??
    (tokens.length === 0 ? 'Asset list unavailable' : null) ??
    (defaultedSell === null || buyToken === null ? 'Select an asset' : null) ??
    (sellAmount.trim() === '' || Number(sellAmount) === 0 ? 'Enter an amount' : null) ??
    'Swap is not built yet'

  return (
    <Surface routeId={Route.fullPath}>
      {/* The 480px column Uniswap uses for every value form. `mx-auto` so it centres on a desktop
          and `w-full` so it fills a phone. */}
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-s8">
        <Text variant="heading3" as="h1">
          Swap
        </Text>

        {/* The two panels, welded: 2px apart with their facing corners squared, so they read as one
            control with a seam rather than two stacked cards. */}
        <div className="flex flex-col gap-s2">
          <CurrencyPanel
            label="Sell"
            corners="top"
            value={sellAmount}
            onValueChange={setSellAmount}
            token={defaultedSell}
            onSelectToken={() => setPicker('sell')}
            // No balance line: no shielded balance has been read on this surface, and a "Balance: 0"
            // would be a number nobody measured. The row still reserves its height.
            balanceLabel={null}
          />

          <SwapDirectionButton onPress={flip} disabled={buyToken === null} />

          <CurrencyPanel
            label="Buy"
            corners="bottom"
            // READ-ONLY, and empty. This is the quote's slot; there is no quote pipeline yet, so it
            // shows nothing rather than echoing the sell figure as though a price of 1:1 had been
            // found. The CTA carries the reason.
            value=""
            readOnly
            token={buyToken}
            onSelectToken={() => setPicker('buy')}
          />
        </div>

        {/* The meter above the thumb, where the consequence is read before the action is taken. */}
        <LinkabilityMeter meter={meter} />

        <BlockedButton
          blocker={blocker}
          action="Review swap"
          // Unreachable while the chain always ends in a blocker, and it stays here rather than
          // becoming a `throw`: the day the last link comes off, this is the seam the real handler
          // goes into, and an empty function is a clearer marker of that than a crash would be.
          onPress={() => {}}
          severity={meterSeverity}
        />

        {/*
          THE MACHINE, AT `preview`, AND THAT IS AN HONEST RENDER RATHER THAN A FIXTURE.

          `preview` MEANS "not yet real" — the status the design gives a step whose icon is withheld
          because the future has not happened. A swap pipeline that has not started is genuinely in
          that state for all five steps, so this shows the user the real shape of the wait they are
          about to take on. Handing it fabricated `reached` stages to make the ring spin would be the
          fixture-as-truth the anti-demo gate exists to stop.
        */}
        <ProgressMachine
          steps={PREVIEW_STEPS}
          label="Swap progress"
          field={
            meter.state === 'measured' ? (
              <NoteField
                field={meter.field}
                label={`${meter.candidates} possible sources, including yours`}
              />
            ) : undefined
          }
        />
      </div>

      <TokenSelector
        open={picker !== null}
        onOpenChange={(open) => setPicker(open ? picker : null)}
        tokens={tokens}
        loading={tokensLoading}
        selectedAddress={picker === 'sell' ? defaultedSell?.address : buyToken?.address}
        onSelect={(token) => {
          if (picker === 'sell') {
            setSellToken(token)
            // Choosing the same asset on both sides is not a swap. Clearing the other side is
            // gentler than refusing the tap, and it leaves the user one decision from a valid pair.
            if (buyToken && BigInt(buyToken.address) === BigInt(token.address)) setBuyToken(null)
          } else {
            setBuyToken(token)
            if (defaultedSell && BigInt(defaultedSell.address) === BigInt(token.address)) {
              setSellToken(null)
            }
          }
        }}
      />
    </Surface>
  )
}
