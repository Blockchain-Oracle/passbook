//
// Where the USDC lands (Uniswap `SendRecipientForm.tsx` is the model).
//
// ── THE FOCUS INVERSION, AGAIN, AND FOR THE SAME REASON ───────────────────────────────────
//
// At rest a filled well with no border; focused it comes forward and shows its edge. Identical to
// `CurrencyPanel` because it sits directly under one and two adjacent fields that treat focus
// differently read as two different kinds of control.
//
// ── THE RESOLVED STATE IS A DIFFERENT CONTROL FROM THE EMPTY ONE ──────────────────────────
//
// Uniswap swaps the text input for a 36px identity row with a clear X the moment a recipient
// resolves, and that swap is the feature: an address the user has committed to should stop looking
// like a field they are still editing. Ours resolves on a PARSE rather than an ENS lookup, so the
// identity row shows the chain it will land on beside the address — which is the fact a crossing
// can get catastrophically wrong and a same-chain send cannot.
//
// ── AND A WRONG-CHAIN ADDRESS IS NOT A VALIDATION ERROR ───────────────────────────────────
//
// It is a perfectly good address of the wrong kind, and it is the one mistake that burns money to
// somebody else's wallet. `parseDestination` writes that sentence — this file only renders it, so
// there is one place where the difference between "malformed" and "wrong chain" is decided.
//
import type { BridgeDestination } from '@strk20/protocol/bridge'

import { cn } from '../lib/cn'
import { Text } from './ui/Text'
import { ChainLogo, isKnownChain } from './ChainLogo'
import { TokenLogo } from './TokenLogo'

export interface DestinationFieldProps {
  value: string
  onValueChange: (next: string) => void
  chain: BridgeDestination
  onSelectChain: () => void
  /**
   * Hides this field's own chain pill.
   *
   * WAVE 4 MADE THE BRIDGE CHAIN-FIRST: the destination chain is now chosen at the TOP of the form,
   * before an amount exists, because "where is this going" is the question a crossing can get
   * catastrophically wrong and the one a user actually starts with. With that row above, the pill
   * here would be a second control for a decision already made — two places to change one value.
   *
   * The chain still appears on the resolved identity row below, which is a STATEMENT of where the
   * money lands rather than a control, and that one stays: it is the fact worth repeating next to
   * the address it will be sent to.
   */
  hideChainPill?: boolean
  /** `true` once `parseDestination` accepted it for this chain. Flips the field to the identity row. */
  resolved: boolean
  /**
   * The refusal sentence, or `null`.
   *
   * Shown only when there is something to refuse — an empty field is not a mistake, and colouring
   * one red before anyone has typed is how a form teaches people to ignore its red.
   */
  problem: string | null
}

export function DestinationField({
  value,
  onValueChange,
  chain,
  onSelectChain,
  hideChainPill = false,
  resolved,
  problem,
}: DestinationFieldProps) {
  const showProblem = problem !== null && value.trim() !== ''

  return (
    <div
      className={cn(
        'flex flex-col gap-s8 rounded-large border border-solid p-s16',
        // The resolved field keeps its edge: it is no longer being edited, but it is holding a
        // decision, and a decision should not look like an empty well.
        resolved ? 'border-surface3 bg-raised' : 'border-transparent bg-inset',
        showProblem && 'border-irreversible',
      )}
    >
      <div className="flex items-center justify-between gap-s12">
        <Text variant="body4" className="text-neutral2">
          To
        </Text>
        {hideChainPill ? null : <ChainPill chain={chain} onPress={onSelectChain} />}
      </div>

      {resolved ? (
        <div className="flex items-center gap-s12">
          {/* 36px identity row. No avatar service and no ENS — the mark is the CHAIN, because on a
              crossing the chain is the half of the destination a person cannot verify by eye. */}
          {isKnownChain(chain.key) ? (
            <ChainLogo chainKey={chain.key} size={36} />
          ) : (
            <TokenLogo url={null} symbol={chain.name} name={chain.name} size={36} />
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <Text variant="body2" className="numeric truncate text-neutral1">
              {value.trim()}
            </Text>
            <Text variant="body4" className="text-neutral2">
              on {chain.name}
            </Text>
          </span>
          <button
            type="button"
            onClick={() => onValueChange('')}
            aria-label="Clear destination"
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
          placeholder={chain.addressHint}
          aria-label={`Destination address on ${chain.name}`}
          aria-invalid={showProblem || undefined}
          className={cn(
            'numeric min-h-s36 w-full bg-transparent text-body2 outline-none',
            'placeholder:font-sans placeholder:text-neutral3',
            showProblem ? 'text-irreversible' : 'text-neutral1',
          )}
        />
      )}

      {/*
        RESERVED, like the balance row on the amount panel. A sentence that appears on the third
        keystroke of a pasted address would push the button the user is reaching for.
      */}
      <div className="flex min-h-s20 items-center">
        <Text variant="body4" className={showProblem ? 'text-irreversible' : 'text-neutral2'}>
          {showProblem ? problem : resolved ? 'This address will receive the USDC.' : ' '}
        </Text>
      </div>
    </div>
  )
}

/**
 * The chain trigger, shaped as the amount panel's token pill so the two rows rhyme.
 *
 * Always filled rather than outlined-until-chosen: unlike an asset, a destination chain always has
 * a value, and an outlined pill next to a filled one reads as the disabled half of a pair.
 */
function ChainPill({ chain, onPress }: { chain: BridgeDestination; onPress: () => void }) {
  return (
    <button
      type="button"
      onClick={onPress}
      className={cn(
        'focus-ring flex min-h-s36 shrink-0 items-center gap-s6 rounded-pill px-s12',
        'border border-solid border-surface3 bg-raised text-neutral1',
        'transition-colors duration-[var(--transition-duration-simple)] hover:bg-raisedHovered',
        'active:scale-[0.98]',
      )}
    >
      <span className="-ml-s8">
        {isKnownChain(chain.key) ? (
          <ChainLogo chainKey={chain.key} size={28} />
        ) : (
          <TokenLogo url={null} symbol={chain.name} name={chain.name} size={28} />
        )}
      </span>
      <Text variant="buttonLabel2">{chain.name}</Text>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="-mr-s2">
        <path
          d="M6 9L12 15L18 9"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  )
}
