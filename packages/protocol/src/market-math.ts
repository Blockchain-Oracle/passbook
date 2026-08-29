//
// The ticket machine's arithmetic, mirrored from `markets.cairo` so a card can show what a stake
// would buy without a round trip per card. Every rounding matches the contract: kept reserves
// round UP, so tickets round DOWN. The contract's `quote_bet` remains the number a ticket is
// confirmed against; this is the number a glance is allowed to show.
//

export type Side = 0 | 1

/** Tickets for staking `stake` on `side` against reserves `up`/`down` with invariant `k`. */
export function ticketsFor(up: bigint, down: bigint, k: bigint, side: Side, stake: bigint): bigint {
  if (stake <= 0n) return 0n
  const upFunded = up + stake
  const downFunded = down + stake
  const [bought, other] = side === 1 ? [upFunded, downFunded] : [downFunded, upFunded]
  if (other === 0n) return 0n
  const quotient = k / other
  const kept = k % other === 0n ? quotient : quotient + 1n
  return kept >= bought ? 0n : bought - kept
}

/**
 * "1 STRK pays 1.92" — the multiple a unit stake returns if it wins, for a card's two doors.
 * `unit` is one whole token in wei; the machine is quoted at that size, not at dust.
 */
export function payoutMultiple(up: bigint, down: bigint, k: bigint, side: Side, unit: bigint, vigBps = 0): number {
  const stake = unit - (unit * BigInt(vigBps)) / 10_000n
  const tickets = ticketsFor(up, down, k, side, stake)
  if (tickets === 0n) return 0
  return Number((tickets * 1000n) / unit) / 1000
}
