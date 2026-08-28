import { useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { parseAmountInput, toPlainText } from '@strk20/protocol/amount'
import {
  BRIDGE_USDC,
  BRIDGE_USDC_DECIMALS,
  BRIDGE_USDC_SYMBOL,
  DESTINATIONS,
  OUTBOUND_ANONYMIZER,
  deliveredWei,
  destinationFor,
  parseDestination,
  type BridgeDestination,
  type ForwardFee,
} from '@strk20/protocol/bridge'
import type { CrowdReading } from '@strk20/protocol/crowd'
import { degradedCopy, degradedFromHealth } from '@strk20/protocol/degraded'
import { meterFor, type LinkabilityModel } from '@strk20/protocol/linkability'
import { INDEXER_UNREACHABLE } from '@strk20/protocol/linkability-copy'
import { selfLinkAgainst, type SelfLinkResult } from '@strk20/protocol/self-link'

import { useSession } from '@/app/session'
import { useDebounced } from '@/hooks/use-debounced'
import type { SendAsk } from '@/mutations'
import { findToken, poolHealthQuery, shieldedBalanceQuery, tokenListQuery } from '@/queries'
import { crowdQuery, forwardFeeQuery } from './queries'

const FEE_DEBOUNCE_MS = 350

export interface BridgeForm {
  chain: BridgeDestination
  setChain: (next: BridgeDestination) => void
  amount: string
  setAmount: (next: string) => void
  destination: string
  setDestination: (next: string) => void
  reset: () => void
  /** The list's logo for USDC; decimals are pinned, never the list's. */
  logoUri: string | null
  /** Shielded USDC: `undefined` not read yet, `null` unreadable, else exact. */
  heldWei: bigint | null | undefined
  amountWei: bigint | null
  amountProblem: string | null
  destinationProblem: string | null
  mintRecipient: bigint | null
  selfLink: SelfLinkResult
  fee: ForwardFee | null
  feeStale: boolean
  deliveredWei: bigint | null
  meter: LinkabilityModel
  crowdPending: boolean
  /** Why Review cannot open yet, in the order a person can act on. `null` = ready. */
  formBlocker: string | null
  /** Why confirm cannot fire inside the review. `null` = ready. */
  reviewBlocker: string | null
  /** The send, fully built, or `null` while anything above blocks it. */
  ask: SendAsk | null
  hasAccount: boolean
}

/** Every derived fact the bridge surface renders, from state the surface owns. */
export function useBridgeForm(initialChain?: string): BridgeForm {
  const [chain, setChain] = useState<BridgeDestination>(
    () => (initialChain ? destinationFor(initialChain) : null) ?? DESTINATIONS[0]!,
  )
  const [amount, setAmount] = useState('')
  const [destination, setDestination] = useState('')

  const session = useSession()
  const ready = session.status === 'ready' && session.address && session.accountKey ? session : null
  const hasAccount = ready !== null

  const tokens = useQuery(tokenListQuery())
  const balance = useQuery(shieldedBalanceQuery(ready?.address, ready?.accountKey))
  const health = useQuery(poolHealthQuery())
  const crowd = useQuery(crowdQuery())

  const logoUri = findToken(tokens.data, BRIDGE_USDC)?.logoUri ?? null

  // Tri-state kept on purpose: not read / unreadable / an exact figure. A walked wallet with no
  // USDC note is genuinely 0n; an unreachable walk is null.
  const heldWei = useMemo<bigint | null | undefined>(() => {
    if (!balance.data) return undefined
    if (balance.data.presence === 'unknown') return null
    const row = balance.data.tokens.find((t) => {
      try {
        return BigInt(t.token) === BigInt(BRIDGE_USDC)
      } catch {
        return false
      }
    })
    return row?.wei ?? 0n
  }, [balance.data])

  const parsed = useMemo(() => parseAmountInput(amount, BRIDGE_USDC_DECIMALS), [amount])
  const parsedDestination = useMemo(() => parseDestination(destination, chain), [destination, chain])
  const typed = destination.trim() !== ''
  const destinationProblem = typed && parsedDestination.state === 'refused' ? parsedDestination.because : null
  const mintRecipient = parsedDestination.state === 'ok' ? parsedDestination.mintRecipient : null

  // Against every address this browser can prove is the user's. Empty → no claim is made.
  const selfLink = useMemo(
    () => selfLinkAgainst(destination.trim(), session.accounts.map((a) => a.address)),
    [destination, session.accounts],
  )

  const settledWei = useDebounced(parsed.wei, FEE_DEBOUNCE_MS)
  const feeQuery = useQuery({ ...forwardFeeQuery(chain.domain, settledWei), placeholderData: keepPreviousData })
  const quoting = parsed.wei !== null && parsed.wei > 0n
  const feeResult = quoting ? feeQuery.data : undefined
  const fee = feeResult?.state === 'quoted' ? feeResult.fee : null
  const feeStale = quoting && (feeQuery.isPlaceholderData || feeQuery.isFetching || settledWei !== parsed.wei)
  const delivered = fee && parsed.wei !== null ? deliveredWei(parsed.wei, fee.maxFeeWei) : null

  // The count when this screen opened, so the caret can say what changed since.
  const firstCandidates = useRef<number | null>(null)
  const reading: CrowdReading = crowd.data ?? { state: 'unmeasurable', because: INDEXER_UNREACHABLE }
  if (reading.state === 'measured' && firstCandidates.current === null) firstCandidates.current = reading.candidates
  const meter = useMemo(
    () =>
      meterFor({
        reading,
        amountWei: parsed.wei,
        decimals: BRIDGE_USDC_DECIMALS,
        previousCandidates: firstCandidates.current,
      }),
    [reading, parsed.wei],
  )

  const globalBlocker = useMemo(() => {
    if (!health.data) return null
    const degraded = degradedFromHealth(health.data, typeof navigator === 'undefined' ? true : navigator.onLine, false)
    if (degraded.mode === null) return null
    const copy = degradedCopy(degraded.mode)
    return copy.scope === 'global' ? copy.blocker : null
  }, [health.data])

  const formBlocker = ((): string | null => {
    if (globalBlocker) return globalBlocker
    if (!hasAccount) return 'This browser has no account yet'
    if (parsed.problem) return parsed.problem
    if (parsed.wei === null || parsed.wei === 0n) return 'Enter an amount'
    if (typeof heldWei === 'bigint' && parsed.wei > heldWei) return `Not enough shielded ${BRIDGE_USDC_SYMBOL}`
    if (parsedDestination.state === 'refused') return parsedDestination.because
    if (feeResult === undefined) return 'Reading the bridge fee'
    if (feeResult.state === 'unavailable') return feeResult.because
    if (fee === null) return 'Reading the bridge fee'
    if (delivered === null) {
      // The helper's own `AMOUNT_LE_MAX_FEE`, said as a floor a person can act on.
      const floor = toPlainText(fee.maxFeeWei, BRIDGE_USDC_DECIMALS)
      return `Send more than ${floor} ${BRIDGE_USDC_SYMBOL} — below that the fee takes all of it`
    }
    return null
  })()

  const reviewBlocker = ((): string | null => {
    if (heldWei === undefined) return 'Reading your balance…'
    if (heldWei === null) return 'Your balance could not be read'
    if (feeStale) return 'Re-reading the fee…'
    return formBlocker
  })()

  const ask: SendAsk | null =
    formBlocker === null && reviewBlocker === null && parsed.wei !== null && mintRecipient !== null && fee !== null
      ? {
          kind: 'bridge',
          // The helper on both legs: the withdrawal lands there and the invoke burns from there.
          recipient: OUTBOUND_ANONYMIZER,
          token: BRIDGE_USDC,
          symbol: BRIDGE_USDC_SYMBOL,
          amount: parsed.wei,
          surface: 'bridge',
          bridge: {
            helper: OUTBOUND_ANONYMIZER,
            destinationDomain: chain.domain,
            mintRecipient,
            maxFeeWei: fee.maxFeeWei,
            // From the quote, never re-derived: a fee priced for one finality tier on a burn
            // declaring another is the mismatch that strands transfers.
            minFinalityThreshold: fee.finalityThreshold,
            chainName: chain.name,
          },
        }
      : null

  return {
    chain,
    setChain,
    amount,
    setAmount,
    destination,
    setDestination,
    reset: () => {
      setAmount('')
      setDestination('')
    },
    logoUri,
    heldWei,
    amountWei: parsed.wei,
    amountProblem: parsed.problem,
    destinationProblem,
    mintRecipient,
    selfLink,
    fee,
    feeStale,
    deliveredWei: delivered,
    meter,
    crowdPending: crowd.isPending,
    formBlocker,
    reviewBlocker,
    ask,
    hasAccount,
  }
}
