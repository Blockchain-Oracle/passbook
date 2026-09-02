//
// Share one finished bet, in three screens: what this reveals → the card → share it. The first
// screen is the whole point: every field the card carries, listed in plain words, before anything
// is rendered. Native share when the browser offers it, a download when it does not, and the text
// always. A closed share sheet is neutral — nothing was shared, nothing went wrong.
//
import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, Download, Share2 } from 'lucide-react'
import { SHARE_OUTCOME, SHARE_SIDE, shareQuestion, shareText, shareUnits, type PositionShare } from '@strk20/protocol/position-share'

import { RefusalRow, useRefusal } from '@/components/money/refusal'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useCopy } from '@/hooks/use-copy'
import { shortAddress } from '@/lib/format'

import { CARD_HEIGHT, CARD_WIDTH, renderShareCard } from './share-card'

const REVEALS_TITLE = 'What this reveals'
const REVEALS_LINK = 'Anyone with this card can link you to this market.'
const EXPORT_FAILED = 'The card could not be drawn in this browser. Nothing was shared.'
const NOTHING_SHARED = 'Nothing was shared.'
const SHARED = 'Shared.'
const TEXT_COPIED = 'Text copied.'

type Step = 'reveals' | 'preview'

export interface ShareDialogProps {
  share: PositionShare | null
  onOpenChange: (open: boolean) => void
}

/** The DTO, one line per field, in the words a person would use. */
function reveals(s: PositionShare): string[] {
  const out = [
    `The market: ${shareQuestion(s)}`,
    `Your side: ${SHARE_SIDE[s.side] ?? `side ${s.side}`}`,
    `Your stake: ${shareUnits(s.cashIn, s.decimals, s.symbol)}`,
    s.terminal ? `The outcome: ${SHARE_OUTCOME[s.terminal.kind]}${s.terminal.amount ? ` ${shareUnits(s.terminal.amount, s.decimals, s.symbol)}` : ''}` : 'That the bet is still open',
    `The opening transaction: ${shortAddress(s.openingTxHash, 8, 6)}`,
  ]
  if (s.terminal?.txHash) out.push(`The closing transaction: ${shortAddress(s.terminal.txHash, 8, 6)}`)
  out.push(`The position's public commitment: ${shortAddress(s.commitment, 8, 6)}`)
  return out
}

export function ShareDialog({ share, onOpenChange }: ShareDialogProps) {
  const [step, setStep] = useState<Step>('reveals')
  const [file, setFile] = useState<File | null>(null)
  const [rendering, setRendering] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const { refusal, refuse, clear } = useRefusal()
  const { copied, copy } = useCopy()
  const canNativeShare = typeof navigator.canShare === 'function' && file !== null && navigator.canShare({ files: [file] })

  // The preview URL is derived from the file; the effect only releases it.
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (url) URL.revokeObjectURL(url) }, [url])

  const reset = () => {
    setStep('reveals')
    setFile(null)
    setNote(null)
    clear()
  }

  const render = async () => {
    if (!share || rendering) return
    setRendering(true)
    clear()
    try {
      const drawn = await renderShareCard(share)
      if (!drawn) {
        refuse(EXPORT_FAILED)
        return
      }
      setFile(drawn)
      setStep('preview')
    } catch {
      refuse(EXPORT_FAILED)
    } finally {
      setRendering(false)
    }
  }

  const nativeShare = async () => {
    if (!file || !share) return
    try {
      await navigator.share({ files: [file], text: shareText(share) })
      setNote(SHARED)
    } catch (e) {
      // A closed share sheet is the ordinary shape of "not now" — neutral, never red.
      setNote(e instanceof Error && e.name === 'AbortError' ? NOTHING_SHARED : NOTHING_SHARED)
    }
  }

  const download = () => {
    if (!url || !file) return
    const a = document.createElement('a')
    a.href = url
    a.download = file.name
    a.click()
  }

  return (
    <Dialog
      open={share !== null}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-lg">
        {share && step === 'reveals' ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-display4 uppercase">{REVEALS_TITLE}</DialogTitle>
              <DialogDescription>{REVEALS_LINK}</DialogDescription>
            </DialogHeader>
            <ul className="flex flex-col gap-2 text-body4">
              {reveals(share).map((line) => (
                <li key={line} className="flex gap-2">
                  <span className="text-muted-foreground">·</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
            <p className="text-body4 text-muted-foreground">Not on the card: your address, your name, your other bets, your balances.</p>
            <RefusalRow refusal={refusal} />
            <DialogFooter>
              <Button size="lg" aria-disabled={rendering} onClick={() => void render()}>
                {rendering ? 'Drawing…' : 'Show the card'}
              </Button>
            </DialogFooter>
          </>
        ) : null}
        {share && step === 'preview' ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display text-display4 uppercase">Your card</DialogTitle>
              <DialogDescription>Exactly what was listed, and nothing else.</DialogDescription>
            </DialogHeader>
            {url ? <img src={url} width={CARD_WIDTH} height={CARD_HEIGHT} alt="" className="h-auto w-full rounded-lg border" /> : null}
            {note ? <p className="text-body4 text-muted-foreground">{note}</p> : null}
            <RefusalRow refusal={refusal} />
            <DialogFooter className="flex-wrap gap-2">
              {canNativeShare ? (
                <Button size="lg" onClick={() => void nativeShare()}>
                  <Share2 data-icon="inline-start" />
                  Share
                </Button>
              ) : null}
              <Button size="lg" variant={canNativeShare ? 'outline' : 'default'} onClick={download}>
                <Download data-icon="inline-start" />
                Download
              </Button>
              <Button size="lg" variant="outline" onClick={() => void copy(shareText(share)).then(() => setNote(TEXT_COPIED))}>
                {copied ? <Check data-icon="inline-start" /> : <Copy data-icon="inline-start" />}
                Copy text
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
