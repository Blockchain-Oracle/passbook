import { useState } from 'react'
import { EARN_UNDERLYING } from '@strk20/protocol/earn-markets'

import { useShieldDoor } from '@/components/money/use-shield-door'
import type { EarnState } from './use-earn-state'

const USDC = { address: EARN_UNDERLYING, symbol: 'USDC', decimals: 6, logoUri: null }

/**
 * Earn's route from public USDC into the shielded side.
 *
 * Two ways in, because they answer different moments. `door` is the in-field offer that appears
 * once a typed amount exceeds the shielded balance — the swap behaviour. `open()` is the standing
 * one, for the row that shows a public balance before anything has been typed at all: an account
 * holding USDC publicly and nothing shielded has no amount to type yet, and every control on the
 * form is dead until it does.
 */
export function useEarnShieldDoor(s: EarnState) {
  const [manual, setManual] = useState(false)
  const inner = useShieldDoor({ sell: USDC, shortfallWei: s.shortfallWei, address: s.address })
  return {
    door: inner.door,
    open: () => setManual(true),
    dialogProps: {
      ...inner.dialogProps,
      open: inner.dialogProps.open || manual,
      onOpenChange: (next: boolean) => {
        setManual(next)
        inner.dialogProps.onOpenChange(next)
      },
    },
  }
}
