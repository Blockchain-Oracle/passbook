import { formatTokenAmount } from '@strk20/protocol/amount'
import { NET } from '@strk20/protocol/constants'

/**
 * A wei amount as plain text, through the protocol's own renderer so dust and unverified scales
 * follow the balance model's rules. `decimals: null` renders the raw unit count — never a guess.
 */
export function formatWei(wei: bigint, decimals: number | null, displayDecimals?: number): string {
  const rendered = formatTokenAmount(wei, decimals, displayDecimals)
  if (rendered.kind === 'raw-units') return `${rendered.sign}${rendered.units} units`
  const { sign, whole, hiddenZeros, fraction } = rendered
  if (fraction === '') return `${sign}${whole}`
  // `0.0₅1024` written out: one literal zero, then the hidden ones, then the digits.
  const zeros = hiddenZeros > 0 ? `0${'0'.repeat(hiddenZeros)}` : ''
  return `${sign}${whole}.${zeros}${fraction}`
}

/** `0x04a1…9f3c` — enough to recognise, not enough to mistake for the whole thing. */
export function shortAddress(address: string, lead = 6, tail = 4): string {
  if (address.length <= lead + tail + 1) return address
  return `${address.slice(0, lead)}…${address.slice(-tail)}`
}

export function explorerTx(hash: string): string {
  return `${NET.explorer}/tx/${hash}`
}

export function explorerAddress(address: string): string {
  return `${NET.explorer}/contract/${address}`
}
