import { useMutation } from '@tanstack/react-query'
import { AppWindow } from 'lucide-react'

import { takeOverSubmitLock, useSession } from '@/app/session'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

/**
 * Shown in every tab that is not the submit leader. Reads work anywhere; only one tab may sign,
 * and without this the refusal ("open in another tab") sends people hunting for the other tab.
 */
export function TabBanner() {
  const session = useSession()
  const takeOver = useMutation({ mutationKey: ['take-over-submit-lock'], mutationFn: takeOverSubmitLock })
  if (session.status !== 'ready' || session.isLeader) return null
  return (
    <div className="px-4 pt-3 md:px-8">
      <Alert>
        <AppWindow />
        <AlertTitle>strk20.run is open in another tab</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
          <span>That tab signs transactions; this one only reads until you switch.</span>
          <Button size="sm" aria-disabled={takeOver.isPending || undefined} onClick={() => !takeOver.isPending && takeOver.mutate()}>
            {takeOver.isPending ? <Spinner data-icon="inline-start" /> : null}
            Use this tab
          </Button>
          {takeOver.error ? <span className="basis-full text-irreversible">{takeOver.error.message}</span> : null}
        </AlertDescription>
      </Alert>
    </div>
  )
}
