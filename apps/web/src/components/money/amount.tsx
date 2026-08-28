import { formatTokenAmount, type Confidence } from '@strk20/protocol/amount'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

const SIZE_CLASS = {
  sm: 'text-mono',
  md: 'text-body3',
  lg: 'text-display4',
  hero: 'text-display2',
} as const

export interface AmountProps {
  /** `null` = read failed, `undefined` = not read yet. Both render an em dash, never 0. */
  wei: bigint | null | undefined
  decimals: number | null
  symbol?: string
  confidence?: Confidence
  size?: keyof typeof SIZE_CLASS
  /** Colour the number as a shortfall (insufficient balance) without touching the symbol. */
  short?: boolean
  className?: string
}

/** Tabular mono money. Parts come from the protocol formatter; this only lays them out. */
export function Amount({ wei, decimals, symbol, confidence, size = 'md', short = false, className }: AmountProps) {
  const base = cn('font-mono tabular-nums', SIZE_CLASS[size], className)
  if (wei === null || wei === undefined) {
    return (
      <span className={cn(base, 'text-muted-foreground')} aria-label={wei === null ? 'Could not be read' : 'Not read yet'}>
        —{symbol ? <span className="ml-1 text-muted-foreground">{symbol}</span> : null}
      </span>
    )
  }
  const rendered = formatTokenAmount(wei, decimals)
  const number =
    rendered.kind === 'raw-units' ? (
      <>
        {rendered.sign}
        {rendered.units}
      </>
    ) : (
      <>
        {rendered.sign}
        {rendered.whole}
        {rendered.hiddenZeros > 0 ? (
          <>
            .0<sub className="text-[0.7em]">{rendered.hiddenZeros}</sub>
            {rendered.fraction}
          </>
        ) : rendered.fraction ? (
          <>.{rendered.fraction}</>
        ) : null}
      </>
    )
  const unit = rendered.kind === 'raw-units' ? `${symbol ?? ''} units`.trim() : symbol
  const body = (
    <span className={base}>
      <span className={cn(short && 'text-irreversible')}>{number}</span>
      {unit ? <span className="ml-1 text-muted-foreground">{unit}</span> : null}
      {confidence === 'unknown' ? <span className="ml-0.5 text-muted-foreground">?</span> : null}
    </span>
  )
  if (rendered.kind === 'raw-units') {
    return (
      <Tooltip>
        <TooltipTrigger render={body} />
        <TooltipContent>This token's scale is unverified, so the raw unit count is shown.</TooltipContent>
      </Tooltip>
    )
  }
  return body
}
