//
// The create form. Everything the contract's signature needs, in the user's units, with the
// arithmetic stated beside each field rather than hidden inside one.
//
// CREATING IS A DIRECT CALL, AND THE SURFACE SAYS WHOSE ADDRESS SHOWS. `create_launch` lives
// outside `privacy_invoke` (the contract's own comment: a relayer can sponsor a creation because
// the creator is a commitment). From this browser it is an ordinary account call: the CALLER's
// address is on the transaction, the creator's CLAIM is the bearer secret this stores. The form
// states that plainly instead of implying a private create.
//
import { useCallback, useMemo, useState } from 'react'

import { encodeByteArray } from '@strk20/protocol/app-reads'
import { parseAmountInput } from '@strk20/protocol/amount'

import { cn } from '../../lib/cn'
import { APP_CONTRACTS } from '../../shell/app-contracts'
import { invokeDirect } from '../../shell/submit'
import { toast } from '../../shell/toast-store'
import { useSession } from '../../shell/session'
import { useTokenList } from '../../shell/use-token-list'
import { ResponsiveDialog } from '../../shell/ResponsiveDialog'
import { addPosition } from '../../shell/use-positions'
import { BlockedButton } from '../BlockedButton'
import { Text } from '../ui/Text'

/** How long a new launch has to hit its target. */
const LAUNCH_WINDOWS = [
  { label: '1 day', seconds: 86_400 },
  { label: '3 days', seconds: 3 * 86_400 },
  { label: '7 days', seconds: 7 * 86_400 },
] as const

export function CreateLaunch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { tokens } = useTokenList()
  const session = useSession()
  const ready = session.status === 'ready' ? session : null

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [priceRaw, setPriceRaw] = useState('')
  const [stepRaw, setStepRaw] = useState('')
  const [epochsRaw, setEpochsRaw] = useState('4')
  const [tokensPerEpochRaw, setTokensPerEpochRaw] = useState('16000')
  const [windowIdx, setWindowIdx] = useState(1)
  const [busy, setBusy] = useState(false)

  const strk = useMemo(() => tokens.find((t) => t.symbol === 'STRK') ?? null, [tokens])
  const decimals = strk?.decimals ?? 18

  const price = useMemo(() => parseAmountInput(priceRaw, decimals), [priceRaw, decimals])
  const step = useMemo(
    () => (stepRaw.trim() === '' ? { wei: 0n, problem: null } : parseAmountInput(stepRaw, decimals)),
    [stepRaw, decimals],
  )
  const epochs = /^\d+$/.test(epochsRaw.trim()) ? Number(epochsRaw.trim()) : null
  const tokensPerEpoch = /^\d+$/.test(tokensPerEpochRaw.trim()) ? Number(tokensPerEpochRaw.trim()) : null
  const symbolClean = symbol.trim().toUpperCase()

  const blocker =
    (!ready ? 'This browser has no account yet' : null) ??
    (!strk ? 'The token list has not loaded' : null) ??
    (name.trim() === '' ? 'Name the token' : null) ??
    (symbolClean === '' || symbolClean.length > 8 ? 'Give it a symbol, eight characters or fewer' : null) ??
    (price.problem ?? null) ??
    (price.wei === null || price.wei === 0n ? 'Price the first epoch' : null) ??
    ('problem' in step && step.problem ? step.problem : null) ??
    (epochs === null || epochs < 1 || epochs > 32 ? 'Between 1 and 32 epochs' : null) ??
    (tokensPerEpoch === null || tokensPerEpoch <= 0 ? 'How many tokens each epoch sells' : null) ??
    (busy ? 'Creating…' : null)

  const onConfirm = useCallback(async () => {
    if (!ready || !strk || price.wei === null || epochs === null || tokensPerEpoch === null) return
    setBusy(true)
    try {
      const { mintPositionSecret } = await import('@strk20/protocol/commitment')
      const minted = mintPositionSecret()
      const tranche = BigInt(tokensPerEpoch) * 10n ** 18n
      const deadline = Math.floor(Date.now() / 1000) + LAUNCH_WINDOWS[windowIdx]!.seconds
      const calldata = [
        ...encodeByteArray(name.trim()),
        ...encodeByteArray(symbolClean),
        ...encodeByteArray(''), // logo_uri — the M3 pin pipeline fills this; empty is stated as empty
        strk.address,
        `0x${price.wei.toString(16)}`,
        `0x${(step.wei ?? 0n).toString(16)}`,
        `0x${tranche.toString(16)}`,
        `0x${epochs.toString(16)}`,
        `0x${deadline.toString(16)}`,
        minted.commitment,
      ]
      const outcome = await invokeDirect(ready.accountKey, ready.address, {
        contractAddress: APP_CONTRACTS.launch!,
        entrypoint: 'create_launch',
        calldata,
      })
      if (!outcome.ok) {
        toast({ kind: 'error', title: 'The launch was not created', detail: outcome.because })
        return
      }
      // The creator's sweep claim — held like every other bearer position.
      addPosition({
        venue: 'launch',
        id: -1,
        secret: minted.secret,
        commitment: minted.commitment,
        createdAt: Date.now(),
        label: `Creator of ${symbolClean} — sweeps the raise on graduation`,
      })
      toast({
        kind: 'success',
        title: `${symbolClean} is live`,
        detail: 'The sale is open. Your creator claim is a bearer secret stored in this browser.',
      })
      onClose()
    } finally {
      setBusy(false)
    }
  }, [ready, strk, price.wei, step.wei, epochs, tokensPerEpoch, windowIdx, name, symbolClean, onClose])

  return (
    <ResponsiveDialog open={open} onOpenChange={(next) => (next ? undefined : onClose())} label="Create a launch" modal>
      <div className="flex min-h-0 flex-col gap-s12 overflow-y-auto">
        <Text variant="subheading2" as="h2" className="text-neutral1">
          Launch a token
        </Text>
        <Text variant="body4" className="text-neutral2">
          Epoch-priced: everyone inside an epoch pays the same price, and the price steps up when
          the epoch does. It graduates at the target or refunds everyone — no half-launched limbo.
        </Text>

        <div className="flex gap-s8">
          <label className="flex min-w-0 flex-[2] flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Name
            </Text>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Night Owl"
              aria-label="Token name"
              className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 text-body3 text-neutral1 outline-none placeholder:text-neutral3"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Symbol
            </Text>
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder="OWL"
              aria-label="Token symbol"
              className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 font-mono text-body3 text-neutral1 uppercase outline-none placeholder:text-neutral3"
            />
          </label>
        </div>

        <div className="flex gap-s8">
          <label className="flex min-w-0 flex-1 flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Price / unit, epoch 1
            </Text>
            <div className="flex items-center gap-s6 rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8">
              <input
                value={priceRaw}
                onChange={(e) => setPriceRaw(e.target.value)}
                placeholder="0.05"
                inputMode="decimal"
                aria-label="Unit price in the first epoch"
                className="focus-ring numeric min-w-0 flex-1 bg-transparent font-mono text-body3 text-neutral1 outline-none placeholder:text-neutral3"
              />
              <span className="text-body4 text-neutral3">STRK</span>
            </div>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Step per epoch
            </Text>
            <div className="flex items-center gap-s6 rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8">
              <input
                value={stepRaw}
                onChange={(e) => setStepRaw(e.target.value)}
                placeholder="0.01"
                inputMode="decimal"
                aria-label="Price step per epoch"
                className="focus-ring numeric min-w-0 flex-1 bg-transparent font-mono text-body3 text-neutral1 outline-none placeholder:text-neutral3"
              />
              <span className="text-body4 text-neutral3">STRK</span>
            </div>
          </label>
        </div>

        <div className="flex gap-s8">
          <label className="flex min-w-0 flex-1 flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Epochs
            </Text>
            <input
              value={epochsRaw}
              onChange={(e) => setEpochsRaw(e.target.value)}
              inputMode="numeric"
              aria-label="Number of epochs"
              className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 font-mono text-body3 text-neutral1 outline-none"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Tokens / epoch
            </Text>
            <input
              value={tokensPerEpochRaw}
              onChange={(e) => setTokensPerEpochRaw(e.target.value)}
              inputMode="numeric"
              aria-label="Tokens sold per epoch"
              className="focus-ring w-full rounded-control border border-solid border-surface3 bg-raised px-s12 py-s8 font-mono text-body3 text-neutral1 outline-none"
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-s4">
            <Text variant="body4" className="uppercase text-neutral3" as="span">
              Runs for
            </Text>
            <div className="flex gap-s4">
              {LAUNCH_WINDOWS.map((w, i) => (
                <button
                  key={w.label}
                  type="button"
                  onClick={() => setWindowIdx(i)}
                  aria-pressed={windowIdx === i}
                  className={cn(
                    'focus-ring flex-1 cursor-pointer rounded-control border border-solid px-s6 py-s8 text-buttonLabel4',
                    windowIdx === i
                      ? 'border-accent1 bg-accent2 text-accent1'
                      : 'border-surface3 bg-transparent text-neutral2',
                  )}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </label>
        </div>

        <Text variant="body4" className="text-neutral3">
          Creating is an ordinary transaction from this account — your ADDRESS is on it, the way any
          deploy is public. Your claim on the raise is not: it is a bearer secret this browser
          stores, and sweeping the raise later names whatever address you choose then. Sixteen
          units per epoch; each unit is a sixteenth of an epoch&rsquo;s tokens.
        </Text>

        <BlockedButton blocker={blocker} action="Launch it" onPress={() => void onConfirm()} />
      </div>
    </ResponsiveDialog>
  )
}
