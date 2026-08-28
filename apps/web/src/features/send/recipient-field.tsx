import { useId } from 'react'
import { AtSign, Check, Copy, ShieldCheck, ShieldOff } from 'lucide-react'
import { buildPayLink, type PayLinkSearch } from '@strk20/protocol/pay-link'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { useCopy } from '@/hooks/use-copy'
import { shortAddress } from '@/lib/format'
import type { RecipientStatus } from './use-recipient'

export interface RecipientFieldProps {
  value: string
  onChange: (next: string) => void
  status: RecipientStatus
  /** What the pay-link share carries when the recipient is not here yet. */
  request: PayLinkSearch
  autoFocus?: boolean
}

/** Address or `@name`. The status line says where it routes; Door A replaces the field's error. */
export function RecipientField({ value, onChange, status, request, autoFocus }: RecipientFieldProps) {
  const id = useId()
  const problem =
    status.state === 'invalid' || status.state === 'unresolved-name'
      ? status.because
      : status.state === 'self'
        ? 'That is your own address.'
        : status.state === 'unreadable'
          ? `The recipient could not be checked: ${status.because}`
          : null
  return (
    <Field data-invalid={problem ? true : undefined}>
      <FieldLabel htmlFor={id}>To</FieldLabel>
      <InputGroup className="h-12">
        <InputGroupAddon>
          <AtSign className="text-muted-foreground" />
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0x… address or @name"
          autoComplete="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-invalid={problem ? true : undefined}
          className="h-full font-mono"
        />
        <InputGroupAddon align="inline-end">
          <StatusMark status={status} />
        </InputGroupAddon>
      </InputGroup>
      {problem ? <FieldError>{problem}</FieldError> : null}
      {status.state === 'registered' ? (
        <FieldDescription className="font-mono text-mono">
          {status.name ? `@${status.name} · ` : ''}
          {shortAddress(status.address, 10, 6)} · registered
        </FieldDescription>
      ) : null}
      {status.state === 'unregistered' ? <DoorA recipient={value} request={request} message={status.door.message} /> : null}
    </Field>
  )
}

function StatusMark({ status }: { status: RecipientStatus }) {
  if (status.state === 'checking') return <Spinner className="text-muted-foreground" />
  if (status.state === 'registered') return <ShieldCheck className="text-settled" aria-label="Registered" />
  if (status.state === 'unregistered') return <ShieldOff className="text-exposed" aria-label="Not registered" />
  return null
}

/**
 * The Door-A transform: the recipient is reachable, just not here yet. No invite pipeline ships,
 * so the offer is the request link itself — it prefills this send once they have an account.
 */
function DoorA({ recipient, request, message }: { recipient: string; request: PayLinkSearch; message: string }) {
  const { copied, copy } = useCopy()
  let link: string | null = null
  try {
    link = `${window.location.origin}${buildPayLink(recipient, request)}`
  } catch {
    link = null
  }
  return (
    <Alert className="border-dashed border-exposed bg-exposedTint">
      <ShieldOff />
      <AlertTitle>No account here yet</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {link ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void copy(link)}>
              {copied ? <Check data-icon="inline-start" className="text-settled" /> : <Copy data-icon="inline-start" />}
              {copied ? 'Copied' : 'Copy this request as a link'}
            </Button>
            <span className="text-body4 text-muted-foreground">Once they register, the link opens this send prefilled.</span>
          </div>
        ) : null}
      </AlertDescription>
    </Alert>
  )
}
