//
// Your handle on this House's roll, shown only once the roll confirms it.
//
// It is the thing the Delegate dialog has always asked people to paste and never told them where
// to find. Now it has a home, and a copy button, because handing it to somebody is the whole point
// — a delegation names a handle, not an address.
//
import { Check, Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { GOV_HANDLE_IS_YOURS, GOV_HANDLE_UNCONFIRMED } from '@strk20/protocol/disclosure-copy'

import { useCopy } from '@/hooks/use-copy'
import { shortAddress } from '@/lib/format'

import { useVoterHandle } from './use-voter-handle'

/**
 * `unconfirmed` is not an error. The roll is the only thing that could tell us you are on it, so a
 * handle it does not recognise means either you have not joined or the derivation is not the one
 * this pool uses — and the row must not pick between those two on your behalf.
 */
export function VoterHandleRow({ houseId }: { houseId: number }) {
  const { state, handle } = useVoterHandle(houseId)
  const { copied, copy } = useCopy()

  if (state === 'idle') return <span className="text-muted-foreground">—</span>
  if (state === 'pending') return <Skeleton className="h-5 w-40" />
  if (state !== 'verified' || !handle) {
    return <span className="text-body4 text-muted-foreground">{GOV_HANDLE_UNCONFIRMED}</span>
  }

  return (
    <span className="flex items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger render={<span className="font-mono text-mono" />}>{shortAddress(handle, 10, 8)}</TooltipTrigger>
        <TooltipContent className="max-w-xs">{GOV_HANDLE_IS_YOURS}</TooltipContent>
      </Tooltip>
      <Button size="icon-sm" variant="ghost" onClick={() => void copy(handle)} aria-label="Copy your handle">
        {copied ? <Check className="size-3.5 text-settled" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      </Button>
    </span>
  )
}
