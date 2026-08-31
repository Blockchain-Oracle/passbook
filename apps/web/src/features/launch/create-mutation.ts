// Creating a launch is a DIRECT account call (see `mutations/use-direct-invoke`): `create_launch`
// lives outside `privacy_invoke`, the CALLER's address is on the transaction, and the creator's
// CLAIM is the bearer secret stored here BEFORE anything is broadcast.
import { useMutation } from '@tanstack/react-query'
import { encodeByteArray } from '@strk20/protocol/app-reads'
import { STRK_TOKEN } from '@strk20/protocol/constants'

import { getSessionSnapshot } from '@/app/session'
import { invalidateVenues, invokeSponsoredOrDirect, type DirectOutcome } from '@/mutations'
import { appContracts } from '@/queries'
import { addStoredPosition, relabelStoredPosition, removeStoredPosition } from '@/queries/positions'

export interface CreateLaunchAsk {
  name: string
  symbol: string
  /** `ipfs://CID`, or the honest empty when nothing pinned. */
  logoUri: string
  /** Unit price in epoch 0, in stake base units. */
  priceWei: bigint
  /** Added to the unit price with each epoch. */
  stepWei: bigint
  /**
   * Spend one of this account's covered transactions instead of paying gas from it.
   * The review screen decides this; absent is `false`, which is "sign it yourself".
   */
  sponsored?: boolean
  /** Tokens sold per epoch, whole units of the new token. */
  tokensPerEpoch: number
  epochs: number
  /** Unix seconds. */
  deadline: number
}

export type CreateLaunchOutcome = DirectOutcome

async function createLaunch(ask: CreateLaunchAsk): Promise<CreateLaunchOutcome> {
  const session = getSessionSnapshot()
  if (session.status !== 'ready' || !session.address || !session.accountKey) {
    return { ok: false, because: 'This browser has no account yet.' }
  }
  const contract = appContracts().launch
  if (!contract) return { ok: false, because: 'The Launch deployment is missing from this build.' }

  const { mintPositionSecret } = await import('@strk20/protocol/commitment')
  const minted = mintPositionSecret()
  const tranche = BigInt(ask.tokensPerEpoch) * 10n ** 18n
  const calldata = [
    ...encodeByteArray(ask.name),
    ...encodeByteArray(ask.symbol),
    ...encodeByteArray(ask.logoUri),
    STRK_TOKEN,
    `0x${ask.priceWei.toString(16)}`,
    `0x${ask.stepWei.toString(16)}`,
    `0x${tranche.toString(16)}`,
    `0x${ask.epochs.toString(16)}`,
    `0x${ask.deadline.toString(16)}`,
    minted.commitment,
  ]
  // The creator's sweep claim — stored before submit: a raise whose secret was lost can never be swept.
  await addStoredPosition({
    venue: 'launch',
    kind: 'launch-founder',
    id: -1,
    secret: minted.secret,
    commitment: minted.commitment,
    createdAt: Date.now(),
    label: `Creator of ${ask.symbol} — sweeps the raise on graduation`,
  })
  const outcome = await invokeSponsoredOrDirect(
    session.accountKey,
    session.address,
    { contractAddress: contract, entrypoint: 'create_launch', calldata },
    `Create launch ${ask.symbol}`,
    ask.sponsored,
  )
  // A hash — confirmed or unknown — keeps the claim; only a refusal that broadcast nothing frees it.
  if (outcome.transactionHash) await relabelStoredPosition(minted.commitment, { txHash: outcome.transactionHash })
  else await removeStoredPosition(minted.commitment)
  return outcome
}

export function useCreateLaunch() {
  return useMutation({
    mutationKey: ['launch', 'create'],
    mutationFn: createLaunch,
    onSettled: () => void invalidateVenues(),
  })
}
