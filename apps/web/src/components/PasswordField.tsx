//
// The password input, and the strength meter that goes under a new one.
//
// ── ONE COMPONENT BECAUSE THERE ARE THREE FIELDS AND THEY MUST NOT DRIFT ──────────────────
//
// The lock screen asks for a password, Settings asks for one twice to set it, and Settings asks
// for it once more to remove it. Four renderings of the same input, and the parts that are easy
// to get subtly different between them are exactly the parts that matter: the autocomplete token
// (which decides whether a password manager offers to save the wrong thing), whether Enter
// submits, and whether the reveal toggle is announced.
//
import { useId, useState } from 'react'

import { MIN_PASSWORD_LENGTH, passwordStrength } from '@strk20/protocol/session-vault'

import { cn } from '../lib/cn'
import { Text } from './Text'

export interface PasswordFieldProps {
  label: string
  value: string
  onChange: (value: string) => void
  /** Fires on Enter. The field is usually the only thing on screen; Enter should do the obvious. */
  onSubmit?: () => void
  /**
   * `new-password` on the two fields that CREATE one, `current-password` on the two that ask for an
   * existing one. Getting this backwards is not cosmetic: a manager offered `new-password` on a
   * lock screen will cheerfully propose overwriting the saved entry with whatever was typed.
   */
  autoComplete: 'new-password' | 'current-password'
  autoFocus?: boolean
  disabled?: boolean
  /** Renders the four-bucket meter under the field. Only ever on a `new-password`. */
  showStrength?: boolean
}

export function PasswordField({
  label,
  value,
  onChange,
  onSubmit,
  autoComplete,
  autoFocus,
  disabled,
  showStrength,
}: PasswordFieldProps) {
  const [revealed, setRevealed] = useState(false)
  const id = useId()

  return (
    <div className="flex flex-col gap-s6">
      <label htmlFor={id} className="kicker">
        {label}
      </label>

      <div className="flex items-center gap-s8">
        <input
          id={id}
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onSubmit) {
              e.preventDefault()
              onSubmit()
            }
          }}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          disabled={disabled}
          className="focus-ring numeric w-full rounded-control bg-inset px-s12 py-s12 text-body2 text-neutral1"
        />
        {/*
          A reveal toggle, not a "show password" checkbox, and it is `aria-pressed` rather than a
          label that flips. A button whose NAME changes between presses is announced as a different
          control each time; a button with a stable name and a pressed state is announced as one
          control that is on or off, which is what it is.
        */}
        <button
          type="button"
          onClick={() => setRevealed((r) => !r)}
          aria-pressed={revealed}
          aria-label="Show password"
          className="focus-ring shrink-0 rounded-control px-s8 py-s8 text-body4 text-neutral2 hover:text-neutral1"
        >
          {revealed ? 'Hide' : 'Show'}
        </button>
      </div>

      {showStrength ? <StrengthMeter password={value} /> : null}
    </div>
  )
}

/**
 * Four segments and a word.
 *
 * ── IT ADVISES AND NEVER BLOCKS, AND THE COLOURS SAY SO ───────────────────────────────────
 *
 * `weak` is `neutral2`, not red. Red is this app's colour for something that is wrong, and a weak
 * password on somebody's own laptop is not wrong — it is a trade they are allowed to make. The one
 * state that IS a refusal is `too-short`, because `sealVault` genuinely rejects it, and that one
 * is spoken as a requirement rather than a judgement.
 *
 * `aria-live="polite"`: the text changes under a field that keeps focus, so a screen reader would
 * otherwise never learn the meter exists. `polite` rather than `assertive` — it must not interrupt
 * every keystroke.
 */
function StrengthMeter({ password }: { password: string }) {
  const strength = password === '' ? null : passwordStrength(password)

  // Always rendered, even empty, so the layout does not jump the moment somebody starts typing.
  if (strength === null) {
    return <div className="h-s16" aria-hidden="true" />
  }

  const filled = FILLED[strength]
  return (
    <div className="flex items-center gap-s8">
      <div className="flex flex-1 gap-s4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'h-s2 flex-1 rounded-pill transition-colors duration-[var(--transition-duration-quick)]',
              i < filled ? TINT[strength] : 'bg-surface3',
            )}
          />
        ))}
      </div>
      <Text variant="body4" className="text-neutral2" aria-live="polite">
        {WORD[strength]}
      </Text>
    </div>
  )
}

const FILLED = { 'too-short': 1, weak: 2, fair: 3, strong: 4 } as const

/** `weak` is not red — see `StrengthMeter`. Only the genuine refusal gets the warning colour. */
const TINT = {
  'too-short': 'bg-exposed',
  weak: 'bg-neutral2',
  fair: 'bg-neutral1',
  strong: 'bg-accent1',
} as const

const WORD = {
  'too-short': `At least ${MIN_PASSWORD_LENGTH} characters`,
  weak: 'Weak',
  fair: 'Fair',
  strong: 'Strong',
} as const
