//
// The share DTO: exactly what a shared position reveals, and nothing else (AD-7).
//
// Built from NAMED SCALARS — never from a receipt object — so a field added to the receipt
// later cannot leak into a card by spread. Parsed EXACTLY: unknown keys are refused, because a
// card that carries something this file does not name is a card this file cannot vouch for.
// Forbidden by construction: an address, a secret, a label, a balance, a peer, a timestamp of
// when this browser looked. A leaf — no imports.
//

export type ShareTerminalKind = 'claimed' | 'residual' | 'refunded' | 'cashed-out' | 'lost' | 'spent-elsewhere'

export interface PositionShare {
  readonly v: 1
  readonly chainId: string
  readonly contract: string
  readonly marketId: number
  readonly pair: string
  readonly side: number
  /** Canonical integer, as a string. */
  readonly cashIn: string
  readonly token: string
  readonly symbol: string
  readonly decimals: number | null
  /** Pragma 8-decimal fixed point, as a string. `'0'` = the line was not yet locked. */
  readonly strike: string
  readonly deadline: number
  readonly commitment: string
  readonly openingTxHash: string
  readonly openingBlock: number | null
  readonly terminal: {
    readonly kind: ShareTerminalKind
    readonly amount: string | null
    readonly txHash: string | null
    readonly block: number | null
  } | null
}

const KEYS = ['v', 'chainId', 'contract', 'marketId', 'pair', 'side', 'cashIn', 'token', 'symbol', 'decimals', 'strike', 'deadline', 'commitment', 'openingTxHash', 'openingBlock', 'terminal'] as const
const TERMINAL_KEYS = ['kind', 'amount', 'txHash', 'block'] as const
const KINDS: readonly ShareTerminalKind[] = ['claimed', 'residual', 'refunded', 'cashed-out', 'lost', 'spent-elsewhere']
const FELT = /^0x[0-9a-fA-F]{1,64}$/
const INT = /^[0-9]{1,78}$/

/** A fresh object from named scalars. The only way a `PositionShare` comes to exist. */
export function positionShareOf(input: {
  chainId: string
  contract: string
  marketId: number
  pair: string
  side: number
  cashIn: string
  token: string
  symbol: string
  decimals: number | null
  strike: string
  deadline: number
  commitment: string
  openingTxHash: string
  openingBlock: number | null
  terminal: PositionShare['terminal']
}): PositionShare {
  return {
    v: 1,
    chainId: input.chainId,
    contract: input.contract,
    marketId: input.marketId,
    pair: input.pair,
    side: input.side,
    cashIn: input.cashIn,
    token: input.token,
    symbol: input.symbol,
    decimals: input.decimals,
    strike: input.strike,
    deadline: input.deadline,
    commitment: input.commitment,
    openingTxHash: input.openingTxHash,
    openingBlock: input.openingBlock,
    terminal: input.terminal ? { kind: input.terminal.kind, amount: input.terminal.amount, txHash: input.terminal.txHash, block: input.terminal.block } : null,
  }
}

const isBlock = (v: unknown): v is number | null => v === null || (typeof v === 'number' && Number.isInteger(v) && v >= 0)

function exactKeys(value: object, allowed: readonly string[]): boolean {
  const keys = Object.keys(value)
  return keys.length === allowed.length && keys.every((k) => (allowed as readonly string[]).includes(k))
}

/** Exact: the right keys, each the right shape, no more. Returns a fresh object or `null`. */
export function parsePositionShare(value: unknown): PositionShare | null {
  if (!value || typeof value !== 'object' || !exactKeys(value, KEYS)) return null
  const s = value as Record<string, unknown>
  if (s.v !== 1) return null
  if (typeof s.chainId !== 'string' || !FELT.test(s.chainId)) return null
  if (typeof s.contract !== 'string' || !FELT.test(s.contract)) return null
  if (typeof s.marketId !== 'number' || !Number.isInteger(s.marketId) || s.marketId < 0) return null
  if (typeof s.pair !== 'string' || s.pair.length === 0 || s.pair.length > 16) return null
  if (typeof s.side !== 'number' || !Number.isInteger(s.side) || s.side < 0) return null
  if (typeof s.cashIn !== 'string' || !INT.test(s.cashIn)) return null
  if (typeof s.token !== 'string' || !FELT.test(s.token)) return null
  if (typeof s.symbol !== 'string' || s.symbol.length > 16) return null
  if (s.decimals !== null && (typeof s.decimals !== 'number' || !Number.isInteger(s.decimals) || s.decimals < 0 || s.decimals > 36)) return null
  if (typeof s.strike !== 'string' || !INT.test(s.strike)) return null
  if (typeof s.deadline !== 'number' || !Number.isInteger(s.deadline) || s.deadline < 0) return null
  if (typeof s.commitment !== 'string' || !FELT.test(s.commitment)) return null
  if (typeof s.openingTxHash !== 'string' || !FELT.test(s.openingTxHash)) return null
  if (!isBlock(s.openingBlock)) return null
  let terminal: PositionShare['terminal'] = null
  if (s.terminal !== null) {
    if (!s.terminal || typeof s.terminal !== 'object' || !exactKeys(s.terminal, TERMINAL_KEYS)) return null
    const t = s.terminal as Record<string, unknown>
    if (!KINDS.includes(t.kind as ShareTerminalKind)) return null
    if (t.amount !== null && (typeof t.amount !== 'string' || !INT.test(t.amount))) return null
    if (t.txHash !== null && (typeof t.txHash !== 'string' || !FELT.test(t.txHash))) return null
    if (!isBlock(t.block)) return null
    terminal = { kind: t.kind as ShareTerminalKind, amount: t.amount as string | null, txHash: t.txHash as string | null, block: t.block as number | null }
  }
  return positionShareOf({
    chainId: s.chainId,
    contract: s.contract,
    marketId: s.marketId,
    pair: s.pair,
    side: s.side,
    cashIn: s.cashIn,
    token: s.token,
    symbol: s.symbol,
    decimals: s.decimals as number | null,
    strike: s.strike,
    deadline: s.deadline,
    commitment: s.commitment,
    openingTxHash: s.openingTxHash,
    openingBlock: s.openingBlock as number | null,
    terminal,
  })
}

// ── Words, for the text share and the card ─────────────────────────────────────────────

export const SHARE_SIDE: Record<number, string> = { 0: 'Under', 1: 'Over' }

export const SHARE_OUTCOME: Record<ShareTerminalKind, string> = {
  claimed: 'Won',
  residual: 'Residual',
  refunded: 'Refunded',
  'cashed-out': 'Sold back',
  lost: 'Lost',
  'spent-elsewhere': 'Settled',
}

/** A canonical integer in the token's unit, trimmed; raw units when the unit is unknown. */
export function shareUnits(amount: string, decimals: number | null, symbol: string): string {
  if (decimals === null) return `${amount} units`
  const negative = amount.startsWith('-')
  const digits = (negative ? amount.slice(1) : amount).padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const frac = digits.slice(digits.length - decimals).replace(/0+$/, '').slice(0, 4)
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}${frac ? `.${frac}` : ''} ${symbol}`.trim()
}

/** Pragma's 8-decimal strike as a price. */
export function shareStrike(strike: string): string {
  if (strike === '0') return 'the opening line'
  const value = Number(BigInt(strike)) / 1e8
  const decimals = value >= 1000 ? 0 : value >= 1 ? 2 : 5
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

export function shareQuestion(share: PositionShare): string {
  return `${share.pair} above ${shareStrike(share.strike)}`
}

/** The plain-text share: everything the card shows, in one line per fact. */
export function shareText(share: PositionShare): string {
  const lines = [
    `${SHARE_SIDE[share.side] ?? `Side ${share.side}`} on ${shareQuestion(share)}`,
    `Stake ${shareUnits(share.cashIn, share.decimals, share.symbol)}`,
  ]
  if (share.terminal) {
    const amount = share.terminal.amount ? ` ${shareUnits(share.terminal.amount, share.decimals, share.symbol)}` : ''
    lines.push(`${SHARE_OUTCOME[share.terminal.kind]}${amount}`)
  } else {
    lines.push('Still open')
  }
  lines.push(`Opened ${share.openingTxHash}`)
  if (share.terminal?.txHash) lines.push(`Closed ${share.terminal.txHash}`)
  lines.push('strk20.run')
  return lines.join('\n')
}
