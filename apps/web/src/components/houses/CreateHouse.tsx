//
// Create a House — relayer-signed by design, creator = commitment.
//
// The allowlist permits `create_house` from the relayer's key precisely because the creator is a
// commitment: the signing key identifies nobody. Pool-native users hold no public STRK for gas,
// so the sponsored path is the primary one; self-signing is the fallback, offered only when the
// ladder says it can work.
//
// The invite secret for a members' club is minted HERE and shown ONCE: it is the door key, it
// never goes anywhere but this screen and the copies its creator hands out, and the chain holds
// only its poseidon. Losing it locks the door permanently — said before the button, not after.
//
import { useCallback, useMemo, useState } from 'react'

import { encodeByteArray } from '@strk20/protocol/app-reads'
import { parseAmountInput } from '@strk20/protocol/amount'
import { HOUSE_COUNTING, HOUSE_MEMBERSHIP } from '@strk20/protocol/governance-reads'

import { cn } from '../../lib/cn'
import {
  APP_CONTRACTS,
  GOVERNANCE_WRITE_SAFETY,
  GOVERNANCE_WRITES_ENABLED,
} from '../../shell/app-contracts'
import { invokeSponsoredOrDirect } from '../../shell/submit'
import { toast } from '../../shell/toast-store'
import { useSession } from '../../shell/session'
import { useTokenList } from '../../shell/use-token-list'
import { ResponsiveDialog } from '../../shell/ResponsiveDialog'
import { addPosition } from '../../shell/use-positions'
import { BlockedButton } from '../BlockedButton'
import { Text } from '../ui/Text'

export function CreateHouse({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tokens } = useTokenList()
  const session = useSession()
  const ready = session.status === 'ready' ? session : null

  const [name, setName] = useState('')
  const [quorumRaw, setQuorumRaw] = useState('10')
  const [thresholdPct, setThresholdPct] = useState(50)
  const [invite, setInvite] = useState(false)
  const [memberVotes, setMemberVotes] = useState(false)
  const [inviteSecret, setInviteSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Rendered INSIDE the dialog: a toast alone leaves the form sitting unchanged behind it, which
  // on a phone reads as "nothing happened".
  const [problem, setProblem] = useState<string | null>(null)

  const strk = useMemo(() => tokens.find((t) => t.symbol === 'STRK') ?? null, [tokens])
  const decimals = strk?.decimals ?? 18
  const quorum = useMemo(() => parseAmountInput(quorumRaw, decimals), [quorumRaw, decimals])

  const blocker =
    (!GOVERNANCE_WRITE_SAFETY.enabled ? GOVERNANCE_WRITE_SAFETY.because : null) ??
    (!ready ? 'This browser has no account yet' : null) ??
    (!strk ? 'The token list has not loaded' : null) ??
    (name.trim() === '' ? 'Name the House' : null) ??
    (name.trim().length > 64 ? 'Sixty-four characters at most' : null) ??
    (memberVotes && !invite ? 'One-member-one-vote needs an invite roll to count over' : null) ??
    (!memberVotes
      ? (quorum.problem ??
        (quorum.wei === null || quorum.wei === 0n ? 'Set a quorum — the weight a vote needs to be real' : null))
      : null) ??
    (busy ? 'Creating…' : null)

  const onConfirm = useCallback(async () => {
    if (!GOVERNANCE_WRITES_ENABLED || !ready || !strk) return
    setBusy(true)
    setProblem(null)
    try {
      const { mintPositionSecret } = await import('@strk20/protocol/commitment')
      const creator = mintPositionSecret()
      const door = invite ? mintPositionSecret() : null

      const calldata = [
        strk.address,
        `0x${(memberVotes ? 2n : (quorum.wei ?? 0n)).toString(16)}`,
        `0x${Math.round(thresholdPct * 100).toString(16)}`,
        `0x${(memberVotes ? HOUSE_COUNTING.member : HOUSE_COUNTING.weighted).toString(16)}`,
        `0x${(invite ? HOUSE_MEMBERSHIP.invite : HOUSE_MEMBERSHIP.open).toString(16)}`,
        door ? door.commitment : '0x0',
        ...encodeByteArray(name.trim()),
        creator.commitment,
      ]
      const outcome = await invokeSponsoredOrDirect(ready.accountKey, ready.address, {
        contractAddress: APP_CONTRACTS.governance!,
        entrypoint: 'create_house',
        calldata,
      })
      if (!outcome.ok) {
        setProblem(outcome.because)
        toast({ kind: 'error', title: 'The House was not created', detail: outcome.because })
        return
      }
      addPosition({
        venue: 'governance',
        kind: 'gov-founder',
        id: -1,
        secret: creator.secret,
        commitment: creator.commitment,
        createdAt: Date.now(),
        label: `Founder of ${name.trim()}`,
        txHash: outcome.transactionHash,
      })
      if (door) {
        // Shown once. The dialog stays open on this state until the creator dismisses it.
        setInviteSecret(door.secret)
        toast({ kind: 'success', title: `${name.trim()} is standing`, detail: 'Copy the invite before you close this.' })
      } else {
        toast({ kind: 'success', title: `${name.trim()} is standing`, detail: 'Anyone holding the token can vote in it.' })
        onClose()
      }
    } finally {
      setBusy(false)
    }
  }, [ready, strk, name, quorum.wei, thresholdPct, invite, memberVotes, onClose])

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())} label="Create a House" modal dismissible={!busy && inviteSecret === null}>
      <div className="flex min-h-0 flex-col gap-s12 overflow-y-auto">
        {inviteSecret ? (
          <>
            <Text variant="subheading2" as="h2" className="text-neutral1">
              The door key — shown once
            </Text>
            <Text variant="body4" className="text-neutral2">
              Anyone you give this to can join the roll. Passbook does not store another copy, and
              there is no way to read it back — the chain holds only its fingerprint.
            </Text>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(inviteSecret)
                toast({ kind: 'success', title: 'Invite copied' })
              }}
              className="focus-ring cursor-pointer break-all rounded-card border border-solid border-surface3 bg-raised p-s12 text-left font-mono text-body4 text-neutral1"
            >
              {inviteSecret}
            </button>
            <BlockedButton blocker={null} action="I have it — close" onPress={onClose} />
          </>
        ) : (
          <>
            <Text variant="subheading2" as="h2" className="text-neutral1">
              Create a House
            </Text>
            <Text variant="body4" className="text-neutral2">
              A House is governance on a token: sealed ballots, a treasury funded through the pool,
              and tallies the chain refuses to get wrong.
            </Text>

            <label className="flex flex-col gap-s4">
              <Text variant="body4" className="uppercase text-neutral3" as="span">
                Name
              </Text>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="The Night Owls"
                aria-label="House name"
                className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 text-body3 text-neutral1 placeholder:text-neutral3"
              />
            </label>

            <div className="flex gap-s8">
              {!memberVotes ? (
                <label className="flex min-w-0 flex-1 flex-col gap-s4">
                  <Text variant="body4" className="uppercase text-neutral3" as="span">
                    Quorum (STRK)
                  </Text>
                  <input
                    value={quorumRaw}
                    onChange={(e) => setQuorumRaw(e.target.value)}
                    inputMode="decimal"
                    aria-label="Quorum in tokens"
                    className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 font-mono text-body3 text-neutral1"
                  />
                </label>
              ) : null}
              <label className="flex min-w-0 flex-1 flex-col gap-s4">
                <Text variant="body4" className="uppercase text-neutral3" as="span">
                  Passes above {thresholdPct}%
                </Text>
                <input
                  type="range"
                  min={50}
                  max={90}
                  value={thresholdPct}
                  onChange={(e) => setThresholdPct(Number(e.target.value))}
                  aria-label="Passing threshold percent"
                  className="focus-ring w-full"
                />
              </label>
            </div>

            <div className="flex gap-s6">
              <button
                type="button"
                onClick={() => {
                  setInvite(!invite)
                  if (invite) setMemberVotes(false)
                }}
                aria-pressed={invite}
                className={cn(
                  'focus-ring flex-1 cursor-pointer rounded-control border border-solid px-s8 py-s8 text-buttonLabel4',
                  invite ? 'border-accent1 bg-accent2 text-accent1' : 'border-surface3 text-neutral2',
                )}
              >
                Invite-only
              </button>
              <button
                type="button"
                onClick={() => setMemberVotes(!memberVotes)}
                aria-pressed={memberVotes}
                disabled={!invite}
                className={cn(
                  'focus-ring flex-1 cursor-pointer rounded-control border border-solid px-s8 py-s8 text-buttonLabel4 disabled:opacity-50',
                  memberVotes ? 'border-accent1 bg-accent2 text-accent1' : 'border-surface3 text-neutral2',
                )}
              >
                One member, one vote
              </button>
            </div>

            <Text variant="body4" className="text-neutral3">
              The chain records the founder claim as a commitment and this browser keeps its bearer
              secret. The transaction&rsquo;s submitting account remains public. Members enter the
              House roll as pool-derived handles rather than addresses.
            </Text>

            {problem ? (
              <Text variant="body4" className="text-exposed" role="status">
                {problem}
              </Text>
            ) : null}

            <BlockedButton blocker={blocker} action="Create it" onPress={() => void onConfirm()} />
          </>
        )}
      </div>
    </ResponsiveDialog>
  )
}
