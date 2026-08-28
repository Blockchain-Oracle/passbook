import { useMutation } from '@tanstack/react-query'
import { encodeByteArray } from '@strk20/protocol/app-reads'
import { STRK_TOKEN } from '@strk20/protocol/constants'
import { HOUSE_COUNTING, HOUSE_MEMBERSHIP, PROPOSAL_ACTION, PROPOSAL_MODE } from '@strk20/protocol/governance-reads'

import { getSessionSnapshot } from '@/app/session'
import { RelayerError, relayerPost } from '@/lib/relayer'
import { hex, invalidateVenues, invokeSponsoredOrDirect } from '@/mutations'
import { appContracts, governanceWrites } from '@/queries'
import { addStoredPosition, relabelStoredPosition, removeStoredPosition } from '@/queries/positions'

export interface CreateHouseAsk {
  name: string
  /** Quorum in STRK base units; ignored in member mode (the contract takes 2 voices). */
  quorumWei: bigint
  thresholdPct: number
  invite: boolean
  memberVotes: boolean
}

export type CreateHouseOutcome =
  | { ok: true; transactionHash: string; inviteSecret: string | null }
  | { ok: false; because: string }

function gate(): { ok: true; accountKey: string; address: string; contract: string } | { ok: false; because: string } {
  const safety = governanceWrites()
  if (!safety.enabled) return { ok: false, because: safety.because }
  const session = getSessionSnapshot()
  if (session.status !== 'ready' || !session.address || !session.accountKey) {
    return { ok: false, because: 'This browser has no account yet.' }
  }
  const contract = appContracts().governance
  if (!contract) return { ok: false, because: 'The Governance deployment is missing from this build.' }
  return { ok: true, accountKey: session.accountKey, address: session.address, contract }
}

/**
 * `create_house`: the founder is a commitment, and an invite House mints its door key HERE. The
 * chain holds only the poseidon; the secret is shown once and never stored — losing it locks the door.
 */
async function createHouse(ask: CreateHouseAsk): Promise<CreateHouseOutcome> {
  const g = gate()
  if (!g.ok) return g
  const { mintPositionSecret } = await import('@strk20/protocol/commitment')
  const creator = mintPositionSecret()
  const door = ask.invite ? mintPositionSecret() : null
  const name = ask.name.trim()
  const calldata = [
    STRK_TOKEN,
    hex(ask.memberVotes ? 2n : ask.quorumWei),
    hex(Math.round(ask.thresholdPct * 100)),
    hex(ask.memberVotes ? HOUSE_COUNTING.member : HOUSE_COUNTING.weighted),
    hex(ask.invite ? HOUSE_MEMBERSHIP.invite : HOUSE_MEMBERSHIP.open),
    door ? door.commitment : '0x0',
    ...encodeByteArray(name),
    creator.commitment,
  ]
  // The founder's claim — stored BEFORE submit, like every bearer position: a House that lands
  // while the tab is closing must still have its founder secret here.
  await addStoredPosition({
    venue: 'governance',
    kind: 'gov-founder',
    id: -1,
    secret: creator.secret,
    commitment: creator.commitment,
    createdAt: Date.now(),
    label: `Founder of ${name}`,
  })
  const outcome = await invokeSponsoredOrDirect(
    g.accountKey,
    g.address,
    { contractAddress: g.contract, entrypoint: 'create_house', calldata },
    `Create House ${name}`,
  )
  if (outcome.ok) {
    await relabelStoredPosition(creator.commitment, { txHash: outcome.transactionHash })
    return { ok: true, transactionHash: outcome.transactionHash, inviteSecret: door?.secret ?? null }
  }
  // Only a refusal with nothing broadcast frees the claim; confirmation-unknown keeps it.
  if (outcome.transactionHash) await relabelStoredPosition(creator.commitment, { txHash: outcome.transactionHash })
  else await removeStoredPosition(creator.commitment)
  return outcome
}

export function useCreateHouse() {
  return useMutation({ mutationKey: ['houses', 'create'], mutationFn: createHouse, onSettled: () => void invalidateVenues() })
}

export interface ProposeAsk {
  houseId: number
  question: string
  permanent: boolean
  abstain: boolean
  /** Voting window in seconds. */
  windowSeconds: number
  spend: { amountWei: bigint; recipient: string } | null
}

export type ProposeOutcome = { ok: true; transactionHash: string } | { ok: false; because: string }

export const NO_TELLER = 'This deployment has no Teller. Without a Teller nobody can count a sealed vote — the proposal was not made.'

/** The Teller mints the key this vote seals to. 404 = this deployment cannot count votes. */
async function fetchTallyKey(): Promise<{ ok: true; tallyKey: string } | { ok: false; because: string }> {
  try {
    const body = await relayerPost<{ tallyKey?: string }>('/api/govern/tally-key', {})
    if (typeof body.tallyKey !== 'string') return { ok: false, because: 'No tally key came back: the answer was not in the expected shape.' }
    return { ok: true, tallyKey: body.tallyKey }
  } catch (error) {
    if (error instanceof RelayerError && error.status === 404) return { ok: false, because: NO_TELLER }
    return { ok: false, because: `No tally key came back: ${error instanceof Error ? error.message : 'the Teller could not be reached'}` }
  }
}

async function propose(ask: ProposeAsk): Promise<ProposeOutcome> {
  const g = gate()
  if (!g.ok) return g
  const key = await fetchTallyKey()
  if (!key.ok) return key
  const deadline = Math.floor(Date.now() / 1000) + ask.windowSeconds
  const calldata = [
    hex(ask.houseId),
    hex(ask.permanent ? PROPOSAL_MODE.permanent : PROPOSAL_MODE.secretUntilClose),
    hex(ask.abstain ? 3 : 2),
    hex(deadline),
    key.tallyKey,
    hex(ask.spend ? PROPOSAL_ACTION.spend : PROPOSAL_ACTION.text),
    hex(ask.spend ? ask.spend.amountWei : 0n),
    ask.spend ? ask.spend.recipient.trim() : '0x0',
    ...encodeByteArray(ask.question.trim()),
  ]
  return invokeSponsoredOrDirect(g.accountKey, g.address, { contractAddress: g.contract, entrypoint: 'propose', calldata }, 'Open a proposal')
}

export function usePropose() {
  return useMutation({ mutationKey: ['houses', 'propose'], mutationFn: propose, onSettled: () => void invalidateVenues() })
}
