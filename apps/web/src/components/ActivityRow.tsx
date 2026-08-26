//
// THE activity row — one renderer for every entry in the book (story 6.6, EXPERIENCE §4.8).
//
// It is `OptionRowBody` with a state in the right slot, and that is not a shortcut. The design
// authority states the activity row's own geometry as `{ radius: 16, py: 8, gap: 12, icon: 40 }`
// (`tokens.yaml` `components.activityRow`) and `.option-row-inner` already ships all four — so the
// two rows are the same row, and building a second one would have meant two ellipsis behaviours,
// two truncation bugs and two places to fix each.
//
// ── THE ROW IS NOT A LINK, AND THAT IS A CORRECTION ──────────────────────────────────────
//
// The first version wrapped the whole row in a `<Link>`. Two of the five slot states put an `<a>`
// or a `<button>` inside it, and interactive content may not nest inside an anchor: the parser
// hoists the inner `<a>` out on any hydrated path, the tab order stops matching the visual order,
// and `preventDefault` patches the click while leaving the semantics broken. So the row is a
// container, its TITLE is the link to the receipt, and the slot's own controls are siblings.
//
// ── THE SLOT SWAP IS THE WHOLE GRAMMAR ───────────────────────────────────────────────────
//
// §4.8: "pending/confirmed is a slot-swap at the right edge (timestamp ↔ spinner ↔ static ring)".
// One reserved box whose contents change, never a conditional element that appears and pushes. The
// reserve is `.activity-right`'s `min-width`, and `build:web` resolves it to a number.
//
// ── AND THE STILL RING IS A CLAIM ────────────────────────────────────────────────────────
//
// A maturing note gets a ring that does NOT turn — "a still ring means the clock runs, nothing is
// stuck". Reusing `.step-ring` here would look right and say something false: that spinner exists
// because we cannot observe a hosted prover's progress, and nothing is being observed while a note
// ages. `.activity-ring-static` is the same geometry with no animation, and both the build gate and
// `activity-gate.test.ts` fail if one is ever given to the other.
//
import { activityRowModel, rightSlot, type RightSlot, type Transaction } from '@strk20/protocol/transaction'
import { CHECK_ON_VOYAGER } from '@strk20/protocol/activity-copy'

import { OptionRowBody } from './OptionRow'

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
}

export function ActivityRow({ transaction, now, settling, onSettleShown, onRetry }: ActivityRowProps) {
  const slot = rightSlot(transaction, now)

  return (
    <li
      className={`option-row activity-row${settling ? ' attention-highlight' : ''}`}
      onAnimationEnd={settling ? onSettleShown : undefined}
    >
      <OptionRowBody
        row={activityRowModel(transaction, now)}
        titleTo={{ to: '/activity/$id', params: { id: transaction.id } }}
        rightSlot={<span className="activity-right">{renderSlot(slot, transaction, onRetry)}</span>}
      />
    </li>
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
      return <span className="numeric text-neutral3 not-yet-real">{slot.text}</span>

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
          <span className="numeric text-neutral3 not-yet-real">{slot.text}</span>
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
            screen reader and a greyscale reader both get. The row's subtitle already carries the
            reason; this says what KIND of thing the reason is.
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
      // subtitle, because a sentence in this slot sizes the slot to the sentence and collapses the
      // title column; what is left here is the action, which is two words wide.
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
