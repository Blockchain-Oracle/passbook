import { useId } from 'react'
import { Link2 } from 'lucide-react'
import type { BridgeDestination } from '@strk20/protocol/bridge'
import { SELF_LINK_SENTENCE, SELF_LINK_WAY_OUT } from '@strk20/protocol/linkability-copy'
import type { SelfLinkResult } from '@strk20/protocol/self-link'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

export interface DestinationFieldProps {
  value: string
  onChange: (next: string) => void
  chain: BridgeDestination
  /** The parser's refusal, only once something has been typed. */
  problem: string | null
  selfLink: SelfLinkResult
}

/** The one thing left to check before an irreversible burn: the address, held to the chosen chain. */
export function DestinationField({ value, onChange, chain, problem, selfLink }: DestinationFieldProps) {
  const id = useId()
  const invalid = problem !== null
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>Destination address on {chain.name}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={chain.family === 'evm' ? '0x…' : 'Base58 account address'}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-invalid={invalid || undefined}
        className="h-11 font-mono text-mono"
      />
      {problem ? <FieldError>{problem}</FieldError> : <FieldDescription>{chain.addressHint}.</FieldDescription>}
      <SelfLinkNotice selfLink={selfLink} />
    </Field>
  )
}

/**
 * Renders only on a match. `no-known-addresses` and `no-match` render nothing — a green tick there
 * would claim a comparison that either never ran or proves nothing.
 */
export function SelfLinkNotice({ selfLink }: { selfLink: SelfLinkResult }) {
  if (selfLink.state !== 'self-link') return null
  return (
    <Alert className="border-irreversible bg-irreversibleTint">
      <Link2 className="text-irreversible" />
      <AlertTitle className="text-irreversible">{SELF_LINK_SENTENCE}</AlertTitle>
      <AlertDescription>{SELF_LINK_WAY_OUT}.</AlertDescription>
    </Alert>
  )
}
