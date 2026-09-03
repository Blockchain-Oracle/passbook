//
// Sending a mail: one call into the app's one send mutation, with the memo leg attached.
//
// Nothing here moves money on its own. `useSend` runs the same pre-flight, proof, submission and
// confirmation every venue uses; the only difference from a plain transfer is the `mail` leg,
// which `proveSend` seals for the note the transfer creates and posts through the pool.
//
import type { MailBody } from '@strk20/protocol/mail-body'

import { useSend, sendProblem, sendTransactionHash } from '@/mutations'

import { mailbox } from './use-mail'

export interface SendMailInput {
  peer: string
  token: string
  symbol: string
  amount: bigint
  body: MailBody
  sponsored: boolean
  /** Rendered red against the confirm button. The sheet stays open. */
  onRefused: (problem: string | null | undefined, transactionHash?: string | null) => void
}

export function useSendMail() {
  const send = useSend()

  const sendMail = async (input: SendMailInput): Promise<{ transactionHash: string } | null> => {
    const box = mailbox()
    if (!box) {
      input.onRefused('This build has no Mailbox to post to, so mail cannot be sent yet.')
      return null
    }
    const result = await send.mutateAsync({
      kind: 'mail',
      recipient: input.peer,
      token: input.token,
      symbol: input.symbol,
      amount: input.amount,
      sponsored: input.sponsored,
      surface: 'mail',
      label: `Mail · ${input.symbol}`,
      mail: { body: input.body, mailbox: box.address },
    })
    if (!result.ok) {
      input.onRefused(sendProblem(result), sendTransactionHash(result))
      return null
    }
    return { transactionHash: result.transactionHash }
  }

  return { sendMail, busy: send.isPending }
}
