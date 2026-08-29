//
// Where a crossing can land, and how the typed address becomes a `mint_recipient`.
//
// Every domain number has a source: the five EVM rows are the sponsor's own mainnet chain table
// (`privacy-bridge` `EVM_CCTP_SOURCES_MAINNET`): Ethereum 1→0, OP Mainnet 10→2, Arbitrum One
// 42161→3, Base 8453→6, Polygon PoS 137→7. Solana is domain 5 — 270 Starknet→Solana burns have
// completed. DELIBERATELY SHORT: every extra row is one more number nobody here has checked.
//
// Browser-safe: no imports at all. The base58 decoder is hand-written so a surface can import this
// without dragging a package graph into the eager chunk.
//

/** How a destination chain spells an address. Decides both parsing and the mismatch sentence. */
export type AddressFamily = 'evm' | 'solana'

export interface BridgeDestination {
  /** Stable id used in state and in copy keys. */
  readonly key: string
  readonly name: string
  /** Circle's CCTP domain id. The eighth felt of the burn. */
  readonly domain: number
  readonly family: AddressFamily
  /** Stated where the address is typed, because a wrong-chain send is unrecoverable. */
  readonly addressHint: string
  /**
   * What is genuinely unproven about this destination, or `null`. NOT MARKETING COPY AND NOT
   * OPTIONAL: Solana carries a real gap — a fresh wallet with no USDC token account cannot
   * receive, and the helper hardcodes a zero hook payload so it cannot ask Circle to create one.
   */
  readonly caveat: string | null
}

export const DESTINATIONS: readonly BridgeDestination[] = [
  {
    key: 'base',
    name: 'Base',
    domain: 6,
    family: 'evm',
    addressHint: '0x followed by 40 hex characters',
    caveat: null,
  },
  {
    key: 'arbitrum',
    name: 'Arbitrum One',
    domain: 3,
    family: 'evm',
    addressHint: '0x followed by 40 hex characters',
    caveat: null,
  },
  {
    key: 'optimism',
    name: 'OP Mainnet',
    domain: 2,
    family: 'evm',
    addressHint: '0x followed by 40 hex characters',
    caveat: null,
  },
  {
    key: 'polygon',
    name: 'Polygon',
    domain: 7,
    family: 'evm',
    addressHint: '0x followed by 40 hex characters',
    caveat: null,
  },
  {
    key: 'ethereum',
    name: 'Ethereum',
    domain: 0,
    family: 'evm',
    addressHint: '0x followed by 40 hex characters',
    caveat: null,
  },
  {
    key: 'solana',
    name: 'Solana',
    domain: 5,
    family: 'solana',
    addressHint: 'a base58 account address, 32 bytes',
    caveat:
      'USDC arrives on Solana only if this address already holds a USDC token account. A brand-new ' +
      'wallet does not have one, and the delivery waits — the burn has happened and cannot be ' +
      'refunded, though the transfer stays claimable once the account exists. Nobody in this ' +
      'project has tested a first-time Solana address.',
  },
]

export function destinationFor(key: string): BridgeDestination | null {
  return DESTINATIONS.find((d) => d.key === key) ?? null
}

// ── The destination address ───────────────────────────────────────────────────────────────

export type DestinationResult =
  /** `mintRecipient` is the u256 CCTP mints to: for EVM the address's own numeric value. */
  | { readonly state: 'ok'; readonly mintRecipient: bigint }
  /** `because` is a whole sentence, safe to render on the field. */
  | { readonly state: 'refused'; readonly because: string }

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

/** Base58 → bytes. `null` for anything invalid — half a pasted address is the normal case. */
function base58Bytes(input: string): Uint8Array | null {
  if (input === '') return null
  // Leading '1's are leading zero bytes by definition and carry no numeric weight.
  let zeros = 0
  while (zeros < input.length && input[zeros] === '1') zeros++

  let value = 0n
  for (const character of input) {
    const digit = BASE58.indexOf(character)
    if (digit === -1) return null
    value = value * 58n + BigInt(digit)
  }

  const body: number[] = []
  while (value > 0n) {
    body.unshift(Number(value & 0xffn))
    value >>= 8n
  }
  return new Uint8Array([...new Array<number>(zeros).fill(0), ...body])
}

/**
 * Turn what somebody typed into the `mint_recipient`, or say why it cannot be one.
 *
 * The chain and the address are checked TOGETHER: a Solana address pasted while Base is selected
 * is a perfectly valid address of the wrong kind, so the string is held to the selected chain's
 * family and the refusal names both halves.
 */
export function parseDestination(
  destination: string,
  chain: BridgeDestination,
): DestinationResult {
  const typed = destination.trim()
  if (typed === '') return { state: 'refused', because: 'Enter a destination address' }

  if (chain.family === 'evm') {
    if (!EVM_ADDRESS.test(typed)) {
      const looksSolana = base58Bytes(typed)?.length === 32
      return {
        state: 'refused',
        because: looksSolana
          ? `That is a Solana address, and this crossing is going to ${chain.name}. Switch the chain or paste an address that starts with 0x.`
          : `${chain.name} wants ${chain.addressHint}.`,
      }
    }
    // The numeric value of the 20-byte address IS the left-padded bytes32 mint recipient.
    const mintRecipient = BigInt(typed)
    if (mintRecipient === 0n) {
      return { state: 'refused', because: 'That is the zero address. USDC sent there is destroyed.' }
    }
    return { state: 'ok', mintRecipient }
  }

  const bytes = base58Bytes(typed)
  if (bytes === null || bytes.length !== 32) {
    const looksEvm = EVM_ADDRESS.test(typed)
    return {
      state: 'refused',
      because: looksEvm
        ? `That is an EVM address, and this crossing is going to ${chain.name}. Switch the chain or paste a base58 account address.`
        : `${chain.name} wants ${chain.addressHint}.`,
    }
  }
  let mintRecipient = 0n
  for (const byte of bytes) mintRecipient = (mintRecipient << 8n) | BigInt(byte)
  if (mintRecipient === 0n) {
    return { state: 'refused', because: 'That is the all-zero account. USDC sent there is destroyed.' }
  }
  return { state: 'ok', mintRecipient }
}
