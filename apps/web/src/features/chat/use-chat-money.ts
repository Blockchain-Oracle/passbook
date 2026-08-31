//
// Moving money from inside a conversation.
//
// TWO STEPS, AND THE ORDER MATTERS. The transfer happens first and the card is posted second, so a
// card in the thread always names a transaction that exists. The reverse order would put a receipt
// on screen for a payment that had not been made — and a payment card is already only a CLAIM
// (`room-message.ts`), so it must at least be a claim about something real.
//
// If the transfer lands and the card does not, the money is still moved and the log says the
// message was undelivered. That is the honest split, and it is why the notification carries the
// hash rather than leaving the thread as the only record.
//
import type { Room } from '@strk20/protocol/room'

import { notify } from '@/lib/notify'
import { sendProblem, sendTransactionHash, useSend } from '@/mutations'

import type { MoneyAttachment } from './money-attachment'
import { useSendMessage } from './use-send-message'

export interface MoneyAsk {
  /** This browser's address — the log is keyed by it. */
  address: string
  peer: string
  room: Room
  attachment: MoneyAttachment
  /** The message written beside the money. Optional: an amount alone is a complete thing to send. */
  note: string
  /** Whether the review sheet's sponsorship toggle was on AND a unit was there. */
  sponsored?: boolean
  /** Where a refusal goes: the review sheet's red row, not a toast. */
  onRefused?: (sentence: string, hash: string | null) => void
}

export function useChatMoney() {
  const send = useSend()
  const post = useSendMessage()

  /** Transfer, then post the card that points at it. Resolves `true` only when value actually moved. */
  async function pay({ address, peer, room, attachment, note, sponsored, onRefused }: MoneyAsk): Promise<boolean> {
    const result = await send.mutateAsync({
      kind: 'transfer',
      ...(sponsored ? { sponsored: true } : {}),
      recipient: peer,
      token: attachment.token,
      symbol: attachment.symbol,
      amount: attachment.wei,
      surface: 'chat',
      label: `Pay in chat · ${attachment.amountText} ${attachment.symbol}`,
    })
    if (!result.ok) {
      // The review sheet is still open and it owns this refusal — a toast would float away from
      // the screen that caused it. `pay` reports it by returning false; the caller shows it.
      onRefused?.(sendProblem(result) ?? 'The payment did not go through.', sendTransactionHash(result))
      return false
    }
    try {
      await post.mutateAsync({
        address,
        peer,
        room,
        message: {
          kind: 'payment',
          amount: attachment.amountText,
          symbol: attachment.symbol,
          token: attachment.token,
          transactionHash: result.transactionHash,
          ...(note ? { text: note } : {}),
        },
      })
      notify.settled(`Sent ${attachment.amountText} ${attachment.symbol}`, {
        description: 'The card is in the thread, pointing at the transaction.',
        hash: result.transactionHash,
      })
    } catch {
      // The money moved. Only the card did not, and the thread already marks it undelivered.
      notify.warned(`Sent ${attachment.amountText} ${attachment.symbol}`, {
        description: 'The payment landed, but the card could not be delivered to the thread.',
        hash: result.transactionHash,
      })
    }
    return true
  }

  /** An ask. No transaction, so nothing to confirm and nothing to fail halfway. */
  async function ask({ address, peer, room, attachment, note }: MoneyAsk): Promise<boolean> {
    await post.mutateAsync({
      address,
      peer,
      room,
      message: {
        kind: 'request',
        amount: attachment.amountText,
        symbol: attachment.symbol,
        token: attachment.token,
        ...(note ? { text: note } : {}),
      },
    })
    return true
  }

  return { pay, ask, busy: send.isPending || post.isPending }
}
