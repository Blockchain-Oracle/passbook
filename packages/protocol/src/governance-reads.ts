//
// Reading the Governance contract — the browser's view of the Houses. `app-reads.ts`'s
// discipline verbatim: raw `starknet_call` over `fetch` with pinned selectors (held to
// `getSelectorFromName` by `governance-reads.test.ts`), decoders transcribed field-for-field
// from the Cairo structs, and half-failures reported as rows-plus-a-sentence.
//
import { NET } from './constants.js'
import { decodeByteArray, defaultTransport, type Transport } from './app-reads.js'

export const GOV_SELECTOR = {
  house_count: '0x114f343c7aa6468376d6821cdaf564ef8472cafe7a706e844d2e0c5821b0836',
  get_house: '0x2fa8ef927d045385d4a243c69182c61996dd79af975b30180b4b2e1d744bfde',
  house_metadata: '0x3fc18a973f85e83250a724b84a2dec16c3c2d6bbb036abd7f85ce296d26b57b',
  proposal_count: '0x14022f36114c145f67b95549237b1a17b3243c1a7a6bc8200b406efb9626d58',
  get_proposal: '0x18f60c3bdb1df95563770826ad07ecaf06d10e719f6506a4bcf38d415114fda',
  proposal_metadata: '0x39a71754ab406e1729807ba4097f24e1d1a153cb2629cfe11c375678b9b62ee',
  get_ballot: '0x3576fff913f6a4bbeffb81315974aed151b620265662f7810c46523f630eeb6',
  get_accumulator: '0x67a88b6f5f72e48c3834c17b60419d473277e43a3cb1bacf05b1a40042944a',
  pot_of: '0x2396a1d812f00126bad2e94508dd8a1252ffa1cba0eabf00f68ae9d663fd978',
  is_member: '0x3520f40cde5a37d7f97fdb31d9893d05baa70a1fca6e3dd0a24cf784def11d6',
  get_escrow: '0x275a3ba0c3a920dc9a4c088eca3f23addb8c049d79b76c10226c5343856d49e',
} as const

// ── Contract vocabulary, transcribed from `governance.cairo`. ─────────────────────────────
export const HOUSE_COUNTING = { weighted: 1, member: 2 } as const
export const HOUSE_MEMBERSHIP = { open: 1, invite: 2 } as const
export const PROPOSAL_STATE = {
  none: 0,
  active: 1,
  succeeded: 2,
  defeated: 3,
  executed: 4,
  voided: 5,
} as const
export const PROPOSAL_MODE = { secretUntilClose: 1, permanent: 2 } as const
export const PROPOSAL_ACTION = { text: 1, spend: 2 } as const

/** One House, decoded. Field names follow `HouseInfo` verbatim; `metadata` rides beside it. */
export interface OnChainHouse {
  id: number
  token: string
  quorum: bigint
  thresholdBps: number
  counting: number
  membership: number
  memberCount: number
  treasury: bigint
  state: number
  /** The House's metadata URI — `ipfs://CID` once M3's pipeline writes one, or plain text. */
  metadata: string
}

/** One proposal, decoded — `Proposal`'s declaration order. */
export interface OnChainProposal {
  id: number
  houseId: number
  mode: number
  options: number
  deadline: number
  tallyKey: bigint
  publishedKey: bigint
  quorum: bigint
  thresholdBps: number
  actionKind: number
  actionAmount: bigint
  actionRecipient: string
  state: number
  totalWeight: bigint
  ballotCount: number
  tallyFor: bigint
  tallyAgainst: bigint
  metadata: string
}

const toBig = (felt: string): bigint => BigInt(felt)
const toNum = (felt: string): number => Number(BigInt(felt))
const hex = (value: number): string => `0x${value.toString(16)}`

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
  if (!Array.isArray(result) || result.some((f) => typeof f !== 'string')) {
    throw new Error('starknet_call returned something that is not a felt array')
  }
  return result as string[]
}

/** `HouseInfo`'s 10 felts, in declaration order. Exported for the pinned-vector test. */
export function decodeHouse(id: number, felts: readonly string[], metadata: string): OnChainHouse {
  if (felts.length < 10) throw new Error(`get_house returned ${felts.length} felts; HouseInfo is 10`)
  return {
    id,
    token: felts[0]!,
    quorum: toBig(felts[1]!),
    thresholdBps: toNum(felts[2]!),
    counting: toNum(felts[3]!),
    membership: toNum(felts[4]!),
    // invite_commitment rides felt 5 and no surface renders it — the invite is a secret.
    memberCount: toNum(felts[6]!),
    treasury: toBig(felts[7]!),
    // creator_commitment rides felt 8.
    state: toNum(felts[9]!),
    metadata,
  }
}

/** `Proposal`'s 16 felts, in declaration order. */
export function decodeProposal(id: number, felts: readonly string[], metadata: string): OnChainProposal {
  if (felts.length < 16) throw new Error(`get_proposal returned ${felts.length} felts; Proposal is 16`)
  return {
    id,
    houseId: toNum(felts[0]!),
    mode: toNum(felts[1]!),
    options: toNum(felts[2]!),
    deadline: toNum(felts[3]!),
    tallyKey: toBig(felts[4]!),
    publishedKey: toBig(felts[5]!),
    quorum: toBig(felts[6]!),
    thresholdBps: toNum(felts[7]!),
    actionKind: toNum(felts[8]!),
    actionAmount: toBig(felts[9]!),
    actionRecipient: felts[10]!,
    state: toNum(felts[11]!),
    totalWeight: toBig(felts[12]!),
    ballotCount: toNum(felts[13]!),
    tallyFor: toBig(felts[14]!),
    tallyAgainst: toBig(felts[15]!),
    metadata,
  }
}

/** Every House, newest first, capped — `readMarkets`'s shape and caveats. */
export async function readHouses(
  contract: string,
  { cap = 24, transport = defaultTransport } = {},
): Promise<{ houses: OnChainHouse[]; total: number; problem: string | null }> {
  const countFelts = await call(contract, GOV_SELECTOR.house_count, [], transport)
  const total = toNum(countFelts[0] ?? '0x0')
  const ids = Array.from({ length: Math.min(total, cap) }, (_, i) => total - 1 - i)
  const houses: OnChainHouse[] = []
  let problem: string | null = null
  for (const id of ids) {
    try {
      const [info, meta] = await Promise.all([
        call(contract, GOV_SELECTOR.get_house, [hex(id)], transport),
        call(contract, GOV_SELECTOR.house_metadata, [hex(id)], transport),
      ])
      houses.push(decodeHouse(id, info, decodeByteArray(meta).text))
    } catch (error) {
      problem = `House ${id} could not be read: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  return { houses, total, problem }
}

/** Every proposal, newest first — same grammar. */
export async function readProposals(
  contract: string,
  { cap = 24, transport = defaultTransport } = {},
): Promise<{ proposals: OnChainProposal[]; total: number; problem: string | null }> {
  const countFelts = await call(contract, GOV_SELECTOR.proposal_count, [], transport)
  const total = toNum(countFelts[0] ?? '0x0')
  const ids = Array.from({ length: Math.min(total, cap) }, (_, i) => total - 1 - i)
  const proposals: OnChainProposal[] = []
  let problem: string | null = null
  for (const id of ids) {
    try {
      const [info, meta] = await Promise.all([
        call(contract, GOV_SELECTOR.get_proposal, [hex(id)], transport),
        call(contract, GOV_SELECTOR.proposal_metadata, [hex(id)], transport),
      ])
      proposals.push(decodeProposal(id, info, decodeByteArray(meta).text))
    } catch (error) {
      problem = `Proposal ${id} could not be read: ${error instanceof Error ? error.message : String(error)}`
    }
  }
  return { proposals, total, problem }
}

/**
 * The live EC accumulators for one proposal, one `(x, y)` pair per option.
 *
 * These are the record page's verification anchors: the contract refused to publish any tally
 * whose sums did not hit these exact points (`S_i·G + R_i·H == ACC_i`, governance.cairo §6.3),
 * so rendering them beside the accepted sums is showing the reader the lock, not asking them to
 * trust the report of it. `(0, 0)` is the identity — an option no weight ever entered.
 */
export async function readAccumulators(
  contract: string,
  proposalId: number,
  options: number,
  transport: Transport = defaultTransport,
): Promise<Array<{ x: string; y: string }>> {
  const out: Array<{ x: string; y: string }> = []
  for (let option = 0; option < options; option += 1) {
    const felts = await call(contract, GOV_SELECTOR.get_accumulator, [hex(proposalId), hex(option)], transport)
    out.push({ x: felts[0] ?? '0x0', y: felts[1] ?? '0x0' })
  }
  return out
}

/** The identity's committed weight on a proposal — `get_ballot`'s public half. */
export async function readBallotWeight(
  contract: string,
  proposalId: number,
  identityKey: string,
  transport: Transport = defaultTransport,
): Promise<bigint> {
  const out = await call(contract, GOV_SELECTOR.get_ballot, [hex(proposalId), identityKey], transport)
  return toBig(out[0] ?? '0x0')
}

// ── Derivations the surfaces share ────────────────────────────────────────────────────────

/** The quorum bar, 0–100. Live participation is public while the direction stays sealed (§4.2). */
export function quorumPct(proposal: OnChainProposal): number {
  if (proposal.quorum === 0n) return 100
  const pct = Number((proposal.totalWeight * 100n) / proposal.quorum)
  return Math.min(100, pct)
}

/** The lifecycle word a card renders — Tally's vocabulary, ours to keep honest. */
export function proposalPhase(proposal: OnChainProposal, nowMs: number): string {
  if (proposal.state === PROPOSAL_STATE.active) {
    return proposal.deadline * 1000 > nowMs ? 'Sealed Ballot Box' : 'Closed · tallying'
  }
  if (proposal.state === PROPOSAL_STATE.succeeded) return 'Succeeded'
  if (proposal.state === PROPOSAL_STATE.defeated) return 'Defeated'
  if (proposal.state === PROPOSAL_STATE.executed) return 'Executed'
  if (proposal.state === PROPOSAL_STATE.voided) return 'Voided'
  return 'Unknown'
}

// Referenced so the two constants below stay importable by the eager chunk without dragging
// anything: this module is fetch-only, `app-reads.ts`'s class.
export const GOVERNANCE_READS_ARE_BROWSER_SAFE = NET.pool.length > 0
