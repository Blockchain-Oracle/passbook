//
// Handing somebody your voter handle.
//
// A delegation names a handle, not an address, and a handle is derived per contract — so there is
// no directory to look one up in and no way to guess it. It has to be handed over, and a
// conversation is the natural place. The card the recipient gets carries a button; the alternative
// was reading a felt out loud.
//
// Only VERIFIED handles are offered. `useVoterHandles` proves each against the House's own roll,
// so this dialog can never share a handle the chain would not recognise.
//
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Landmark } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { houseTitle } from '@/features/houses/gov-send'
import { useVoterHandles } from '@/features/houses/use-voter-handle'
import { shortAddress } from '@/lib/format'
import { housesQuery } from '@/queries'

export interface ShareHandleDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onShare: (share: { handle: string; houseId: number; houseName: string }) => void
}

export function ShareHandleDialog({ open, onOpenChange, onShare }: ShareHandleDialogProps) {
  const houses = useQuery(housesQuery())
  const ids = useMemo(() => (houses.data?.houses ?? []).map((h) => h.id), [houses.data])
  const handles = useVoterHandles(ids)

  const rolls = (houses.data?.houses ?? []).filter((h) => handles[h.id]?.state === 'verified')
  const reading = houses.isPending || ids.some((id) => handles[id]?.state === 'pending')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-display4 uppercase">Share your handle</DialogTitle>
          <DialogDescription>
            Whoever holds it can delegate their voting weight to you in that House. Sharing it delegates nothing on its own.
          </DialogDescription>
        </DialogHeader>

        {reading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : rolls.length === 0 ? (
          <Empty className="py-6">
            <EmptyHeader>
              <EmptyTitle>No roll to share from</EmptyTitle>
              <EmptyDescription>
                A handle exists once you have joined a House. Join one and it appears on that House’s page.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ItemGroup className="gap-2">
            {rolls.map((house) => {
              const handle = handles[house.id]!.handle!
              return (
                <Item
                  key={house.id}
                  variant="outline"
                  size="sm"
                  render={
                    <button
                      type="button"
                      onClick={() => onShare({ handle, houseId: house.id, houseName: houseTitle(house) })}
                      className="text-left"
                    />
                  }
                >
                  <Landmark className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <ItemContent className="min-w-0">
                    <ItemTitle className="truncate">{houseTitle(house)}</ItemTitle>
                    <ItemDescription className="font-mono text-mono">{shortAddress(handle, 10, 8)}</ItemDescription>
                  </ItemContent>
                  <Button size="sm" variant="outline" render={<span />}>
                    Share
                  </Button>
                </Item>
              )
            })}
          </ItemGroup>
        )}
      </DialogContent>
    </Dialog>
  )
}
