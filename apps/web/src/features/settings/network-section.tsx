import { Activity, ExternalLink, Globe, Landmark, RefreshCw, Server, Wallet } from 'lucide-react'
import { ACTIVE_NETWORK, NET } from '@strk20/protocol/constants'
import type { PoolHealth } from '@strk20/protocol/pool'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { explorerAddress, formatWei, shortAddress } from '@/lib/format'
import { cn } from '@/lib/utils'
import { SettingsSection } from './section'
import {
  FEE_RECIPIENT_BODY,
  FEE_RECIPIENT_TITLE,
  FEE_RECIPIENT_UNSET,
  PINNED_POOL,
  POOL_STATE_LABEL,
  RPC_ORDER_NOTE,
} from './settings-copy'

export interface NetworkSectionProps {
  /** `undefined` while the first read is in flight. */
  health: PoolHealth | undefined
  healthProblem: string | null
  refreshing: boolean
  onRefresh: () => void
  /** `undefined` while reading; `null` when the relayer has none set (the query errored). */
  feeRecipient: string | null | undefined
  feeRecipientProblem: string | null
}

const STATE_TONE: Record<PoolHealth['state'], string> = {
  ok: 'border-settled/40 text-settled',
  paused: 'border-exposed/40 text-exposed',
  upgraded: 'border-exposed/40 text-exposed',
  unreachable: 'border-irreversible/40 text-irreversible',
}

function ExplorerLink({ href, children }: { href: string; children: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-mono underline underline-offset-4 hover:text-primary">
      {children}
      <ExternalLink className="size-3" aria-hidden />
    </a>
  )
}

function PoolLine({ health, problem }: { health: PoolHealth | undefined; problem: string | null }) {
  if (problem) return <ItemDescription>{problem}</ItemDescription>
  if (!health) return <Skeleton className="h-4 w-56" />
  switch (health.state) {
    case 'ok':
      return (
        <ItemDescription className="line-clamp-none font-mono text-mono">
          fee {formatWei(health.feeWei, 18)} STRK · proofs valid {health.proofValidityBlocks} blocks · block {health.blockNumber}
        </ItemDescription>
      )
    case 'upgraded':
      return (
        <ItemDescription className="line-clamp-none font-mono text-mono">
          pinned {shortAddress(health.pinned, 8, 6)} · on chain {shortAddress(health.onchain, 8, 6)}
        </ItemDescription>
      )
    case 'paused':
      return <ItemDescription>Deposits and sends are stopped by the pool. Reads still work.</ItemDescription>
    case 'unreachable':
      return <ItemDescription>None of the RPC hosts answered.</ItemDescription>
  }
}

export function NetworkSection({ health, healthProblem, refreshing, onRefresh, feeRecipient, feeRecipientProblem }: NetworkSectionProps) {
  return (
    <SettingsSection
      id="network"
      index="05"
      title="Network"
      action={
        <Button size="sm" variant="outline" onClick={onRefresh} aria-disabled={refreshing}>
          <RefreshCw data-icon="inline-start" className={cn(refreshing && 'animate-spin')} />
          Re-read
        </Button>
      }
    >
      <Item variant="outline">
        <ItemMedia variant="icon">
          <Globe aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            Starknet <Badge variant="outline" className="uppercase text-navLabel">{ACTIVE_NETWORK}</Badge>
          </ItemTitle>
          <ItemDescription className="font-mono text-mono">chain id {NET.chainId}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ExplorerLink href={NET.explorer}>{NET.explorer.replace(/^https?:\/\//, '')}</ExplorerLink>
        </ItemActions>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon">
          <Activity aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>
            Shielded pool
            {health ? (
              <Badge variant="outline" className={cn('uppercase text-navLabel', STATE_TONE[health.state])}>
                {POOL_STATE_LABEL[health.state]}
              </Badge>
            ) : null}
          </ItemTitle>
          <PoolLine health={health} problem={healthProblem} />
          <ItemDescription>{PINNED_POOL}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <ExplorerLink href={explorerAddress(NET.pool)}>{shortAddress(NET.pool, 8, 6)}</ExplorerLink>
        </ItemActions>
      </Item>

      <Item variant="outline" className="items-start">
        <ItemMedia variant="icon">
          <Server aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>RPC hosts</ItemTitle>
          <ol className="flex flex-col gap-0.5 font-mono text-mono text-muted-foreground">
            {NET.rpc.map((host, i) => (
              <li key={host}>
                {i + 1}. {host}
              </li>
            ))}
          </ol>
          <ItemDescription>{RPC_ORDER_NOTE}</ItemDescription>
        </ItemContent>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon">
          <Landmark aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>Prover</ItemTitle>
          <ItemDescription className="font-mono text-mono">{NET.prover}</ItemDescription>
        </ItemContent>
      </Item>

      <Item variant="outline">
        <ItemMedia variant="icon">
          <Wallet aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{FEE_RECIPIENT_TITLE}</ItemTitle>
          <ItemDescription className="line-clamp-none">
            {FEE_RECIPIENT_BODY}
            {feeRecipient === null ? ` ${FEE_RECIPIENT_UNSET}${feeRecipientProblem ? ` — ${feeRecipientProblem}` : ''}.` : null}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          {feeRecipient === undefined ? <Skeleton className="h-4 w-28" /> : null}
          {feeRecipient ? <ExplorerLink href={explorerAddress(feeRecipient)}>{shortAddress(feeRecipient, 8, 6)}</ExplorerLink> : null}
          {feeRecipient === null ? <span className="font-mono text-mono text-muted-foreground">—</span> : null}
        </ItemActions>
      </Item>
    </SettingsSection>
  )
}
