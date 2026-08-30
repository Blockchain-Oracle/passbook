//
// Settling a claim, whichever venue issued it.
//
// The three venue panels each carried their own copy of "build the payload, send it, forget the
// secret, say what happened". Now that claims are collected in one place, so is the settlement:
// one function, three payload builders, and the SAME calldata the venues always used. Nothing
// about how a door works is re-decided here — `position-actions.ts` already decided it.
//
import { useMutation } from '@tanstack/react-query'
import { LAUNCH_OP, redeemPayload, refundPayload } from '@strk20/protocol/launch-calldata'
import { MARKET_OP, cashoutPayload, claimPayload } from '@strk20/protocol/market-calldata'
import { GOV_OP, reclaimPayload, revokePayload } from '@strk20/protocol/governance-calldata'
import type { AppInvokeLeg, SendKind } from '@strk20/protocol/send'

import { govLeg } from '@/features/houses/gov-send'
import { formatWei } from '@/lib/format'
import { notify } from '@/lib/notify'
import { sendProblem, sendTransactionHash, useSend, type SendAsk } from '@/mutations'
import { appContracts } from '@/queries'
import { removeStoredPosition } from '@/queries/positions'

import type { Claim, PositionGroup } from './types'

/** The doors a claim can offer. Anything else is not settleable and never reaches here. */
export type SettleDoor = 'claim' | 'cashout' | 'redeem' | 'refund' | 'reclaim' | 'revoke'

export const DOOR_VERB: Record<SettleDoor, string> = {
  claim: 'Claim',
  cashout: 'Sell back',
  redeem: 'Redeem',
  refund: 'Refund',
  reclaim: 'Reclaim',
  revoke: 'Revoke',
}

/** What the notification says once it landed. Spelled out, because English is not a suffix rule. */
const DOOR_DONE: Record<SettleDoor, string> = {
  claim: 'Payout claimed',
  cashout: 'Position sold back',
  redeem: 'Launch tokens redeemed',
  refund: 'Purchase refunded',
  reclaim: 'Escrow reclaimed',
  revoke: 'Delegation revoked',
}

/** A cash out is a sale at a moving quote, so the calldata carries a floor. One percent, as always. */
const CASHOUT_FLOOR_BPS = 99n

export function settleDoor(claim: Claim): SettleDoor | null {
  const kind = claim.action?.kind
  return kind && kind in DOOR_VERB ? (kind as SettleDoor) : null
}

/** What the open door pays, already formatted — the review sheet and the notification share it. */
export function doorAmount(claim: Claim): string {
  return claim.life.amount === null ? '—' : `${formatWei(claim.life.amount, claim.payout.decimals)} ${claim.payout.symbol}`
}

/** The floor a cash out accepts, so the number in the calldata is the number on screen. */
export function cashoutFloor(claim: Claim): bigint | null {
  return claim.life.amount === null ? null : (claim.life.amount * CASHOUT_FLOOR_BPS) / 100n
}

type Built = { ok: true; ask: SendAsk } | { ok: false; because: string }

function leg(contract: string, op: number, payload: { calldata: readonly string[]; noteIdSlots: readonly number[] }, payoutToken: string): AppInvokeLeg {
  return { contract, op, calldata: [...payload.calldata], noteIdSlots: [...payload.noteIdSlots], openNoteCount: 1, payoutToken }
}

function build(claim: Claim, group: PositionGroup, door: SettleDoor): Built {
  const contracts = appContracts()
  const { secret } = claim.position
  const payout = claim.payout

  if (group.venue === 'market') {
    // The contract the position was read from, so a pre-migration bet settles where it was opened.
    const contract = claim.contract ?? contracts.markets
    if (!contract) return { ok: false, because: 'The Markets contract is not configured in this build.' }
    const floor = cashoutFloor(claim)
    if (door === 'cashout' && floor === null) return { ok: false, because: 'This position has no quote to sell back at.' }
    const payload = door === 'cashout' ? cashoutPayload({ secret, minOut: floor! }) : claimPayload([secret])
    if (payload.state === 'refused') return { ok: false, because: payload.because }
    const kind: SendKind = door === 'cashout' ? 'market-cashout' : 'market-claim'
    return {
      ok: true,
      ask: {
        kind,
        recipient: contract,
        token: payout.token,
        symbol: payout.symbol,
        amount: 0n,
        surface: 'markets',
        label: door === 'cashout' ? 'Cash out market position' : 'Claim market winnings',
        app: leg(contract, door === 'cashout' ? MARKET_OP.cashout : MARKET_OP.claim, payload, payout.token),
      },
    }
  }

  if (group.venue === 'launch') {
    const contract = contracts.launch
    if (!contract) return { ok: false, because: 'The Launch contract is not configured in this build.' }
    const redeeming = door === 'redeem'
    const payload = redeeming ? redeemPayload([secret]) : refundPayload([secret])
    if (payload.state === 'refused') return { ok: false, because: payload.because }
    return {
      ok: true,
      ask: {
        kind: redeeming ? 'launch-redeem' : 'launch-refund',
        recipient: contract,
        token: payout.token,
        symbol: payout.symbol,
        amount: 0n,
        surface: 'launch',
        label: redeeming ? `Redeem ${payout.symbol}` : 'Refund launch purchase',
        app: leg(contract, redeeming ? LAUNCH_OP.redeem : LAUNCH_OP.refund, payload, payout.token),
      },
    }
  }

  const contract = contracts.governance
  if (!contract) return { ok: false, because: 'The DAO contract is not configured in this build.' }
  const reclaiming = door === 'reclaim'
  const payload = reclaiming ? reclaimPayload([secret]) : revokePayload([secret])
  if (payload.state === 'refused') return { ok: false, because: payload.because }
  return {
    ok: true,
    ask: {
      kind: reclaiming ? 'gov-reclaim' : 'gov-revoke',
      recipient: contract,
      token: payout.token,
      symbol: payout.symbol,
      amount: 0n,
      surface: 'houses',
      label: reclaiming ? 'Reclaim DAO escrow' : 'Revoke DAO delegation',
      app: govLeg(contract, reclaiming ? GOV_OP.reclaim : GOV_OP.revoke, payload, { payoutToken: payout.token }),
    },
  }
}

export interface SettleOutcome {
  ok: boolean
}

/** One settlement. The stored secret is forgotten only on a result that actually landed. */
export function useSettle() {
  const send = useSend()
  const run = useMutation({
    mutationKey: ['position', 'settle'],
    mutationFn: async ({ claim, group, door }: { claim: Claim; group: PositionGroup; door: SettleDoor }): Promise<SettleOutcome> => {
      const built = build(claim, group, door)
      if (!built.ok) {
        notify.refused(`${DOOR_VERB[door]} refused`, { description: built.because })
        return { ok: false }
      }
      const result = await send.mutateAsync(built.ask)
      if (!result.ok) {
        notify.refused('The settlement did not go through', {
          description: sendProblem(result) ?? undefined,
          hash: sendTransactionHash(result),
        })
        return { ok: false }
      }
      await removeStoredPosition(claim.position.commitment)
      notify.settled(DOOR_DONE[door], {
        description: `${doorAmount(claim)} matured into your shielded balance as a fresh note.`,
        hash: sendTransactionHash(result),
      })
      return { ok: true }
    },
  })
  return { settle: run.mutateAsync, busy: run.isPending || send.isPending }
}
