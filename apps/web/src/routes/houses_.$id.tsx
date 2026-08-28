import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'

import { toPlainText } from '@strk20/protocol/amount'
import { timeLeft } from '@strk20/protocol/app-reads'
import {
  HOUSE_COUNTING,
  HOUSE_MEMBERSHIP,
  PROPOSAL_MODE,
  PROPOSAL_STATE,
  readAccumulators,
  type OnChainHouse,
  type OnChainProposal,
} from '@strk20/protocol/governance-reads'
import { voyagerTxUrl } from '@strk20/protocol/transaction'

import { ActivityTape } from '../components/launch/ActivityTape'
import { YourPositions } from '../components/launch/YourPositions'
import { BallotTicket } from '../components/houses/BallotTicket'
import { FundDialog, JoinDialog, ProposalRow } from '../components/houses/HouseCard'
import { ProposeDialog } from '../components/houses/ProposeDialog'
import { Button } from '../components/ui/Button'
import { Text } from '../components/ui/Text'
import { APP_CONTRACTS } from '../shell/app-contracts'
import { useChainFeed } from '../shell/chain-feed'
import { useGovernance } from '../shell/use-governance'
import { findToken, useTokenList } from '../shell/use-token-list'
import { shortenFelt } from '../shell/session'
import { Surface } from '../shell/Surface'

export const Route = createFileRoute('/houses_/$id')({
  component: HouseRecord,
})

//
// ONE HOUSE, WHOLE — the record page. The list card is the door; this is the room: the rules the
// House stands on, every proposal as a full record with its receipts, the treasury's public
// history off the chain feed, and a verification section that shows the reader the lock rather
// than asking them to trust the report of it. NoxVote's record grammar (breadcrumb → header →
// facts with provenance → panels), carried onto sealed-ballot governance.
//
function HouseRecord() {
  const { id } = Route.useParams()
  const houseId = /^\d+$/.test(id) ? Number(id) : null
  const read = useGovernance()
  const feed = useChainFeed()
  const { tokens } = useTokenList()
  const [now, setNow] = useState(() => Date.now())
  const [ballot, setBallot] = useState<{ proposal: OnChainProposal; choice: number } | null>(null)
  const [proposing, setProposing] = useState(false)
  const [funding, setFunding] = useState(false)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const house = houseId === null ? undefined : read.houses.find((h) => h.id === houseId)

  if (!house) {
    return (
      <Surface routeId={Route.fullPath}>
        <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-s12">
          <Crumb />
          <Text variant="body3" className="text-neutral2">
            {houseId === null
              ? 'That is not a House id.'
              : read.loading
                ? 'Reading the Governor…'
                : `House ${houseId} is not in the read window — the list carries the newest Houses, and this one is either older than that or not created yet.`}
          </Text>
        </div>
      </Surface>
    )
  }

  const stake = findToken(tokens, house.token)
  const symbol = stake?.symbol ?? shortenFelt(house.token, 4, 3)
  const decimals = stake?.decimals ?? 18
  const memberCounted = house.counting === HOUSE_COUNTING.member
  const weightDecimals = memberCounted ? 0 : decimals
  const invite = house.membership === HOUSE_MEMBERSHIP.invite
  const proposals = read.proposals.filter((p) => p.houseId === house.id)
  const settled = proposals.filter(
    (p) =>
      p.state === PROPOSAL_STATE.succeeded ||
      p.state === PROPOSAL_STATE.defeated ||
      p.state === PROPOSAL_STATE.executed,
  )

  return (
    <Surface routeId={Route.fullPath}>
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-s16">
        <Crumb name={house.metadata || `House ${house.id}`} />

        <header className="flex flex-wrap items-center gap-s12 rounded-large border border-solid border-surface3 p-s16">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-center gap-s8">
              <Text variant="display3" as="h1" className="truncate text-neutral1">
                {house.metadata || `House ${house.id}`}
              </Text>
              <span className="rounded-pill border border-solid border-surface3 px-s8 py-s2 font-mono text-mono text-neutral2">
                {invite ? 'invite' : 'open'}
              </span>
              {memberCounted ? (
                <span className="rounded-pill border border-solid border-surface3 px-s8 py-s2 font-mono text-mono text-neutral2">
                  1 member · 1 vote
                </span>
              ) : null}
            </div>
            <Text variant="mono" className="text-neutral3">
              House #{house.id} · votes in {symbol} · {house.memberCount} member
              {house.memberCount === 1 ? '' : 's'}, none of them named
            </Text>
          </div>
          <div className="flex shrink-0 flex-col items-end">
            <Text variant="display3" as="p" className="numeric text-neutral1">
              {toPlainText(house.treasury, decimals)} {symbol}
            </Text>
            <Text variant="body4" className="text-neutral3">
              in the treasury — grown anonymously, spent only by a passed vote
            </Text>
          </div>
        </header>

        <div className="grid gap-s16 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-s16">
            <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
              <Text variant="kicker">Proposals</Text>
              {proposals.length === 0 ? (
                <Text variant="body3" className="text-neutral2">
                  No question has been put to this House yet. The box is ready — propose the first.
                </Text>
              ) : (
                <div className="flex flex-col gap-s8">
                  {proposals.map((proposal) => (
                    <div key={proposal.id} className="flex flex-col gap-s4">
                      <ProposalRow
                        proposal={proposal}
                        now={now}
                        symbol={symbol}
                        decimals={weightDecimals}
                        onVote={(choice) => setBallot({ proposal, choice })}
                      />
                      <ProposalMeta proposal={proposal} feedTape={feed.tape} now={now} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
              <Text variant="kicker">Activity</Text>
              <ActivityTape
                items={feed.tape}
                markets={feed.markets}
                launches={[]}
                houses={read.houses}
                proposals={read.proposals}
                scope={{ houseId: house.id, proposalIds: proposals.map((p) => p.id) }}
                emptyLine="Nothing this House did is in the feed's window yet — ballots, gifts and tallies appear here as they land."
              />
            </section>

            {settled.length > 0 ? <Verification house={house} proposals={settled} symbol={symbol} decimals={weightDecimals} /> : null}
          </div>

          <aside className="flex flex-col gap-s12 self-start lg:sticky lg:top-[88px]">
            <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 bg-raised p-s16">
              <Text variant="subheading2" as="h2" className="text-neutral1">
                The doors
              </Text>
              <div className="flex flex-col gap-s6">
                <Button variant="primary" size="md" onClick={() => setProposing(true)}>
                  Propose
                </Button>
                <Button variant="secondary" size="md" onClick={() => setFunding(true)}>
                  Fund the treasury
                </Button>
                {invite ? (
                  <Button variant="secondary" size="md" onClick={() => setJoining(true)}>
                    Join with an invite
                  </Button>
                ) : null}
              </div>
              <Text variant="body4" className="text-neutral3">
                Every door is a real transaction through the pool — who walked through it is
                nobody&rsquo;s to know.
              </Text>
            </section>

            <section className="rounded-large border border-solid border-surface3 p-s16">
              <Text variant="kicker">The rules</Text>
              <dl className="mt-s8 flex flex-col gap-s8">
                <Rule
                  label="Quorum"
                  value={`${toPlainText(house.quorum, weightDecimals)}${memberCounted ? ' voices' : ` ${symbol}`}`}
                />
                <Rule label="Passes above" value={`${house.thresholdBps / 100}% of the vote`} />
                <Rule label="Counting" value={memberCounted ? 'one member, one vote' : `weight in ${symbol}`} />
                <Rule label="Membership" value={invite ? 'invite only — the roll is anonymous handles' : 'open to any holder'} />
                <Rule label="Governor" value={shortenFelt(APP_CONTRACTS.governance ?? '0x0', 8, 6)} />
              </dl>
            </section>

            <YourPositions venue="governance" />
          </aside>
        </div>

        {ballot ? (
          <BallotTicket
            house={house}
            proposal={ballot.proposal}
            initialChoice={ballot.choice}
            open
            onClose={() => setBallot(null)}
          />
        ) : null}
        <ProposeDialog house={house} open={proposing} onClose={() => setProposing(false)} />
        <FundDialog house={house} open={funding} onClose={() => setFunding(false)} />
        {invite ? <JoinDialog house={house} open={joining} onClose={() => setJoining(false)} /> : null}
      </div>
    </Surface>
  )
}

/** The receipts line under each proposal: mode, deadline as a date, and the tape's tx links. */
function ProposalMeta({
  proposal,
  feedTape,
  now,
}: {
  proposal: OnChainProposal
  feedTape: readonly import('@strk20/protocol/chain-feed-wire').TapeItem[]
  now: number
}) {
  const links: Array<[string, string]> = []
  for (const item of feedTape) {
    if (!('proposalId' in item) || item.proposalId !== proposal.id) continue
    const href = voyagerTxUrl(item.txHash)
    if (!href) continue
    if (item.kind === 'proposal-created') links.push(['opened', href])
    if (item.kind === 'tally-published') links.push(['tally', href])
    if (item.kind === 'key-published') links.push(['key', href])
    if (item.kind === 'gov-executed') links.push(['executed', href])
  }
  const open = proposal.state === PROPOSAL_STATE.active && proposal.deadline * 1000 > now
  return (
    <div className="flex flex-wrap items-baseline gap-s10 px-s10 font-mono text-mono text-neutral3">
      <span>#{proposal.id}</span>
      <span>
        {proposal.mode === PROPOSAL_MODE.permanent ? 'permanently sealed' : 'sealed until close'}
      </span>
      <span>
        {open
          ? `closes ${new Date(proposal.deadline * 1000).toLocaleString()} (${timeLeft(proposal.deadline, now)})`
          : `closed ${new Date(proposal.deadline * 1000).toLocaleString()}`}
      </span>
      {links.map(([label, href]) => (
        <a
          key={label}
          href={href}
          target="_blank"
          rel="noreferrer"
          className="focus-ring underline hover:text-neutral1"
        >
          {label} ↗
        </a>
      ))}
    </div>
  )
}

function Rule({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-body4 text-neutral3">{label}</dt>
      <dd className="numeric m-s0 font-mono text-body3 text-neutral1">{value}</dd>
    </div>
  )
}

/**
 * The verification panel — every row a chain fact with its provenance, NoxVote's discipline.
 *
 * What the reader is shown, per settled proposal:
 *   1. The live EC accumulators, read from the contract in THIS browser. They are the lock: the
 *      publish transaction reverts unless `S·G + R·H` lands on these exact points, so a tally
 *      standing beside them was proven, not reported.
 *   2. Conservation, re-done here in plain arithmetic: accepted sums never exceed the weight the
 *      box escrowed. A failure renders loud — it would mean the page's own reads disagree.
 */
function Verification({
  house,
  proposals,
  symbol,
  decimals,
}: {
  house: OnChainHouse
  proposals: readonly OnChainProposal[]
  symbol: string
  decimals: number
}) {
  const [accumulators, setAccumulators] = useState<Record<number, Array<{ x: string; y: string }>>>({})

  useEffect(() => {
    const contract = APP_CONTRACTS.governance
    if (!contract) return
    let live = true
    for (const proposal of proposals) {
      void readAccumulators(contract, proposal.id, proposal.options).then(
        (points) => {
          if (live) setAccumulators((prev) => ({ ...prev, [proposal.id]: points }))
        },
        () => undefined, // The row says "reading…" until it can say something true.
      )
    }
    return () => {
      live = false
    }
  }, [proposals])

  return (
    <section className="flex flex-col gap-s10 rounded-large border border-solid border-surface3 p-s16">
      <Text variant="kicker">Verification</Text>
      <Text variant="body4" className="text-neutral2">
        Nothing here asks for trust. The contract refused every tally whose sums did not land on
        the accumulator points below — the check ran inside the publish transaction, on the curve,
        before the numbers could exist on-chain.
      </Text>
      {proposals.map((proposal) => {
        const points = accumulators[proposal.id]
        const counted = proposal.tallyFor + proposal.tallyAgainst
        // `<=`, not `==`: revoked and excluded ballots leave the escrowed total without entering
        // the count, and the contract checked the exact equation with those subtracted.
        const conserved = counted <= proposal.totalWeight
        return (
          <div key={proposal.id} className="flex flex-col gap-s6 rounded-card border border-solid border-surface3 p-s10">
            <Text variant="body3" className="font-medium text-neutral1">
              {proposal.metadata || `Proposal ${proposal.id}`}
            </Text>
            {!conserved ? (
              <Text variant="body3" className="text-irreversible" role="alert">
                Evidence mismatch: the accepted sums exceed the escrowed weight. This page&rsquo;s
                two reads disagree — inspect the tally transaction.
              </Text>
            ) : null}
            <dl className="flex flex-col gap-s4 font-mono text-mono">
              <VRow
                label="Accepted tally · on-chain"
                value={`FOR ${toPlainText(proposal.tallyFor, decimals)} · AGAINST ${toPlainText(proposal.tallyAgainst, decimals)}${decimals === 0 ? ' voices' : ` ${symbol}`}`}
              />
              <VRow
                label="Escrowed weight · on-chain"
                value={`${toPlainText(proposal.totalWeight, decimals)}${decimals === 0 ? ' voices' : ` ${symbol}`} across ${proposal.ballotCount} ballot${proposal.ballotCount === 1 ? '' : 's'}`}
              />
              <VRow
                label="Conservation · this browser"
                value={conserved ? 'counted ≤ escrowed ✓' : 'FAILED'}
              />
              {points ? (
                points.map((point, i) => (
                  <VRow
                    key={i}
                    label={`Accumulator ${i === 0 ? 'FOR' : i === 1 ? 'AGAINST' : `option ${i}`} · on-chain`}
                    value={
                      point.x === '0x0' && point.y === '0x0'
                        ? 'identity — no weight entered this lane'
                        : `${shortenFelt(point.x, 8, 6)}, ${shortenFelt(point.y, 8, 6)}`
                    }
                  />
                ))
              ) : (
                <VRow label="Accumulators" value="reading…" />
              )}
              <VRow
                label="Tally key"
                value={
                  proposal.publishedKey !== 0n
                    ? `${shortenFelt(`0x${proposal.publishedKey.toString(16)}`, 8, 6)} — on-chain; anyone holding the ballot events can recount`
                    : proposal.mode === PROPOSAL_MODE.permanent
                      ? 'never published — permanently private by this proposal’s own rule'
                      : 'not published yet'
                }
              />
            </dl>
            <Text variant="body4" className="text-neutral3">
              House token {shortenFelt(house.token, 6, 4)} · options {proposal.options}
            </Text>
          </div>
        )
      })}
    </section>
  )
}

function VRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-s12">
      <dt className="shrink-0 text-neutral3">{label}</dt>
      <dd className="m-s0 min-w-0 truncate text-right text-neutral1">{value}</dd>
    </div>
  )
}

function Crumb({ name }: { name?: string }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-s6 font-mono text-mono text-neutral3">
      <Link to="/houses" className="focus-ring no-underline hover:text-neutral1">
        Houses
      </Link>
      <span aria-hidden="true">›</span>
      <span className="text-neutral2">{name ?? '…'}</span>
    </nav>
  )
}
