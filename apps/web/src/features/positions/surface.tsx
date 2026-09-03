//
// Positions: everything this browser can still collect, in one place.
//
// It replaces four surfaces — a flat cross-venue log plus a panel bolted onto Markets, Launch and
// Houses — that each printed one row per stored secret. The venue pages now point here; settling
// happens here; and a position is the INSTRUMENT you hold, with its claims inside it.
//
import { useMemo, useState } from 'react'
import { Trophy } from 'lucide-react'
import { disclosureFor } from '@strk20/protocol/disclosure'

import { Page } from '@/components/layout/page'
import { Amount } from '@/components/money/amount'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { ReviewSheet } from '@/components/money/review-sheet'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSession } from '@/app/session'
import { useNow } from '@/hooks/use-now'
import { formatWei } from '@/lib/format'
import { notify } from '@/lib/notify'
import { removeReceipt } from '@/queries/position-history'
import { removeStoredPosition } from '@/queries/positions'

import { GroupDialog } from './group-dialog'
import { FINISHED_BODY, FINISHED_TITLE, HISTORY_CORRUPT } from './history-copy'
import { HistoryList } from './history-list'
import { PositionsList } from './positions-table'
import { shareOf } from './receipt-describe'
import { ReceiptSheet } from './receipt-sheet'
import { ShareDialog } from './share-dialog'
import { PositionsRollup } from './rollup'
import { DOOR_VERB, doorAmount, settleDoor, useSettle, type SettleDoor } from './settle'
import type { MarketReceipt } from '@strk20/protocol/position-history'
import type { PositionShare } from '@strk20/protocol/position-share'

import type { Claim, PositionGroup, PositionTab } from './types'
import { useMarketHistory } from './use-history'
import { usePositionGroups } from './use-position-groups'

/** Thirty seconds. Nothing here is a trading clock, and a long list ticking per second is waste. */
const TICK_MS = 30_000

const TABS: readonly { value: PositionTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'market', label: 'Markets' },
  { value: 'token', label: 'Tokens' },
  { value: 'house', label: 'DAOs' },
  { value: 'earn', label: 'Earn' },
]

const DISCLOSURE = {
  market: disclosureFor('markets-exit'),
  launch: disclosureFor('launch-sell'),
  governance: disclosureFor('gov-reclaim'),
  earn: disclosureFor('earn'),
} as const

interface Review {
  group: PositionGroup
  door: SettleDoor
  /** One claim, or every ready claim sharing a door. Settled in order, stopping at the first refusal. */
  claims: Claim[]
}

/** Every ready claim in the group, but only when they all open the SAME door. */
function batchable(group: PositionGroup): { door: SettleDoor; claims: Claim[] } | null {
  const ready = group.claims.map((claim) => ({ claim, door: settleDoor(claim) })).filter((r) => r.door !== null)
  if (ready.length < 2) return null
  const door = ready[0]!.door!
  return ready.every((r) => r.door === door) ? { door, claims: ready.map((r) => r.claim) } : null
}

function totalOf(claims: readonly Claim[]): { wei: bigint; decimals: number | null; symbol: string } | null {
  const first = claims[0]
  if (!first) return null
  if (!claims.every((c) => c.payout.symbol === first.payout.symbol)) return null
  return {
    wei: claims.reduce((sum, c) => sum + (c.life.amount ?? 0n), 0n),
    decimals: first.payout.decimals,
    symbol: first.payout.symbol,
  }
}

export function PositionsSurface({ open }: { open?: string }) {
  const now = useNow(TICK_MS)
  const read = usePositionGroups(now)
  const session = useSession()
  // Hidden while locked: a memory of bets is still a fact about the wallet on this screen.
  const history = useMarketHistory(now, session.status === 'ready')
  const [receipt, setReceipt] = useState<MarketReceipt | null>(null)
  const [share, setShare] = useState<PositionShare | null>(null)
  const [tab, setTab] = useState<PositionTab>('all')
  const [openKey, setOpenKey] = useState<string | null>(open ?? null)
  const [seededFrom, setSeededFrom] = useState(open)
  const [review, setReview] = useState<Review | null>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const { settle, busy } = useSettle()

  // A venue's summary strip links here with its own key, so the position it points at opens. The
  // link can change while this surface is already mounted, so the state is adjusted during render
  // (React's own pattern for a prop-derived value) rather than in an effect that renders twice.
  if (open !== seededFrom) {
    setSeededFrom(open)
    setOpenKey(open ?? null)
  }

  const shown = useMemo(() => (tab === 'all' ? read.groups : read.groups.filter((g) => g.tab === tab)), [read.groups, tab])
  const openGroup = useMemo(() => read.groups.find((g) => g.key === openKey) ?? null, [read.groups, openKey])

  const confirm = async (sponsored: boolean) => {
    if (!review) return
    const { claims, group, door } = review
    setProgress({ done: 0, total: claims.length })
    for (const [i, claim] of claims.entries()) {
      // One pipeline at a time per account, so a batch is a queue rather than a fan-out. The
      // sponsor choice applies to each; the sheet's counter says how many are still covered.
      const outcome = await settle({ claim, group, door, sponsored })
      if (!outcome.ok) {
        setProgress(null)
        if (i > 0) notify.warned(`${i} of ${claims.length} settled`, { description: 'The rest are still held — open the position to try them again.' })
        return
      }
      setProgress({ done: i + 1, total: claims.length })
    }
    setProgress(null)
    setReview(null)
  }

  const total = review ? totalOf(review.claims) : null
  const batch = review && review.claims.length > 1

  return (
    <Page
      kicker="Venues"
      title="Positions"
      description="Every bearer claim this browser holds — what it is, when it decides, and what it pays when it does."
      actions={<BoundaryBadge kind="bearer" />}
    >
      {read.status === 'corrupt' ? <p className="text-body4 text-irreversible">{read.because}</p> : null}
      {read.status === 'pending' ? <Skeleton className="h-32 w-full" /> : null}

      {read.status === 'ok' ? (
        <>
          <PositionsRollup read={read} />

          {read.groups.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Trophy aria-hidden />
                </EmptyMedia>
                <EmptyTitle>Nothing open</EmptyTitle>
                <EmptyDescription>
                  Bets, launch buys and House claims made in this browser collect here, each with the countdown to when it
                  can be settled.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <>
              <Tabs value={tab} onValueChange={(value) => setTab(value as PositionTab)}>
                <TabsList>
                  {TABS.map((t) => (
                    <TabsTrigger key={t.value} value={t.value}>
                      {t.label}
                      {t.value !== 'all' ? (
                        <span className="ml-1.5 text-muted-foreground">{read.groups.filter((g) => g.tab === t.value).length}</span>
                      ) : null}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>

              {shown.length === 0 ? (
                <p className="text-body4 text-muted-foreground">Nothing held in this venue.</p>
              ) : (
                <PositionsList groups={shown} onOpen={(g) => setOpenKey(g.key)} />
              )}
            </>
          )}

          {(tab === 'all' || tab === 'market') && (history.status === 'corrupt' || history.finished.length > 0) ? (
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="font-display text-display4 uppercase">{FINISHED_TITLE}</h2>
                <p className="text-body4 text-muted-foreground">{FINISHED_BODY}</p>
              </div>
              {history.status === 'corrupt' ? (
                <p className="text-body4 text-irreversible">{HISTORY_CORRUPT}</p>
              ) : (
                <HistoryList receipts={history.finished} tokens={history.tokens} onOpen={setReceipt} />
              )}
            </section>
          ) : null}
        </>
      ) : null}

      <ReceiptSheet
        receipt={receipt}
        tokens={history.tokens}
        onOpenChange={(next) => (next ? undefined : setReceipt(null))}
        onClear={async (r) => {
          await removeStoredPosition(r.commitment)
          await removeReceipt(r.commitment)
          setReceipt(null)
        }}
        onShare={(r) => {
          const dto = shareOf(r, history.tokens)
          if (dto) {
            setReceipt(null)
            setShare(dto)
          }
        }}
      />
      <ShareDialog share={share} onOpenChange={(next) => (next ? undefined : setShare(null))} />

      <GroupDialog
        group={openGroup}
        onOpenChange={(next) => (next ? undefined : setOpenKey(null))}
        onSettle={(claim, door) => {
          const all = openGroup ? batchable(openGroup) : null
          setOpenKey(null)
          // Offer the batch when every ready claim opens the same door — nine redeems is one decision.
          setReview(
            openGroup
              ? { group: openGroup, door, claims: all && all.door === door ? all.claims : [claim] }
              : null,
          )
        }}
      />

      {review ? (
        <ReviewSheet
          open
          onOpenChange={(next) => (next || busy ? undefined : setReview(null))}
          title={`Review ${DOOR_VERB[review.door].toLowerCase()}`}
          description={review.group.title}
          boundary="bearer"
          rows={[
            { label: 'Position', value: review.group.title },
            ...(batch ? [{ label: 'Claims', value: String(review.claims.length) }] : []),
            {
              label: review.door === 'cashout' ? 'Sells back for' : 'Pays',
              value: total ? <Amount wei={total.wei} decimals={total.decimals} symbol={total.symbol} /> : doorAmount(review.claims[0]!),
            },
            ...(review.door === 'cashout' && total
              ? [{ label: 'You accept at least', value: `${formatWei((total.wei * 99n) / 100n, total.decimals)} ${total.symbol}` }]
              : []),
            {
              label: 'Receives shielded',
              value: batch ? `${review.claims.length} fresh notes to yourself` : 'One fresh note to yourself',
            },
          ]}
          disclosure={DISCLOSURE[review.group.venue]}
          confirmLabel={batch ? `Settle ${review.claims.length} claims` : `${DOOR_VERB[review.door]} now`}
          sponsor={{ kind: 'eligible' }}
          onConfirm={(sponsored) => void confirm(sponsored)}
          busy={busy || progress !== null}
        >
          {batch ? (
            <p className="text-body4 text-muted-foreground">
              {review.claims.length} separate transactions, one per claim, each paying its own network fee. They go in order
              and stop at the first refusal.
              {progress ? ` ${progress.done} of ${progress.total} done.` : ''}
            </p>
          ) : null}
        </ReviewSheet>
      ) : null}
    </Page>
  )
}
