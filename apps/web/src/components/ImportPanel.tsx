//
// The recovery-file import panel, in its own module so two callers can reach it.
//
// It used to live inside `AccountDrawer`. The onboarding gate needs it too — the gate sets `#root`
// inert, which puts the drawer and therefore every other route to this panel out of reach of a
// returning user on a second browser — and importing it from the drawer would statically pull that
// 680-line component into the eager graph, defeating `AccountChip`'s dynamic import of it. The
// build's warning gate catches exactly that, which is how this file came to exist.
//
import { useCallback, useState } from 'react'

import { IMPORT_ALREADY_HERE, IMPORT_BODY } from '@strk20/protocol/account-copy'

import { cn } from '../lib/cn'
import { importAccount, shortenFelt } from '../shell/session'
import { toast } from '../shell/toast-store'
import { Button } from './LegacyButton'
import { Text } from './Text'

/** A chosen recovery file, already read in this browser. */
export interface ChosenFile {
  name: string
  text: string
}

/** The panel with its own field state, so a caller only has to say where it goes. */
export function ImportPanelStandalone({ onDone }: { onDone: () => void }) {
  const [file, setFile] = useState<ChosenFile | null>(null)
  const [code, setCode] = useState('')
  return <ImportPanel file={file} onFile={setFile} code={code} onCode={setCode} onDone={onDone} />
}

export function ImportPanel({
  file,
  onFile,
  code,
  onCode,
  onDone,
}: {
  file: ChosenFile | null
  onFile: (file: ChosenFile | null) => void
  code: string
  onCode: (code: string) => void
  onDone: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const submit = useCallback(() => {
    if (!file) return
    setBusy(true)
    setProblem(null)
    void importAccount(file.text, code).then((result) => {
      setBusy(false)
      if (!result.ok) {
        setProblem(result.because)
        return
      }
      // The two success outcomes are different events and get different words: one added an
      // account, the other found one already here and switched to it.
      toast({
        kind: 'success',
        title: result.already ? 'Switched to that account' : 'Account imported',
        detail: result.already ? IMPORT_ALREADY_HERE : shortenFelt(result.address, 8, 6),
      })
      onFile(null)
      onCode('')
      onDone()
    })
  }, [file, code, onFile, onCode, onDone])

  return (
    <>
      <Text variant="body4" className="text-neutral2">
        {IMPORT_BODY}
      </Text>

      <label className="flex flex-col gap-s4">
        <span className="text-body4 text-neutral2">Recovery file</span>
        {/*
          READ IN THE BROWSER AND NEVER UPLOADED. `FileReader` is not used — `File.text()` is a
          promise, which keeps the failure on the same channel as everything else here.
        */}
        <input
          type="file"
          accept="application/json,.json"
          className={cn(
            'focus-ring w-full rounded-card border border-solid border-surface3 bg-raised',
            'p-s12 text-body4 text-neutral2',
            'file:mr-s12 file:rounded-small file:border-0 file:bg-inset file:px-s12 file:py-s4',
            'file:text-buttonLabel4 file:text-neutral1',
          )}
          onChange={(event) => {
            const chosen = event.target.files?.[0]
            setProblem(null)
            if (!chosen) {
              onFile(null)
              return
            }
            void chosen
              .text()
              .then((text) => onFile({ name: chosen.name, text }))
              .catch(() => setProblem('That file could not be read from this device.'))
          }}
        />
        {file ? <span className="truncate text-body4 text-settled">Loaded {file.name}</span> : null}
      </label>

      <label className="flex flex-col gap-s4">
        <span className="text-body4 text-neutral2">Recovery code</span>
        <input
          value={code}
          onChange={(event) => {
            onCode(event.target.value)
            setProblem(null)
          }}
          autoComplete="off"
          spellCheck={false}
          placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
          className={cn(
            'focus-ring min-h-s48 w-full rounded-card border border-solid bg-raised px-s12',
            'font-mono text-mono text-neutral1',
            problem ? 'border-irreversible' : 'border-surface3',
          )}
        />
      </label>

      {problem ? (
        <Text variant="body3" className="text-irreversible" role="alert">
          {problem}
        </Text>
      ) : null}

      <Button
        variant="primary"
        size="md"
        fill
        disabled={busy || !file || code.trim() === ''}
        onClick={submit}
      >
        {busy ? 'Opening the file…' : 'Import this account'}
      </Button>
    </>
  )
}
