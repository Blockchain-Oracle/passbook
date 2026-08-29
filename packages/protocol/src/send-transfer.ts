//
// Transfer and withdraw: the two plain shapes. A transfer stays shielded (a note for the
// recipient); a withdraw leaves the pool to a public address. Change comes back via `surplusTo`.
//

import { OK, type SendLeg } from './send-plan.js'

export const transferLeg: SendLeg = {
  // Everything a transfer can refuse for free is shared: mode, amount, felts, no stray legs.
  // The recipient's registration is the dispatcher's `preflightRecipient` — a free view call.
  validate: () => OK,
  compose(builder, request) {
    builder.with(request.token, (t) => {
      t.transfer({ recipient: request.recipient, amount: request.amount })
    })
  },
}

export const withdrawLeg: SendLeg = {
  validate: () => OK,
  compose(builder, request) {
    builder.with(request.token, (t) => {
      t.withdraw({ recipient: request.recipient, amount: request.amount })
    })
  },
}
