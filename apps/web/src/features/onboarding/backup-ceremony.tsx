import { useState } from 'react'
import { Check, Download, FileKey, KeyRound } from 'lucide-react'
import { BACKUP_DONE_INVENTORY } from '@strk20/protocol/backup-copy'
import { BACKUP_BODY, BACKUP_GATE_NOTE, BACKUP_TITLE } from '@strk20/protocol/onboarding-copy'

import { backupActions, useBackupCeremony } from '@/app/session'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

interface BackupCeremonyProps {
  /** Fired once the file is saved and verified — registration may open. */
  onComplete?: () => void
  /** A re-issue from the account drawer says so instead of the onboarding frame. */
  title?: string
  body?: string
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
 * Issue a Recovery File + Code, confirm the code by paste, download the file, then the session
 * verifies it by decrypting the file against the live key. Copy is the protocol's.
 */
export function BackupCeremony({ onComplete, title = BACKUP_TITLE, body = BACKUP_BODY }: BackupCeremonyProps) {
  const ceremony = useBackupCeremony()
  const [pasted, setPasted] = useState('')
  const [downloaded, setDownloaded] = useState(false)
  const { state, busy, problem } = ceremony

  const save = async () => {
    await backupActions.markSaved()
    onComplete?.()
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-display3 uppercase">{title}</h2>
        <p className="mt-1 text-body3 text-muted-foreground">{body}</p>
      </div>

      {state.step === 'not-started' ? (
        <>
          <p className="text-body4 text-muted-foreground">{BACKUP_GATE_NOTE}</p>
          <Button size="lg" onClick={() => void backupActions.issue()} aria-disabled={busy}>
            {busy ? <Spinner data-icon="inline-start" /> : <FileKey data-icon="inline-start" />}
            {busy ? 'Writing the file…' : 'Create a recovery file'}
          </Button>
        </>
      ) : null}

      {state.step === 'code-issued' ? (
        <>
          <Field>
            <FieldLabel>Your Recovery Code</FieldLabel>
            <p className="select-all rounded-md border bg-muted px-3 py-2 text-center font-mono text-body2 tracking-wider">
              {state.backup.recoveryCode}
            </p>
            <FieldDescription>Write it down somewhere the file is not. Then type it back to prove you have it.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="recovery-code-confirm">Type the code</FieldLabel>
            <Input
              id="recovery-code-confirm"
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              className="font-mono"
            />
          </Field>
          <Button size="lg" onClick={() => void backupActions.confirmCode(pasted)} aria-disabled={busy || pasted.trim() === ''}>
            <KeyRound data-icon="inline-start" />
            Confirm the code
          </Button>
        </>
      ) : null}

      {state.step === 'code-confirmed' ? (
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
          {!downloaded ? <p className="text-body4 text-muted-foreground">Download it first; the file is verified against your key before this step closes.</p> : null}
        </>
      ) : null}

      {state.step === 'ready' ? (
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
    </div>
  )
}
