// Browser-safe view calls for bearer positions. Secrets never enter these reads: commitments are
// already public on chain and are sufficient to look up state and quotes.
import { NET } from './constants.js'
import type { Transport } from './app-reads.js'

export const POSITION_SELECTOR = {
  get_position: '0x3b3d893679cec4ffbfdc6a8c56ac55b38ce6cc583d9341af90e623172da5570',
  quote_cashout: '0x152b141cca0687d12081166bbe624d55ae8442e8b15b008fff6d91c9b122f14',
  preview_claim: '0x216f7045c872831a74d5f1cb9f9afc20bd7005f2e6bec121e07f7e2f1f4fea6',
  preview_redeem: '0x82c661d8fec0d7c2d8de38b2276e2ae2976aee47a3860369fe9594d5dd9e45',
  preview_refund: '0x4150cb5e36e82da65ab5b8eb25fe80ebe07c1878ee64412c7aaecabc092ff5',
  get_escrow: '0x275a3ba0c3a920dc9a4c088eca3f23addb8c049d79b76c10226c5343856d49e',
} as const

export interface MarketPositionRead {
  marketId: number
  side: number
  tickets: bigint
  cashIn: bigint
  state: number
  cashoutQuote: bigint
  claimPreview: bigint
}

export interface LaunchPositionRead {
  launchId: number
  units: number
  cashIn: bigint
  state: number
  redeemPreview: bigint
  refundPreview: bigint
}

async function defaultTransport(method: string, params: unknown): Promise<unknown> {
  let last: unknown
  for (const nodeUrl of NET.rpc) {
    try {
      const response = await fetch(nodeUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      })
      if (!response.ok) throw new Error(`${nodeUrl} answered ${response.status}`)
      const body = (await response.json()) as { result?: unknown; error?: unknown }
      if (body.error) throw new Error(JSON.stringify(body.error))
      return body.result
    } catch (error) {
      last = error
    }
  }
  throw new Error(`all RPC hosts failed: ${String(last)}`)
}

async function call(
  contract: string,
  selector: string,
  calldata: readonly string[],
  transport: Transport,
): Promise<string[]> {
  const result = await transport('starknet_call', {
    request: { contract_address: contract, entry_point_selector: selector, calldata },
    block_id: 'latest',
  })
  if (!Array.isArray(result) || result.some((item) => typeof item !== 'string')) {
    throw new Error('position view returned malformed calldata')
  }
  return result as string[]
}

export async function readMarketPosition(
  contract: string,
  commitment: string,
  transport: Transport = defaultTransport,
): Promise<MarketPositionRead> {
  const [position, quote, claim] = await Promise.all([
    call(contract, POSITION_SELECTOR.get_position, [commitment], transport),
    call(contract, POSITION_SELECTOR.quote_cashout, [commitment], transport),
    call(contract, POSITION_SELECTOR.preview_claim, ['0x1', commitment], transport),
  ])
  if (position.length < 5) throw new Error(`get_position returned ${position.length} felts; Market Position is 5`)
  return {
    marketId: Number(BigInt(position[0]!)),
    side: Number(BigInt(position[1]!)),
    tickets: BigInt(position[2]!),
    cashIn: BigInt(position[3]!),
    state: Number(BigInt(position[4]!)),
    cashoutQuote: BigInt(quote[0] ?? '0x0'),
    claimPreview: BigInt(claim[0] ?? '0x0'),
  }
}

export async function readLaunchPosition(
  contract: string,
  commitment: string,
  transport: Transport = defaultTransport,
): Promise<LaunchPositionRead> {
  const [position, redeem, refund] = await Promise.all([
    call(contract, POSITION_SELECTOR.get_position, [commitment], transport),
    call(contract, POSITION_SELECTOR.preview_redeem, ['0x1', commitment], transport),
    call(contract, POSITION_SELECTOR.preview_refund, ['0x1', commitment], transport),
  ])
  if (position.length < 4) throw new Error(`get_position returned ${position.length} felts; Launch Position is 4`)
  return {
    launchId: Number(BigInt(position[0]!)),
    units: Number(BigInt(position[1]!)),
    cashIn: BigInt(position[2]!),
    state: Number(BigInt(position[3]!)),
    redeemPreview: BigInt(redeem[0] ?? '0x0'),
    refundPreview: BigInt(refund[0] ?? '0x0'),
  }
}
