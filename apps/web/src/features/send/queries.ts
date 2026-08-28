import { queryOptions, skipToken } from '@tanstack/react-query'
import type { RecipientRoute } from '@strk20/protocol/recipient'

/**
 * Where an address routes — registered, unregistered (Door A) or unreadable. One free view call,
 * asked on paste rather than on press, so the form can transform before anything is built.
 * `recipient.ts` fails closed: an unreadable answer is its own route, never folded into either side.
 */
export function recipientRouteQuery(address: string | null) {
  return queryOptions({
    queryKey: ['recipient-route', address],
    queryFn: address
      ? async (): Promise<RecipientRoute> => {
          const { preflightRecipient } = await import('@strk20/protocol/recipient')
          return preflightRecipient(address)
        }
      : skipToken,
    // A registration lands in blocks, not seconds: re-ask on the next mount, not every keystroke.
    staleTime: 30_000,
  })
}
