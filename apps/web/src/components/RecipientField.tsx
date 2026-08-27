//
// Who receives the money (Uniswap `SendRecipientForm.tsx` is the model).
//
// ── THE FOCUS INVERSION, AND THE RESOLVED SWAP ────────────────────────────────────────────
//
// At rest a filled well with no border; resolved it comes forward and shows its edge, and the text
// input is REPLACED by a 36px identity row with a clear X. That swap is the feature rather than
// decoration: an address someone has committed to should stop looking like a field they are still
// editing. `DestinationField` does the same thing on the crossing surface, and the two rhyme on
// purpose — one gesture, two forms.
//
// ── THE MARK IS DERIVED FROM THE ADDRESS, AND THAT IS ALL IT CLAIMS ───────────────────────
//
// No avatar service, no name service, no directory. The disc's colour is seeded from the address
// itself, so the same address always draws the same mark and two different addresses almost never
// do — which is enough to notice a paste that changed, and is not a claim to have identified
// anybody. Anything more would be a lookup this product refuses to make on the user's behalf.
//
// ── AND "NOT REGISTERED" IS NOT RED ───────────────────────────────────────────────────────
//
// It is the Door-A transform: the user did nothing wrong and the recipient is real, they simply
// have no account on this protocol yet. The copy is the protocol's own, passed through rather than
// paraphrased. What IS red is a malformed address and a send to yourself — the two cases where the
// thing in the box is a mistake.
//
import type { RecipientStatus } from '../shell/use-recipient'

import { cn } from '../lib/cn'
import { Text } from './ui/Text'
import { TokenLogo } from './TokenLogo'

export interface RecipientFieldProps {
  value: string
  onValueChange: (next: string) => void
  status: RecipientStatus
}

export function RecipientField({ value, onValueChange, status }: RecipientFieldProps) {
  const resolved = status.kind === 'registered'
  // The two states where the field itself is wrong. `unregistered` and `unreadable` are facts about
  // the world, not about what was typed, so they get the ordinary colour and their own sentence.
  const wrong = status.kind === 'invalid' || status.kind === 'self'
  const showWrong = wrong && value.trim() !== ''

  return (
    <div
      className={cn(
        'flex flex-col gap-s8 rounded-large border border-solid p-s16',
        resolved ? 'border-surface3 bg-raised' : 'border-transparent bg-inset',
        showWrong && 'border-irreversible',
      )}
    >
      <Text variant="body4" className="text-neutral2">
        To
      </Text>

      {resolved ? (
        <div className="flex items-center gap-s12">
          <TokenLogo
            url={null}
            // Three hex characters off the front, which is what a person actually compares when
            // they check a pasted address against the one they were given.
            symbol={value.trim().replace(/^0x/i, '').slice(0, 3)}
            name={value.trim()}
            size={36}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <Text variant="body2" className="numeric truncate text-neutral1">
              {value.trim()}
            </Text>
            <Text variant="body4" className="text-neutral2">
              Registered with the pool
            </Text>
          </span>
          <button
            type="button"
            onClick={() => onValueChange('')}
            aria-label="Clear recipient"
            className="focus-ring shrink-0 rounded-control p-s4 text-neutral3 hover:bg-inset hover:text-neutral1"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      ) : (
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onValueChange(event.target.value)}
          placeholder="0x…"
          aria-label="Recipient address"
          aria-invalid={showWrong || undefined}
          className={cn(
            'numeric min-h-s36 w-full bg-transparent text-body2 outline-none',
            'placeholder:font-sans placeholder:text-neutral3',
            showWrong ? 'text-irreversible' : 'text-neutral1',
          )}
        />
      )}

      {/*
        RESERVED, so a sentence arriving on the third keystroke of a pasted address does not push
        the button the user is already reaching for.
      */}
      <div className="flex min-h-s20 items-center">
        <Text variant="body4" className={showWrong ? 'text-irreversible' : 'text-neutral2'}>
          {recipientNote(status, value)}
        </Text>
      </div>
    </div>
  )
}

/**
 * One sentence per state, written out rather than derived.
 *
 * The empty field says what CAN be sent to, because "who can receive this?" is the first question a
 * private transfer raises and the answer — anyone who has opened this app once — is not obvious.
 */
export function recipientNote(status: RecipientStatus, value: string): string {
  if (value.trim() === '') {
    return 'Anyone who has registered with the pool can receive a private transfer.'
  }
  switch (status.kind) {
    case 'idle':
    case 'checking':
      return 'Checking whether this address can receive…'
    case 'invalid':
      return 'That is not a Starknet address.'
    case 'self':
      return 'That is your own address — a send to yourself costs a fee and moves nothing.'
    case 'unregistered':
      // The protocol's authored sentence, passed through. The invite that would follow it is not
      // built, so the copy's `primaryAction` is deliberately not rendered as a button anywhere: a
      // stated recovery wired to nothing is the overclaim this repository fails builds over.
      return status.door.message
    case 'unreadable':
      return `The chain could not be read, so nothing is known about this address yet: ${status.because}`
    case 'registered':
      return 'Registered with the pool'
  }
}
