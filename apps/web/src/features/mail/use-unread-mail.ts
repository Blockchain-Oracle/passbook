// The nav badge: threads with incoming mail newer than the last look. One read, live on every surface.
import { useUnreadThreads } from './mail-seen'
import { useMail } from './use-mail'

export function useUnreadMail(): number {
  const { ready, query } = useMail()
  return useUnreadThreads(ready?.address, query.data?.threads)
}
