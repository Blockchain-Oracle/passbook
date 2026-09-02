// The sealed-copy sync, driven off the session snapshot: whenever a v2 write leaves the remote
// copy behind and a recovery session is held, one mutation carries it over. No polling — the
// snapshot changes are the trigger. A sync that failed stays behind with its sentence until
// Settings' `Sync now` (a passkey prompt) clears it.
import { useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'

import { pushEnvelope } from './passkey'
import { getRecoverySession } from './recovery-state'
import { useSession } from './store'

export function useRecoverySync(): void {
  const session = useSession()
  const passkey = session.status === 'ready' ? session.protection?.passkey : null
  const behind = passkey?.sync === 'behind' && passkey.problem === null
  const push = useMutation({ mutationKey: ['recovery', 'envelope', 'put'], mutationFn: pushEnvelope })
  const { mutate, isPending } = push
  useEffect(() => {
    if (behind && !isPending && getRecoverySession()) mutate()
  }, [behind, isPending, mutate])
}
