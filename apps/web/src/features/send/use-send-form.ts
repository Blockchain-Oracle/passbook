import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { insufficient, parseAmountInput } from '@strk20/protocol/amount'
import { BRIDGE_USDC, BRIDGE_USDC_DECIMALS, BRIDGE_USDC_SYMBOL } from '@strk20/protocol/bridge'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import type { PayAsset } from '@strk20/protocol/pay-link'
import { sameAddress } from '@strk20/protocol/address'

import { useSession } from '@/app/session'
import { poolHealthQuery } from '@/queries/pool'
import { publicBalancesQuery, publicTokenSet } from '@/queries/public-balances'
import { shieldedBalanceQuery } from '@/queries/shielded'
import { findToken, tokenListQuery } from '@/queries/tokens'
import { useRecipient, type RecipientStatus } from './use-recipient'

export interface SendSearch {
  to?: string
  asset?: PayAsset
  amount?: string
  note?: string
}

export interface SendAsset {
  address: string
  symbol: string
  name: string
  logoUri: string | null
  /** `null` = unverified scale; such a token is listed but cannot be sent. */
  decimals: number | null
  /** Shielded holding. `null` = the walk did not land; `0n` = walked and empty. */
  shieldedWei: bigint | null
  /** Public holding at the embedded address. `null` = unreadable. */
  publicWei: bigint | null
}

const PINNED = [
  { address: STRK_TOKEN, symbol: 'STRK', name: 'Starknet Token', decimals: 18 },
  { address: BRIDGE_USDC, symbol: BRIDGE_USDC_SYMBOL, name: 'USD Coin', decimals: BRIDGE_USDC_DECIMALS },
] as const

/** Everything the form derives. Reads are queries; the four inputs are the only local state. */
export function useSendForm(initial: SendSearch) {
  const session = useSession()
  const ready = session.status === 'ready' ? { address: session.address, accountKey: session.accountKey } : null

  const [token, setToken] = useState<string>(initial.asset === 'USDC' ? BRIDGE_USDC : STRK_TOKEN)
  const [raw, setRaw] = useState(initial.amount ?? '')
  const [recipientRaw, setRecipientRaw] = useState(initial.to ?? '')
  const [note, setNote] = useState(initial.note ?? '')

  const health = useQuery(poolHealthQuery())
  const shielded = useQuery(shieldedBalanceQuery(ready?.address, ready?.accountKey))
  const list = useQuery(tokenListQuery())
  const shieldedTokens = useMemo(() => (shielded.data?.tokens ?? []).map((t) => t.token), [shielded.data])
  const publicBalances = useQuery(publicBalancesQuery(ready?.address, publicTokenSet(shieldedTokens)))

  const assets = useMemo<SendAsset[]>(() => {
    const walked = shielded.data !== undefined && shielded.data.presence !== 'unknown'
    const publicOf = (address: string): bigint | null => {
      const table = publicBalances.data
      if (!table) return null
      const key = Object.keys(table).find((k) => sameAddress(k, address))
      return key ? (table[key] ?? null) : null
    }
    const rows: SendAsset[] = PINNED.map((p) => {
      const listed = findToken(list.data, p.address)
      const held = shielded.data?.tokens.find((t) => sameAddress(t.token, p.address))
      return {
        address: p.address,
        symbol: p.symbol,
        name: listed?.name ?? p.name,
        logoUri: listed?.logoUri ?? null,
        decimals: p.decimals,
        shieldedWei: held ? held.wei : walked ? 0n : null,
        publicWei: publicOf(p.address),
      }
    })
    for (const held of shielded.data?.tokens ?? []) {
      if (rows.some((r) => sameAddress(r.address, held.token))) continue
      const listed = findToken(list.data, held.token)
      rows.push({
        address: held.token,
        symbol: listed?.symbol ?? 'Token',
        name: listed?.name ?? held.token,
        logoUri: listed?.logoUri ?? null,
        decimals: held.decimals,
        shieldedWei: held.wei,
        publicWei: publicOf(held.token),
      })
    }
    return rows
  }, [shielded.data, list.data, publicBalances.data])

  const asset = assets.find((a) => sameAddress(a.address, token)) ?? assets[0]!
  const parsed = parseAmountInput(raw, asset.decimals)
  const short = insufficient(parsed.wei, asset.shieldedWei)
  const shortfallWei = short && parsed.wei !== null && asset.shieldedWei !== null ? parsed.wei - asset.shieldedWei : null
  const recipient = useRecipient(recipientRaw, ready?.address)
  const publicStrkWei = assets.find((a) => sameAddress(a.address, STRK_TOKEN))?.publicWei ?? null

  const blocker = reviewBlocker({
    ready: ready !== null,
    health: health.data?.state,
    walkState: shielded.data === undefined ? 'reading' : shielded.data.presence === 'unknown' ? 'unreachable' : 'walked',
    asset,
    parsedProblem: parsed.problem,
    wei: parsed.wei,
    short,
    recipient,
  })

  return {
    ready,
    assets,
    asset,
    token,
    setToken,
    raw,
    setRaw,
    parsed,
    short,
    shortfallWei,
    recipient,
    recipientRaw,
    setRecipientRaw,
    note,
    setNote,
    publicStrkWei,
    feeWei: health.data?.state === 'ok' ? health.data.feeWei : null,
    blocker,
    reset: () => {
      setRaw('')
      setRecipientRaw('')
      setNote('')
    },
  }
}

export type SendForm = ReturnType<typeof useSendForm>

interface BlockerInput {
  ready: boolean
  health: 'ok' | 'paused' | 'upgraded' | 'unreachable' | undefined
  walkState: 'reading' | 'unreachable' | 'walked'
  asset: SendAsset
  parsedProblem: string | null
  wei: bigint | null
  short: boolean
  recipient: RecipientStatus
}

/** The chain of reasons the CTA says instead of going grey. First true reason wins. */
function reviewBlocker(i: BlockerInput): string | null {
  if (!i.ready) return 'This browser has no account yet'
  if (i.health === 'paused') return 'The pool is paused'
  if (i.health === 'upgraded') return 'The pool contract changed since this build'
  if (i.walkState === 'reading') return 'Reading your balance'
  if (i.walkState === 'unreachable') return 'Your balance could not be read'
  if (i.asset.decimals === null) return `${i.asset.symbol} has an unverified scale and cannot be sent`
  if (i.parsedProblem) return i.parsedProblem
  if (i.wei === null || i.wei === 0n) return 'Enter an amount'
  if (i.short) return `Not enough shielded ${i.asset.symbol}`
  switch (i.recipient.state) {
    case 'idle':
      return 'Enter a recipient'
    case 'checking':
      return 'Checking the recipient'
    case 'invalid':
    case 'unresolved-name':
      return i.recipient.because
    case 'self':
      return 'That is your own address'
    case 'unregistered':
      return 'The recipient has no account here yet'
    case 'unreadable':
      return 'The recipient could not be checked'
    case 'registered':
      return null
  }
}
