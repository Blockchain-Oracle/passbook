import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileUp, KeyRound } from 'lucide-react'
import {
  IMPORT_ALREADY_HERE,
  IMPORT_BODY,
  IMPORT_CODE_WRONG,
  IMPORT_DIFFERENT_IDENTITY,
  IMPORT_FILE_UNREADABLE,
  IMPORT_NO_KEY,
  IMPORT_TITLE,
  IMPORT_UNSUPPORTED_VERSION,
} from '@strk20/protocol/account-copy'
import { accountAddressFor } from '@strk20/protocol/account-address'
import { toast } from 'sonner'

import { backupActions, getSessionSnapshot, sessionActions } from '@/app/session'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { shortAddress } from '@/lib/format'

type ImportAsk = { kind: 'file'; file: string; code: string } | { kind: 'key'; key: string }
type ImportOutcome = { address: string; already: boolean }

function describeRestoreError(e: unknown): string {
  const kind = (e as { kind?: string } | null)?.kind
  if (kind === 'unsupported-version') return IMPORT_UNSUPPORTED_VERSION
  if (kind === 'not-json' || kind === 'not-an-envelope') return IMPORT_FILE_UNREADABLE
  if (kind === 'undecryptable') return IMPORT_CODE_WRONG
  return e instanceof Error ? e.message : String(e)
}

/** Opens the file (or takes the raw key), checks the header names the same account, adopts it. */
async function importAccount(ask: ImportAsk): Promise<ImportOutcome> {
  const { isStarkPrivateKey, readBackupHeader, deriveIdentityPublicKey } = await import('@strk20/protocol/identity')
  let key: string
  if (ask.kind === 'file') {
    try {
      key = await backupActions.openRecoveryFile(ask.file, ask.code)
    } catch (e) {
      throw new Error(describeRestoreError(e))
    }
    if (!isStarkPrivateKey(key)) throw new Error(IMPORT_NO_KEY)
    const header = readBackupHeader(ask.file)
    if (header?.receiveAddress) {
      const { hash } = await import('starknet')
      const derived = accountAddressFor(deriveIdentityPublicKey(key), (a, b) => hash.computePedersenHash(a, b))
      if (BigInt(derived) !== BigInt(header.receiveAddress)) throw new Error(IMPORT_DIFFERENT_IDENTITY)
    }
  } else {
    key = ask.key.trim()
    if (!isStarkPrivateKey(key)) throw new Error(IMPORT_NO_KEY)
  }
  const before = getSessionSnapshot().accounts.map((a) => a.address)
  await sessionActions.importAccount(key)
  const after = getSessionSnapshot()
  const address = after.address ?? ''
  return { address, already: before.some((a) => BigInt(a) === BigInt(address)) }
}

export function useImportAccount() {
  return useMutation({ mutationKey: ['import-account'], mutationFn: importAccount })
}

interface ImportPanelProps {
  onDone?: (outcome: ImportOutcome) => void
}

/** Recovery file + code, or a raw Stark key. Both refusals are the protocol's sentences. */
export function ImportPanel({ onDone }: ImportPanelProps) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [code, setCode] = useState('')
  const [rawKey, setRawKey] = useState('')
  const mutation = useImportAccount()

  const run = (ask: ImportAsk) =>
    mutation.mutate(ask, {
      onSuccess: (outcome) => {
        toast.success(outcome.already ? 'Switched to that account' : 'Account imported', {
          description: outcome.already ? IMPORT_ALREADY_HERE : shortAddress(outcome.address, 8, 6),
        })
        onDone?.(outcome)
      },
    })

  const readFile = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0]
    if (!chosen) return
    setFile({ name: chosen.name, text: await chosen.text() })
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="font-display text-display3 uppercase">{IMPORT_TITLE}</h2>
        <p className="mt-1 text-body3 text-muted-foreground">{IMPORT_BODY}</p>
      </div>
      <Tabs defaultValue="file">
        <TabsList>
          <TabsTrigger value="file">Recovery file</TabsTrigger>
          <TabsTrigger value="key">Raw key</TabsTrigger>
        </TabsList>
        <TabsContent value="file" className="flex flex-col gap-4 pt-3">
          <Field>
            <FieldLabel htmlFor="import-file">Recovery file</FieldLabel>
            <Input id="import-file" type="file" accept="application/json,.json" onChange={(e) => void readFile(e.currentTarget)} />
            {file ? <FieldDescription className="font-mono">{file.name}</FieldDescription> : null}
          </Field>
          <Field>
            <FieldLabel htmlFor="import-code">Recovery code</FieldLabel>
            <Input
              id="import-code"
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className="font-mono"
            />
          </Field>
          <Button
            size="lg"
            aria-disabled={mutation.isPending || !file || code.trim() === ''}
            onClick={() => file && code.trim() && run({ kind: 'file', file: file.text, code })}
          >
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : <FileUp data-icon="inline-start" />}
            {mutation.isPending ? 'Opening the file…' : 'Import this account'}
          </Button>
        </TabsContent>
        <TabsContent value="key" className="flex flex-col gap-4 pt-3">
          <Field>
            <FieldLabel htmlFor="import-key">Stark private key</FieldLabel>
            <Input
              id="import-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="0x…"
              value={rawKey}
              onChange={(e) => setRawKey(e.target.value)}
              className="font-mono"
            />
            <FieldDescription>A key pasted here has no recovery file yet. Save one before registering.</FieldDescription>
          </Field>
          <Button size="lg" aria-disabled={mutation.isPending || rawKey.trim() === ''} onClick={() => rawKey.trim() && run({ kind: 'key', key: rawKey })}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
            Import this key
          </Button>
        </TabsContent>
      </Tabs>
      {mutation.error ? (
        <Alert variant="destructive">
          <AlertDescription>{mutation.error.message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
