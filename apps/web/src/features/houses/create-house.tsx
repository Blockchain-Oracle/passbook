import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { notify } from '@/lib/notify'
import { parseAmountInput } from '@strk20/protocol/amount'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { KNOWN_TOKEN_DECIMALS } from '@strk20/protocol/token-scale'

import { BoundaryBadge } from '@/components/money/boundary-badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Spinner } from '@/components/ui/spinner'
import { useCopy } from '@/hooks/use-copy'
import { useCreateHouse } from './create-mutations'
import { useDoorGate } from './house-doors'
import { SwitchRow } from './switch-row'
import { useSession } from '@/app/session'

export interface CreateHouseProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const STRK_DECIMALS = KNOWN_TOKEN_DECIMALS[STRK_TOKEN]!

/**
 * Create a House — relayer-signed by design, creator = commitment. An invite House mints its door
 * key here and shows it ONCE: the chain holds only its poseidon, and losing it locks the door.
 */
export function CreateHouse({ open, onOpenChange }: CreateHouseProps) {
  const session = useSession()
  const gate = useDoorGate(session.status === 'ready')
  const create = useCreateHouse()
  const [name, setName] = useState('')
  const [quorumRaw, setQuorumRaw] = useState('10')
  const [thresholdPct, setThresholdPct] = useState(50)
  const [invite, setInvite] = useState(false)
  const [memberVotes, setMemberVotes] = useState(false)
  const [doorKey, setDoorKey] = useState<string | null>(null)
  const { copied, copy } = useCopy()

  const quorum = parseAmountInput(quorumRaw, STRK_DECIMALS)
  const busy = create.isPending
  const trimmed = name.trim()
  const blocker =
    gate.blocker ??
    (trimmed === ''
      ? 'Name the House'
      : trimmed.length > 64
        ? 'Sixty-four characters at most'
        : memberVotes && !invite
          ? 'One-member-one-vote needs an invite roll to count over'
          : !memberVotes && (quorum.problem || quorum.wei === null || quorum.wei === 0n)
            ? (quorum.problem ?? 'Set a quorum — the weight a vote needs to be real')
            : busy
              ? 'Creating…'
              : null)

  const confirm = async () => {
    if (blocker !== null) return
    const outcome = await create.mutateAsync({ name: trimmed, quorumWei: quorum.wei ?? 0n, thresholdPct, invite, memberVotes })
    if (!outcome.ok) {
      notify.refused('The House was not created', { description: outcome.because })
      return
    }
    if (outcome.inviteSecret) {
      // Shown once. The dialog stays open on this state until the creator dismisses it.
      setDoorKey(outcome.inviteSecret)
      notify.settled(`${trimmed} is standing`, { description: 'Copy the invite before you close this.' })
      return
    }
    notify.settled(`${trimmed} is standing`, { description: 'Anyone holding the token can vote in it.' })
    close()
  }

  const close = () => {
    setDoorKey(null)
    setName('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => ((busy || doorKey) && !next ? undefined : onOpenChange(next))}>
      <DialogContent className="sm:max-w-md" showCloseButton={!busy && doorKey === null}>
        {doorKey ? (
          <>
            <DialogHeader>
              <BoundaryBadge kind="bearer" className="w-fit" />
              <DialogTitle className="font-display text-display3 uppercase">The door key — shown once</DialogTitle>
              <DialogDescription>
                Anyone you give this to can join the roll. strk20.run does not store another copy, and there is no way to read
                it back — the chain holds only its fingerprint.
              </DialogDescription>
            </DialogHeader>
            <Button
              variant="outline"
              onClick={() => void copy(doorKey)}
              className="h-auto w-full items-start justify-start gap-2 whitespace-normal break-all bg-muted p-3 text-left font-mono text-body4"
              aria-label={copied ? 'Copied' : 'Copy the door key'}
            >
              <span className="min-w-0 flex-1">{doorKey}</span>
              {copied ? <Check className="size-4 shrink-0 text-settled" /> : <Copy className="size-4 shrink-0 text-muted-foreground" />}
            </Button>
            <DialogFooter>
              <Button size="lg" onClick={close}>
                I have it — close
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <BoundaryBadge kind="bearer" className="w-fit" />
              <DialogTitle className="font-display text-display3 uppercase">Create a House</DialogTitle>
              <DialogDescription>
                A House is governance on a token: sealed ballots, a treasury funded through the pool, and tallies the chain
                refuses to get wrong.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4">
              <Field>
                <FieldLabel htmlFor="house-name">Name</FieldLabel>
                <Input id="house-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="The Night Owls" autoFocus />
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {!memberVotes ? (
                  <Field>
                    <FieldLabel htmlFor="house-quorum">Quorum (STRK)</FieldLabel>
                    <Input id="house-quorum" value={quorumRaw} onChange={(e) => setQuorumRaw(e.target.value)} inputMode="decimal" className="font-mono" />
                    {quorum.problem ? <FieldDescription className="text-irreversible">{quorum.problem}</FieldDescription> : null}
                  </Field>
                ) : null}
                <Field>
                  <FieldLabel id="house-threshold-label">Passes above {thresholdPct}%</FieldLabel>
                  <Slider
                    aria-labelledby="house-threshold-label"
                    min={50}
                    max={90}
                    value={[thresholdPct]}
                    onValueChange={(v) => setThresholdPct(Array.isArray(v) ? (v[0] ?? thresholdPct) : v)}
                    className="py-2"
                  />
                </Field>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SwitchRow
                  id="house-invite"
                  label="Invite-only"
                  checked={invite}
                  onChange={(v) => {
                    setInvite(v)
                    if (!v) setMemberVotes(false)
                  }}
                />
                <SwitchRow id="house-member" label="One member, one vote" hint={invite ? undefined : 'Needs an invite roll'} checked={memberVotes} onChange={setMemberVotes} />
              </div>
              <Alert>
                <AlertTitle>What the chain records</AlertTitle>
                <AlertDescription>
                  The founder claim as a commitment, with its bearer secret kept in this browser. The transaction’s submitting
                  account remains public. Members enter the roll as pool-derived handles rather than addresses.
                </AlertDescription>
              </Alert>
            </div>
            <DialogFooter>
              <Button size="lg" aria-disabled={blocker !== null || undefined} onClick={() => void confirm()}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                {blocker ?? 'Create it'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
