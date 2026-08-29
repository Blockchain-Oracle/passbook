import { useState, type DragEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { FileCheck2, FileKey, FileUp, KeyRound } from 'lucide-react'
import {
  IMPORT_BODY,
  IMPORT_CODE_WRONG,
  IMPORT_DIFFERENT_IDENTITY,
  IMPORT_FILE_UNREADABLE,
  IMPORT_NO_KEY,
  IMPORT_TITLE,
  IMPORT_UNSUPPORTED_VERSION,
} from '@strk20/protocol/account-copy'
import { accountAddressFor } from '@strk20/protocol/account-address'

import { backupActions, getSessionSnapshot, sessionActions } from '@/app/session'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { PasswordField } from './password-field'

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

type Picked = { name: string; text: string }

/** A file lands here by drop or by click; either way the same hidden input owns it. */
function DropZone({ file, onFile }: { file: Picked | null; onFile: (f: Picked) => void }) {
  const [over, setOver] = useState(false)
  const take = async (chosen: File | undefined) => {
    if (chosen) onFile({ name: chosen.name, text: await chosen.text() })
  }
  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault()
    setOver(false)
    void take(e.dataTransfer.files?.[0])
  }
  return (
    <label
      htmlFor="import-file"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors duration-quick',
        file ? 'border-primary bg-accent' : over ? 'border-ring bg-accent' : 'border-input bg-background hover:border-ring',
      )}
    >
      <input id="import-file" type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void take(e.currentTarget.files?.[0])} />
      {file ? <FileCheck2 className="size-7 text-primary" aria-hidden /> : <FileKey className="size-7 text-muted-foreground" aria-hidden />}
      {file ? (
        <>
          <span className="font-mono text-body3">{file.name}</span>
          <span className="text-body4 text-muted-foreground">Choose a different file</span>
        </>
      ) : (
        <>
          <span className="text-body2 font-medium">Drop your recovery file here</span>
          <span className="text-body4 text-muted-foreground">or click to browse — a strk20-recovery-block-….json</span>
        </>
      )}
    </label>
  )
}

/** Recovery file + code, or a raw Stark key. Every refusal is the protocol's sentence, under the field it concerns. */
export function ImportPanel({ onDone }: ImportPanelProps) {
  const [file, setFile] = useState<Picked | null>(null)
  const [code, setCode] = useState('')
  const [rawKey, setRawKey] = useState('')
  const mutation = useImportAccount()
  const failed = (kind: ImportAsk['kind']) => (mutation.isError && mutation.variables?.kind === kind ? mutation.error.message : null)

  const run = (ask: ImportAsk) => mutation.mutate(ask, { onSuccess: (outcome) => onDone?.(outcome) })
  const submitFile = () => file && code.trim() && !mutation.isPending && run({ kind: 'file', file: file.text, code })
  const submitKey = () => rawKey.trim() && !mutation.isPending && run({ kind: 'key', key: rawKey })

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="font-display text-display3 uppercase">{IMPORT_TITLE}</h2>
        <p className="mt-1 text-body3 text-muted-foreground">{IMPORT_BODY}</p>
      </div>
      <Tabs defaultValue="file" onValueChange={() => mutation.reset()}>
        <TabsList className="w-full">
          <TabsTrigger value="file" className="flex-1">
            Recovery file
          </TabsTrigger>
          <TabsTrigger value="key" className="flex-1">
            Raw key
          </TabsTrigger>
        </TabsList>
        <TabsContent value="file" className="flex flex-col gap-4 pt-4">
          <DropZone file={file} onFile={(f) => { setFile(f); mutation.reset() }} />
          <Field data-invalid={failed('file') ? true : undefined}>
            <FieldLabel htmlFor="import-code">Recovery code</FieldLabel>
            <Input
              id="import-code"
              autoComplete="off"
              spellCheck={false}
              placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
              value={code}
              aria-invalid={failed('file') ? true : undefined}
              className="h-11 font-mono text-body2 tracking-wider"
              onChange={(e) => {
                setCode(e.target.value)
                if (mutation.isError) mutation.reset()
              }}
              onKeyDown={(e) => e.key === 'Enter' && submitFile()}
            />
            {failed('file') ? <FieldError>{failed('file')}</FieldError> : <FieldDescription>The code printed with the file when it was saved.</FieldDescription>}
          </Field>
          <Button size="lg" className="h-12 self-start text-buttonLabel2" aria-disabled={mutation.isPending || !file || code.trim() === ''} onClick={submitFile}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : <FileUp data-icon="inline-start" />}
            {mutation.isPending ? 'Opening the file…' : 'Import this account'}
          </Button>
        </TabsContent>
        <TabsContent value="key" className="flex flex-col gap-4 pt-4">
          <PasswordField
            id="import-key"
            label="Stark private key"
            autoComplete="off"
            mono
            value={rawKey}
            onChange={(v) => {
              setRawKey(v)
              if (mutation.isError) mutation.reset()
            }}
            error={failed('key')}
            hint="A key pasted here has no recovery file yet. Save one before registering."
          />
          <Button size="lg" className="h-12 self-start text-buttonLabel2" aria-disabled={mutation.isPending || rawKey.trim() === ''} onClick={submitKey}>
            {mutation.isPending ? <Spinner data-icon="inline-start" /> : <KeyRound data-icon="inline-start" />}
            Import this key
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  )
}
