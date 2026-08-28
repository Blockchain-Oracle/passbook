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
import { useCallback, useMemo, useRef, useState } from 'react'

import { encodeByteArray } from '@strk20/protocol/app-reads'
import { parseAmountInput } from '@strk20/protocol/amount'

import { cn } from '../../lib/cn'
import { downscaleToLogo } from '../../lib/downscale-image'
import { APP_CONTRACTS } from '../../shell/app-contracts'
import { generateLogo, pinLogo } from '../../shell/logo-service'
import { invokeDirect } from '../../shell/submit'
import { toast } from '../../shell/toast-store'
import { useSession } from '../../shell/session'
import { useTokenList } from '../../shell/use-token-list'
import { ResponsiveDialog } from '../../shell/ResponsiveDialog'
import { addPosition } from '../../shell/use-positions'
import { BlockedButton } from '../BlockedButton'
import { Button } from '../ui/Button'
import { Text } from '../ui/Text'
import { TokenLogo } from '../TokenLogo'

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

  // ── The logo. Uploaded or generated, previewed here, PINNED only at confirm. ────────────
  const [logo, setLogo] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<string[] | null>(null)
  const [generating, setGenerating] = useState(false)
  // Flipped when the relayer answers 404 — this deployment has no generation lane, and a
  // button that 404s is worse than no button.
  const [generationOff, setGenerationOff] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const onPickFile = useCallback(async (file: File | undefined) => {
    if (!file) return
    const scaled = await downscaleToLogo(file)
    if (!scaled.ok) {
      toast({ kind: 'error', title: 'That image did not work', detail: scaled.because })
      return
    }
    setCandidates(null)
    setLogo(scaled.dataUri)
  }, [])

  const onGenerate = useCallback(async () => {
    setGenerating(true)
    try {
      const answer = await generateLogo({ name: name.trim(), symbol: symbol.trim().toUpperCase() })
      if (!answer.ok) {
        if (answer.unconfigured) {
          setGenerationOff(true)
          toast({
            kind: 'error',
            title: 'Generation is not offered here',
            detail: 'This deployment has no image key. Upload a logo, or let the seeded disc stand in.',
          })
        } else {
          toast({ kind: 'error', title: 'No logo came back', detail: answer.because })
        }
        return
      }
      setCandidates(answer.images)
      // One candidate auto-selects; two ask for the pick.
      if (answer.images.length === 1) setLogo(answer.images[0]!)
    } finally {
      setGenerating(false)
    }
  }, [name, symbol])

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
      //
      // THE PIN COMES FIRST, because the chain write is the irreversible half. A logo that fails
      // to pin aborts the create with the reason — never a launch pointing at a CID that does
      // not exist — and a deployment with no pinning lane proceeds WITHOUT the logo, saying so:
      // the seeded disc is the designed fallback, not an error state.
      //
      let logoUri = ''
      if (logo) {
        const pinned = await pinLogo(logo)
        if (pinned.ok) {
          logoUri = pinned.uri
        } else if (pinned.unconfigured) {
          toast({
            kind: 'error',
            title: 'Pinning is not offered here',
            detail: 'The logo was not stored — the seeded disc will represent this token.',
          })
        } else {
          toast({ kind: 'error', title: 'The logo did not pin', detail: pinned.because })
          return
        }
      }
      const { mintPositionSecret } = await import('@strk20/protocol/commitment')
      const minted = mintPositionSecret()
      const tranche = BigInt(tokensPerEpoch) * 10n ** 18n
      const deadline = Math.floor(Date.now() / 1000) + LAUNCH_WINDOWS[windowIdx]!.seconds
      const calldata = [
        ...encodeByteArray(name.trim()),
        ...encodeByteArray(symbolClean),
        ...encodeByteArray(logoUri), // `ipfs://CID`, or the honest empty when nothing pinned
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
  }, [ready, strk, price.wei, step.wei, epochs, tokensPerEpoch, windowIdx, name, symbolClean, logo, onClose])

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

        {/* ── The logo: brought, or made from the name. Never required — the disc stands in. ── */}
        <div className="flex flex-col gap-s8 rounded-card border border-solid border-surface3 bg-raised p-s12">
          <div className="flex items-center gap-s12">
            <TokenLogo url={logo} symbol={symbolClean || symbol} name={name} size={40} />
            <div className="flex min-w-0 flex-1 flex-col">
              <Text variant="body4" className="uppercase text-neutral3">
                Logo
              </Text>
              <Text variant="body4" className="text-neutral3">
                {logo
                  ? 'Pinned to IPFS when you launch — the chain will point at it.'
                  : 'Optional. Without one, the seeded disc is the mark — never a broken image.'}
              </Text>
            </div>
            <div className="flex shrink-0 gap-s6">
              <Button variant="secondary" size="sm" onClick={() => fileInput.current?.click()}>
                Upload
              </Button>
              {!generationOff ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={generating || name.trim() === '' || symbolClean === ''}
                  onClick={() => void onGenerate()}
                >
                  {generating ? 'Making…' : 'Generate'}
                </Button>
              ) : null}
              {logo ? (
                <Button variant="secondary" size="sm" onClick={() => setLogo(null)}>
                  Remove
                </Button>
              ) : null}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              aria-label="Upload a logo image"
              onChange={(e) => void onPickFile(e.target.files?.[0])}
            />
          </div>
          {candidates && candidates.length > 1 ? (
            <div className="flex items-center gap-s8">
              <Text variant="body4" className="text-neutral3">
                Pick one:
              </Text>
              {candidates.map((candidate, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setLogo(candidate)}
                  aria-pressed={logo === candidate}
                  className={cn(
                    'focus-ring cursor-pointer rounded-pill border-2 border-solid p-s2',
                    logo === candidate ? 'border-accent1' : 'border-transparent',
                  )}
                >
                  <img src={candidate} alt={`Candidate logo ${i + 1}`} width={40} height={40} className="rounded-pill" />
                </button>
              ))}
            </div>
          ) : null}
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
