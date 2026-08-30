import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PROVING_BLOCK_LAG } from '@strk20/protocol/constants'
import { DIRECTORY_NAME_PATTERN } from '@strk20/protocol/directory-name'
import { ONBOARDING_STAGE_NOTES, REGISTER_NEEDS_FUNDS, settleNote } from '@strk20/protocol/onboarding-copy'
import { ONBOARDING_STAGES, type OnboardingStage } from '@strk20/protocol/pipeline-stage'
import { notify } from '@/lib/notify'

import { useDeployAccount, useDirectoryClaim, useRegister } from '@/mutations'
import { accountProvableQuery, accountStatusQuery } from '@/queries'

export interface Ladder {
  /** The last entry is the rung in flight; everything before it is complete. */
  reached: OnboardingStage[]
  failedAt: OnboardingStage | null
  startedAt: number | null
  problem: string | null
  receipt: { transactionHash: string; block: number | null } | null
  /** Block the deploy landed in when this session deployed it; drives the settle countdown. */
  deployedAt: number | null
  /** Waiting for the head to pass the deploy. Polls the chain; no timer. */
  settling: boolean
  done: boolean
}

const IDLE: Ladder = {
  reached: [],
  failedAt: null,
  startedAt: null,
  problem: null,
  receipt: null,
  deployedAt: null,
  settling: false,
  done: false,
}

const RUNG = (stage: OnboardingStage): OnboardingStage[] =>
  ONBOARDING_STAGES.slice(0, ONBOARDING_STAGES.indexOf(stage) + 1)

interface LadderInput {
  address: string
  name: string | null
  claimPublicly: boolean
  backedUp: boolean
}

/**
 * The ladder: drip (already landed, or not) → deploy → settle → register → confirm. Each rung is
 * a real callback. `settle` is the one the chain owns: the prover looks for the account
 * PROVING_BLOCK_LAG blocks behind the head, so a fresh deploy is refused there until the head
 * has moved on — the register call only fires once a live read says it is visible.
 */
export function useOnboardingLadder({ address, name, claimPublicly, backedUp }: LadderInput) {
  const status = useQuery({ ...accountStatusQuery(address), refetchInterval: 10_000 })
  const deploy = useDeployAccount()
  const register = useRegister()
  const claim = useDirectoryClaim()
  const [ladder, setLadder] = useState<Ladder>(IDLE)
  const patch = (p: Partial<Ladder>) => setLadder((l) => ({ ...l, ...p }))

  const provable = useQuery({
    ...accountProvableQuery(ladder.settling ? address : undefined),
    refetchInterval: (query) => (query.state.data?.visible ? false : 10_000),
  })

  const running = deploy.isPending || register.isPending || ladder.settling

  const start = async () => {
    if (running || ladder.done) return
    const current = status.data ?? (await status.refetch()).data
    if (!current) return
    setLadder({ ...IDLE, startedAt: Date.now(), reached: RUNG('drip') })

    if (current.rung === 'unknown') {
      patch({ failedAt: 'drip', problem: current.because ?? 'The account could not be read.' })
      return
    }
    if (current.rung === 'unfunded') {
      patch({ failedAt: 'drip', problem: REGISTER_NEEDS_FUNDS })
      return
    }

    if (current.rung === 'undeployed') {
      patch({ reached: RUNG('deploy') })
      const deployed = await deploy.mutateAsync()
      if (!deployed.ok) {
        patch({ failedAt: 'deploy', problem: deployed.because })
        return
      }
      patch({ deployedAt: deployed.block })
    }
    // Hands over to the effect below, which registers once the chain shows the account.
    patch({ reached: RUNG('settle'), settling: true })
  }

  // Fires exactly once per settle: the ref survives the re-render between `settling` flipping
  // off and the mutation reporting pending.
  const firing = useRef(false)
  const visible = provable.data?.visible === true
  useEffect(() => {
    if (!ladder.settling || !visible || firing.current) return
    firing.current = true
    setLadder((l) => ({ ...l, settling: false, reached: RUNG('register') }))

    const finish = async () => {
      const registered = await register.mutateAsync({ backedUp })
      if (!registered.ok) {
        patch({ failedAt: 'register', problem: registered.because })
        return
      }
      patch({
        receipt: { transactionHash: registered.transactionHash, block: registered.block },
        reached: [...ONBOARDING_STAGES],
        done: true,
      })

      if (claimPublicly && name && DIRECTORY_NAME_PATTERN.test(name)) {
        const outcome = await claim.mutateAsync({ name })
        if (outcome.ok) notify.settled(`You are @${name}`, { description: 'Anyone can now find this address by that name.' })
        else notify.noted('Your account is ready', { description: `The name @${name} was not claimed: ${outcome.because} You can claim one in Settings.` })
      }
    }
    void finish().finally(() => {
      firing.current = false
    })
    // `patch`/`mutateAsync` are stable; the effect keys on the two facts that gate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ladder.settling, visible])

  const blocksToGo =
    ladder.deployedAt !== null && provable.data
      ? Math.max(0, ladder.deployedAt + PROVING_BLOCK_LAG - provable.data.head)
      : null
  const notes = { ...ONBOARDING_STAGE_NOTES, settle: settleNote(PROVING_BLOCK_LAG, blocksToGo) }

  return { ladder, start, running, notes, rung: status.data?.rung }
}
