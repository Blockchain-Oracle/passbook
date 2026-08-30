import { useQuery } from '@tanstack/react-query'
import { sameAddress } from '@strk20/protocol/address'
import { resolveRecipientReference } from '@strk20/protocol/pay-link'
import type { DoorAInvite } from '@strk20/protocol/recipient'

import { useDebounced } from '@/hooks/use-debounced'
import { directoryQuery } from '@/queries/directory'
import { recipientRouteQuery } from './queries'

export type RecipientStatus =
  | { state: 'idle' }
  | { state: 'invalid'; because: string }
  | { state: 'unresolved-name'; because: string }
  | { state: 'checking'; address: string | null; name: string | null }
  | { state: 'self'; address: string }
  | { state: 'unregistered'; address: string; name: string | null; door: DoorAInvite }
  | { state: 'unreadable'; address: string; name: string | null; because: string }
  | { state: 'registered'; address: string; name: string | null }
  /** A valid public Starknet address, for a withdrawal. Registration is not consulted. */
  | { state: 'public'; address: string; name: string | null }

/** The directory is not searched per keystroke; the typed value settles for a beat first. */
const SETTLE_MS = 300

/**
 * Address or `@name` → resolved address → registration route. Every step is a state of the form,
 * not an error: an unregistered recipient becomes the Door-A invitation, not a red field.
 */
export function useRecipient(
  raw: string,
  ownAddress: string | undefined,
  /**
   * `'public'` for a withdrawal, where the destination is an ordinary Starknet address.
   *
   * IT CHANGES TWO ANSWERS, and both would be wrong the other way round. Registration is not
   * consulted — a withdrawal pays an address, so "they have no account here yet" is not a fact
   * about the transaction. And your OWN address stops being a refusal: unshielding to yourself is
   * the ordinary reason to unshield, while transferring to yourself moves nothing.
   */
  destination: 'shielded' | 'public' = 'shielded',
): RecipientStatus {
  const settled = useDebounced(raw, SETTLE_MS)
  const trimmed = settled.trim()
  const wantsName = trimmed.startsWith('@')

  // The directory is only consulted for `@name`; an address never waits on it.
  const directory = useQuery({ ...directoryQuery(), enabled: wantsName })
  const resolved = trimmed === '' ? null : resolveRecipientReference(trimmed, directory.data ?? [])
  const address = resolved?.ok ? resolved.address : null
  const name = resolved?.ok ? resolved.name : null
  const isSelf = address !== null && ownAddress !== undefined && sameAddress(address, ownAddress)

  const wantsRoute = destination === 'shielded'
  const route = useQuery(recipientRouteQuery(wantsRoute && !isSelf ? address : null))

  if (trimmed === '' || raw.trim() !== trimmed) return trimmed === '' ? { state: 'idle' } : { state: 'checking', address: null, name: null }
  if (resolved && !resolved.ok) {
    if (resolved.kind === 'unresolved-name') {
      if (directory.isPending) return { state: 'checking', address: null, name: null }
      if (directory.isError) {
        return { state: 'unresolved-name', because: 'Names could not be loaded. Use the recipient’s address instead.' }
      }
      return { state: 'unresolved-name', because: resolved.because }
    }
    return { state: 'invalid', because: resolved.because }
  }
  if (address === null) return { state: 'idle' }
  // A withdrawal is done with the address the moment it parses: no registration, and self is fine.
  if (!wantsRoute) return { state: 'public', address, name }
  if (isSelf) return { state: 'self', address }
  if (route.isPending) return { state: 'checking', address, name }
  if (route.isError || !route.data) {
    return { state: 'unreadable', address, name, because: route.error instanceof Error ? route.error.message : 'The recipient could not be checked.' }
  }
  switch (route.data.route) {
    case 'registered':
      return { state: 'registered', address, name }
    case 'unregistered':
      return { state: 'unregistered', address, name, door: route.data.door }
    case 'blocked-rpc-unknown':
      return { state: 'unreadable', address, name, because: route.data.reason }
  }
}
