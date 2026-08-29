import { useQuery } from '@tanstack/react-query'
import { Euro } from 'lucide-react'
import { STRK_TOKEN } from '@strk20/protocol/constants'

import btc from '@/assets/marks/btc.svg'
import eth from '@/assets/marks/eth.svg'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { findToken, tokenListQuery } from '@/queries'
import { cn } from '@/lib/utils'

/** The base asset's mark with the quote currency pinned to its corner: BTC with a $, BTC with a €. */
export function PairMark({ pair, className }: { pair: string; className?: string }) {
  const [base = pair, quote = 'USD'] = pair.split('/')
  const list = useQuery(tokenListQuery())
  const src = base === 'BTC' ? btc : base === 'ETH' ? eth : base === 'STRK' ? (findToken(list.data, STRK_TOKEN)?.logoUri ?? undefined) : undefined
  return (
    <span className={cn('relative inline-flex size-9 shrink-0', className)}>
      <Avatar className="size-full border bg-background">
        <AvatarImage src={src} alt={base} />
        <AvatarFallback className="text-[10px] font-semibold">{base.slice(0, 3)}</AvatarFallback>
      </Avatar>
      <span
        aria-label={quote}
        className="absolute -right-1 -bottom-1 inline-flex size-4 items-center justify-center rounded-full border bg-background font-mono text-[9px] font-semibold text-muted-foreground"
      >
        {quote === 'EUR' ? <Euro className="size-2.5" aria-hidden /> : '$'}
      </span>
    </span>
  )
}
