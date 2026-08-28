//
// One transaction, told as what happened to it (EXPERIENCE §2.3, Flow W4 §5) — the receipt.
//
// EXTRACTED FROM `routes/activity.$id.tsx` so it can render in TWO places without drifting: the
// deep-linkable receipt page, and the modal the feed opens in place ([STUDIO] — the prototype's
// activity detail is a sheet over the record, not a navigation). The words, the fee rules and the
// visibility matrix are identical in both because they are literally the same component.
//
// Amount, counterparty, block, note commitment in mono, and THE FEE ACTUALLY CHARGED — which is
// the receipt's own, from `actual_fee`, never the pool's `get_fee_amount()`. The two are different
// money: the sequencer charged gas on top, and on a relayed submission the two were paid by
// different parties.
//
// THE VISIBILITY MATRIX MOUNTS BELOW THE FEE ROW, and every value in it comes out of
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
import type { ReactNode } from 'react'

import { formatTokenAmount, groupDigits, type RenderedAmount } from '@strk20/protocol/amount'
import { KNOWN_TOKEN_DECIMALS, lookupDecimals } from '@strk20/protocol/token-scale'
import {
  ACTIVITY_KIND_LABELS,
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
import { RECEIPT_YOU_IS_THE_ACTOR } from '@strk20/protocol/disclosure-copy'
import { receiptContext } from '@strk20/protocol/visibility-matrix'

import { VisibilityMatrix } from './VisibilityMatrix'

export function ActivityReceipt({ transaction }: { transaction: Transaction }) {
  const settled = transaction.chain.state === 'settled' ? transaction.chain.entry : null

  return (
    <>
      <h1 className="display text-display3 text-neutral1">{rowTitle(transaction)}</h1>

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
          {transaction.chain.state === 'optimistic' && transaction.chain.transactionHash ? (
            <dl className="receipt">
              <Field label="Transaction" format="mono">
                {transaction.chain.transactionHash}
              </Field>
              <Field label="Check it yourself" format="prose">
                <ExplorerLink hash={transaction.chain.transactionHash} />
              </Field>
            </dl>
          ) : null}
        </>
      ) : (
        <>
          <dl className="receipt">
            <Field label="What happened" format="prose">
              {ACTIVITY_KIND_LABELS[settled.kind]}
            </Field>

            <Field label="Amount" format="numeric">
              {settled.amount === null ? (
                <span className="text-body3 text-neutral2">{AMOUNT_NOT_OURS_TO_READ}</span>
              ) : (
                <Amount
                  rendered={formatTokenAmount(
                    settled.amount,
                    settled.token === null ? null : lookupDecimals(KNOWN_TOKEN_DECIMALS, settled.token),
                  )}
                />
              )}
            </Field>

            <Field label="Counterparty" format={settled.counterparty ? 'mono' : 'prose'}>
              {settled.counterparty ?? (
                <span className="text-neutral2">{RECEIPT_NO_COUNTERPARTY}</span>
              )}
            </Field>

            <Field label="Block" format="numeric">
              {blockLabel(settled.blockNumber)}
            </Field>

            <Field label="Note commitment" format={settled.noteCommitment ? 'mono' : 'prose'}>
              {settled.noteCommitment ?? <span className="text-neutral2">{RECEIPT_NOT_A_NOTE}</span>}
            </Field>

            <Field label="Transaction" format="mono">
              {settled.transactionHash}
            </Field>

            <Field label="Check it yourself" format="prose">
              <ExplorerLink hash={settled.transactionHash} />
            </Field>

            {/*
              THE FEE COLUMN NEVER GUESSES. `ActivityFee` has no zero variant by design: a missing
              receipt and a genuinely free action are different facts, and a fabricated 0 handed to a
              bookkeeper is worse than a blank. It is GROUPED for the same reason every other number
              on this page is — an ungrouped eighteen-digit run is misread by orders of magnitude,
              which is its own kind of wrong number.
            */}
            <Field label="Fee charged" format="numeric">
              {settled.fee.state === 'charged' ? (
                <>
                  {groupDigits(settled.fee.amountWei.toString())}{' '}
                  <span className="text-body3 text-neutral2">
                    {settled.fee.unit === 'unknown' ? FEE_UNIT_UNNAMED : settled.fee.unit}
                  </span>
                </>
              ) : (
                <span className="text-body3 text-neutral2">{FEE_UNREADABLE}</span>
              )}
            </Field>
          </dl>

          {/*
            NO `data-severity` HERE. A receipt is a record, not a review — nothing on this page is
            about to happen — and a privacy severity typed into a `.tsx` is the class of thing
            `packages/protocol/src/privacy.ts` exists to delete. The panel is being used as the
            container recipe it is; the four severity rules belong to the surfaces that ask a user
            to press something.
          */}
          <div className="disclosure-panel">
            {settled.amount === null ? (
              <p className="disclosure-body">{RECEIPT_YOU_IS_THE_ACTOR}</p>
            ) : null}
            <VisibilityMatrix context={receiptContext(transaction.surface)} />
          </div>
        </>
      )}
    </>
  )
}

function ExplorerLink({ hash }: { hash: string }) {
  const href = voyagerTxUrl(hash)
  // `null` cannot happen for a non-empty hash, and the branch is here rather than asserted because
  // a receipt is the last place to throw over a link.
  return href === null ? null : (
    <a className="focus-ring" href={href} target="_blank" rel="noreferrer">
      {CHECK_ON_VOYAGER} ↗
    </a>
  )
}

/**
 * One labelled fact.
 *
 * `format` is explicit rather than a `mono` boolean, because the third case is the one that got it
 * wrong first: tabular figures on prose ("Deposit") and the mono face on a fallback sentence ("Not
 * named in the record") are both the wrong typeface for the content, applied by a flag that only
 * knew about hashes.
 */
function Field({
  label,
  format,
  children,
}: {
  label: string
  format: 'mono' | 'numeric' | 'prose'
  children: ReactNode
}) {
  const face = format === 'mono' ? 'font-mono' : format === 'numeric' ? 'numeric' : ''
  return (
    <>
      <dt className="text-body4 text-neutral2">{label}</dt>
      <dd className={`text-body3 ${face}`}>{children}</dd>
    </>
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
