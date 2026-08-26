import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react'

import { SEND_STAGES } from '@strk20/protocol/pipeline-stage'
import { stepsFor } from '@strk20/protocol/progress'
import { meterFor } from '@strk20/protocol/linkability'
import { maxSeverity } from '@strk20/protocol/privacy'
import { parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import { DEFAULT_SLIPPAGE_BPS, minimumOut, priceImpact } from '@strk20/protocol/quote'
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
import { useQuote } from '../shell/use-quote'
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

  // The typed field, through the protocol's own parser — which owns the comma separator, the
  // second decimal point, and the two pastes that silently change a value's meaning.
  const parsed = useMemo(
    () => parseAmountInput(sellAmount, defaultedSell?.decimals ?? null),
    [sellAmount, defaultedSell],
  )

  const quote = useQuote({
    sellToken: defaultedSell?.address ?? null,
    buyToken: buyToken?.address ?? null,
    sellAmount: parsed.wei,
  })

  const quoted = quote.result?.state === 'quoted' ? quote.result.quote : null

  // What the output panel shows. Empty until there is a real quote — never an echo of the sell
  // figure, which would be a price of 1:1 that nobody computed.
  const buyDisplay =
    quoted && buyToken ? toPlainText(quoted.buyAmount, buyToken.decimals) : ''

  const impact = quoted ? priceImpact(quoted) : null

  // The floor the swap must clear. Computed here so the review step and the eventual transaction
  // read the same number, and so a zero can never reach a call — `minimumOut` throws on one.
  const minOut = quoted ? minimumOut(quoted.buyAmount, DEFAULT_SLIPPAGE_BPS) : null

  const meter = useMemo(
    () =>
      meterFor({
        reading: crowd,
        amountWei: parsed.wei,
        decimals: defaultedSell?.decimals ?? null,
      }),
    [crowd, parsed.wei, defaultedSell],
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
    // The parser's own sentence, when a paste meant something other than what it looked like.
    parsed.problem ??
    (parsed.wei === null || parsed.wei === 0n ? 'Enter an amount' : null) ??
    (quote.loading && !quote.stale ? 'Finding the best price' : null) ??
    (quote.result?.state === 'unavailable' ? quote.result.because : null) ??
    (quote.result?.state === 'no-route' ? 'No route for this pair' : null) ??
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
            // READ-ONLY: this is the quote's slot, and the venue decides what goes in it. Empty
            // until a real quote arrives — never an echo of the sell figure, which would be a
            // price of 1:1 that nobody computed.
            value={buyDisplay}
            readOnly
            token={buyToken}
            onSelectToken={() => setPicker('buy')}
            // Dimmed while a newer quote is in flight: the figure on screen is a REAL price for a
            // slightly older amount, which is worth showing and worth marking as not-yet-current.
            className={quote.stale ? 'opacity-60' : undefined}
          />
        </div>

        {quoted ? (
          <QuoteDetails
            rate={`1 ${defaultedSell?.symbol ?? ''} = ${
              buyToken && quoted.sellAmount > 0n
                ? toPlainText(
                    (quoted.buyAmount * 10n ** BigInt(defaultedSell?.decimals ?? 0)) /
                      quoted.sellAmount,
                    buyToken.decimals,
                  )
                : '—'
            } ${buyToken?.symbol ?? ''}`}
            impact={impact}
            minOut={
              minOut !== null && buyToken
                ? `${toPlainText(minOut, buyToken.decimals)} ${buyToken.symbol}`
                : null
            }
            route={quoted.routes.map((r) => r.name).join(' · ') || null}
          />
        ) : null}

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

/**
 * The rows under the form: rate, impact, floor, route.
 *
 * ── THE FLOOR IS SHOWN, NOT BURIED ────────────────────────────────────────────────────────
 *
 * Uniswap's review modal shows "Max slippage" as a percentage. This shows the resulting AMOUNT,
 * because a percentage is a setting and an amount is a consequence — and the consequence is the
 * thing a person can actually check against what they expected. It is also the number the
 * transaction will assert on-chain, so what is on screen is what gets enforced.
 *
 * ── AND THE IMPACT IS COLOURED ONLY WHEN IT IS WORTH COLOURING ────────────────────────────
 *
 * Below 1% it is ordinary text. A route that costs a fraction of a percent is not a warning, and
 * colouring every one of them spends the warning colour on the normal case — which is how a real
 * warning stops being read.
 */
function QuoteDetails({
  rate,
  impact,
  minOut,
  route,
}: {
  rate: string
  impact: number | null
  minOut: string | null
  route: string | null
}) {
  const impactPercent = impact === null ? null : impact * 100
  const loud = impactPercent !== null && impactPercent >= 1

  return (
    <dl className="flex flex-col gap-s8 rounded-card border border-solid border-surface3 p-s12">
      <Row label="Rate" value={rate} />
      {impactPercent !== null ? (
        <Row
          label="Price impact"
          value={`${impactPercent >= 0 ? '' : '+'}${Math.abs(impactPercent).toFixed(2)}%`}
          tone={loud ? 'exposed' : 'plain'}
        />
      ) : null}
      {minOut ? <Row label="Minimum received" value={minOut} /> : null}
      {route ? <Row label="Route" value={route} /> : null}
    </dl>
  )
}

function Row({
  label,
  value,
  tone = 'plain',
}: {
  label: string
  value: string
  tone?: 'plain' | 'exposed'
}) {
  return (
    <div className="flex items-baseline justify-between gap-s12">
      <Text as="dt" variant="body4" className="text-neutral2">
        {label}
      </Text>
      <Text
        as="dd"
        variant="body4"
        className={tone === 'exposed' ? 'numeric text-exposed' : 'numeric text-neutral1'}
      >
        {value}
      </Text>
    </div>
  )
}
