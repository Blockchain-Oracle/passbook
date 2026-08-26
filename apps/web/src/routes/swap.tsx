import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useMemo, useRef, useState } from 'react'

// `token-scale`, never `balances`: the balance model reaches the privacy SDK through the discovery
// walk, and importing it here shipped 266 kB of chain-walking code to fetch one integer. `build:web`
// caught that as a single unexpected externalization warning — see the note in `token-scale.ts`.
import { KNOWN_TOKEN_DECIMALS } from '@strk20/protocol/token-scale'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import type { OptionRow, OptionSection } from '@strk20/protocol/option-row'
import type { Valued } from '@strk20/protocol/amount'

import { AmountInput, useAmountField } from '../components/AmountInput'
import { BlockedButton } from '../components/BlockedButton'
import { OptionList } from '../components/OptionList'
import { Surface } from '../shell/Surface'

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
  const blocker =
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

      <BlockedButton
        blocker={blocker}
        action="Review swap"
        // Unreachable while the chain always ends in a blocker, and it stays here rather than
        // becoming a `throw`: the day the last link comes off, this is the seam the real handler
        // goes into, and an empty function is a clearer marker of that than a crash would be.
        onPress={() => {}}
      />
    </Surface>
  )
}
