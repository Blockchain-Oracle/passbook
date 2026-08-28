//
// The Room — a market's open thread, one press off its card. Yosuku gated theirs to bettors;
// ours is deliberately open (the market's whole book is public anyway), and the thread's own
// disclosure line says exactly what open means.
//
import { marketTalkTag } from '@strk20/protocol/open-room-tags'
import { marketQuestion, type OnChainMarket } from '@strk20/protocol/app-reads'

import { ResponsiveDialog } from '../../shell/ResponsiveDialog'
import { TalkThread } from '../launch/TalkThread'
import { Text } from '../ui/Text'

export function MarketRoom({
  market,
  open,
  onClose,
}: {
  market: OnChainMarket
  open: boolean
  onClose: () => void
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())} label="The Room" modal>
      <div className="flex min-h-0 flex-col gap-s12 overflow-y-auto">
        <div className="flex flex-col">
          <Text variant="kicker">The Room</Text>
          <Text variant="subheading2" as="h2" className="text-neutral1">
            {marketQuestion(market)}
          </Text>
        </div>
        <TalkThread
          tag={marketTalkTag(market.id)}
          emptyLine="Nobody has called this one yet. The room is open."
        />
      </div>
    </ResponsiveDialog>
  )
}
