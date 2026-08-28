import { useQuery } from '@tanstack/react-query'
import { Eye, ShieldCheck } from 'lucide-react'
import { DRAWER_BALANCE_UNKNOWN, DRAWER_BALANCE_UNREAD } from '@strk20/protocol/account-copy'
import { BRIDGE_USDC, BRIDGE_USDC_DECIMALS } from '@strk20/protocol/bridge'
import { STRK_TOKEN } from '@strk20/protocol/constants'

import { Amount } from '@/components/money/amount'
import { findToken, publicBalancesQuery, publicTokenSet, shieldedBalanceQuery, tokenListQuery } from '@/queries'

const CORE = [
  { token: STRK_TOKEN, symbol: 'STRK', decimals: 18 },
  { token: BRIDGE_USDC, symbol: 'USDC', decimals: BRIDGE_USDC_DECIMALS },
] as const

function same(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return a === b
  }
}

/** One line per side, per token. Never summed across tokens or across the boundary. */
export function AccountBalances({ address, accountKey }: { address: string; accountKey: string | undefined }) {
  const shielded = useQuery(shieldedBalanceQuery(address, accountKey))
  const publicSide = useQuery(publicBalancesQuery(address, publicTokenSet()))
  const list = useQuery(tokenListQuery())

  const shieldedRows = shielded.data?.tokens.filter((t) => t.wei > 0n) ?? []

  return (
    <div className="flex flex-col gap-2 text-body4">
      <div className="flex items-start gap-2">
        <ShieldCheck className="mt-0.5 size-4 text-shielded" aria-hidden />
        <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-kicker uppercase text-muted-foreground">Shielded</span>
          {shielded.isPending ? (
            <span className="text-muted-foreground">{DRAWER_BALANCE_UNREAD}</span>
          ) : !shielded.data || shielded.data.presence === 'unknown' ? (
            <span className="text-muted-foreground">{DRAWER_BALANCE_UNKNOWN}</span>
          ) : shieldedRows.length === 0 ? (
            <span className="text-muted-foreground">nothing yet</span>
          ) : (
            shieldedRows.map((t) => (
              <Amount
                key={t.token}
                wei={t.wei}
                decimals={t.decimals}
                symbol={findToken(list.data ?? [], t.token)?.symbol ?? CORE.find((c) => same(c.token, t.token))?.symbol ?? 'units'}
                size="sm"
              />
            ))
          )}
        </div>
      </div>
      <div className="flex items-start gap-2">
        <Eye className="mt-0.5 size-4 text-public" aria-hidden />
        <div className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-kicker uppercase text-muted-foreground">Public</span>
          {CORE.map((c) => (
            <Amount key={c.token} wei={publicSide.data ? publicSide.data[c.token] : undefined} decimals={c.decimals} symbol={c.symbol} size="sm" />
          ))}
        </div>
      </div>
    </div>
  )
}
