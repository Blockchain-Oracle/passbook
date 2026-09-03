//
// One thread: every mail between this account and one peer, in block order, both directions —
// rebuilt from the chain, never from this browser. The composer at the foot sends the next one.
//
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Lock } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { BRIDGE_USDC, BRIDGE_USDC_DECIMALS, BRIDGE_USDC_SYMBOL } from '@strk20/protocol/bridge-calldata'
import { MAIL_AUDITOR_DERIVES } from '@strk20/protocol/disclosure-copy'
import { MAIL_PENDING, MAIL_THREAD_EMPTY } from '@strk20/protocol/mail-copy'
import { sameAddress } from '@strk20/protocol/address'
import { PAY_ASSETS, type PayAsset } from '@strk20/protocol/pay-link'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { IdentityAvatar } from '@/components/money/identity-avatar'
import { handleLabel } from '@/lib/format'
import { useIdentity } from '@/queries/identity'
import { findToken, tokenListQuery } from '@/queries/tokens'

import { latestIncoming, markSeen } from './mail-seen'
import { MailRow, type PayAsk, type TokenScale } from './mail-row'
import { MailComposerPanel, type ComposerSeed } from './thread-composer'
import { threadFor, useMail } from './use-mail'

const PINNED: Record<string, TokenScale> = {
  [BigInt(STRK_TOKEN).toString()]: { symbol: 'STRK', decimals: 18 },
  [BigInt(BRIDGE_USDC).toString()]: { symbol: BRIDGE_USDC_SYMBOL, decimals: BRIDGE_USDC_DECIMALS },
}

/** The thread route's body. */
export function Thread({ peer }: { peer: string }) {
  const { ready, query } = useMail()
  const identity = useIdentity(peer)
  const list = useQuery(tokenListQuery())
  const thread = useMemo(() => threadFor(query.data, peer), [query.data, peer])
  const [pending, setPending] = useState<ComposerSeed | null>(null)
  const [seed, setSeed] = useState<{ asset?: PayAsset; amount?: string } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const scaleFor = (token: string): TokenScale => {
    const pinned = PINNED[BigInt(token).toString()]
    if (pinned) return pinned
    const listed = findToken(list.data, token)
    return listed ? { symbol: listed.symbol, decimals: listed.decimals } : { symbol: 'Token', decimals: null }
  }

  // Seen up to the newest incoming block whenever the thread is on screen and has been read.
  useEffect(() => {
    if (ready && query.data) markSeen(ready.address, peer, latestIncoming(thread))
  }, [ready, query.data, peer, thread])

  // The LIST scrolls, never the document, so the composer stays on the bottom edge of the screen.
  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread.items.length, pending])

  if (!ready) return null
  const self = sameAddress(peer, ready.address)

  function payAsk(ask: PayAsk) {
    const asset = (PAY_ASSETS as readonly string[]).includes(ask.symbol) ? (ask.symbol as PayAsset) : undefined
    setSeed({ ...(asset ? { asset } : {}), amount: ask.amount })
  }

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card @max-3xl:rounded-none @max-3xl:border-x-0">
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-3 py-2">
        <Button size="icon-sm" variant="ghost" className="@3xl:hidden" render={<Link to="/mail" aria-label="All threads" />}>
          <ArrowLeft aria-hidden />
        </Button>
        <IdentityAvatar address={peer} name={identity.name} avatar={identity.avatar} />
        <div className="min-w-0 flex-1 basis-32">
          <p className="truncate font-medium">{handleLabel(identity.name, peer, 10, 8)}</p>
          <p className="truncate text-body4 text-muted-foreground">
            {query.isPending ? 'Reading the chain…' : `${thread.items.length} on chain`}
            {query.data && !query.data.complete ? ' · the newest may be missing' : ''}
          </p>
        </div>
        <Tooltip>
          <TooltipTrigger render={<Badge variant="outline" className="gap-1 uppercase text-navLabel" />}>
            <Lock aria-hidden />
            Sealed
          </TooltipTrigger>
          <TooltipContent className="max-w-xs">{MAIL_AUDITOR_DERIVES}</TooltipContent>
        </Tooltip>
      </header>

      <div ref={listRef} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-3 py-4">
        {query.isPending ? (
          <p className="m-auto flex items-center gap-2 text-body3 text-muted-foreground">
            <Spinner /> Reading the chain…
          </p>
        ) : query.isError ? (
          <p className="m-auto max-w-sm text-center text-body3 text-irreversible">{query.error.message}</p>
        ) : thread.items.length === 0 && !pending ? (
          <p className="m-auto max-w-sm text-center text-body3 text-muted-foreground">{MAIL_THREAD_EMPTY}</p>
        ) : (
          thread.items.map((item) => <MailRow key={`${item.transactionHash}:${item.noteId}`} item={item} scale={scaleFor(item.token)} onPay={payAsk} />)
        )}
        {pending ? (
          <div className="flex max-w-[85%] flex-col items-end gap-1 self-end opacity-70">
            <div className="rounded-xl bg-primary px-3 py-2 text-primary-foreground">
              <p className="whitespace-pre-wrap break-words text-body2">{pending.text || pending.kindLabel}</p>
            </div>
            <p className="flex items-center gap-1 text-body4 text-muted-foreground">
              <Spinner className="size-3" /> {MAIL_PENDING}
            </p>
          </div>
        ) : null}
      </div>

      <MailComposerPanel
        peer={peer}
        self={self}
        seed={seed}
        onSeedUsed={() => setSeed(null)}
        onPending={setPending}
        onSent={() => setPending(null)}
      />
    </section>
  )
}
