import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { CircleHelp, FileCheck, FileKey, ShieldAlert, ShieldCheck } from 'lucide-react'
import { EXPORT_ROW_DETAIL } from '@strk20/protocol/account-copy'
import { BACKUP_STATE_UNKNOWN_NAG, BACKUP_VERIFICATION_IN_BROWSER, NO_BACKUP_NAG } from '@strk20/protocol/backup-copy'
import type { BackupStatus } from '@strk20/protocol/backup-cadence'
import type { BackupVerification } from '@strk20/protocol/identity'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { BackupCadenceView } from './queries'
import { SettingsSection } from './section'
import {
  BACKUP_STATUS_TITLE,
  BACKUP_VERIFIED_OK,
  NEED_UNLOCK,
  REISSUE_ACTION,
  VERIFY_ACTION,
  VERIFY_TITLE,
  lastVerifiedLine,
  nextCheckLine,
} from './settings-copy'

export interface BackupSectionProps {
  /** `undefined` while reading; `null` when there is no open account to read for. */
  cadence: BackupCadenceView | null | undefined
  /** The session's own read, which wins when the cadence query is still loading. */
  status: BackupStatus
  ready: boolean
  onVerify: (file: string, code: string) => Promise<BackupVerification>
  onReissue: () => void
}

const STATUS_ICON = { 'backed-up': ShieldCheck, 'not-backed-up': ShieldAlert, unknown: CircleHelp } as const
const STATUS_TONE = { 'backed-up': 'text-settled', 'not-backed-up': 'text-irreversible', unknown: 'text-exposed' } as const

function StatusItem({ cadence, status }: { cadence: BackupCadenceView | null | undefined; status: BackupStatus }) {
  const effective = cadence?.status ?? status
  const Icon = STATUS_ICON[effective]
  const nag = effective === 'not-backed-up' ? NO_BACKUP_NAG : effective === 'unknown' ? BACKUP_STATE_UNKNOWN_NAG : null
  return (
    <Item variant="outline">
      <ItemMedia variant="icon">
        <Icon className={STATUS_TONE[effective]} aria-hidden />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{BACKUP_STATUS_TITLE[effective]}</ItemTitle>
        {cadence === undefined ? (
          <Skeleton className="h-4 w-48" />
        ) : (
          <ItemDescription className="line-clamp-none">
            {nag ? `${nag} ` : null}
            {cadence ? lastVerifiedLine(cadence.lastVerifiedAt) : null}
            {cadence ? ` ${nextCheckLine(cadence.dueAt, cadence.checkDue) ?? ''}` : null}
          </ItemDescription>
        )}
      </ItemContent>
    </Item>
  )
}

function VerifyForm({ onVerify }: { onVerify: BackupSectionProps['onVerify'] }) {
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [code, setCode] = useState('')
  const verify = useMutation({
    mutationKey: ['settings', 'verify-backup'],
    mutationFn: (ask: { file: string; code: string }) => onVerify(ask.file, ask.code),
  })
  const readFile = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0]
    if (!chosen) return
    setFile({ name: chosen.name, text: await chosen.text() })
  }
  const ready = file !== null && code.trim() !== ''
  const result = verify.data
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready && !verify.isPending && file) verify.mutate({ file: file.text, code })
      }}
    >
      <Field>
        <FieldLabel htmlFor="verify-file">Recovery file</FieldLabel>
        <Input id="verify-file" type="file" accept="application/json,.json" onChange={(e) => void readFile(e.currentTarget)} />
        <FieldDescription className={file ? 'font-mono' : undefined}>{file ? file.name : BACKUP_VERIFICATION_IN_BROWSER}</FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="verify-code">Recovery code</FieldLabel>
        <Input
          id="verify-code"
          autoComplete="off"
          spellCheck={false}
          placeholder="XXXXXX-XXXXXX-XXXXXX-XXXXXX"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="font-mono"
        />
      </Field>
      {result ? (
        <Alert variant={result.ok ? 'default' : 'destructive'}>
          {result.ok ? <FileCheck className="text-settled" /> : <ShieldAlert />}
          <AlertDescription>{result.ok ? BACKUP_VERIFIED_OK : result.message}</AlertDescription>
        </Alert>
      ) : null}
      {verify.error ? (
        <Alert variant="destructive">
          <AlertDescription>{verify.error.message}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" variant="outline" aria-disabled={!ready || verify.isPending} className="self-start">
        {verify.isPending ? <Spinner data-icon="inline-start" /> : <FileCheck data-icon="inline-start" />}
        {VERIFY_ACTION}
      </Button>
    </form>
  )
}

export function BackupSection({ cadence, status, ready, onVerify, onReissue }: BackupSectionProps) {
  return (
    <SettingsSection id="backup" index="03" title="Backup">
      <StatusItem cadence={cadence} status={status} />

      {ready ? (
        <Item variant="outline" className="items-start">
          <ItemMedia variant="icon">
            <FileCheck aria-hidden />
          </ItemMedia>
          <ItemContent className="gap-3">
            <ItemTitle>{VERIFY_TITLE}</ItemTitle>
            <VerifyForm onVerify={onVerify} />
          </ItemContent>
        </Item>
      ) : (
        <Alert>
          <AlertDescription>{NEED_UNLOCK}</AlertDescription>
        </Alert>
      )}

      <Item variant="outline">
        <ItemMedia variant="icon">
          <FileKey aria-hidden />
        </ItemMedia>
        <ItemContent>
          <ItemTitle>{REISSUE_ACTION}</ItemTitle>
          <ItemDescription className="line-clamp-none">{EXPORT_ROW_DETAIL}</ItemDescription>
        </ItemContent>
        <ItemActions>
          <Button variant="outline" aria-disabled={!ready} onClick={() => ready && onReissue()}>
            <FileKey data-icon="inline-start" />
            Re-issue
          </Button>
        </ItemActions>
      </Item>
    </SettingsSection>
  )
}
