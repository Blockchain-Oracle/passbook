//
// The inline re-consent row (DESIGN §7.7 / EXPERIENCE §5's proof-expired row).
//
// ── IT IS A ROW IN THE FEE SLOT, NOT A DIALOG ─────────────────────────────────────────────
//
// A proof lapses because the user took longer than the validity window to press a button. Nothing
// was submitted, nothing was charged, and regenerating costs them one more wait. A scrim would
// make that read as a failure they have to clear; an inline row at the fee row's own height makes
// it read as what it is — the form telling them it needs one thing redone.
//
// The height match is the layout law: appearing must SWAP content in a reserved slot, never push
// the CTA down the page at the moment the user is reaching for it.
//
import {
  REGENERATE_ACTION,
  expiredLabel,
  type ExpiryVerdict,
} from '@strk20/protocol/proof-expiry'

export interface ReConsentRowProps {
  verdict: ExpiryVerdict
  /** The block the proof lapsed at — checkable in an explorer, which "it expired" is not. */
  expiredAtBlock: number
  onRegenerate: () => void
}

export function ReConsentRow({ verdict, expiredAtBlock, onRegenerate }: ReConsentRowProps) {
  return (
    <div className="reconsent-row" role="status">
      <span className="text-body3 numeric">{expiredLabel(verdict, expiredAtBlock)}</span>
      <button
        type="button"
        className="focus-ring text-buttonLabel4"
        onClick={onRegenerate}
      >
        {REGENERATE_ACTION}
      </button>
    </div>
  )
}
