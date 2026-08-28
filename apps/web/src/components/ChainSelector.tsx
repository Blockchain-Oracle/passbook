//
// Which chain the USDC leaves for.
//
// ── NO SEARCH BOX, AND THAT IS NOT A SHORTCUT ─────────────────────────────────────────────
//
// `TokenSelector` has one because AVNU's routable set is thirty rows and growing. This list is six,
// every one of them a domain number somebody in this repository checked against the sponsor's own
// mainnet chain table. A search field over six rows is furniture, and it would also imply the list
// is a subset of something longer that the user could reach by typing — which is exactly the wrong
// idea to plant on a screen where an unlisted chain is one nobody has verified.
//
// ── THE CAVEAT RENDERS IN THE LIST, NOT ONLY IN THE REVIEW ────────────────────────────────
//
// Solana's row says what is unproven about it BEFORE it is chosen. A warning that waits for the
// review step is a warning delivered after the user has already formed the intention, and the
// honest place to spend somebody's attention is the moment the choice is still free.
//
import { DESTINATIONS, type BridgeDestination } from '@strk20/protocol/bridge'

import { cn } from '../lib/cn'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { Text } from './Text'
import { ChainLogo, isKnownChain } from './ChainLogo'
import { TokenLogo } from './TokenLogo'

export interface ChainSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedKey: string
  onSelect: (chain: BridgeDestination) => void
}

export function ChainSelector({ open, onOpenChange, selectedKey, onSelect }: ChainSelectorProps) {
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} label="Select a chain" modal>
      <div className="flex min-h-0 w-full min-w-0 flex-col gap-s12">
        <div className="flex items-start justify-between gap-s12">
          <Text variant="subheading1" as="h2">
            Select a chain
          </Text>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close"
            className="focus-ring -m-s4 rounded-control p-s4 text-neutral3 hover:bg-inset hover:text-neutral1"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <Text variant="body4" className="text-neutral2">
          USDC crosses through Circle&rsquo;s CCTP. These are the destinations this app has checked
          against the chain; it is not the full list CCTP supports.
        </Text>

        <div className="-mx-s4 min-h-0 flex-1 overflow-y-auto">
          <ul className="flex flex-col">
            {DESTINATIONS.map((chain) => (
              <li key={chain.key}>
                <ChainRow
                  chain={chain}
                  selected={chain.key === selectedKey}
                  onSelect={() => {
                    onSelect(chain)
                    onOpenChange(false)
                  }}
                />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </ResponsiveDialog>
  )
}

function ChainRow({
  chain,
  selected,
  onSelect,
}: {
  chain: BridgeDestination
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'focus-ring flex w-full items-start gap-s12 rounded-card p-s8 text-left',
        'transition-colors duration-[var(--transition-duration-simple)] hover:bg-inset',
        selected && 'bg-inset',
      )}
    >
      {isKnownChain(chain.key) ? (
        <ChainLogo chainKey={chain.key} size={40} />
      ) : (
        <TokenLogo url={null} symbol={chain.name} name={chain.name} size={40} />
      )}

      <span className="flex min-w-0 flex-1 flex-col gap-s2">
        <Text variant="body2" className="truncate text-neutral1">
          {chain.name}
        </Text>
        <Text variant="body4" className="text-neutral2">
          {chain.addressHint}
        </Text>
        {/* The unproven case, before the choice rather than after it. `exposed` and not
            `irreversible`: this is a fact about what has not been tested, not a refusal. */}
        {chain.caveat ? (
          <Text variant="body4" className="text-exposed">
            {chain.caveat}
          </Text>
        ) : null}
      </span>
    </button>
  )
}
