//
// What a claim actually does between opening and paying out.
//
// The app has always had three lifecycles and never explained any of them, so "Waiting" was a word
// with no story behind it and "Sell back" looked like a second kind of loss. Four steps each,
// venue by venue, in the same order the position moves through them.
//
import type { PositionVenue } from './types'

interface Step {
  when: string
  what: string
}

const STEPS: Record<PositionVenue, readonly Step[]> = {
  market: [
    { when: 'Open', what: 'You stake, and the pool records a commitment instead of your address. The secret is stored in this browser.' },
    { when: 'Running', what: 'The odds move while the market is live. Selling back early pays whatever the pool quotes right now.' },
    { when: 'Closed', what: 'At the deadline the market stops taking stakes and waits for its resolver.' },
    { when: 'Settle', what: 'A winning ticket claims its payout; a losing one is worth nothing. A voided market refunds every stake.' },
  ],
  launch: [
    { when: 'Buy', what: 'Your stake joins the raise against a bearer commitment. Nothing names you on the launch record.' },
    { when: 'Running', what: 'The sale fills, or it does not, until the deadline. Neither outcome can be settled before then.' },
    { when: 'Graduated', what: 'The raise filled: each claim redeems its share of the launched token.' },
    { when: 'Did not fill', what: 'The raise missed: each claim refunds the stake it put in, in full.' },
  ],
  governance: [
    { when: 'Escrow', what: 'Casting a ballot or delegating locks weight behind a commitment held in this browser.' },
    { when: 'Voting', what: 'While the proposal is open the escrow stays locked — that is what makes the weight count.' },
    { when: 'Closed', what: 'Once the proposal is decided the lock lifts.' },
    { when: 'Reclaim', what: 'The escrow comes back to you as one fresh shielded note. A delegation can be revoked the same way.' },
  ],
}

const SECRET_IS_MONEY =
  'The claim secret lives in this browser. Whoever holds it can settle the position, so a Recovery File is the only way back to it.'

export function LifecycleNote({ venue }: { venue: PositionVenue }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-inset/40 p-3">
      {STEPS[venue].map((step) => (
        <div key={step.when} className="flex gap-3 text-body4">
          <span className="w-24 shrink-0 font-medium">{step.when}</span>
          <span className="text-muted-foreground">{step.what}</span>
        </div>
      ))}
      <p className="border-t pt-2 text-body4 text-muted-foreground">{SECRET_IS_MONEY}</p>
    </div>
  )
}
