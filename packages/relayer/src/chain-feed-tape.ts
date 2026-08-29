// The activity tape: the app contracts' event selectors and one raw event → one tape row.
import type { TapeItem } from '../../protocol/src/chain-feed-wire.js'

export type TapeSource = 'markets' | 'launch' | 'governance'

// Pinned like `SELECTOR` in app-reads.ts; each equals `hash.getSelectorFromName(name)`.
export const EVENT_KEY = {
  MarketCreated: '0x15d762f1fc581b3e684cf095d93d3a2c10754f60124b09bec8bf3d76473baaf',
  BetPlaced: '0x3714964c81efee0fe58ac4504b7913e0e777e5d0f90ab45fc44568dd4ca88c1',
  MarketResolved: '0x3a69063a7ce6bf68928eda97af8f80e63b16ada5f75dacc66f432ab2683963',
  MarketVoided: '0x22e796813637e01cc55546e5af27911e667117f1ddf02dad9709e6194aeb423',
  Claimed: '0x35cc0235f835cc84da50813dc84eb10a75e24a21d74d6d86278c0f037cb7429',
  CashedOut: '0x1e27bebcd46bc944065dc93e3f3b8d71b4ffe68d6cfca1ee14301239a41b01f',
  LaunchCreated: '0x357d68fbe7a6a30028c88b1094efd4614d9eed65cf27f0d40da9c405a629a12',
  Bought: '0x20cb8131637de1953a75938db3477cc6b648e5ed255f5b3fe3f0fb9299f0afc',
  Graduated: '0x36c2bc6e1f3df003a7f84d1a6f715017a63a49e4cf2f4d6c448a3b271423543',
  Failed: '0x29b6695cc078fec6f5eaa1763a4568ff856dfa63ebfa86719d6a43e911ffb23',
  Redeemed: '0x23e7cec2fb91669c83bda0a76c5b9291e64043ae4d6c7dece25843a6a1124ae',
  Refunded: '0x1e3aa8099bfbb7b9fee513355876c379349ac1dca81cd9eb4e0653e784ff985',
  HouseCreated: '0x2553dfcdac928ed8545204c4385fa899d589476a55fae013f5c53a0718c919f',
  ProposalCreated: '0x2c0d1d9d0efb5c7398b67924974bb430e0de82d366c7ee89e068943383c0181',
  BallotCast: '0x22533cc45c07d80b456838832204cdd6d1f5a258aea753af84470c65b830573',
  Joined: '0xe186c9f9ae6099cab4fdeed472d27d45d775496082bf874ded47d4058dfc7c',
  TreasuryFunded: '0x314a49f14ef9154e2bc7f4f0c7b6453d83c74e3ae63ceca7f5a1cfe209d6d5c',
  TallyPublished: '0x18f4c17a4677ce43e2ebdc7476b4c9a54407ba407d3f83ae5618780212aa137',
  KeyPublished: '0xeff458ede0c729d0265ba767fc2c494b2b9e388296fdfe9f57c18d4f02d370',
  Executed: '0x1f4317aae43f6c24b2b85c6d8b21d5fa0a28cee0476cd52ca5d60d4787aab78',
  ProposalVoided: '0x3fc7d79ef885017803ff9a4b389bcd2ab4e4d2ec92a89e6aea2557fb81bd4c7',
} as const

export interface RawEvent {
  keys?: unknown
  data?: unknown
  transaction_hash?: unknown
  block_number?: unknown
}

const toNum = (felt: string): number => Number(BigInt(felt))

const felt = (value: unknown): string | null =>
  typeof value === 'string' && /^0x[0-9a-fA-F]+$/.test(value) ? value : null

/** The pair short string, decoded so the wire carries `'BTC/USD'` and not a felt. */
function decodePairShortString(feltHex: string): string {
  let value = BigInt(feltHex)
  const bytes: number[] = []
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn))
    value >>= 8n
  }
  return String.fromCharCode(...bytes)
}

type Row = (string | null)[]
type Ctx = { id: number; d: Row; txHash: string; block: number; k: (n: keyof typeof EVENT_KEY) => boolean }
const at = (list: Row, i: number): string => list[i] as string

function marketRow({ id: marketId, d, txHash, block, k }: Ctx): TapeItem | null {
  if (k('MarketCreated') && d.length >= 7) {
    return { kind: 'market-created', marketId, pair: decodePairShortString(at(d, 0)), strike: at(d, 1), deadline: toNum(at(d, 2)), txHash, block }
  }
  if (k('BetPlaced') && d.length >= 6) {
    return { kind: 'bet', marketId, side: toNum(at(d, 0)), amount: at(d, 1), upAfter: at(d, 3), downAfter: at(d, 4), txHash, block }
  }
  if (k('MarketResolved') && d.length >= 3) {
    return { kind: 'market-resolved', marketId, winner: toNum(at(d, 0)), settlePrice: at(d, 1), txHash, block }
  }
  if (k('MarketVoided')) return { kind: 'market-voided', marketId, txHash, block }
  // Claimed and CashedOut carry the commitment in the key slot and the market id in data.
  if (k('Claimed') && d.length >= 3) {
    return { kind: 'market-claim', marketId: toNum(at(d, 0)), amount: at(d, 1), txHash, block }
  }
  if (k('CashedOut') && d.length >= 3) {
    return { kind: 'market-cashout', marketId: toNum(at(d, 0)), tickets: at(d, 1), amount: at(d, 2), txHash, block }
  }
  return null
}

function governanceRow({ id, d, txHash, block, k }: Ctx): TapeItem | null {
  if (k('HouseCreated') && d.length >= 3) return { kind: 'house-created', houseId: id, token: at(d, 0), txHash, block }
  if (k('ProposalCreated') && d.length >= 6) {
    return { kind: 'proposal-created', proposalId: id, houseId: toNum(at(d, 0)), deadline: toNum(at(d, 3)), txHash, block }
  }
  // The tape carries the PUBLIC half of a ballot only — weight and sequence, never `sealed`.
  if (k('BallotCast') && d.length >= 3) {
    return { kind: 'gov-ballot', proposalId: id, weight: at(d, 1), seq: toNum(at(d, 2)), txHash, block }
  }
  if (k('Joined') && d.length >= 1) return { kind: 'gov-joined', houseId: id, memberCount: toNum(at(d, 0)), txHash, block }
  if (k('TreasuryFunded') && d.length >= 2) {
    return { kind: 'treasury-funded', houseId: id, amount: at(d, 0), treasuryAfter: at(d, 1), txHash, block }
  }
  if (k('TallyPublished') && d.length >= 4) {
    return { kind: 'tally-published', proposalId: id, tallyFor: at(d, 0), tallyAgainst: at(d, 1), outcome: toNum(at(d, 3)), txHash, block }
  }
  if (k('KeyPublished') && d.length >= 1) return { kind: 'key-published', proposalId: id, txHash, block }
  if (k('Executed') && d.length >= 2) return { kind: 'gov-executed', proposalId: id, amount: at(d, 1), txHash, block }
  if (k('ProposalVoided')) return { kind: 'proposal-voided', proposalId: id, txHash, block }
  return null
}

function launchRow({ id: launchId, d, txHash, block, k }: Ctx): TapeItem | null {
  if (k('LaunchCreated') && d.length >= 7) return { kind: 'launch-created', launchId, deadline: toNum(at(d, 5)), txHash, block }
  if (k('Bought') && d.length >= 5) {
    return { kind: 'buy', launchId, epoch: toNum(at(d, 0)), units: toNum(at(d, 1)), cost: at(d, 2), soldAfter: toNum(at(d, 3)), txHash, block }
  }
  if (k('Graduated') && d.length >= 1) return { kind: 'graduated', launchId, token: at(d, 0), txHash, block }
  if (k('Failed') && d.length >= 2) return { kind: 'launch-failed', launchId, sold: toNum(at(d, 0)), raised: at(d, 1), txHash, block }
  if (k('Redeemed') && d.length >= 3) {
    return { kind: 'redeem', launchId: toNum(at(d, 0)), units: toNum(at(d, 1)), amount: at(d, 2), txHash, block }
  }
  if (k('Refunded') && d.length >= 2) return { kind: 'refund', launchId: toNum(at(d, 0)), amount: at(d, 1), txHash, block }
  return null
}

/** One raw event into a tape row, or null. Never throws: one undecodable event costs a row, not the feed. */
export function decodeTapeEvent(source: TapeSource, ev: RawEvent): TapeItem | null {
  if (!Array.isArray(ev.keys) || !Array.isArray(ev.data)) return null
  const keys = ev.keys.map(felt)
  const data = ev.data.map(felt)
  if (keys.some((k) => k === null) || data.some((d) => d === null)) return null
  const txHash = felt(ev.transaction_hash)
  const block = typeof ev.block_number === 'number' ? ev.block_number : null
  if (txHash === null || block === null || keys.length === 0) return null

  const key = BigInt(keys[0] as string)
  try {
    // Every event carries its entity id as the single #[key] after the selector.
    const ctx: Ctx = {
      id: keys.length > 1 ? toNum(at(keys, 1)) : 0,
      d: data,
      txHash,
      block,
      k: (name) => key === BigInt(EVENT_KEY[name]),
    }
    if (source === 'markets') return marketRow(ctx)
    if (source === 'governance') return governanceRow(ctx)
    return launchRow(ctx)
  } catch {
    return null
  }
}
