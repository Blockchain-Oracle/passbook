import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { sameAddress } from '@strk20/protocol/address'
import { STRK_TOKEN } from '@strk20/protocol/constants'

import type { ShieldDoor } from '@/components/money/money-field'
import type { ShieldDialogProps } from '@/components/money/shield-dialog'
import { shieldProblem, useShield } from '@/mutations'
import { publicBalancesQuery, publicTokenSet, type PublicBalances } from '@/queries/public-balances'
import type { SwapSide } from './sides'

/** Keys are spelled as the token set spelled them; compare as felts, never as strings. */
function lookup(balances: PublicBalances | undefined, token: string): bigint | null {
  if (!balances) return null
  const key = Object.keys(balances).find((candidate) => sameAddress(candidate, token))
  return key === undefined ? null : balances[key]!
}

export interface ShieldDoorInput {
  sell: SwapSide
  /** How much shielded is missing, or `null` when the sell fits. */
  shortfallWei: bigint | null
  address: string | undefined
}

/**
 * The door from a short shielded balance to the public one that could cover it. Offered only when
 * the public read succeeded AND covers the gap; the dialog's own review handles the fee and the
 * "this deposit is public" warning.
 */
export function useShieldDoor({ sell, shortfallWei, address }: ShieldDoorInput): { door: ShieldDoor | null; dialogProps: ShieldDialogProps } {
  const [open, setOpen] = useState(false)
  const publicBalances = useQuery(publicBalancesQuery(address, publicTokenSet([sell.address])))
  const shield = useShield()

  const publicWei = lookup(publicBalances.data, sell.address)
  const publicStrkWei = lookup(publicBalances.data, STRK_TOKEN)
  const covers = shortfallWei !== null && shortfallWei > 0n && publicWei !== null && publicWei >= shortfallWei

  const door: ShieldDoor | null = covers ? { shortfallWei, onShield: () => setOpen(true) } : null

  const dialogProps: ShieldDialogProps = {
    open,
    onOpenChange: setOpen,
    token: sell.address,
    symbol: sell.symbol,
    decimals: sell.decimals,
    logoUri: sell.logoUri,
    publicWei,
    publicStrkWei,
    busy: shield.isPending,
    problem: shieldProblem(shield.data),
    onShield: (ask) =>
      shield.mutate(ask, {
        onSuccess: (result) => {
          if (!result.ok) return
          setOpen(false)
          toast.success(`Shielded ${sell.symbol}`, { description: 'The note is in the pool. Your shielded balance refreshes on the next read.' })
        },
      }),
  }

  return { door, dialogProps }
}
