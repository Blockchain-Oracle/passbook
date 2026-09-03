//
// Two messaging surfaces, two counters, one place that knows which is which.
//
// The sidebar and the phone's tab bar both draw these badges, and the phone additionally sums them
// onto the "More" trigger because both surfaces live behind it. Before this hook that arithmetic
// existed twice, and the two copies had already drifted once — which on a badge is not a cosmetic
// bug, it is the app telling you there is nothing to read when there is.
//
// The two numbers come from genuinely different places and are NOT interchangeable. Mail's is
// derived from the chain against a "seen up to block" cursor; Chat's comes from the local log the
// relay stream writes into. Summing them for the More badge is fine — "how many things are waiting
// for you" is one honest question — but nothing else may treat them as one number.
//
import type { LinkProps } from '@tanstack/react-router'

import { useSession } from '@/app/session'
import { useTotalUnread } from '@/features/chat'
import { useUnreadMail } from '@/features/mail'

export interface UnreadBadges {
  /** What to draw on one nav item. `0` for every route that is not a messaging surface. */
  badgeFor: (to: LinkProps['to']) => number
  /** Both surfaces together, for a trigger that hides them both. */
  total: number
}

export function useUnreadBadges(): UnreadBadges {
  const session = useSession()
  // The socket lives at the app root, so this number is live on every surface rather than only on
  // the one that owns the connection.
  const chat = useTotalUnread(session.status === 'ready' ? session.address : undefined)
  const mail = useUnreadMail()
  return {
    badgeFor: (to) => (to === '/mail' ? mail : to === '/chat' ? chat : 0),
    total: chat + mail,
  }
}
