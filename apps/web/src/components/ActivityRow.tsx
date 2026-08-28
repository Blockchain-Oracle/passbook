//
// THE activity row — one renderer for every entry in the book (story 6.6, EXPERIENCE §4.8).
//
// ── REBUILT ONTO ITS OWN ANATOMY, AND HERE IS WHY IT LEFT `OptionRowBody` ────────────────
//
// It used to BE the selector row with a state in the right slot, which was the correct call while
// the two rows wanted the same three columns. A wallet-grade history wants five things the option
// row has no slot for and should not grow one for: a tinted category disc, a counterparty line, a
// signed amount, a status chip, and a whole row that is a link to the receipt. Widening the shared
// anatomy to carry them would have pushed six unrelated lists — tokens, contacts, routes — into
// carrying an activity row's vocabulary. So the row owns its own layout in utilities, and
// `OptionRow` goes back to being the row a SELECTOR uses.
//
// ── THE ROW IS NOT A LINK, AND THAT IS A CORRECTION THAT STILL STANDS ────────────────────
//
// Two of the five slot states put an `<a>` or a `<button>` inside the row, and interactive content
// may not nest inside an anchor: the parser hoists the inner `<a>` out on any hydrated path, the
// tab order stops matching the visual order, and `preventDefault` patches the click while leaving
// the semantics broken. So the row is a container, its TITLE is the link to the receipt, and the
// slot's own controls are siblings.
//
// ── THE SLOT SWAP IS STILL THE GRAMMAR ───────────────────────────────────────────────────
//
// §4.8: "pending/confirmed is a slot-swap at the right edge (timestamp ↔ spinner ↔ static ring)".
// One reserved box whose contents change, never a conditional element that appears and pushes. The
// reserve is `.activity-right`'s `min-width`, and `build:web` resolves it to a number — which is
// why that class survives the rebuild while the rest of the row's styling became utilities.
//
// ── AND THE STILL RING IS A CLAIM ────────────────────────────────────────────────────────
//
// A maturing note gets a ring that does NOT turn — "a still ring means the clock runs, nothing is
// stuck". Reusing `.step-ring` here would look right and say something false: that spinner exists
// because we cannot observe a hosted prover's progress, and nothing is being observed while a note
// ages. `.activity-ring-static` is the same geometry with no animation, and both the build gate and
// `activity-gate.test.ts` fail if one is ever given to the other.
//
import { Link } from '@tanstack/react-router'

import {
  activityCategory,
  amountDirection,
  rightSlot,
  rowAmountWei,
  rowCounterparty,
  rowTitle,
  type RightSlot,
  type Transaction,
} from '@strk20/protocol/transaction'
import { CHECK_ON_VOYAGER } from '@strk20/protocol/activity-copy'
import { AMOUNT_UNREADABLE, AMOUNT_UNREADABLE_WHY } from '@strk20/protocol/history-copy'
import { MINUS, toPlainText } from '@strk20/protocol/amount'

import { cn } from '../lib/cn'
import { findToken, useTokenList } from '../shell/use-token-list'
import { shortenFelt } from '../shell/session'
import { CategoryDisc } from './CategoryDisc'

export interface ActivityRowProps {
  transaction: Transaction
  /** The clock, passed in. Nothing here calls `Date.now()` — see `rightSlot`. */
  now: number
  /**
   * True while the once-only settle cue should play.
   *
   * §4.8: a matured row "gains its timestamp without reflow and plays the 1.2s attention highlight
   * ONCE — never a toast". The `once` is CSS's (`animation-iteration-count: 1`); the row reports
   * the end of the animation so its owner can drop the class at the right moment rather than on
   * whichever render happens next.
   */
  settling?: boolean
  onSettleShown?: () => void
  /**
   * What a retryable failure does.
   *
   * OPTIONAL, AND ABSENT TODAY ON PURPOSE. Nothing in epic 6 submits, so nothing can retry, and a
   * `Retry` button wired to a no-op is worse than no button — it is the failure grammar's whole
   * point that a stated recovery works. When a caller can retry it passes this; until then a
   * retryable row says it failed and says what stopped it, in words, without offering a lie.
   */
  onRetry?: (transaction: Transaction) => void
  /**
   * Open the receipt IN PLACE — [STUDIO] the detail is a sheet over the record, not a page turn.
   * When absent the title falls back to the deep-link route, which is the same receipt at a URL.
   */
  onOpen?: (transaction: Transaction) => void
}

export function ActivityRow({ transaction, now, settling, onSettleShown, onRetry, onOpen }: ActivityRowProps) {
  const slot = rightSlot(transaction, now)
  const category = activityCategory(transaction)
  const counterparty = rowCounterparty(transaction)
  const failedReason = transaction.chain.state === 'failed' ? transaction.chain.reason : null

  return (
    <li
      className={cn(
        'group flex items-center gap-s12 rounded-card px-s12 py-s8',
        'transition-colors duration-[var(--transition-duration-fastHeavy)] ease-glide',
        // ONE STATE FROM EITHER INPUT (§6), and the focus half is `focus-within` because the thing
        // that takes focus is the title link inside the row. Without it, tabbing through the feed
        // moves a ring around inside rows that never change, which reads as nothing happening.
        'hover:bg-inset focus-within:bg-inset',
        settling ? 'attention-highlight' : '',
      )}
      onAnimationEnd={settling ? onSettleShown : undefined}
    >
      <CategoryDisc category={category} />

      <div className="flex min-w-0 flex-1 flex-col gap-s2">
        {/*
          The TITLE is the control, not the row. See the header — this is the one element in the
          row that is unambiguously the thing being named, and it keeps the inner controls legal.
          A button when the feed opens a modal; the route link otherwise.
        */}
        {onOpen ? (
          <button
            type="button"
            onClick={() => onOpen(transaction)}
            className="focus-ring cursor-pointer truncate bg-transparent p-s0 text-left text-body2 text-neutral1 hover:underline"
          >
            {rowTitle(transaction)}
          </button>
        ) : (
          <Link
            to="/activity/$id"
            params={{ id: transaction.id }}
            className="focus-ring truncate text-body2 text-neutral1 no-underline hover:underline"
          >
            {rowTitle(transaction)}
          </Link>
        )}

        {/*
          THE SECOND LINE, in priority order: why it failed, then who the other party was, then
          nothing. A failure reason outranks a counterparty because it is the only line that tells
          the reader what to do next.
        */}
        {failedReason ? (
          <span className="truncate text-body4 text-exposed">{failedReason}</span>
        ) : counterparty ? (
          <span className="truncate font-mono text-mono text-neutral3">
            {category === 'received' ? 'from ' : category === 'sent' ? 'to ' : ''}
            {shortenFelt(counterparty, 8, 6)}
          </span>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-col items-end gap-s2">
        <Amount transaction={transaction} />
        <span className="activity-right flex items-center justify-end gap-s6">
          {renderSlot(slot, transaction, onRetry)}
        </span>
      </div>
    </li>
  )
}

/**
 * The amount, signed, or an honest dash.
 *
 * ── THE SIGN IS A CLAIM AND IT IS ONLY MADE WHERE IT IS TRUE ─────────────────────────────
 *
 * `amountDirection` answers `none` for a stranger's note movement, a registration and a system
 * note, and this renders those without a sign — a `+` on somebody else's note-created would say
 * that value arrived here, which is precisely the attribution the record refuses to make.
 *
 * ── AND THE COLOUR NEVER CARRIES IT ALONE ────────────────────────────────────────────────
 *
 * The `+`/`−` glyph is the channel that survives greyscale and every form of colour blindness;
 * `settled` green is the second one, spent only on value that ARRIVED. Outgoing value is plain
 * ink, not red: `irreversible` is reserved for the genuinely irreversible, and an ordinary send is
 * not that.
 */
function Amount({ transaction }: { transaction: Transaction }) {
  const { tokens } = useTokenList()
  const wei = rowAmountWei(transaction)
  const direction = amountDirection(transaction)

  if (wei === null) {
    return (
      <span className="numeric text-body3 text-neutral3" title={AMOUNT_UNREADABLE_WHY}>
        {AMOUNT_UNREADABLE}
      </span>
    )
  }

  const token = transaction.chain.state === 'settled' ? transaction.chain.entry.token : null
  const known = token ? findToken(tokens, token) : null
  // An unverified scale is shown in raw units and said so, for `HoldingRow`'s reason: a guessed 18
  // on a 6-decimal token misplaces the value by a factor of a million, in the direction that looks
  // like dust.
  const amount = known?.decimals != null ? toPlainText(wei, known.decimals) : `${wei.toString()} raw`
  const sign = direction === 'in' ? '+' : direction === 'out' ? MINUS : ''

  return (
    <span
      className={cn(
        'numeric text-body3',
        direction === 'in' ? 'text-settled' : 'text-neutral1',
      )}
    >
      {sign}
      {amount}
      {known ? <span className="text-neutral2"> {known.symbol}</span> : null}
    </span>
  )
}

function renderSlot(
  slot: RightSlot,
  transaction: Transaction,
  onRetry?: (transaction: Transaction) => void,
) {
  switch (slot.kind) {
    case 'block':
      // `not-yet-real` on a block count, per the authority's `notYetReal.appliesTo`, which names
      // block counts and timestamps explicitly. The dotted underline is the channel that survives
      // greyscale and colour blindness; `neutral3` alone measures 2.12–2.18:1 and may never carry
      // the meaning by itself.
      return <span className="numeric text-body4 text-neutral3 not-yet-real">{slot.text}</span>

    case 'spinner':
      return (
        <>
          <span className="text-body4 text-neutral2">{slot.text}</span>
          <span className="step-ring" role="presentation" />
        </>
      )

    case 'static-ring':
      return (
        <>
          <span className="numeric text-body4 text-neutral3 not-yet-real">{slot.text}</span>
          <span className="activity-ring-static" role="presentation" />
        </>
      )

    case 'failed':
      return (
        <>
          {/*
            AMBER, NEVER RED. §5's colour discipline spends `irreversible` only on the genuinely
            irreversible, and nothing in this feed is: a failed send charged nothing and moved
            nothing.

            AND IT SHIPS ITS WORD. The epic's enforced rule is that semantic colour never carries
            meaning as hue alone — so the mark is decorative and the word beside it is what a
            screen reader and a greyscale reader both get. The row's second line already carries
            the reason; this says what KIND of thing the reason is.
          */}
          <span className="activity-failed-mark" aria-hidden="true">
            ▲
          </span>
          <span className="text-body4 text-neutral2">Failed</span>
          {slot.retryable && onRetry ? (
            <button
              type="button"
              className="activity-retry focus-ring"
              onClick={() => onRetry(transaction)}
            >
              Retry
            </button>
          ) : null}
        </>
      )

    case 'not-indexed':
      // NEVER VANISHES (§11 checklist 9). A transaction we submitted and cannot find is the row a
      // user most needs to keep looking at. The FACT — "Submitted, not yet indexed" — is the row's
      // second line, because a sentence in this slot sizes the slot to the sentence and collapses
      // the title column; what is left here is the action, which is two words wide.
      return slot.href === null ? null : (
        <span className="activity-not-indexed">
          <a className="focus-ring" href={slot.href} target="_blank" rel="noreferrer">
            {CHECK_ON_VOYAGER} ↗
          </a>
        </span>
      )

    default: {
      //
      // A SIXTH SLOT SHAPE IS A COMPILE ERROR HERE, and without this it would not be. The switch
      // returns from every arm, so a new union member simply falls through and `renderSlot` hands
      // back `undefined` — which React renders as nothing. The right edge would go blank for one
      // state with a green build and a green suite; `undefined` is assignable to `ReactNode`, so
      // even an explicit return type does not catch it. Assigning to `never` does.
      //
      const unhandled: never = slot
      throw new Error(`unhandled activity slot: ${JSON.stringify(unhandled)}`)
    }
  }
}
