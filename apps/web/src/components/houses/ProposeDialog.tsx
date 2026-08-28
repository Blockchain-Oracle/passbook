//
// Put a question to a House — a direct call, with the Teller's key minted first.
//
// The tally key comes from `/api/govern/tally-key`: the Teller mints a per-proposal keypair,
// keeps the secret in its ledger, and hands back the public half every sealed choice will be
// encrypted to. A deployment with no Teller answers 404 and this form says so instead of
// offering a vote nobody could ever count.
//
import { useCallback, useMemo, useState } from 'react'

import { encodeByteArray } from '@strk20/protocol/app-reads'
import { parseAmountInput } from '@strk20/protocol/amount'
import { PROPOSAL_ACTION, PROPOSAL_MODE, type OnChainHouse } from '@strk20/protocol/governance-reads'

import { cn } from '../../lib/cn'
import { APP_CONTRACTS } from '../../shell/app-contracts'
import { invokeSponsoredOrDirect } from '../../shell/submit'
import { toast } from '../../shell/toast-store'
import { useSession } from '../../shell/session'
import { useTokenList } from '../../shell/use-token-list'
import { ResponsiveDialog } from '../../shell/ResponsiveDialog'
import { BlockedButton } from '../BlockedButton'
import { Text } from '../ui/Text'

const WINDOWS = [
  { label: '1 day', seconds: 86_400 },
  { label: '3 days', seconds: 3 * 86_400 },
  { label: '7 days', seconds: 7 * 86_400 },
  { label: '1 hour — demo', seconds: 3_600 },
] as const

export function ProposeDialog({
  house,
  open,
  onClose,
}: {
  house: OnChainHouse
  open: boolean
  onClose: () => void
}) {
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const { tokens } = useTokenList()

  const [question, setQuestion] = useState('')
  const [permanent, setPermanent] = useState(false)
  const [abstain, setAbstain] = useState(false)
  const [windowIdx, setWindowIdx] = useState(0)
  const [spend, setSpend] = useState(false)
  const [amountRaw, setAmountRaw] = useState('')
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false)

  const stake = useMemo(() => tokens.find((t) => {
    try {
      return BigInt(t.address) === BigInt(house.token)
    } catch {
      return false
    }
  }) ?? null, [tokens, house.token])
  const decimals = stake?.decimals ?? 18
  const amount = useMemo(() => parseAmountInput(amountRaw, decimals), [amountRaw, decimals])

  const recipientOk = useMemo(() => {
    try {
      return recipient.trim() !== '' && BigInt(recipient.trim()) > 0n
    } catch {
      return false
    }
  }, [recipient])

  const blocker =
    (!ready ? 'This browser has no account yet' : null) ??
    (question.trim() === '' ? 'Ask the question' : null) ??
    (question.trim().length > 400 ? 'Four hundred characters at most' : null) ??
    (spend
      ? (amount.problem ?? (amount.wei === null || amount.wei === 0n ? 'How much the treasury pays' : null))
      : null) ??
    (spend && !recipientOk ? 'Who the treasury pays — a real address' : null) ??
    (busy ? 'Proposing…' : null)

  const onConfirm = useCallback(async () => {
    if (!ready) return
    setBusy(true)
    try {
      // The Teller mints the key this vote seals to. 404 = this deployment cannot count votes.
      const answer = await fetch('/api/govern/tally-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      if (!answer.ok) {
        toast({
          kind: 'error',
          title: answer.status === 404 ? 'This deployment has no Teller' : 'No tally key came back',
          detail:
            answer.status === 404
              ? 'Without a Teller nobody can count a sealed vote — the proposal was not made.'
              : `HTTP ${answer.status}`,
        })
        return
      }
      const { tallyKey } = (await answer.json()) as { tallyKey?: string }
      if (typeof tallyKey !== 'string') {
        toast({ kind: 'error', title: 'No tally key came back', detail: 'The answer was not in the expected shape.' })
        return
      }

      const deadline = Math.floor(Date.now() / 1000) + WINDOWS[windowIdx]!.seconds
      const calldata = [
        `0x${house.id.toString(16)}`,
        `0x${(permanent ? PROPOSAL_MODE.permanent : PROPOSAL_MODE.secretUntilClose).toString(16)}`,
        `0x${(abstain ? 3 : 2).toString(16)}`,
        `0x${deadline.toString(16)}`,
        tallyKey,
        `0x${(spend ? PROPOSAL_ACTION.spend : PROPOSAL_ACTION.text).toString(16)}`,
        `0x${(spend ? (amount.wei ?? 0n) : 0n).toString(16)}`,
        spend ? recipient.trim() : '0x0',
        ...encodeByteArray(question.trim()),
      ]
      // Relayer-signed like `create_house` — the allowlist permits `propose`, and a pool-native
      // proposer holds no public gas. Falls back to self-signing only when that can work.
      const outcome = await invokeSponsoredOrDirect(ready.accountKey, ready.address, {
        contractAddress: APP_CONTRACTS.governance!,
        entrypoint: 'propose',
        calldata,
      })
      if (!outcome.ok) {
        toast({ kind: 'error', title: 'The proposal was not made', detail: outcome.because })
        return
      }
      toast({
        kind: 'success',
        title: 'The box is open',
        detail: permanent
          ? 'Permanently private: only the aggregate will ever surface.'
          : 'Sealed until close; the key goes on-chain when the box closes.',
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }, [ready, house.id, question, permanent, abstain, windowIdx, spend, amount.wei, recipient, onClose])

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())} label="Propose" modal>
      <div className="flex min-h-0 flex-col gap-s12 overflow-y-auto">
        <Text variant="subheading2" as="h2" className="text-neutral1">
          Put it to {house.metadata || `House ${house.id}`}
        </Text>

        <label className="flex flex-col gap-s4">
          <Text variant="body4" className="uppercase text-neutral3" as="span">
            The question
          </Text>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            placeholder="Pay 40 STRK from the treasury to fund the meetup?"
            aria-label="The proposal"
            className="focus-ring w-full resize-y rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 text-body3 text-neutral1 outline-none placeholder:text-neutral3"
          />
        </label>

        <div className="flex flex-wrap gap-s6">
          {WINDOWS.map((w, i) => (
            <button
              key={w.label}
              type="button"
              onClick={() => setWindowIdx(i)}
              aria-pressed={windowIdx === i}
              className={cn(
                'focus-ring cursor-pointer rounded-control border border-solid px-s12 py-s8 text-buttonLabel4',
                windowIdx === i ? 'border-accent1 bg-accent2 text-accent1' : 'border-surface3 text-neutral2',
              )}
            >
              {w.label}
            </button>
          ))}
        </div>

        <div className="flex gap-s6">
          <button
            type="button"
            onClick={() => setPermanent(!permanent)}
            aria-pressed={permanent}
            className={cn(
              'focus-ring flex-1 cursor-pointer rounded-control border border-solid px-s8 py-s8 text-buttonLabel4',
              permanent ? 'border-accent1 bg-accent2 text-accent1' : 'border-surface3 text-neutral2',
            )}
          >
            Permanently private
          </button>
          <button
            type="button"
            onClick={() => setAbstain(!abstain)}
            aria-pressed={abstain}
            className={cn(
              'focus-ring flex-1 cursor-pointer rounded-control border border-solid px-s8 py-s8 text-buttonLabel4',
              abstain ? 'border-accent1 bg-accent2 text-accent1' : 'border-surface3 text-neutral2',
            )}
          >
            Allow abstain
          </button>
          <button
            type="button"
            onClick={() => setSpend(!spend)}
            aria-pressed={spend}
            className={cn(
              'focus-ring flex-1 cursor-pointer rounded-control border border-solid px-s8 py-s8 text-buttonLabel4',
              spend ? 'border-accent1 bg-accent2 text-accent1' : 'border-surface3 text-neutral2',
            )}
          >
            Treasury spend
          </button>
        </div>

        {spend ? (
          <div className="flex gap-s8">
            <label className="flex min-w-0 flex-1 flex-col gap-s4">
              <Text variant="body4" className="uppercase text-neutral3" as="span">
                Pays ({stake?.symbol ?? 'tokens'})
              </Text>
              <input
                value={amountRaw}
                onChange={(e) => setAmountRaw(e.target.value)}
                inputMode="decimal"
                aria-label="Spend amount"
                className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 font-mono text-body3 text-neutral1 outline-none"
              />
            </label>
            <label className="flex min-w-0 flex-[2] flex-col gap-s4">
              <Text variant="body4" className="uppercase text-neutral3" as="span">
                To (public address)
              </Text>
              <input
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x…"
                aria-label="Recipient address"
                className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 font-mono text-body3 text-neutral1 outline-none placeholder:text-neutral3"
              />
            </label>
          </div>
        ) : null}

        <Text variant="body4" className="text-neutral3">
          Proposing is public — your address signs it. If it passes, execution is permissionless:
          anyone can fire it, and the treasury pays its named recipient in the open. The FUNDERS
          of that treasury stay anonymous; its spending never is.
        </Text>

        <BlockedButton blocker={blocker} action="Open the ballot box" onPress={() => void onConfirm()} />
      </div>
    </ResponsiveDialog>
  )
}
