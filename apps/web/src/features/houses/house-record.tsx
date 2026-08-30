import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import { HOUSE_MEMBERSHIP, type OnChainHouse, type OnChainProposal } from '@strk20/protocol/governance-reads'

import { Amount } from '@/components/money/amount'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { explorerTx, shortAddress } from '@/lib/format'
import { appContracts, useChainFeed } from '@/queries'
import { BallotTicket } from './ballot-ticket'
import { DelegateDialog } from './delegate-dialog'
import { houseTitle } from './gov-send'
import { FundDialog, JoinDialog } from './house-doors'
import { useNow } from '@/hooks/use-now'
import { HOUSE_CLOCK_MS, WritesBlocked } from './houses-list'
import { PositionsStrip } from '@/features/positions'
import { ProposalRow, proposalSettled } from './proposal-row'
import { ProposeDialog } from './propose-dialog'
import { useGovernanceRead } from './queries'
import { useHouseToken } from './use-house-token'
import { Verification } from './verification'

type Door = 'propose' | 'fund' | 'join' | 'delegate' | null

/** Tape receipts for one proposal: opened / tally / key / executed, each a transaction link. */
function ProposalReceipts({ proposal }: { proposal: OnChainProposal }) {
  const feed = useChainFeed()
  const links: Array<[string, string]> = []
  for (const item of feed.tape) {
    if (!('proposalId' in item) || item.proposalId !== proposal.id) continue
    const href = explorerTx(item.txHash)
    if (item.kind === 'proposal-created') links.push(['opened', href])
    if (item.kind === 'tally-published') links.push(['tally', href])
    if (item.kind === 'key-published') links.push(['key', href])
    if (item.kind === 'gov-executed') links.push(['executed', href])
  }
  if (links.length === 0) return null
  return (
    <div className="flex flex-wrap gap-3 px-3 font-mono text-mono text-muted-foreground">
      {links.map(([label, href]) => (
        <a key={label} href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline hover:text-foreground">
          {label}
          <ExternalLink className="size-3" aria-hidden />
        </a>
      ))}
    </div>
  )
}

function Rule({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-body4 text-muted-foreground">{label}</dt>
      <dd className="font-mono text-body3">{value}</dd>
    </div>
  )
}

/** The room behind the card: rules, every proposal with receipts, verification, and the doors. */
function Record({ house, proposals }: { house: OnChainHouse; proposals: readonly OnChainProposal[] }) {
  const read = useGovernanceRead()
  const token = useHouseToken(house)
  const now = useNow(HOUSE_CLOCK_MS)
  const [ballot, setBallot] = useState<{ proposal: OnChainProposal; choice: number } | null>(null)
  const [door, setDoor] = useState<Door>(null)
  const invite = house.membership === HOUSE_MEMBERSHIP.invite
  const settled = proposals.filter(proposalSettled)
  const writesEnabled = read.writes.enabled

  return (
    <div className="flex flex-col gap-6">
      {!read.writes.enabled ? <WritesBlocked because={read.writes.because} /> : null}
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="font-mono text-mono">
              {invite ? 'invite' : 'open'}
            </Badge>
            {token.memberMode ? (
              <Badge variant="outline" className="font-mono text-mono">
                1 member · 1 vote
              </Badge>
            ) : null}
          </div>
          <CardDescription className="font-mono text-mono">
            House #{house.id} · votes in {token.symbol} · {house.memberCount} member{house.memberCount === 1 ? '' : 's'}, none of them named
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-1">
          <Amount wei={house.treasury} decimals={token.decimals} symbol={token.symbol} size="hero" />
          <p className="text-body4 text-muted-foreground">in the treasury — funding amounts are public; spending requires a passed vote</p>
        </CardContent>
      </Card>

      <div className="grid gap-6 @3xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-6">
          <section className="flex flex-col gap-2">
            <h2 className="text-kicker uppercase text-muted-foreground">Proposals</h2>
            {proposals.length === 0 ? (
              <p className="text-body3 text-muted-foreground">No question has been put to this House yet. The box is ready — propose the first.</p>
            ) : (
              proposals.map((proposal) => (
                <div key={proposal.id} className="flex flex-col gap-1">
                  <ProposalRow
                    proposal={proposal}
                    now={now}
                    symbol={token.symbol}
                    decimals={token.weightDecimals}
                    unit={token.weightUnit}
                    onVote={writesEnabled ? (choice) => setBallot({ proposal, choice }) : undefined}
                  />
                  <ProposalReceipts proposal={proposal} />
                </div>
              ))
            )}
          </section>
          {settled.length > 0 ? <Verification house={house} proposals={settled} decimals={token.weightDecimals} unit={token.weightUnit} /> : null}
        </div>

        <aside className="flex flex-col gap-4 self-start lg:sticky lg:top-6">
          <Card>
            <CardHeader>
              <CardTitle className="font-display text-display4 uppercase">The doors</CardTitle>
              <CardDescription>Every door is a real transaction through the pool. The House stores derived handles or commitments, while the transaction submitter remains visible.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Button aria-disabled={!writesEnabled || undefined} onClick={() => writesEnabled && setDoor('propose')}>
                Propose
              </Button>
              <Button variant="outline" aria-disabled={!writesEnabled || undefined} onClick={() => writesEnabled && setDoor('fund')}>
                Fund the treasury
              </Button>
              {invite ? (
                <Button variant="outline" aria-disabled={!writesEnabled || undefined} onClick={() => writesEnabled && setDoor('join')}>
                  Join with an invite
                </Button>
              ) : null}
              {!token.memberMode ? (
                <Button variant="ghost" aria-disabled={!writesEnabled || undefined} onClick={() => writesEnabled && setDoor('delegate')}>
                  Delegate weight
                </Button>
              ) : null}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-kicker uppercase text-muted-foreground">The rules</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="flex flex-col gap-2">
                <Rule label="Quorum" value={<Amount wei={house.quorum} decimals={token.weightDecimals} symbol={token.weightUnit} size="sm" />} />
                <Rule label="Passes above" value={`${house.thresholdBps / 100}% of the vote`} />
                <Rule label="Counting" value={token.memberMode ? 'one member, one vote' : `weight in ${token.symbol}`} />
                <Rule label="Membership" value={invite ? 'invite only — the roll stores derived handles, not addresses' : 'open to any holder'} />
                <Rule label="Governor" value={shortAddress(appContracts().governance ?? '0x0', 8, 6)} />
              </dl>
            </CardContent>
          </Card>
          <PositionsStrip venue="governance" id={house.id} />
        </aside>
      </div>

      {ballot ? (
        <BallotTicket house={house} proposal={ballot.proposal} initialChoice={ballot.choice} open onOpenChange={(o) => !o && setBallot(null)} />
      ) : null}
      <ProposeDialog house={house} open={door === 'propose'} onOpenChange={(o) => !o && setDoor(null)} />
      <FundDialog house={house} open={door === 'fund'} onOpenChange={(o) => !o && setDoor(null)} />
      {invite ? <JoinDialog house={house} open={door === 'join'} onOpenChange={(o) => !o && setDoor(null)} /> : null}
      <DelegateDialog house={house} open={door === 'delegate'} onOpenChange={(o) => !o && setDoor(null)} />
    </div>
  )
}

/** Resolves the id against the read window; the route passes the raw param. */
export function HouseRecord({ id }: { id: string }) {
  const read = useGovernanceRead()
  const houseId = /^\d+$/.test(id) ? Number(id) : null
  const house = houseId === null ? undefined : read.houses.find((h) => h.id === houseId)

  if (!house) {
    if (houseId !== null && read.loading) return <Skeleton className="h-48 w-full" />
    return (
      <div className="flex flex-col gap-3">
        <p className="text-body3 text-muted-foreground">
          {houseId === null
            ? 'That is not a House id.'
            : !read.deployed
              ? 'No Governance deployment is recorded for this build.'
              : `House ${houseId} is not in the read window — the list carries the newest Houses, and this one is either older than that or not created yet.`}
        </p>
        <Button variant="outline" className="w-fit" render={<Link to="/houses" />}>
          Back to the Houses
        </Button>
      </div>
    )
  }
  return <Record house={house} proposals={read.proposals.filter((p) => p.houseId === house.id)} />
}

export { houseTitle }
