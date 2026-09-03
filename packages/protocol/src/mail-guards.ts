//
// The mail span guard: what the prover is allowed to have composed for a transfer with a memo.
//
// The memo was sealed against a note id predicted from the walk. If the SDK compiled the
// recipient's note at any other index, the memo would land on chain keyed to a note that never
// exists and the recipient would find a payment with no words. That costs the pool fee to learn
// on chain and nothing to learn here, so the compiled span is read before anything is proved.
//

import { decodeClientActions } from './action-span.js'
import { CLIENT_ACTION } from './client-action-index.js'
import { compute_note_id } from './discovery.js'
import { envelopeFromFelts } from './mail-envelope.js'

export interface MailSpanSubject {
  recipient: bigint
  token: bigint
  amount: bigint
  mailbox: bigint
  channelKey: bigint
  anchor: bigint
  calldata: readonly string[]
}

/** The SDK named the recipient's note differently from the walk's prediction. Nothing was signed. */
export class MailAnchorMismatch extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MailAnchorMismatch'
  }
}

/**
 * Exactly one encrypted note to the recipient for the reviewed token and amount, at the index the
 * anchor was predicted from; exactly one `InvokeExternal`, to the Mailbox, carrying the sealed
 * calldata verbatim. Everything else in the span is the SDK's own business (notes spent, change,
 * setup, the relayer's reimbursement) and is left alone.
 */
export function assertMailActionSpan(span: readonly bigint[], subject: MailSpanSubject): void {
  const actions = decodeClientActions(span, 'mail')

  // `CreateEncNote` fields: [recipient_addr, recipient_public_key, token, amount, index, salt].
  const toRecipient = actions.filter(
    (a) => a.variant === CLIENT_ACTION.CreateEncNote && a.fields[0] === subject.recipient && a.fields[2] === subject.token,
  )
  if (toRecipient.length !== 1) {
    throw new MailAnchorMismatch(`the compiled mail creates ${toRecipient.length} notes to the recipient for this token; a mail creates exactly one`)
  }
  const note = toRecipient[0]!
  if (note.fields[3] !== subject.amount) {
    throw new Error(`the compiled recipient note carries ${note.fields[3]} and the review said ${subject.amount}`)
  }
  const index = Number(note.fields[4])
  const compiledId = compute_note_id(subject.channelKey, subject.token, index)
  if (compiledId !== subject.anchor) {
    throw new MailAnchorMismatch(
      `the SDK compiled the recipient note at index ${index}, which is not the note the memo was sealed for — ` +
        'the walk was behind the chain. Refresh and send again; nothing was signed.',
    )
  }

  // `InvokeExternal` fields: [contract_address, calldata_len, ...calldata].
  const invokes = actions.filter((a) => a.variant === CLIENT_ACTION.InvokeExternal || a.variant === CLIENT_ACTION.ComputeAndInvoke)
  if (invokes.length !== 1 || invokes[0]!.variant !== CLIENT_ACTION.InvokeExternal) {
    throw new Error(`the compiled mail carries ${invokes.length} invoke action(s); a mail carries exactly one InvokeExternal`)
  }
  const invoke = invokes[0]!
  if (invoke.fields[0] !== subject.mailbox) {
    throw new Error(`the compiled mail invokes ${invoke.fields[0]?.toString(16)}, not the Mailbox`)
  }
  const compiled = invoke.fields.slice(2)
  const expected = subject.calldata.map((f) => BigInt(f))
  if (compiled.length !== expected.length || compiled.some((f, i) => f !== expected[i])) {
    throw new Error('the compiled Mailbox calldata is not the sealed memo verbatim')
  }
  // And the envelope inside it names the same note.
  if (envelopeFromFelts(compiled).anchor !== subject.anchor) throw new Error('the sealed memo names a different anchor')
}
