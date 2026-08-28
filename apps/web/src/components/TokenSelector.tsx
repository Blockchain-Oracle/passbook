//
// The asset picker (Uniswap `packages/uniswap/src/components/TokenSelector/` is the model).
//
// ── ONE ROW USED TO BE THE WHOLE LIST, AND THAT WAS A HONESTY DECISION, NOT A BUG ─────────
//
// `token-scale.ts` had verified the decimals of exactly one token and refused to guess the rest,
// so the selector showed STRK and nothing else. The fix is not to relax the refusal — it is
// `token-list.ts`, which fetches the routable set and confirms every entry's `decimals()` against
// its own contract before it is allowed into an amount.
//
// ── THE SHAPE IS UNISWAP'S, THE THRESHOLD IS OURS ─────────────────────────────────────────
//
// 400x700 dialog above 640px, bottom sheet below — through `ResponsiveDialog`, which is one
// `Drawer.Root` on both sides precisely so crossing the threshold does not remount the search box
// and throw away what the user typed.
//
// Rows are `p-s8 rounded-card`, logo 40, NAME over SYMBOL, balance right. Sections are
// volume-ordered because "by 24H volume" is the honest ranking when we have no per-user history to
// rank by — and a selector that opens on an arbitrary order is a selector nobody trusts.
//
import { useEffect, useMemo, useRef, useState } from 'react'
import { byLiquidity, searchTokens, type TokenInfo } from '@strk20/protocol/token-list'

import { cn } from '../lib/cn'
import { ResponsiveDialog } from '../shell/ResponsiveDialog'
import { Skeleton } from './ui/skeleton'
import { Text } from './Text'
import { TokenLogo } from './TokenLogo'

export interface TokenSelectorProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tokens: readonly TokenInfo[]
  /** Absent while the list is still arriving. Distinct from an empty list, which is an answer. */
  loading?: boolean
  onSelect: (token: TokenInfo) => void
  /** Renders a check instead of a balance, so the current choice is visible in the list. */
  selectedAddress?: string | null
  /** Per-token display balance, when the surface has read one. */
  balanceFor?: (token: TokenInfo) => string | null
}

export function TokenSelector({
  open,
  onOpenChange,
  tokens,
  loading = false,
  onSelect,
  selectedAddress = null,
  balanceFor,
}: TokenSelectorProps) {
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Reopening with the previous search still in the box shows a filtered list the user did not
  // ask for and cannot see the cause of.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const results = useMemo(() => byLiquidity(searchTokens(tokens, query)), [tokens, query])

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} label="Select an asset" modal>
      {/* `w-full`, not a fixed width — `.pb-dialog` caps at 420px and pads 24px each side, so a
          400px child overflows. The dialog owns the width. */}
      <div className="flex min-h-0 w-full min-w-0 flex-col gap-s12">
        <div className="flex items-start justify-between gap-s12">
          <Text variant="subheading1" as="h2">
            Select an asset
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

        {/*
          48px search field. `autoFocus` only above the sheet threshold: on a phone it summons the
          keyboard over the list the user is trying to read.
        */}
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search name, symbol or address"
          aria-label="Search assets"
          className={cn(
            'focus-ring min-h-s48 w-full rounded-card border border-solid border-surface3',
            'bg-inset px-s16 text-body2 text-neutral1 placeholder:text-neutral3',
          )}
        />

        {/* `min-h-0` is what lets a flex child actually shrink and scroll — without it the list
            grows to its content and pushes the dialog past its own height cap. */}
        <div className="-mx-s4 min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col gap-s8 p-s4">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton key={index} style={{ opacity: (5 - index) / 5 }}>
                  <div className="flex items-center gap-s12 p-s8">
                    <Skeleton className="size-s40 rounded-pill" />
                    <div className="flex flex-1 flex-col gap-s4">
                      <Skeleton className="h-s16 w-[40%]" />
                      <Skeleton className="h-s12 w-[25%]" />
                    </div>
                  </div>
                </Skeleton>
              ))}
            </div>
          ) : results.length === 0 ? (
            <EmptyResults hadTokens={tokens.length > 0} query={query} />
          ) : (
            <ul className="flex flex-col">
              {results.map((token) => (
                <li key={token.address}>
                  <TokenRow
                    token={token}
                    selected={selectedAddress === token.address}
                    balance={balanceFor?.(token) ?? null}
                    onSelect={() => {
                      onSelect(token)
                      onOpenChange(false)
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ResponsiveDialog>
  )
}

function TokenRow({
  token,
  selected,
  balance,
  onSelect,
}: {
  token: TokenInfo
  selected: boolean
  balance: string | null
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'focus-ring flex w-full items-center gap-s12 rounded-card p-s8 text-left',
        'transition-colors duration-[var(--transition-duration-simple)] hover:bg-inset',
        selected && 'bg-inset',
      )}
    >
      <TokenLogo url={token.logoUri} symbol={token.symbol} name={token.name} size={40} />

      <span className="flex min-w-0 flex-1 flex-col">
        {/* NAME over SYMBOL, which is Uniswap's order and the right one: the name is what a
            person is looking for and the symbol is how they confirm it. */}
        <Text variant="body2" className="truncate text-neutral1">
          {token.name}
        </Text>
        <Text variant="body4" className="text-neutral2">
          {token.symbol}
        </Text>
      </span>

      {balance !== null ? (
        <Text variant="body3" className="numeric shrink-0 text-neutral1">
          {balance}
        </Text>
      ) : null}
    </button>
  )
}

/**
 * Two different empty states, deliberately — Uniswap keeps them separate and the reason is that
 * "there is nothing" and "your search hid everything" need different actions from the reader.
 */
function EmptyResults({ hadTokens, query }: { hadTokens: boolean; query: string }) {
  if (hadTokens) {
    return (
      <Text variant="body2" className="block px-s16 py-s20 text-center text-neutral2">
        {`No asset matches “${query.trim()}”.`}
      </Text>
    )
  }
  return (
    <div className="flex flex-col items-center gap-s8 px-s16 py-s40 text-center">
      <Text variant="subheading2" className="text-neutral1">
        No assets to show
      </Text>
      <Text variant="body3" className="text-neutral2">
        The asset list could not be read, so nothing here is a claim about what is tradeable.
      </Text>
    </div>
  )
}
