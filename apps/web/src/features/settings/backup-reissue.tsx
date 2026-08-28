import { useState } from 'react'
import { Check, Download, FileKey, KeyRound } from 'lucide-react'
import { BACKUP_DONE_INVENTORY, BACKUP_REWRAP_NO_REVOCATION } from '@strk20/protocol/backup-copy'

import type { BackupCeremony } from '@/app/session'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { REISSUE_TITLE } from './settings-copy'

export interface ReissueActions {
  issue: () => Promise<void>
  confirmCode: (pasted: string) => Promise<void>
  markSaved: () => Promise<void>
}

export interface BackupReissueDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  ceremony: BackupCeremony
  actions: ReissueActions
  /** Fired once the new file is verified and persisted. */
  onComplete?: () => void
}

/** Hands the file to the browser. The state machine advances only after `markSaved` verifies it. */
function downloadFile(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Re-wrap: a fresh file and code for the same key. `issue` is called when the dialog opens with
 * a `ready` (or not-started) ceremony, so the steps inside are code → download → verify.
 */
export function BackupReissueDialog({ open, onOpenChange, ceremony, actions, onComplete }: BackupReissueDialogProps) {
  const [pasted, setPasted] = useState('')
  const [downloaded, setDownloaded] = useState(false)
  const [started, setStarted] = useState(false)
  const { state, busy, problem } = ceremony

  const begin = () => {
    setStarted(true)
    setPasted('')
    setDownloaded(false)
    void actions.issue()
  }
  const save = async () => {
    await actions.markSaved()
    onComplete?.()
  }
  // A `ready` state seen before this dialog started belongs to the previous file, not this one.
  const showDone = started && state.step === 'ready' && !busy

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display text-display4 uppercase">{REISSUE_TITLE}</DialogTitle>
          <DialogDescription>{BACKUP_REWRAP_NO_REVOCATION}</DialogDescription>
        </DialogHeader>

        {!started || (state.step !== 'code-issued' && state.step !== 'code-confirmed' && !showDone) ? (
          <Button size="lg" onClick={begin} aria-disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : <FileKey data-icon="inline-start" />}
            {busy ? 'Writing the file…' : 'Write the file'}
          </Button>
        ) : null}

        {started && state.step === 'code-issued' ? (
          <>
            <Field>
              <FieldLabel>Your new Recovery Code</FieldLabel>
              <p className="select-all rounded-md border bg-muted px-3 py-2 text-center font-mono text-body2 tracking-wider">
                {state.backup.recoveryCode}
              </p>
              <FieldDescription>Write it down somewhere the file is not. Then type it back to prove you have it.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="reissue-code">Type the code</FieldLabel>
              <Input
                id="reissue-code"
                autoComplete="off"
                spellCheck={false}
                placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                className="font-mono"
              />
            </Field>
            <Button size="lg" onClick={() => void actions.confirmCode(pasted)} aria-disabled={busy || pasted.trim() === ''}>
              <KeyRound data-icon="inline-start" />
              Confirm the code
            </Button>
          </>
        ) : null}

        {started && state.step === 'code-confirmed' ? (
          <>
            <Button
              size="lg"
              variant={downloaded ? 'outline' : 'default'}
              onClick={() => {
                downloadFile(state.backup.file, state.backup.filename)
                setDownloaded(true)
              }}
            >
              <Download data-icon="inline-start" />
              {downloaded ? `Download again · ${state.backup.filename}` : 'Download the recovery file'}
            </Button>
            <Button size="lg" onClick={() => void save()} aria-disabled={!downloaded || busy}>
              {busy ? <Spinner data-icon="inline-start" /> : <Check data-icon="inline-start" />}
              {busy ? 'Verifying the file…' : 'I have saved it'}
            </Button>
            {!downloaded ? (
              <p className="text-body4 text-muted-foreground">Download it first; the file is verified against your key before this step closes.</p>
            ) : null}
          </>
        ) : null}

        {showDone ? (
          <Alert>
            <Check className="text-settled" />
            <AlertDescription>
              Saved as <span className="font-mono">{state.filename}</span>. {BACKUP_DONE_INVENTORY}
            </AlertDescription>
          </Alert>
        ) : null}

        {problem ? (
          <Alert variant="destructive">
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
