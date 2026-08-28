//
// One transaction, told as what happened to it (EXPERIENCE §2.3, Flow W4 §5) — the receipt.
//
// EXTRACTED FROM `routes/activity.$id.tsx` so it can render in TWO places without drifting: the
// deep-linkable receipt page, and the modal the feed opens in place ([STUDIO] — the prototype's
// activity detail is a sheet over the record, not a navigation). The words, the fee rules and the
// visibility matrix are identical in both because they are literally the same component.
//
// ── THE AMOUNT IS THE HEADLINE, AND IT USED NOT TO BE ────────────────────────────────────
//
// [Abu 2026-08-28] This opened as an eight-row definition list under an Anton title, with the
// amount as row two of eight and a five-by-four visibility table nailed underneath — every fact
// the same size as every other fact, so the reader had to READ the whole thing to find out how
// much money moved. The prototype's `ad.on` sheet answers the question in the first glance: a
// 26px mono figure, signed and coloured, then four short label/value lines, then the hash, then
// ONE sentence about what it revealed.
//
// So the rows are four, the hashes moved to a mono block of their own, and the matrix went behind
// a chevron. NOTHING WAS DELETED — the fee, the counterparty, the note commitment and all twenty
// matrix cells are still here, they are just no longer all shouting at once. A receipt whose
// hierarchy is flat is a receipt nobody reads to the end.
//
// ── THE SIGN AND THE COLOUR FOLLOW `ActivityRow`, EXACTLY ────────────────────────────────
//
// `amountDirection` answers `none` for a stranger's note movement, a registration and a system
// note, and this renders those without a sign — a `+` on somebody else's note-created would say
// that value arrived here, which is precisely the attribution the record refuses to make. The
// glyph is the channel that survives greyscale; `settled` green is spent only on value that
// ARRIVED, and outgoing value is plain ink because `irreversible` is reserved for the genuinely
// irreversible. A row and its receipt disagreeing about either would be the same transaction
// wearing two different claims.
//
// Amount, counterparty, block, note commitment in mono, and THE FEE ACTUALLY CHARGED — which is
// the receipt's own, from `actual_fee`, never the pool's `get_fee_amount()`. The two are different
// money: the sequencer charged gas on top, and on a relayed submission the two were paid by
// different parties.
//
// THE VISIBILITY MATRIX MOUNTS INSIDE THE DISCLOSURE BOX, and every value in it comes out of
// `@strk20/protocol/visibility-matrix` (story 6.7, FR-058). There is no cell literal in this file
// and there must never be one.
//
// WHICH MATRIX, AND WHY THE ANSWER IS SOMETIMES "THE BASELINE". `transaction.surface` is `null` on
// every RECONSTRUCTED row by design — 6.6 made it so a Global row could not wear a `Swap` tag it
// could not justify — so a row this browser did not originate renders the pool baseline, which is
// what is true of any pool transaction.
//
// SETTLED ROWS ONLY get the matrix. A failed row was never submitted — "nothing was submitted,
// nothing was charged" is its whole grammar — so a matrix saying the amount and the timing are
// public would be describing a transaction that does not exist.
//
import { useState, type ReactNode } from 'react'

import {
  formatTokenAmount,
  groupDigits,
  MINUS,
  type RenderedAmount,
} from '@strk20/protocol/amount'
import { KNOWN_TOKEN_DECIMALS, lookupDecimals } from '@strk20/protocol/token-scale'
import {
  ACTIVITY_KIND_LABELS,
  amountDirection,
  blockLabel,
  rowTitle,
  voyagerTxUrl,
  type Transaction,
} from '@strk20/protocol/transaction'
import {
  AMOUNT_NOT_OURS_TO_READ,
  AMOUNT_TRUNCATED,
  CHECK_ON_VOYAGER,
  FEE_UNIT_UNNAMED,
  FEE_UNREADABLE,
  RECEIPT_NOT_A_NOTE,
  RECEIPT_NOT_YET_ON_CHAIN,
  RECEIPT_NO_COUNTERPARTY,
  SCALE_UNVERIFIED,
} from '@strk20/protocol/activity-copy'
import {
  DISCLOSURE_HEADLINE,
  RECEIPT_YOU_IS_THE_ACTOR,
  WHO_CAN_READ,
} from '@strk20/protocol/disclosure-copy'
import { receiptContext, type VisibilityContext } from '@strk20/protocol/visibility-matrix'

import { cn } from '../lib/cn'
import { findToken, useTokenList } from '../shell/use-token-list'
import { VisibilityMatrix } from './VisibilityMatrix'
import { Text } from './ui/Text'

export interface ActivityReceiptProps {
  transaction: Transaction
  /**
   * What the × does. ABSENT MEANS NO ×, which is how the deep-link route gets a receipt with no
   * dismiss control on it — a page has the back button and a close that navigated nowhere would
   * be a dead control. The modal passes one; `/activity/$id` does not.
   */
  onClose?: () => void
}

export function ActivityReceipt({ transaction, onClose }: ActivityReceiptProps) {
  const settled = transaction.chain.state === 'settled' ? transaction.chain.entry : null

  return (
    <>
      <div className="flex items-center justify-between gap-s8">
        {/*
          SUBHEADING, NOT THE ANTON DISPLAY STEP. The prototype titles this sheet at 14.5px and
          spends its size on the amount instead, and it is right to: two things competing to be
          the first thing read means neither is. `as="h1"` regardless, because on the deep-link
          route this really is the page's heading.
        */}
        <Text variant="subheading2" as="h1" className="font-medium text-neutral1">
          {rowTitle(transaction)}
        </Text>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className={cn(
              'focus-ring flex size-s28 shrink-0 cursor-pointer items-center justify-center',
              'rounded-pill text-neutral3 transition-colors',
              'duration-[var(--transition-duration-fastHeavy)] ease-glide',
              'hover:bg-inset hover:text-neutral1',
            )}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M6 6l12 12M18 6L6 18"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        ) : null}
      </div>

      {settled === null ? (
        // A row that never settled has no block, no commitment and no fee — it has a reason. Laying
        // out empty fields for facts that do not exist would read as data we failed to load. The
        // hash is the exception: an optimistic row may already have one, and it is the only thing
        // a reader can check for themselves while they wait.
        <>
          <p className="text-body3 text-neutral2">
            {transaction.chain.state === 'failed'
              ? transaction.chain.reason
              : RECEIPT_NOT_YET_ON_CHAIN}
          </p>
          {(transaction.chain.state === 'optimistic' && transaction.chain.transactionHash) ||
          (transaction.chain.state === 'failed' && transaction.chain.transactionHash) ? (
            <>
              <HashBlock label="Transaction" value={transaction.chain.transactionHash!} />
              <ExplorerLink hash={transaction.chain.transactionHash!} />
            </>
          ) : null}
        </>
      ) : (
        <>
          <Hero transaction={transaction} />

          {/*
            FOUR LINES, LABEL LEFT AND VALUE RIGHT, as the prototype draws them. `justify-between`
            per row rather than a two-column grid: at 400px the grid's `max-content` label column
            was wide enough to squeeze "Fee charged"'s eighteen grouped digits onto three lines.
          */}
          <dl className="m-s0 flex flex-col gap-s8 border-t border-solid border-surface3 pt-s12">
            <Fact label="What happened">{ACTIVITY_KIND_LABELS[settled.kind]}</Fact>

            <Fact label="Counterparty" mono={settled.counterparty !== null}>
              {settled.counterparty ?? RECEIPT_NO_COUNTERPARTY}
            </Fact>

            <Fact label="Block" mono>
              {blockLabel(settled.blockNumber)}
            </Fact>

            {/*
              THE FEE COLUMN NEVER GUESSES. `ActivityFee` has no zero variant by design: a missing
              receipt and a genuinely free action are different facts, and a fabricated 0 handed to
              a bookkeeper is worse than a blank. It is GROUPED for the same reason every other
              number here is — an ungrouped eighteen-digit run is misread by orders of magnitude,
              which is its own kind of wrong number.
            */}
            <Fact label="Fee charged" mono={settled.fee.state === 'charged'}>
              {settled.fee.state === 'charged' ? (
                <>
                  {groupDigits(settled.fee.amountWei.toString())}{' '}
                  {settled.fee.unit === 'unknown' ? FEE_UNIT_UNNAMED : settled.fee.unit}
                </>
              ) : (
                FEE_UNREADABLE
              )}
            </Fact>
          </dl>

          {/*
            THE TWO LONG HASHES, TOGETHER AND SMALL. The prototype gives the transaction hash its
            own wrapped mono line rather than a `dl` row, because a 66-character value in a
            right-aligned value column reflows the label and turns a four-line list into a wall.
            The note commitment is the same shape of thing and gets the same treatment.
          */}
          <div className="flex flex-col gap-s8">
            <HashBlock label="Transaction" value={settled.transactionHash} />
            <HashBlock
              label="Note commitment"
              value={settled.noteCommitment}
              absent={RECEIPT_NOT_A_NOTE}
            />
          </div>

          <PrivacyBox
            context={receiptContext(transaction.surface)}
            actorNote={settled.amount === null ? RECEIPT_YOU_IS_THE_ACTOR : null}
          />

          <ExplorerLink hash={settled.transactionHash} />
        </>
      )}
    </>
  )
}

/**
 * The figure, at the top, in the machine voice — signed where a sign is a true claim.
 *
 * ── IT STILL GOES THROUGH `formatTokenAmount`, AND THAT IS NOT INTERCHANGEABLE ───────────
 *
 * `ActivityRow` renders its amount with `toPlainText`, which is right for a row: a list wants one
 * short readable figure per line. This is the view whose whole job is EXACTNESS, and the two
 * things `RenderedAmount` carries that a plain string cannot are exactly the two ways an amount
 * lies — a dust value rounded to `0`, and a long value quietly shortened past display precision.
 * Swapping this for the row's formatter would look identical on every amount that is neither.
 */
function Hero({ transaction }: { transaction: Transaction }) {
  const { tokens } = useTokenList()
  const settled = transaction.chain.state === 'settled' ? transaction.chain.entry : null
  const direction = amountDirection(transaction)

  if (settled === null || settled.amount === null) {
    return (
      <Text variant="body3" className="text-neutral2">
        {AMOUNT_NOT_OURS_TO_READ}
      </Text>
    )
  }

  const known = settled.token ? findToken(tokens, settled.token) : null
  const rendered = formatTokenAmount(
    settled.amount,
    settled.token === null ? null : lookupDecimals(KNOWN_TOKEN_DECIMALS, settled.token),
  )
  //
  // TWO SIGNS EXIST AND ONLY ONE MAY PRINT. `RenderedAmount.sign` is MINUS when the stored bigint
  // is itself negative; `amountDirection` is a claim about which way value moved, derived from the
  // event kind. They are different questions, and rendering both would put `−−` in front of a
  // figure the first time an entry arrives with a negative amount. The stored sign wins where it
  // exists, because it is the arithmetic rather than an interpretation of it.
  //
  const prefix = rendered.sign === '' ? (direction === 'in' ? '+' : direction === 'out' ? MINUS : '') : ''

  return (
    <span className="flex flex-wrap items-baseline gap-s8">
      <span
        className={cn(
          // `numeric` is the tabular-figures class, and mono is the app's money voice [STUDIO].
          'numeric font-mono text-heading3',
          direction === 'in' ? 'text-settled' : 'text-neutral1',
        )}
      >
        {prefix}
        <Amount rendered={rendered} />
      </span>
      {known ? <span className="text-body2 text-neutral2">{known.symbol}</span> : null}
    </span>
  )
}

/**
 * What it revealed: one sentence, and the whole table one press away.
 *
 * ── THE MATRIX IS COLLAPSED, NOT CUT ─────────────────────────────────────────────────────
 *
 * Twenty cells and five row headers opened by default under every receipt, which is the single
 * biggest reason this sheet read as a data dump. It is also genuinely load-bearing — FR-058, and
 * the only place the auditor's reach is drawn rather than asserted — so it is behind a summary
 * rather than behind nothing. The prototype does exactly this on its review sheet (`rv.privToggle`,
 * "What this reveals" with a chevron); this is that control on the receipt.
 *
 * ── AND THE HEADLINE IS PASSED DOWN SO IT CANNOT PRINT TWICE ─────────────────────────────
 *
 * `statedAbove` exists for this: the matrix footnotes a cell's qualifier in full unless the caller
 * has already said it, in which case it points up instead. This is now a caller that says it.
 */
function PrivacyBox({
  context,
  actorNote,
}: {
  context: VisibilityContext
  actorNote: string | null
}) {
  const [open, setOpen] = useState(false)
  //
  // A LOOKUP RATHER THAN AN INDEX, because `DISCLOSURE_HEADLINE` deliberately omits the two
  // unauthored contexts — a headline for a disclosure nobody wrote is the guess story 6.7 exists
  // to refuse. `receiptContext` cannot return either of them today (it resolves through
  // `SURFACE_CONTEXT`, which names neither), and this still does not assume that: the summary
  // falls back to the matrix's own heading, which is true of every context there is.
  //
  const headline: string | undefined =
    DISCLOSURE_HEADLINE[context as keyof typeof DISCLOSURE_HEADLINE]

  return (
    <div className="disclosure-panel">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="focus-ring flex w-full cursor-pointer items-start gap-s8 text-left"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-s2">
          <span className="kicker text-neutral3">What this revealed</span>
          <span className="disclosure-body">{headline ?? WHO_CAN_READ}</span>
        </span>
        {/*
          ROTATED BY A CLASS, NOT BY AN ANIMATION. EXPERIENCE §4.3 has the disclosure panel hold
          still — "never animates on polls, never pulses" — and the build gate reads the emitted
          `.disclosure-panel` rule to prove it declares none. A transform transition on a child
          would not trip that gate, and would still be the panel moving.
        */}
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
          className={cn('mt-s2 shrink-0 text-neutral3', open ? 'rotate-180' : '')}
        >
          <path
            d="M6 9l6 6 6-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {open ? (
        <>
          {actorNote ? <p className="disclosure-body">{actorNote}</p> : null}
          <VisibilityMatrix context={context} statedAbove={headline ?? ''} />
        </>
      ) : null}
    </div>
  )
}

function ExplorerLink({ hash }: { hash: string }) {
  const href = voyagerTxUrl(hash)
  // `null` cannot happen for a non-empty hash, and the branch is here rather than asserted because
  // a receipt is the last place to throw over a link.
  return href === null ? null : (
    <a className="focus-ring text-body3" href={href} target="_blank" rel="noreferrer">
      {CHECK_ON_VOYAGER} ↗
    </a>
  )
}

/** One short labelled fact on its own line, value to the right. */
function Fact({
  label,
  mono = false,
  children,
}: {
  label: string
  mono?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex justify-between gap-s12">
      <dt className="shrink-0 text-body4 text-neutral3">{label}</dt>
      {/*
        `break-all` ONLY on the mono values, which is the same call `SendReview` and `ReceivePanel`
        make. A counterparty address is one unbroken token and would push the row wider than the
        sheet without it; the prose values are short, and breaking a word mid-letter to save a
        pixel is how "Deposit" becomes "Depos / it".
      */}
      <dd
        className={cn(
          'm-s0 text-right text-body4 text-neutral2',
          mono ? 'numeric break-all font-mono' : '',
        )}
      >
        {children}
      </dd>
    </div>
  )
}

/**
 * An exact amount, subscript and all.
 *
 * NEVER A FALSE "0" — a pool that renders 400 wei as "0" has told someone their money is gone. The
 * hidden-zero count comes out of `formatTokenAmount` as a number so the subscript can be real
 * markup rather than a glyph baked into a string, and an unverified token scale renders its exact
 * integer in raw units rather than being scaled by a guess.
 *
 * AND A SHORTENED FIGURE SAYS SO. `truncated` means digits were dropped past display precision;
 * this is the one view whose job is exactness, so a number that looks exact and is not would be
 * the same class of defect as the false zero, arriving from the other end of the scale.
 */
function Amount({ rendered }: { rendered: RenderedAmount }) {
  if (rendered.kind === 'raw-units') {
    return (
      <>
        {rendered.sign}
        {rendered.units} <span className="text-body3 text-neutral2">{SCALE_UNVERIFIED}</span>
      </>
    )
  }

  //
  // THE FRACTION CARRIES ITS OWN LEADING ZEROS IN ONE BRANCH AND NOT THE OTHER, which is the trap
  // here and it is not visible from the type. On an ordinary amount `fraction` is already the
  // zero-padded slice (`1.0002` arrives as fraction `0002`, hiddenZeros 0); on a dust amount the
  // leading zeros have been lifted out into `hiddenZeros` and `fraction` starts at the first
  // significant digit. So the literal `0` belongs with the SUBSCRIPT and only with it — writing
  // `0.0` unconditionally prints 0.05 for 0.5 and 1.00002 for 1.0002, and `amount.ts:190` warns
  // about the first of those by name.
  //
  return (
    <>
      {rendered.sign}
      {rendered.whole}
      {rendered.fraction ? (
        <>
          .
          {rendered.hiddenZeros > 0 ? (
            <>
              0<sub>{rendered.hiddenZeros}</sub>
            </>
          ) : null}
          {rendered.fraction}
        </>
      ) : null}
      {rendered.truncated ? (
        <span className="text-body4 text-neutral2"> ({AMOUNT_TRUNCATED})</span>
      ) : null}
    </>
  )
}

/** A long hash, wrapped, under its own quiet label. `absent` is what prints when there isn't one. */
function HashBlock({
  label,
  value,
  absent,
}: {
  label: string
  value: string | null
  absent?: string
}) {
  if (value === null && absent === undefined) return null

  return (
    <div className="flex flex-col gap-s2">
      <span className="text-body4 text-neutral3">{label}</span>
      {value === null ? (
        <span className="text-body4 text-neutral2">{absent}</span>
      ) : (
        <span className="break-all font-mono text-mono text-neutral2">{value}</span>
      )}
    </div>
  )
}
