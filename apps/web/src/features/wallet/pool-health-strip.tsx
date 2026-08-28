import { useSyncExternalStore } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CloudOff, PauseCircle, RefreshCw } from 'lucide-react'
import { degradedCopy, degradedFromHealth, upgradedBody } from '@strk20/protocol/degraded'

import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { poolHealthQuery } from '@/queries'
import { cn } from '@/lib/utils'

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => {
    window.removeEventListener('online', listener)
    window.removeEventListener('offline', listener)
  }
}

/** Only shown when the pool is not `ok`. The sentence is the protocol's; this only picks the tint. */
export function PoolHealthStrip({ className }: { className?: string }) {
  const health = useQuery(poolHealthQuery())
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true)
  if (!health.data || health.data.state === 'ok') return null

  const reading = degradedFromHealth(health.data, online, false)
  if (reading.mode === null) return null
  const copy = degradedCopy(reading.mode)
  const body = reading.mode === 'upgraded' ? upgradedBody(reading.upgrade?.blockNumber) : copy.body
  const Icon = reading.mode === 'offline' ? CloudOff : PauseCircle

  return (
    <Alert className={cn(copy.severity === 'amber' ? 'border-exposed bg-exposedTint' : 'border-border bg-muted', className)}>
      <Icon />
      <AlertTitle>{copy.blocker}</AlertTitle>
      <AlertDescription>
        {body}
        {reading.upgrade ? (
          <span className="mt-1 block font-mono text-mono">
            pinned {reading.upgrade.pinned} · on chain {reading.upgrade.onchain}
          </span>
        ) : null}
      </AlertDescription>
      {copy.retryAction ? (
        <AlertAction>
          <Button size="sm" variant="outline" onClick={() => void health.refetch()}>
            <RefreshCw data-icon="inline-start" />
            {copy.retryAction}
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  )
}
