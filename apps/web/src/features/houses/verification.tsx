import { useQuery } from '@tanstack/react-query'
import { PROPOSAL_MODE, type OnChainHouse, type OnChainProposal } from '@strk20/protocol/governance-reads'

import { Amount } from '@/components/money/amount'
import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table'
import { shortAddress } from '@/lib/format'
import { proposalTitle } from './gov-send'
import { accumulatorsQuery } from './queries'

export interface VerificationProps {
  house: OnChainHouse
  proposals: readonly OnChainProposal[]
  decimals: number | null
  unit: string
  className?: string
}

const LANE = (i: number) => (i === 0 ? 'FOR' : i === 1 ? 'AGAINST' : `option ${i}`)

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className="text-right font-mono text-mono">{value}</TableCell>
    </TableRow>
  )
}

/** One settled proposal: the accumulators read in THIS browser, beside the accepted sums. */
function ProposalEvidence({ proposal, decimals, unit }: { proposal: OnChainProposal; decimals: number | null; unit: string }) {
  const points = useQuery(accumulatorsQuery(proposal.id, proposal.options))
  const counted = proposal.tallyFor + proposal.tallyAgainst
  // `<=`, not `==`: revoked and excluded ballots leave the escrowed total without entering the
  // count, and the contract checked the exact equation with those subtracted.
  const conserved = counted <= proposal.totalWeight
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-body3 font-medium">{proposalTitle(proposal)}</p>
      {!conserved ? (
        <Alert variant="destructive">
          <AlertTitle>Evidence mismatch</AlertTitle>
          <AlertDescription>The accepted sums exceed the escrowed weight. This page’s two reads disagree — inspect the tally transaction.</AlertDescription>
        </Alert>
      ) : null}
      <Table>
        <TableBody>
          <Row
            label="Accepted tally · on-chain"
            value={
              <>
                FOR <Amount wei={proposal.tallyFor} decimals={decimals} size="sm" /> · AGAINST{' '}
                <Amount wei={proposal.tallyAgainst} decimals={decimals} symbol={unit} size="sm" />
              </>
            }
          />
          <Row
            label="Escrowed weight · on-chain"
            value={
              <>
                <Amount wei={proposal.totalWeight} decimals={decimals} symbol={unit} size="sm" /> across {proposal.ballotCount} ballot
                {proposal.ballotCount === 1 ? '' : 's'}
              </>
            }
          />
          <Row label="Conservation · this browser" value={conserved ? <span className="text-settled">counted ≤ escrowed</span> : <span className="text-irreversible">FAILED</span>} />
          {points.data ? (
            points.data.map((point, i) => (
              <Row
                key={i}
                label={`Accumulator ${LANE(i)} · on-chain`}
                value={
                  point.x === '0x0' && point.y === '0x0'
                    ? 'identity — no weight entered this lane'
                    : `${shortAddress(point.x, 8, 6)}, ${shortAddress(point.y, 8, 6)}`
                }
              />
            ))
          ) : (
            <Row label="Accumulators" value={points.isError ? 'could not be read' : 'reading…'} />
          )}
          <Row
            label="Tally key"
            value={
              proposal.publishedKey !== 0n
                ? `${shortAddress(`0x${proposal.publishedKey.toString(16)}`, 8, 6)} — on-chain; anyone holding the ballot events can recount`
                : proposal.mode === PROPOSAL_MODE.permanent
                  ? 'never published — permanently private by this proposal’s own rule'
                  : 'not published yet'
            }
          />
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * The verification panel — every row a chain fact with its provenance. The accumulators are the
 * lock: the publish transaction reverts unless `S·G + R·H` lands on these exact points, so a tally
 * standing beside them was proven, not reported. Conservation is re-done here in plain arithmetic.
 */
export function Verification({ house, proposals, decimals, unit, className }: VerificationProps) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="font-display text-display4 uppercase">Verification</CardTitle>
        <CardDescription>
          Nothing here asks for trust. The contract refused every tally whose sums did not land on the accumulator points
          below — the check ran inside the publish transaction, on the curve, before the numbers could exist on-chain.
        </CardDescription>
        <CardAction>
          <BoundaryBadge kind="readOnly" />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {proposals.map((proposal) => (
          <ProposalEvidence key={proposal.id} proposal={proposal} decimals={decimals} unit={unit} />
        ))}
        <p className="font-mono text-mono text-muted-foreground">DAO token {shortAddress(house.token, 6, 4)}</p>
      </CardContent>
    </Card>
  )
}
