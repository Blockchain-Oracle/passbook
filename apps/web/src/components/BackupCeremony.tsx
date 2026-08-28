//
// The backup ceremony — the gate in front of registration (FR-013, story 1.8).
//
// ── WHY A CEREMONY AND NOT A CHECKBOX ────────────────────────────────────────────────────
//
// The pool writes your viewing key ONCE. `WriteOnce` refuses every replacement, so an account
// whose key is lost is not recoverable by re-registering — it is gone, along with anything in it.
// `backup-gate.ts` therefore refuses to let registration happen until a recovery path demonstrably
// exists, and `canRegister` defaults to `false` for exactly that reason.
//
// ── TWO SECRETS THAT MUST NOT BE STORED TOGETHER ─────────────────────────────────────────
//
// The Recovery FILE is the wrapped key. The Recovery CODE unwraps it. Either alone is useless,
// which is the entire security property — so this component never persists either one, and the
// terminal state it produces carries neither. `backup-gate.ts`'s `ready` variant scrubs them and
// its comment explains why: `ready` is the state that survives a reload, so a `ready` still
// holding the code would put both halves in localStorage where one script can read them.
//
// ── AND THE ORDER IS A SAFETY PROPERTY ───────────────────────────────────────────────────
//
// Paste the code back BEFORE the file counts as saved. `markFileSaved` is only reachable from
// `code-confirmed` and is a no-op otherwise, so a user who downloads first cannot skip the
// confirmation by reporting the download. This UI mirrors that rather than reimplementing it:
// every transition goes through the module, and the step rendered is whatever the module says.
//
import { useCallback, useState } from 'react'
import type { BackupCeremonyState } from '@strk20/protocol/backup-gate'

import { cn } from '../lib/cn'
import { Button } from './LegacyButton'
import { Text } from './Text'

export interface BackupCeremonyProps {
  accountKey: string
  /** The account's own address, recorded in the file's header. Identifying but not secret. */
  receiveAddress?: string
  /** Fires once the ceremony reaches `ready` — the only state that opens the gate. */
  onComplete: (state: Extract<BackupCeremonyState, { step: 'ready' }>) => void
}

export function BackupCeremony({ accountKey, receiveAddress, onComplete }: BackupCeremonyProps) {
  const [state, setState] = useState<BackupCeremonyState>({ step: 'not-started' })
  const [pasted, setPasted] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mismatch, setMismatch] = useState(false)

  const begin = useCallback(async () => {
    setBusy(true)
    setProblem(null)
    try {
      const { issueBackup, readBackupHeaderContext } = await import('@strk20/protocol/backup-gate')

      // THE CHAIN READ COMES FIRST, before any key material is touched. The file records which
      // auditor key registrations escrow to and at which block; a header written from a failed
      // read would be a fabrication, and `issueBackup` refuses one at runtime as well as by type.
      const context = await readBackupHeaderContext()
      if (!context.ok) {
        setProblem(`The chain could not be read, so no recovery file was written: ${context.reason}`)
        return
      }

      setState(await issueBackup(accountKey, context, receiveAddress))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The recovery file could not be created.')
    } finally {
      setBusy(false)
    }
  }, [accountKey, receiveAddress])

  const confirm = useCallback(async () => {
    const { confirmPastedCode } = await import('@strk20/protocol/backup-gate')
    const next = confirmPastedCode(state, pasted)
    // UNCHANGED ON A MISMATCH — the module returns the same state rather than throwing, because a
    // wrong paste is the ceremony working. So "did it move?" is the test, and the message below is
    // the only thing this component adds.
    if (next === state) {
      setMismatch(true)
      return
    }
    setMismatch(false)
    setState(next)
  }, [state, pasted])

  const saveFile = useCallback(async () => {
    if (state.step !== 'code-confirmed') return
    const { markFileSaved } = await import('@strk20/protocol/backup-gate')

    // The download happens here, in the browser, and never touches a server.
    const blob = new Blob([state.backup.file], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = state.backup.filename
    anchor.click()
    URL.revokeObjectURL(url)

    const next = markFileSaved(state)
    setState(next)
    if (next.step === 'ready') onComplete(next)
  }, [state, onComplete])

  return (
    <div className="flex flex-col gap-s16 rounded-large border border-solid border-surface3 p-s16">
      <div className="flex flex-col gap-s4">
        <Text variant="subheading1" as="h2">
          Save a way back in
        </Text>
        <Text variant="body3" className="text-neutral2">
          Your account key lives in this browser and nowhere else. The pool accepts it once and will
          never accept a replacement, so if you lose it the account is gone. This writes a recovery
          file and gives you a code that opens it — keep them in different places.
        </Text>
      </div>

      {problem ? (
        <Text variant="body3" className="text-irreversible">
          {problem}
        </Text>
      ) : null}

      {state.step === 'not-started' ? (
        <Button variant="primary" size="md" fill onClick={begin} disabled={busy}>
          {busy ? 'Preparing…' : 'Create a recovery file'}
        </Button>
      ) : null}

      {state.step === 'code-issued' ? (
        <div className="flex flex-col gap-s12">
          <Text variant="body4" className="text-neutral2">
            Write this down. It is shown once and it is not stored anywhere.
          </Text>
          {/*
            SELECTABLE, and shown in full. A code the user cannot copy is a code they will
            transcribe wrongly, and the next screen asks them to type it back.
          */}
          <code className="select-all break-all rounded-card bg-inset p-s12 font-mono text-mono text-neutral1">
            {state.backup.recoveryCode}
          </code>

          <div className="flex flex-col gap-s4">
            <Text variant="body4" className="text-neutral2">
              Now type it back, so we both know you have it.
            </Text>
            <input
              value={pasted}
              onChange={(event) => {
                setPasted(event.target.value)
                setMismatch(false)
              }}
              autoComplete="off"
              spellCheck={false}
              aria-label="Recovery code"
              className={cn(
                'focus-ring min-h-s48 w-full rounded-card border border-solid bg-raised px-s12',
                'font-mono text-mono text-neutral1',
                mismatch ? 'border-irreversible' : 'border-surface3',
              )}
            />
            {mismatch ? (
              <Text variant="body4" className="text-irreversible">
                That does not match. Nothing is lost — check it and try again.
              </Text>
            ) : null}
          </div>

          <Button variant="primary" size="md" fill onClick={confirm} disabled={pasted.trim() === ''}>
            Confirm the code
          </Button>
        </div>
      ) : null}

      {state.step === 'code-confirmed' ? (
        <div className="flex flex-col gap-s12">
          <Text variant="body3" className="text-settled">
            Code confirmed. Now save the file it opens.
          </Text>
          <Text variant="body4" className="text-neutral2">
            The file is useless without the code, and the code is useless without the file. Keeping
            them in the same place removes the point of having two.
          </Text>
          <Button variant="primary" size="md" fill onClick={saveFile}>
            Download the recovery file
          </Button>
        </div>
      ) : null}

      {state.step === 'ready' ? (
        <div className="flex flex-col gap-s4">
          <Text variant="body3" className="text-settled">
            Saved as {state.filename}.
          </Text>
          <Text variant="body4" className="text-neutral2">
            Registration is unlocked. Keep the file and the code apart, and neither one here.
          </Text>
        </div>
      ) : null}
    </div>
  )
}
