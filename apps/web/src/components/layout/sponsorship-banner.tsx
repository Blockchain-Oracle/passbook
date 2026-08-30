import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { ALLOWANCE_SPENT_NOTICE } from '@strk20/protocol/relayer-wire'
import { SPONSORED_OFFER, SPONSORED_OFFER_NOTE } from '@strk20/protocol/onboarding-copy'

import { useSession } from '@/app/session'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { allowanceQuery } from '@/queries'

/**
 * How many transactions we are still covering for this account.
 *
 * ── IT RENDERS NOTHING RATHER THAN GUESSING ───────────────────────────────────────────────
 *
 * `allowanceQuery` resolves `null` for every "we cannot say" — a relayer that does not meter per
 * account, an unreachable one, a malformed body. This shows nothing in that case, because the two
 * wrong answers are both worse than silence: "0 of 3" reads as an offer withdrawn, and "3 of 3"
 * promises transactions that will be refused. The count only appears when it came from the ledger
 * that will actually be spent.
 *
 * At zero it stays up. The spent state is the one a user most needs explained — it is the moment
 * their next transaction starts costing them a pool fee — so it says that plainly instead of
 * quietly disappearing and letting the charge be a surprise.
 */
export function SponsorshipBanner() {
  const session = useSession()
  const address = session.status === 'ready' ? session.address : undefined
  const { data } = useQuery(allowanceQuery(address))

  if (!data) return null
  const { remaining, of } = data
  const spent = remaining <= 0

  return (
    <div className="px-4 pt-3 md:px-8">
      <Alert>
        <Sparkles />
        <AlertTitle>
          {/* The whole offer before anything is spent; the count once it is being drawn down. Not
              "3 of 3 left", which reads like something already in progress. */}
          {remaining === of ? SPONSORED_OFFER : spent ? 'Sponsored transactions used' : `${remaining} of ${of} sponsored transactions left`}
        </AlertTitle>
        <AlertDescription>
          <span>{spent ? ALLOWANCE_SPENT_NOTICE : SPONSORED_OFFER_NOTE}</span>
        </AlertDescription>
      </Alert>
    </div>
  )
}
