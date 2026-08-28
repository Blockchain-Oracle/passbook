import { useId, useState } from 'react'
import { MIN_PASSWORD_LENGTH, passwordStrength, type PasswordStrength } from '@strk20/protocol/session-vault'
import { PASSWORD_MISMATCH } from '@strk20/protocol/account-copy'

import { Badge } from '@/components/ui/badge'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { PASSWORD_TOO_SHORT, STRENGTH_LABEL } from './settings-copy'

const STRENGTH_TONE: Record<PasswordStrength, string> = {
  'too-short': 'text-irreversible border-irreversible/40',
  weak: 'text-exposed border-exposed/40',
  fair: 'text-foreground border-border',
  strong: 'text-settled border-settled/40',
}

export interface NewPasswordValue {
  password: string
  /** True when the pair matches and clears the minimum length. */
  ready: boolean
}

/** New + confirm, with the protocol's strength read and the mismatch said before the button. */
export function NewPasswordFields({ onChange, autoFocus }: { onChange: (v: NewPasswordValue) => void; autoFocus?: boolean }) {
  const id = useId()
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const strength = passwordStrength(pw)
  const mismatch = confirm !== '' && confirm !== pw

  const update = (nextPw: string, nextConfirm: string) => {
    setPw(nextPw)
    setConfirm(nextConfirm)
    onChange({ password: nextPw, ready: nextPw.length >= MIN_PASSWORD_LENGTH && nextPw === nextConfirm })
  }

  return (
    <>
      <Field>
        <FieldLabel htmlFor={`${id}-new`}>New password</FieldLabel>
        <Input
          id={`${id}-new`}
          type="password"
          autoComplete="new-password"
          autoFocus={autoFocus}
          value={pw}
          onChange={(e) => update(e.target.value, confirm)}
        />
        <FieldDescription className="flex items-center gap-2">
          {pw === '' ? (
            PASSWORD_TOO_SHORT(MIN_PASSWORD_LENGTH)
          ) : (
            <Badge variant="outline" className={cn('uppercase text-navLabel', STRENGTH_TONE[strength])}>
              {STRENGTH_LABEL[strength]}
            </Badge>
          )}
        </FieldDescription>
      </Field>
      <Field data-invalid={mismatch || undefined}>
        <FieldLabel htmlFor={`${id}-confirm`}>Confirm</FieldLabel>
        <Input
          id={`${id}-confirm`}
          type="password"
          autoComplete="new-password"
          aria-invalid={mismatch || undefined}
          value={confirm}
          onChange={(e) => update(pw, e.target.value)}
        />
        {mismatch ? <FieldError>{PASSWORD_MISMATCH}</FieldError> : null}
      </Field>
    </>
  )
}

/** The current password, asked again on purpose — see `PASSWORD_REMOVE_CONFIRM`. */
export function CurrentPasswordField({ value, onChange, label = 'Current password' }: { value: string; onChange: (v: string) => void; label?: string }) {
  const id = useId()
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} type="password" autoComplete="current-password" value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  )
}
