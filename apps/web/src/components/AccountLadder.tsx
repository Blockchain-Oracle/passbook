//
// Where this account stands, and what clears the next rung.
//
// ── THE SCREEN THAT STOPS "SOMETHING WENT WRONG" ─────────────────────────────────────────
//
// An embedded key is not yet an account that can transact, and the four things that have to
// become true have four different fixes — one of which (funding) this app cannot do for anyone.
// A surface that does not model that can only fail vaguely. This one names the rung.
//
// ── ORDER IS PROTOCOL, NOT PREFERENCE ────────────────────────────────────────────────────
//
// Deploy before register: the prove leg SRC5-probes the user's address, so a counterfactual
// account has nothing to answer the probe with. Learned live on 2026-08-24 and recorded at
// `register.ts:1067`. Presenting these as an ordered list rather than a set of buttons is that
// fact expressed as layout.
//
import type { ReactNode } from 'react'

import type { AccountStatus, AccountRung } from '../shell/account-status'
import { cn } from '../lib/cn'
import { Button } from './ui/Button'
import { Text } from './ui/Text'

/**
 * The rungs in order. `unknown` is deliberately NOT one of them — it is the absence of a reading,
 * not a place on the ladder, and typing it out of this list is what makes the render below
 * exhaustive without a fallback branch that could quietly swallow a new rung.
 */
type Rung = Exclude<AccountRung, 'unknown'>

const RUNGS: readonly Rung[] = ['unfunded', 'undeployed', 'unregistered', 'ready']

const STEP: Record<Rung, { title: string; done: string; todo: string }> = {
  unfunded: {
    title: 'Fund the address',
    done: 'Funded.',
    // The one step nothing here can perform. Saying so plainly beats a button that cannot work.
    todo: 'Send STRK to the address above. Nothing else can happen until something is there to pay with.',
  },
  undeployed: {
    title: 'Deploy the account',
    done: 'Deployed.',
    todo: 'Starknet accounts are contracts. This one pays for its own deployment out of the STRK you sent.',
  },
  unregistered: {
    title: 'Register with the pool',
    done: 'Registered.',
    todo: 'Writes your viewing key to the pool, once and permanently, so notes can be found. Costs the pool fee.',
  },
  ready: {
    title: 'Ready',
    done: 'This account can hold and move shielded value.',
    todo: '',
  },
}

export interface AccountLadderProps {
  status: AccountStatus
  /**
   * Deploy the account contract. Rendered as a button only when supplied AND the account is
   * standing on that rung — the never-a-no-op rule, and the reason the ladder can be shown on a
   * surface that cannot act on it.
   */
  onDeploy?: () => void
  /** A deployment is in flight. The button says so rather than looking pressable twice. */
  deploying?: boolean
  /** What went wrong with the last attempt, as a sentence. */
  problem?: string | null
  /**
   * The backup ceremony, rendered inside the registration rung.
   *
   * Passed in rather than constructed here so this component stays a ladder and does not need to
   * know what an account key is — the same reason `onDeploy` is a callback.
   */
  backup?: ReactNode
}

export function AccountLadder({
  status,
  onDeploy,
  deploying = false,
  problem = null,
  backup,
}: AccountLadderProps) {
  if (status.rung === 'unknown') {
    return (
      <div className="rounded-large border border-solid border-surface3 p-s16">
        <Text variant="body3" className="text-exposed">
          {status.because ?? 'The account could not be read, so this is a gap rather than a state.'}
        </Text>
      </div>
    )
  }

  const reached = RUNGS.indexOf(status.rung)

  return (
    <ol className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
      {RUNGS.map((rung, index) => {
        // `index < reached` is cleared; `=== reached` is where the user is; beyond is not yet
        // reachable and is deliberately dimmed rather than hidden — seeing what comes next is
        // most of what makes a multi-step thing feel finite.
        const state = index < reached ? 'done' : index === reached ? 'current' : 'ahead'
        const step = STEP[rung]
        return (
          <li key={rung} className="flex items-start gap-s12">
            <Marker state={state} index={index} />
            <div className="flex min-w-0 flex-col gap-s2">
              <Text
                variant="body3"
                className={cn(
                  state === 'ahead' && 'text-neutral3',
                  state === 'current' && 'text-neutral1',
                  state === 'done' && 'text-neutral2',
                )}
              >
                {step.title}
              </Text>
              {state === 'current' && step.todo ? (
                <Text variant="body4" className="text-neutral2">
                  {step.todo}
                </Text>
              ) : null}
              {state === 'current' && rung === 'ready' ? (
                <Text variant="body4" className="text-settled">
                  {step.done}
                </Text>
              ) : null}

              {/*
                THE BACKUP CEREMONY IS PART OF THIS RUNG, not a separate screen.

                `canRegister` defaults to false and stays false until the ceremony reaches its
                terminal state, so registration is genuinely unreachable without it — putting the
                ceremony anywhere else would mean a user pressing Register and being refused by
                something they had never been shown.
              */}
              {state === 'current' && rung === 'unregistered' && backup ? (
                <div className="mt-s8">{backup}</div>
              ) : null}

              {/*
                THE ONE RUNG THIS APP CAN CLEAR ITSELF. Funding is someone else's action and
                registration costs the pool fee; deployment is a single transaction the account
                pays for out of what it already holds.
              */}
              {state === 'current' && rung === 'undeployed' && onDeploy ? (
                <div className="mt-s4 flex flex-col gap-s4">
                  <Button variant="primary" size="sm" onClick={onDeploy} disabled={deploying}>
                    {deploying ? 'Deploying…' : 'Deploy account'}
                  </Button>
                  {problem ? (
                    <Text variant="body4" className="text-irreversible">
                      {problem}
                    </Text>
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/**
 * A dot per rung: filled for cleared, ringed for current, hollow for ahead.
 *
 * FILL AND SHAPE, not colour alone — the same rule the visibility matrix keeps, and for the same
 * reason: this has to read in greyscale and under every form of colour blindness.
 */
function Marker({ state, index }: { state: 'done' | 'current' | 'ahead'; index: number }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'mt-s2 flex size-s16 shrink-0 items-center justify-center rounded-pill border border-solid',
        state === 'done' && 'border-settled bg-settled',
        state === 'current' && 'border-neutral1 bg-transparent',
        state === 'ahead' && 'border-neutral3 bg-transparent',
      )}
    >
      {state === 'done' ? (
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
          <path d="M5 13l4 4L19 7" stroke="var(--color-ground)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <span className={cn('size-s4 rounded-pill', state === 'current' ? 'bg-neutral1' : 'bg-neutral3')} />
      )}
      <span className="sr-only">{`Step ${index + 1}`}</span>
    </span>
  )
}
