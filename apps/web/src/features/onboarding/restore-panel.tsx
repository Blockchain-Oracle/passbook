// Import → Passkey: a fresh browser asks the passkey provider for the passkey made elsewhere,
// and the sealed copy comes back from the recovery service. One prompt. It refuses on a browser
// that already holds a wallet — restoring would write over it.
import { useMutation } from '@tanstack/react-query'
import { Fingerprint } from 'lucide-react'
import { RESTORE_BODY, RESTORE_CTA, RESTORE_DONE } from '@strk20/protocol/passkey-copy'

import { getSessionSnapshot, sessionActions } from '@/app/session'
import { RefusalRow, useRefusal } from '@/components/money/refusal'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

export interface RestorePanelProps {
  onDone?: (outcome: { address: string; already: boolean }) => void
}

export function RestorePanel({ onDone }: RestorePanelProps) {
  const { refusal, refuse, clear } = useRefusal()
  const restore = useMutation({
    mutationKey: ['restore-passkey'],
    mutationFn: async () => {
      const outcome = await sessionActions.restoreWithPasskey()
      if (!outcome.ok) throw new Error(outcome.error)
      return getSessionSnapshot().address ?? ''
    },
    onError: (e) => refuse(e.message),
    onSuccess: (address) => onDone?.({ address, already: false }),
  })
  return (
    <div className="flex flex-col gap-4">
      <p className="text-body3 text-muted-foreground">{RESTORE_BODY}</p>
      {restore.isSuccess ? <p className="text-body3">{RESTORE_DONE}</p> : null}
      <RefusalRow refusal={refusal} />
      <Button
        size="lg"
        className="h-12 self-start text-buttonLabel2"
        aria-disabled={restore.isPending}
        onClick={() => {
          if (restore.isPending) return
          clear()
          restore.mutate()
        }}
      >
        {restore.isPending ? <Spinner data-icon="inline-start" /> : <Fingerprint data-icon="inline-start" />}
        {restore.isPending ? 'Waiting for the passkey…' : RESTORE_CTA}
      </Button>
    </div>
  )
}
