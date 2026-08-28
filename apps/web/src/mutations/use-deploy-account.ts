import { useMutation } from '@tanstack/react-query'
import { OZ_ACCOUNT_CLASS_HASH } from '@strk20/protocol/account-address'

import { getSessionSnapshot } from '@/app/session'
import { invalidateAccount } from './invalidate'
import { embeddedAccount } from './self-submit'

export type DeployOutcome = { ok: true; transactionHash: string } | { ok: false; because: string }

/**
 * Counterfactual OZ deploy from the funded key. The derived address is checked against the
 * session's first and a mismatch STOPS: deploying elsewhere would strand whatever was sent here.
 */
async function deploy(): Promise<DeployOutcome> {
  const session = getSessionSnapshot()
  if (session.status !== 'ready' || !session.address || !session.accountKey) {
    return { ok: false, because: 'This browser has no account yet.' }
  }
  const { address, accountKey } = session
  try {
    const [{ ec, hash }, { provider, account }] = await Promise.all([
      import('starknet'),
      embeddedAccount(accountKey, address),
    ])
    const publicKey = ec.starkCurve.getStarkKey(accountKey)
    const derived = hash.calculateContractAddressFromHash(publicKey, OZ_ACCOUNT_CLASS_HASH, [publicKey], 0)
    if (BigInt(derived) !== BigInt(address)) {
      return {
        ok: false,
        because:
          'This key does not control that address, so deploying would create an account somewhere ' +
          'else and strand whatever was sent here. Refused.',
      }
    }

    const result = await account.deployAccount({
      classHash: OZ_ACCOUNT_CLASS_HASH,
      constructorCalldata: [publicKey],
      addressSalt: publicKey,
      contractAddress: address,
    })
    await provider.waitForTransaction(result.transaction_hash)

    // Read back rather than trusting the response.
    const onChain = await provider.getClassHashAt(result.contract_address)
    if (BigInt(onChain) !== BigInt(OZ_ACCOUNT_CLASS_HASH)) {
      return {
        ok: false,
        because: `The address now holds class ${onChain}, which is not the account class. Something else deployed there.`,
      }
    }
    return { ok: true, transactionHash: result.transaction_hash }
  } catch (error) {
    // The account paid for any attempt that reached the sequencer, so this says so.
    return {
      ok: false,
      because:
        error instanceof Error && error.message
          ? `The deployment did not complete: ${error.message}`
          : 'The deployment did not complete.',
    }
  }
}

export function useDeployAccount() {
  return useMutation({
    mutationKey: ['deploy-account'],
    mutationFn: deploy,
    onSettled: () => void invalidateAccount(),
  })
}
