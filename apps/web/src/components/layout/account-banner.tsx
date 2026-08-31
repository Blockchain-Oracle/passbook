import { CloudOff, Sparkles, TriangleAlert, Wallet, X } from 'lucide-react'
import { ALLOWANCE_SPENT_NOTICE } from '@strk20/protocol/relayer-wire'
import {
  NEEDS_DRIP_BODY,
  NEEDS_DRIP_CTA,
  NEEDS_DRIP_TITLE,
  NEEDS_FUND_BODY,
  NEEDS_FUND_CTA,
  NEEDS_FUND_TITLE,
  NEEDS_REGISTER_BODY,
  NEEDS_REGISTER_CTA,
  NEEDS_REGISTER_TITLE,
  NEEDS_UNKNOWN_BODY,
  NEEDS_UNKNOWN_TITLE,
  SPONSORED_OFFER,
  SPONSORED_OFFER_NOTE,
} from '@strk20/protocol/onboarding-copy'

import { dismiss } from '@/app/dismissed-notices'
import { setEntered } from '@/app/onboarding-entry'
import { useSession } from '@/app/session'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DISMISSIBLE, useAccountNeed, type AccountNeed } from '@/features/onboarding'
import { cn } from '@/lib/utils'

/**
 * The one bar at the top of the shell: what this account still needs, or nothing.
 *
 * ── IT REPLACED A BANNER THAT ONLY EVER TALKED ABOUT SPONSORSHIP ──────────────────────────
 *
 * `SponsorshipBanner` lived in this slot and rendered the covered-transaction count. It was
 * correct and nobody saw it, because the full-screen onboarding gate renders directly above this
 * slot and does not let go until the account is finished — so the one message aimed at a finished
 * account was the one message a finished account had already scrolled past, and every unfinished
 * account got nothing at all.
 *
 * So the count is now the LAST case of a bar that speaks earlier too, and `useAccountNeed` ranks
 * them so this renders exactly one thing. Two Alerts in one slot is two Alerts nobody reads.
 */
export function AccountBanner() {
  const session = useSession()
  const address = session.status === 'ready' ? session.address : undefined
  const need = useAccountNeed()
  if (!need) return null

  const view = describe(need)
  return (
    <div className="px-4 pt-3 md:px-8">
      <Alert className={cn((need.kind === 'register' || need.kind === 'unknown') && 'border-exposed bg-exposedTint')}>
        <view.Icon />
        <AlertTitle>{view.title}</AlertTitle>
        <AlertDescription>{view.body}</AlertDescription>
        <AlertAction>
          <div className="flex items-center gap-1">
            {view.cta ? (
              // Every action is the same door: hand this address back to the gate, which reads the
              // rung and opens on the step it is actually missing. The banner never runs a
              // pipeline of its own — one register path, not two that can drift.
              <Button size="sm" onClick={() => setEntered(null)}>
                {view.cta}
              </Button>
            ) : null}
            {DISMISSIBLE.has(need.kind) ? (
              <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={() => dismiss(address, need.kind)}>
                <X />
              </Button>
            ) : null}
          </div>
        </AlertAction>
      </Alert>
    </div>
  )
}

interface View {
  Icon: typeof Sparkles
  title: string
  body: string
  /** Absent when there is nothing to press — the sponsored count is news, not a task. */
  cta?: string
}

function describe(need: AccountNeed): View {
  switch (need.kind) {
    case 'unknown':
      // No CTA: there is nothing for a person to press. It clears when the chain answers.
      return { Icon: CloudOff, title: NEEDS_UNKNOWN_TITLE, body: NEEDS_UNKNOWN_BODY }
    case 'register':
      return { Icon: TriangleAlert, title: NEEDS_REGISTER_TITLE, body: NEEDS_REGISTER_BODY, cta: NEEDS_REGISTER_CTA }
    case 'drip':
      return { Icon: Wallet, title: NEEDS_DRIP_TITLE, body: NEEDS_DRIP_BODY, cta: NEEDS_DRIP_CTA }
    case 'fund':
      return { Icon: Wallet, title: NEEDS_FUND_TITLE, body: NEEDS_FUND_BODY, cta: NEEDS_FUND_CTA }
    case 'sponsored': {
      const { remaining, of } = need
      // The whole offer before anything is spent; the count once it is being drawn down. Not
      // "3 of 3 left", which reads like something already in progress.
      const title =
        remaining === of ? SPONSORED_OFFER : remaining <= 0 ? 'Sponsored transactions used' : `${remaining} of ${of} sponsored transactions left`
      return { Icon: Sparkles, title, body: remaining <= 0 ? ALLOWANCE_SPENT_NOTICE : SPONSORED_OFFER_NOTE }
    }
  }
}
