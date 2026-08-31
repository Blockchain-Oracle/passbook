import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import type { Allowance } from '@strk20/protocol/relayer-wire'

import { useSession } from '@/app/session'
import { allowanceQuery } from '@/queries'

import { SPONSORED_DOCS } from '@/lib/links'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

const FRAME = 'flex items-start justify-between gap-3 rounded-lg border px-3 py-2'

/**
 * Whether this venue can be paid for by us at all.
 *
 * ── `unsupported` IS A REAL STATE AND NOT A MISSING FEATURE ────────────────────────────────
 *
 * Shielding is a deposit, and a deposit pulls `transferFrom(caller)`. If our relayer submitted one,
 * OUR STRK would land in the pool — that transaction exists, it is the starter drip, and it is a
 * gift rather than a sponsored transaction. So shielding can never be covered no matter how many
 * units are left, and a user staring at "2 of 3 left" while being charged is owed the reason.
 */
export type SponsorOffer =
  | { kind: 'eligible' }
  | { kind: 'unsupported'; because: string }

export interface SponsorRowProps {
  offer: SponsorOffer
  /**
   * `null` when the count could not be read — which means NOT covered. See `readAllowance`.
   * Only read for an `eligible` offer; the other two say their piece without asking.
   */
  allowance?: Allowance | null
  loading?: boolean
  checked?: boolean
  onCheckedChange?: (next: boolean) => void
  /** True while the transaction is running: the choice is made and must stop moving. */
  locked?: boolean
}

/** The muted, non-interactive shape the two statement kinds share. */
function Note({ children }: { children: ReactNode }) {
  return (
    <div className={cn(FRAME, 'bg-muted/40')}>
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="text-body4 text-muted-foreground">{children}</p>
      </div>
    </div>
  )
}


/** The docs door. Every state that is not a live toggle offers it, because every one of them needs a why. */
function More() {
  return (
    <a
      href={SPONSORED_DOCS}
      target="_blank"
      rel="noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      Read more
    </a>
  )
}

/**
 * The one row that says who is paying, on the last screen before signing.
 *
 * It renders in four states and only ONE of them is a control. The other three exist because
 * "nothing here" and "this is not for you" and "you have used them" are three different things, and
 * a screen that renders all three as an absent toggle teaches a user that the offer was never real.
 */
export function SponsorRow({ offer, allowance, loading, checked, onCheckedChange, locked }: SponsorRowProps) {
  if (offer.kind === 'unsupported') {
    return (
      <Note>
        {offer.because} <More />
      </Note>
    )
  }

  // Still asking. Say nothing rather than flash "none left" and then a toggle — the flicker reads
  // as the offer being withdrawn and then returned.
  if (loading) return null

  const remaining = allowance?.remaining ?? 0
  if (remaining <= 0) {
    // `null` and `0` are DIFFERENT FACTS and the same outcome: this one is not covered. They get one
    // sentence because a user cannot act on the difference — what they can act on is knowing the
    // fee is theirs.
    return (
      <Note>
        {allowance === null || allowance === undefined
          ? 'Sponsored transactions could not be checked, so this one pays the pool fee from your balance.'
          : 'You have used your sponsored transactions. This one pays the pool fee from your balance.'}{' '}
        <More />
      </Note>
    )
  }

  return (
    <label className={cn(FRAME, 'cursor-pointer items-center border-accent/40 bg-accent/5')}>
      <span className="flex items-center gap-2">
        <Sparkles className="size-4 shrink-0 text-accent" />
        <span className="flex flex-col">
          <span className="text-body3">Use a sponsored transaction</span>
          <span className="text-body4 text-muted-foreground">
            {remaining} of {allowance?.of} left · we pay the pool fee
          </span>
        </span>
      </span>
      <Switch checked={checked ?? false} onCheckedChange={onCheckedChange} disabled={locked} aria-label="Use a sponsored transaction" />
    </label>
  )
}

/**
 * The live count, the user's answer, and the EFFECTIVE one that may reach a submitter.
 *
 * Shared rather than written twice: `ReviewSheet` renders this for every pool venue, and the three
 * creation dialogs are plain `Dialog`s that need exactly the same thing. Two copies would drift,
 * and the half that drifts is `sponsored` — the boolean that decides whether a fee lands on us.
 *
 * `sponsored` is never just the toggle: a switch left on while the count reads zero must not tell
 * a submitter it is covered, or the relayer folds no reimbursement leg and pays a fee nobody
 * agreed to. Asking is free and the answer defaults to "not covered" on any failure.
 */
export function useSponsorChoice(enabled = true) {
  const session = useSession()
  const address = session.status === 'ready' ? session.address : undefined
  // `allowanceQuery` is disabled without an address, so an ineligible venue makes no request.
  const query = useQuery(allowanceQuery(enabled ? address : undefined))
  // OFF by default: an account pays its own way, and the three we cover are a thing to spend
  // deliberately rather than a discount applied to whatever someone happened to do first.
  const [want, setWant] = useState(false)
  return {
    want,
    setWant,
    allowance: query.data,
    loading: enabled && query.isPending,
    sponsored: enabled && want && (query.data?.remaining ?? 0) > 0,
  }
}
