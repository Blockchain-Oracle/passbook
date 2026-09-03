//
// Mail: a shielded transfer that carries a sealed memo. The transfer is the transfer leg's;
// the memo is one `InvokeExternal` to the Mailbox, which the pool calls after the note exists
// and inside the same proof. Its calldata is prepared by `proveSend` once the note is named.
//

import { bad, feltOrNull, OK, sameFelt, type SendLeg } from './send-plan.js'
import { mailBodyFits, mailBodyBytes } from './mail-body.js'
import { MAX_MAIL_PLAINTEXT_BYTES } from './mail-envelope.js'

/**
 * Postage: a mail with nothing to pay still moves value, because the note is what the recipient
 * discovers the memo through and what makes the transaction replay-safe. One hundredth of a token
 * is small enough to be a stamp and large enough to be spendable change; the pool itself would
 * take zero, and this is the one place that says we do not.
 */
export const MAIL_POSTAGE_DIVISOR = 100n
export function mailPostageWei(decimals: number): bigint {
  return 10n ** BigInt(decimals) / MAIL_POSTAGE_DIVISOR
}

export const mailLeg: SendLeg = {
  validate(request, self) {
    const mail = request.mail
    if (!mail) return bad('a mail carried no memo')
    const mailbox = feltOrNull(mail.mailbox)
    if (mailbox === null || mailbox === 0n) return bad('this deployment has no Mailbox address to post to')
    if (sameFelt(request.recipient, self)) return bad('refusing to mail yourself: the memo would ride a note to your own account')
    if (mail.body.kind === 'unsupported') return bad('refusing to seal a body this app does not understand')
    if (!mailBodyFits(mail.body)) {
      return bad(`the memo is ${mailBodyBytes(mail.body)} bytes sealed; a mail carries at most ${MAX_MAIL_PLAINTEXT_BYTES}`)
    }
    return OK
  },
  compose(builder, request) {
    const mail = request.mail
    if (!mail?.calldata) throw new Error('a mail reached the builder before its memo was sealed')
    builder.with(request.token, (t) => {
      t.transfer({ recipient: request.recipient, amount: request.amount })
    })
    // The callback's arguments (open notes, withdrawals, pool) are not what a memo needs; the
    // calldata was fixed when the note was named, and the span guard checks it went in verbatim.
    const calldata = [...mail.calldata]
    builder.invoke(() => ({ contractAddress: mail.mailbox, calldata }))
  },
}
