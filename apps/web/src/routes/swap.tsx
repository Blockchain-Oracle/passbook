import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'

// `token-scale`, never `balances`: the balance model reaches the privacy SDK through the discovery
// walk, and importing it here shipped 266 kB of chain-walking code to fetch one integer. `build:web`
// caught that as a single unexpected externalization warning — see the note in `token-scale.ts`.
import { KNOWN_TOKEN_DECIMALS } from '@strk20/protocol/token-scale'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import type { OptionRow, OptionSection } from '@strk20/protocol/option-row'
import type { Valued } from '@strk20/protocol/amount'

import { SEND_STAGES } from '@strk20/protocol/pipeline-stage'
import { stepsFor } from '@strk20/protocol/progress'

import { meterFor } from '@strk20/protocol/linkability'
import { maxSeverity } from '@strk20/protocol/privacy'

import { AmountInput, useAmountField } from '../components/AmountInput'
import { BlockedButton } from '../components/BlockedButton'
import { LinkabilityMeter } from '../components/LinkabilityMeter'
import { NoteField } from '../components/NoteField'
import { OptionList } from '../components/OptionList'
import { ProgressMachine } from '../components/ProgressMachine'
import { currentBlocker, getHealth, subscribeHealth } from '../shell/pool-health'
import { useCrowd } from '../shell/use-crowd'
import { Surface } from '../shell/Surface'

// Computed once at module scope: the rows are a pure function of the stage list, and nothing on
// this surface can change them until a swap can actually start.
const PREVIEW_STEPS = stepsFor({ stages: SEND_STAGES, reached: [] })

export const Route = createFileRoute('/swap')({
  component: Swap,
})

//
// THE SPINE'S FIRST CONSUMER.
//
// Swap itself is a later epic — no quote, no route, no submission, and this file contains none of
// those. What it does is stand the 6.4 primitives up on a real surface, because a component with no
// caller is a component nobody has looked at.
//
// ── EVERY NUMBER ON THIS SCREEN IS TRUE, INCLUDING THE ABSENT ONES ────────────────────────
//
// There is no session in this app yet, so there is no shielded balance to read — and the honest
// rendering of "we have not read your balance" is NOT a plausible-looking number. The balance line
// says what it does not know, in the not-yet-real encoding, and `available` stays `null` so nothing
// downstream can compute a shortfall against a balance that was never read.
//
// The token list is the same discipline. STRK is here because `KNOWN_TOKEN_DECIMALS` records its
// scale as read live on mainnet; nothing else is here because nothing else has been verified, and
// the short list is the true one.
//

/** The verified token, and the only one. See `balances.ts` on why this map is nearly empty. */
const STRK_DECIMALS = KNOWN_TOKEN_DECIMALS[STRK_TOKEN] ?? null

/**
 * Hoisted to module scope DELIBERATELY, not for render cost.
 *
 * `AmountInput` reads a refetch as "a new object carrying an equal value" and pulses the balance
 * line when it sees one. An object literal written inline in the JSX is a new object on every single
 * render, so the line would pulse on every keystroke — a refetch animation firing for something that
 * never refetched.
 */
const NO_BALANCE_READ: Valued<string> = {
  // Short on purpose. `.amount-balance` is `nowrap` + ellipsis so its 20px reserve is a guarantee
  // rather than a floor, which means a sentence long enough to wrap gets truncated instead of
  // pushing the layout. The reason belongs in the surface's own paragraph, not on this line.
  value: 'Shielded balance not read',
  confidence: 'unknown',
}

const SHIELDED_TOKENS: OptionRow[] = [
  {
    id: 'strk',
    title: 'STRK',
    titleSuffix: 'Starknet Token',
    subtitle: STRK_TOKEN,
    subtitleIsMono: true,
    right: { value: 'Balance not read', confidence: 'unknown' },
  },
]

/** The id the toggle's `aria-controls` points at. Static: there is one of these on the surface. */
const LIST_ID = 'swap-asset-list'

function Swap() {
  const [selecting, setSelecting] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)

  const closeList = useCallback(() => {
    setSelecting(false)
    toggleRef.current?.focus()
  }, [])

  // The same app-wide reading `/chat` and the shell strip read. Subscribed, so a pool that pauses
  // while this surface is open relabels the CTA rather than leaving a stale one live.
  const health = useSyncExternalStore(subscribeHealth, getHealth, getHealth)

  const field = useAmountField({
    decimals: STRK_DECIMALS,
    // Not a zero, and not a guess. `insufficient()` treats an unread balance as "not a shortfall",
    // because colouring a number red on a balance nobody read tells the user their money is short
    // when it may not be.
    available: null,
  })

  const sections = useMemo<OptionSection[]>(
    () => [
      { key: 'shielded', rows: SHIELDED_TOKENS },
      // Deliberately empty rather than absent: the public section exists in the grammar, and
      // `filterSections` drops it while it has nothing in it. Populating it would mean claiming to
      // have read a public balance, which is the Wallet epic's story.
      { key: 'public', rows: [] },
    ],
    [],
  )

  //
  // THE BLOCKER CHAIN (§7.10), ORDERED — and the ordering is a judgement worth reading.
  //
  // "Swap is not built yet" is LAST, not first, even though it is the one nothing can clear. First
  // would be more literal and less useful: it would make the CTA a constant, so the amount input's
  // own states — enter something, that is more than you have — would never reach the button they
  // are supposed to be reported on. Last, the chain still ends at the truth and never claims the
  // button will work, and the surface's own paragraph says so above the fold.
  //
  //
  // THE GLOBAL STOP GOES FIRST, and this surface was missing it. `/chat` read the shared degraded
  // reading and `/swap` — the surface with the money CTA — did not, so with the pool paused the
  // strip above the fold said so while the button below it still read "Enter an amount". A CTA
  // whose stated reason omits an app-wide stop the app has already detected and is displaying is
  // the "one surface forgets and renders a live CTA over a dead pool" case `pool-health.ts` names.
  //
  // Ahead of the field's own states because it outranks them: entering a valid amount does not
  // become possible when the pool comes back, it becomes RELEVANT again.
  //
  // AD-14's bounded read, in its own chunk. Unmeasurable until it returns, which is true.
  const crowd = useCrowd()
  const meter = useMemo(
    () => meterFor({ reading: crowd, amountWei: field.wei, decimals: STRK_DECIMALS }),
    [crowd, field.wei],
  )

  // `none` when there is no verdict to carry, so `ctaSeverity` emits no attribute at all rather
  // than a colour standing for a measurement nobody has.
  const meterSeverity = maxSeverity(
    meter.state === 'measured' && meter.severity !== null ? [meter.severity] : [],
  )

  const blocker =
    currentBlocker(health) ??
    field.problem ??
    (field.wei === null || field.wei === 0n ? 'Enter an amount' : null) ??
    (field.short ? 'Not enough shielded STRK' : null) ??
    'Swap is not built yet'

  return (
    <Surface routeId={Route.fullPath}>
      <h1 className="text-heading3">Swap</h1>
      <p className="text-body3 text-neutral2">
        Exchanging one asset for another will happen here. The amount field and the asset list below
        are real and shared with every other value surface; the swap itself is built in a later
        story.
      </p>

      <AmountInput field={field} symbol="STRK" label="Amount to swap" balance={NO_BALANCE_READ} />

      <button
        ref={toggleRef}
        type="button"
        // `disclosure-toggle`, not `amount-chip`. The chip recipe is the additive `+1 / +5 / +20`
        // control and says so in its own comment; borrowing it for an unrelated toggle is how one
        // class quietly becomes two meanings and stops being re-themable as either.
        className="disclosure-toggle focus-ring"
        aria-expanded={selecting}
        aria-controls={LIST_ID}
        onClick={() => setSelecting((open) => !open)}
      >
        {selecting ? 'Hide assets' : 'Choose an asset'}
      </button>

      {selecting ? (
        <div id={LIST_ID}>
          <OptionList
            sections={sections}
            label="Search assets"
            placeholder="Search assets"
            // FOCUS COMES BACK HERE. The list unmounts on select and on dismiss, and it unmounts
            // with focus inside its own search box — so without this, focus falls to `<body>` and a
            // keyboard user is dropped at the top of the document. The command palette closes
            // before it runs a command for the same reason.
            onSelect={() => closeList()}
            onDismiss={() => closeList()}
          />
        </div>
      ) : null}

      {/*
        THE METER, ON A REAL READING, AND THAT IS THE SAME DISCIPLINE AS THE MACHINE BELOW.

        `useCrowd` performs AD-14's bounded, client-side read and hands back what it found. There is
        no `PREVIEW_CROWD` fixture, for the reason the progress machine has no fabricated stages: a
        made-up count is a made-up privacy MEASUREMENT, which is worse than a made-up step. Until
        the read returns — and on any pool where it finds nothing — the meter renders its
        unmeasurable state, which is what is actually true.

        No `onWaitForDeposits` and no `onSplitAmount`, so both alternatives render as words. Neither
        action exists, and `Split the amount`'s mechanics are an explicit GAP (EXPERIENCE:800).
      */}
      <LinkabilityMeter meter={meter} />

      <BlockedButton
        blocker={blocker}
        action="Review swap"
        // Unreachable while the chain always ends in a blocker, and it stays here rather than
        // becoming a `throw`: the day the last link comes off, this is the seam the real handler
        // goes into, and an empty function is a clearer marker of that than a crash would be.
        onPress={() => {}}
        // THE METER'S VERDICT REACHES THE THUMB. `maxSeverity` rather than the meter's level alone,
        // so the day this surface also mounts a disclosure panel the louder of the two wins through
        // the one ladder instead of two channels racing.
        severity={meterSeverity}
      />

      {/*
        THE MACHINE, AT `preview`, AND THAT IS AN HONEST RENDER RATHER THAN A FIXTURE.

        `preview` MEANS "not yet real" — it is the status the design gives a step whose icon is
        withheld because the future has not happened. A swap pipeline that has not started is
        genuinely in that state for all five steps, so this shows the user the real shape of the
        wait they are about to take on. Handing it fabricated `reached` stages to make the ring
        spin would be the fixture-as-truth the anti-demo gate exists to stop.
      */}
      {/*
        THE SAME PICTURE, ABOVE THE WAIT (C08:229, DESIGN:423).

        Not a second drawing kept in sync with the meter's — literally the same component, mounted
        twice, which is what makes "the same picture" a fact a grep can check rather than a promise.
        Rendered only when there is a crowd to draw: a field with nothing measured behind it would
        be decoration standing where a measurement belongs.
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
    </Surface>
  )
}
