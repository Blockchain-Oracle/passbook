import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ShieldedBalance } from '@strk20/protocol/balances'
import { STRK_TOKEN } from '@strk20/protocol/constants'

import { useSession, type Session } from '@/app/session'
import type { BalanceRow } from '@/components/money/balance-cards'
import { publicBalancesQuery, publicTokenSet, shieldedBalanceQuery, tokenListQuery } from '@/queries'
import { publicRows, shieldedRows, walletTokens, weiOf, type WalletToken } from './rows'

export interface WalletData {
  session: Session
  /** Set only while the session is `ready`. */
  address: string | undefined
  accountKey: string | undefined
  tokens: WalletToken[]
  shielded: ShieldedBalance | undefined
  shieldedRows: BalanceRow[]
  publicRows: BalanceRow[]
  /** Public STRK at the address — what a shield's pool fee is paid from. `null` = unread. */
  publicStrkWei: bigint | null
  headBlock: number | null
  loading: boolean
  refetch: () => void
}

/** Every read the wallet home shows, composed once so the triptych and its doors agree. */
export function useWalletData(): WalletData {
  const session = useSession()
  const ready = session.status === 'ready'
  const address = ready ? session.address : undefined
  const accountKey = ready ? session.accountKey : undefined

  const list = useQuery(tokenListQuery())
  const shielded = useQuery(shieldedBalanceQuery(address, accountKey))

  const tokens = useMemo(() => walletTokens(list.data, shielded.data), [list.data, shielded.data])
  const publicSet = useMemo(() => publicTokenSet(tokens.map((row) => row.token)), [tokens])
  const publics = useQuery(publicBalancesQuery(address, publicSet))

  const shieldedList = useMemo(
    () => shieldedRows(tokens, shielded.data, shielded.isError),
    [tokens, shielded.data, shielded.isError],
  )
  const publicList = useMemo(() => publicRows(tokens, publics.data, publics.isError), [tokens, publics.data, publics.isError])

  return {
    session,
    address,
    accountKey,
    tokens,
    shielded: shielded.data,
    shieldedRows: shieldedList,
    publicRows: publicList,
    publicStrkWei: weiOf(publicList, STRK_TOKEN),
    headBlock: shielded.data?.blockNumber ?? null,
    loading: shielded.isPending || publics.isPending,
    refetch: () => {
      void shielded.refetch()
      void publics.refetch()
    },
  }
}
