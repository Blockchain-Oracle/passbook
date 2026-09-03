import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { notify } from '@/lib/notify'
import { sameAddress } from '@strk20/protocol/address'
import { STRK_TOKEN } from '@strk20/protocol/constants'

import type { ShieldDoor } from './money-field'
import type { ShieldDialogProps } from './shield-dialog'
import { shieldProblem, useShield } from '@/mutations'
import { publicBalancesQuery, publicTokenSet, type PublicBalances } from '@/queries/public-balances'

/** Keys are spelled as the token set spelled them; compare as felts, never as strings. */
function lookup(balances: PublicBalances | undefined, token: string): bigint | null {
  if (!balances) return null
  const key = Object.keys(balances).find((candidate) => sameAddress(candidate, token))
  return key === undefined ? null : balances[key]!
}

/** The minimum a token must tell this hook. `SwapSide` satisfies it; so does an Earn market. */
export interface ShieldableToken {
  address: string
  symbol: string
  decimals: number | null
  logoUri?: string | null
}

export interface ShieldDoorInput {
  /** The token being spent from the shielded side. */
  sell: ShieldableToken
  /** How much shielded is missing, or `null` when the sell fits. */
  shortfallWei: bigint | null
  address: string | undefined
}

/**
 * The door from a short shielded balance to the public one that could cover it. Offered only when
 * the public read succeeded AND covers the gap; the dialog's own review handles the fee and the
 * "this deposit is public" warning.
 *
 * It lives here rather than in `features/swap` because it is not about swapping. Any surface that
 * spends from the shielded side has the same dead end — you hold the token publicly, the field says
 * you have nothing, and there is no route from one to the other. Earn shipped with exactly that
 * dead end because this hook was somewhere it could not be found.
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
    decimals: sell.decimals ?? 0,
    logoUri: sell.logoUri ?? null,
    publicWei,
    publicStrkWei,
    busy: shield.isPending,
    problem: shieldProblem(shield.data),
    onShield: (ask) =>
      shield.mutate(ask, {
        onSuccess: (result) => {
          if (!result.ok) return
          setOpen(false)
          notify.settled(`Shielded ${sell.symbol}`, {
            description: 'The note is in the pool. Your shielded balance refreshes on the next read.',
            hash: result.transactionHash,
          })
        },
      }),
  }

  return { door, dialogProps }
}
