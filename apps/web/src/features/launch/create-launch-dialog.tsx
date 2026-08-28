// The create form. The pin comes first, because the chain write is the irreversible half: a logo
// that fails to pin aborts with the reason; a deployment with no pinning lane proceeds without one
// and says so — the seeded disc is the designed fallback, not an error state.
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Sparkles, Upload, X } from 'lucide-react'
import { parseAmountInput } from '@strk20/protocol/amount'
import { KNOWN_TOKEN_DECIMALS } from '@strk20/protocol/token-scale'
import { STRK_TOKEN } from '@strk20/protocol/constants'

import { useSession } from '@/app/session'
import { TokenLogo } from '@/components/money/asset-identity'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useCreateLaunch } from './create-mutation'
import { pinLogo, useDownscaleLogo, useGenerateLogo } from './logo'

const WINDOWS = [
  { label: '1 day', seconds: 86_400 },
  { label: '3 days', seconds: 3 * 86_400 },
  { label: '7 days', seconds: 7 * 86_400 },
] as const
const STRK_DECIMALS = KNOWN_TOKEN_DECIMALS[STRK_TOKEN] ?? 18

export function CreateLaunchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const session = useSession()
  const ready = session.status === 'ready'
  const create = useCreateLaunch()
  const generate = useGenerateLogo()
  const downscale = useDownscaleLogo()
  const fileInput = useRef<HTMLInputElement>(null)

  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [brief, setBrief] = useState('')
  const [priceRaw, setPriceRaw] = useState('')
  const [stepRaw, setStepRaw] = useState('')
  const [epochsRaw, setEpochsRaw] = useState('4')
  const [tokensRaw, setTokensRaw] = useState('16000')
  const [windowIdx, setWindowIdx] = useState('1')
  const [logo, setLogo] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<string[]>([])
  const [generationOff, setGenerationOff] = useState(false)
  const [pinning, setPinning] = useState(false)

  const symbolClean = symbol.trim().toUpperCase()
  const price = parseAmountInput(priceRaw, STRK_DECIMALS)
  const step = stepRaw.trim() === '' ? { wei: 0n, problem: null } : parseAmountInput(stepRaw, STRK_DECIMALS)
  const epochs = /^\d+$/.test(epochsRaw.trim()) ? Number(epochsRaw.trim()) : null
  const tokensPerEpoch = /^\d+$/.test(tokensRaw.trim()) ? Number(tokensRaw.trim()) : null
  const busy = create.isPending || pinning

  const blocker =
    (!ready ? 'This browser has no account yet' : null) ??
    (name.trim() === '' ? 'Name the token' : null) ??
    (symbolClean === '' || symbolClean.length > 8 ? 'Give it a symbol, eight characters or fewer' : null) ??
    price.problem ??
    (price.wei === null || price.wei === 0n ? 'Price the first epoch' : null) ??
    step.problem ??
    (epochs === null || epochs < 1 || epochs > 32 ? 'Between 1 and 32 epochs' : null) ??
    (tokensPerEpoch === null || tokensPerEpoch <= 0 ? 'How many tokens each epoch sells' : null) ??
    (busy ? (pinning ? 'Pinning the logo…' : 'Creating…') : null)

  const pickFile = async (file: File | undefined) => {
    if (!file) return
    const scaled = await downscale.mutateAsync(file)
    if (!scaled.ok) {
      toast.error('That image did not work', { description: scaled.because })
      return
    }
    setCandidates([])
    setLogo(scaled.dataUri)
  }

  const onGenerate = async () => {
    if (name.trim() === '' || symbolClean === '') {
      toast('Name and symbol first — the generator prompts from them.')
      return
    }
    const answer = await generate.mutateAsync({ name: name.trim(), symbol: symbolClean, ...(brief.trim() ? { brief: brief.trim() } : {}) })
    if (!answer.ok) {
      if (answer.unconfigured) setGenerationOff(true)
      toast.error(answer.unconfigured ? 'Generation is not offered here' : 'No logo came back', {
        description: answer.unconfigured ? 'This deployment has no image key. Upload a logo, or let the seeded disc stand in.' : answer.because,
      })
      return
    }
    setCandidates(answer.value)
    if (answer.value.length === 1) setLogo(answer.value[0]!)
  }

  const onConfirm = async () => {
    if (blocker || price.wei === null || epochs === null || tokensPerEpoch === null) {
      if (blocker) toast(blocker)
      return
    }
    let logoUri = ''
    if (logo) {
      setPinning(true)
      const pinned = await pinLogo(logo).finally(() => setPinning(false))
      if (pinned.ok) logoUri = pinned.value.uri
      else if (pinned.unconfigured) toast.warning('Pinning is not offered here', { description: 'The logo was not stored — the seeded disc will represent this token.' })
      else {
        toast.error('The logo did not pin', { description: pinned.because })
        return
      }
    }
    const window = WINDOWS[Number(windowIdx)] ?? WINDOWS[1]
    const outcome = await create.mutateAsync({
      name: name.trim(),
      symbol: symbolClean,
      logoUri,
      priceWei: price.wei,
      stepWei: step.wei ?? 0n,
      tokensPerEpoch,
      epochs,
      deadline: Math.floor(Date.now() / 1000) + window.seconds,
    })
    if (!outcome.ok) {
      toast.error('The launch was not created', { description: outcome.because })
      return
    }
    toast.success(`${symbolClean} is live`, { description: 'The sale is open. Your creator claim is a bearer secret stored in this browser.' })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy && !next ? undefined : onOpenChange(next))}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="font-display text-display3 uppercase">Launch a token</DialogTitle>
          <DialogDescription>
            Epoch-priced: everyone inside an epoch pays the same price, and the price steps up when the epoch does. It graduates at the target or refunds everyone.
          </DialogDescription>
        </DialogHeader>

        <FieldGroup>
          <div className="grid grid-cols-[2fr_1fr] gap-3">
            <Field>
              <FieldLabel htmlFor="cl-name">Name</FieldLabel>
              <Input id="cl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Night Owl" />
            </Field>
            <Field>
              <FieldLabel htmlFor="cl-symbol">Symbol</FieldLabel>
              <Input id="cl-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="OWL" className="font-mono uppercase" maxLength={8} />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="cl-brief">Brief</FieldLabel>
            <Textarea id="cl-brief" value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="One line on what this token is for. Feeds the logo generator." rows={2} />
          </Field>

          <div className="flex flex-col gap-3 rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <TokenLogo logoUri={logo} symbol={symbolClean || symbol || '?'} name={name} size={40} />
              <div className="min-w-0 flex-1">
                <p className="text-kicker uppercase text-muted-foreground">Logo</p>
                <p className="text-body4 text-muted-foreground">
                  {logo ? 'Pinned to IPFS when you launch — the chain will point at it.' : 'Optional. Without one, the seeded disc is the mark — never a broken image.'}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
                {downscale.isPending ? <Spinner data-icon="inline-start" /> : <Upload data-icon="inline-start" />} Upload
              </Button>
              {!generationOff ? (
                <Button size="sm" variant="outline" onClick={() => void onGenerate()} aria-disabled={generate.isPending || undefined}>
                  {generate.isPending ? <Spinner data-icon="inline-start" /> : <Sparkles data-icon="inline-start" />} Generate
                </Button>
              ) : null}
              {logo ? (
                <Button size="sm" variant="ghost" onClick={() => setLogo(null)}>
                  <X data-icon="inline-start" /> Remove
                </Button>
              ) : null}
              <input ref={fileInput} type="file" accept="image/*" className="hidden" aria-label="Upload a logo image" onChange={(e) => void pickFile(e.target.files?.[0])} />
            </div>
            {candidates.length > 1 ? (
              <div className="flex items-center gap-2">
                <span className="text-body4 text-muted-foreground">Pick one:</span>
                <ToggleGroup value={logo ? [logo] : []} onValueChange={(v: string[]) => v[0] !== undefined && setLogo(v[0])} aria-label="Logo candidates">
                  {candidates.map((candidate, i) => (
                    <ToggleGroupItem
                      key={i}
                      value={candidate}
                      aria-label={`Candidate logo ${i + 1}`}
                      className="h-auto min-w-0 rounded-pill border-2 border-transparent p-0.5 hover:bg-transparent aria-pressed:border-accent1 aria-pressed:bg-transparent"
                    >
                      <img src={candidate} alt="" width={40} height={40} className="rounded-pill" />
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field data-invalid={Boolean(price.problem) || undefined}>
              <FieldLabel htmlFor="cl-price">Price / unit, epoch 1</FieldLabel>
              <InputGroup>
                <InputGroupInput id="cl-price" value={priceRaw} onChange={(e) => setPriceRaw(e.target.value)} placeholder="0.05" inputMode="decimal" className="font-mono" />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>STRK</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </Field>
            <Field data-invalid={Boolean(step.problem) || undefined}>
              <FieldLabel htmlFor="cl-step">Step per epoch</FieldLabel>
              <InputGroup>
                <InputGroupInput id="cl-step" value={stepRaw} onChange={(e) => setStepRaw(e.target.value)} placeholder="0.01" inputMode="decimal" className="font-mono" />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>STRK</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="cl-epochs">Epochs</FieldLabel>
              <Input id="cl-epochs" value={epochsRaw} onChange={(e) => setEpochsRaw(e.target.value)} inputMode="numeric" className="font-mono" />
              <FieldDescription>Sixteen units each, 1–32.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="cl-tokens">Tokens / epoch</FieldLabel>
              <Input id="cl-tokens" value={tokensRaw} onChange={(e) => setTokensRaw(e.target.value)} inputMode="numeric" className="font-mono" />
              <FieldDescription>A unit is a sixteenth of this.</FieldDescription>
            </Field>
          </div>
          <Field>
            <FieldLabel>Runs for</FieldLabel>
            <ToggleGroup value={[windowIdx]} onValueChange={(v: string[]) => v[0] !== undefined && setWindowIdx(v[0])} variant="outline" className="w-full">
              {WINDOWS.map((w, i) => (
                <ToggleGroupItem key={w.label} value={String(i)} className="flex-1">
                  {w.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
        </FieldGroup>

        <p className="text-body4 text-muted-foreground">
          Creating is an ordinary transaction from this account — your address is on it, the way any deploy is public. Your claim on the raise is a bearer secret this browser stores.
        </p>
        <Button size="lg" aria-disabled={Boolean(blocker) || undefined} onClick={() => void onConfirm()}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {blocker ?? 'Launch it'}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
