import { useState } from 'react'
import { ChevronsUpDown } from 'lucide-react'

import { TokenLogo } from '@/components/money/asset-identity'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

export interface PickableToken {
  address: string
  symbol: string
  name: string
  logoUri?: string | null
  decimals?: number | null
  /** Optional right-hand text, e.g. the held balance. */
  trailing?: string
}

export interface TokenPickerProps {
  tokens: readonly PickableToken[]
  /** The selected address, or null for none. */
  value: string | null
  onChange: (address: string) => void
  placeholder?: string
  loading?: boolean
  className?: string
}

function same(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b)
  } catch {
    return a.toLowerCase() === b.toLowerCase()
  }
}

/** Command-in-Popover token selector. Search by symbol or name. */
export function TokenPicker({ tokens, value, onChange, placeholder = 'Select a token', loading, className }: TokenPickerProps) {
  const [open, setOpen] = useState(false)
  const selected = value ? tokens.find((t) => same(t.address, value)) : undefined
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="outline" role="combobox" aria-expanded={open} className={cn('justify-between gap-2', className)} />}
      >
        {selected ? (
          <span className="flex items-center gap-2">
            <TokenLogo logoUri={selected.logoUri} symbol={selected.symbol} name={selected.name} size={20} />
            <span className="font-medium">{selected.symbol}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{loading ? 'Loading tokens…' : placeholder}</span>
        )}
        <ChevronsUpDown className="size-4 opacity-50" />
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder="Search by symbol or name" />
          <CommandList>
            <CommandEmpty>{loading ? 'Loading tokens…' : 'No token matches.'}</CommandEmpty>
            <CommandGroup>
              {tokens.map((token) => (
                <CommandItem
                  key={token.address}
                  value={`${token.symbol} ${token.name}`}
                  data-checked={selected !== undefined && same(selected.address, token.address)}
                  onSelect={() => {
                    onChange(token.address)
                    setOpen(false)
                  }}
                >
                  <TokenLogo logoUri={token.logoUri} symbol={token.symbol} name={token.name} size={24} />
                  <span className="flex flex-col leading-tight">
                    <span className="font-medium">{token.symbol}</span>
                    <span className="text-body4 text-muted-foreground">{token.name}</span>
                  </span>
                  {token.trailing ? <span className="ml-auto font-mono text-mono text-muted-foreground">{token.trailing}</span> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
