//
// Where a typed address routes, resolved while the user is still looking at the form.
//
// ── THE ANSWER IS FREE, SO IT BELONGS BEFORE THE PRESS ────────────────────────────────────
//
// `preflightRecipient` is one permissionless view call: no fee, no proof, no side effect. That is
// what makes it honest to run on a paste rather than on a confirm — the alternative is a user who
// builds a proof, pays the pool's fee and finds out at the end that the address they were sending
// to has no account. `sendShielded` runs the same gate again on the way through, and it is the one
// that matters; this is the same fact, said early.
//
// ── FIVE STATES, FIVE SENTENCES, AND `unregistered` IS NOT AN ERROR ───────────────────────
//
// "Not registered" and "we could not read the chain" are different facts about a stranger's
// account, and collapsing them tells someone their friend has not signed up when the truth is that
// an RPC timed out. The unregistered arm carries the protocol's own authored copy — the Door-A
// transform — rather than a sentence written here, so the form and the failure path say the same
// thing in the same words.
//
// ── THE DEBOUNCE IS NOT POLISH ────────────────────────────────────────────────────────────
//
// A Starknet address is 66 characters. An effect keyed on every keystroke is 66 view calls for one
// typed address, against a public RPC this app shares with everything else it does. A paste — the
// way an address actually arrives — is one call either way, so the wait costs the common path
// nothing.
//
// ── AND IT REACHES THE POOL WITHOUT REACHING THE SDK ──────────────────────────────────────
//
// `@strk20/protocol/recipient` is a leaf over the pool client. Importing it does not pull the
// privacy SDK, so the field can resolve an address without dragging the crypto graph into the
// chunk that draws it — which is exactly why the gate was moved out of `send.ts` to begin with.
//
import { useEffect, useMemo, useState } from 'react'

import { resolveRecipientReference } from '@strk20/protocol/pay-link'
import type { DoorAInvite } from '@strk20/protocol/recipient'

import { useDirectory } from './use-directory'

export type RecipientStatus =
  /** Nothing typed yet. */
  | { readonly kind: 'idle' }
  /** Not a felt. */
  | { readonly kind: 'invalid'; readonly because: string }
  /** The read is in flight, or the session has not arrived yet. */
  | { readonly kind: 'checking' }
  /** Your own address. Sends to yourself cost a fee and move nothing. */
  | { readonly kind: 'self' }
  /** No viewing key on chain, so a private transfer cannot reach it. Carries the authored copy. */
  | { readonly kind: 'unregistered'; readonly door: DoorAInvite }
  /** The chain could not be read. We do not know, rather than know. */
  | { readonly kind: 'unreadable'; readonly because: string }
  /** A well-formed @name that no current directory entry owns. */
  | { readonly kind: 'unresolved-name'; readonly because: string }
  /** Registered with the pool, and reachable. */
  | { readonly kind: 'registered'; readonly address: string; readonly name: string | null }

/** How long a field sits still before its address is looked up. */
const SETTLE_MS = 300

export function useRecipient(raw: string, ownAddress: string | null): RecipientStatus {
  const [status, setStatus] = useState<RecipientStatus>({ kind: 'idle' })
  const directory = useDirectory()

  // Trimmed once, here, so a pasted address with whitespace and one without are the same input to
  // everything below — including the effect's dependency list.
  const recipient = useMemo(() => raw.trim(), [raw])

  useEffect(() => {
    if (recipient === '') {
      setStatus({ kind: 'idle' })
      return
    }

    const isName = recipient.startsWith('@')
    if (isName && directory.loading) {
      setStatus({ kind: 'checking' })
      return
    }
    if (isName && directory.problem) {
      setStatus({
        kind: 'unreadable',
        because: 'Names could not be loaded. Use the recipient’s address instead.',
      })
      return
    }

    const resolved = resolveRecipientReference(recipient, directory.entries)
    if (!resolved.ok) {
      setStatus(
        resolved.kind === 'unresolved-name'
          ? { kind: 'unresolved-name', because: resolved.because }
          : { kind: 'invalid', because: resolved.because },
      )
      return
    }

    let live = true
    // Announced before the wait, not after it. A field that says nothing for 300ms and then says
    // "reading" reads as a form that ignored the paste.
    setStatus({ kind: 'checking' })

    const timer = setTimeout(() => {
      void (async () => {
        const [{ sameAddress }, { preflightRecipient }] = await Promise.all([
          import('@strk20/protocol/address'),
          import('@strk20/protocol/recipient'),
        ])
        if (!live) return

        // Checked before the call rather than after: reading your own key would answer
        // `registered`, and a form that accepts a send to yourself is a form that charges a fee to
        // move money from a pocket into the same pocket.
        if (ownAddress !== null && sameAddress(resolved.address, ownAddress)) {
          setStatus({ kind: 'self' })
          return
        }

        const route = await preflightRecipient(resolved.address)
        if (!live) return

        setStatus(
          route.route === 'registered'
            ? { kind: 'registered', address: resolved.address, name: resolved.name }
            : route.route === 'unregistered'
              ? { kind: 'unregistered', door: route.door }
              : { kind: 'unreadable', because: route.reason },
        )
      })().catch((error: unknown) => {
        if (live) setStatus({ kind: 'unreadable', because: String(error) })
      })
    }, SETTLE_MS)

    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [recipient, ownAddress, directory.entries, directory.loading, directory.problem])

  return status
}
