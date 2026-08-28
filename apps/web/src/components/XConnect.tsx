//
// Connect X — your handle becomes your name, attested.
//
// THREE STATES, HONESTLY DISTINCT (yosuku's two-source lesson): signed in HERE is the session
// cookie `/api/x/me` reads; BOUND is the directory's attested entry, which everyone can see.
// This panel renders both truths side by side and never conflates them.
//
// The claim itself is the shipped directory discipline: the viewing key signs H(name, address)
// where the name is the normalized handle — the server builds it from its own session, and the
// signature here must match exactly that, so a mismatched client cannot bind a name it did not
// sign. An unconfigured deployment (404s from /api/x/*) renders as absence, not as a broken button.
//
import { useCallback, useEffect, useState } from 'react'

import { toast } from '../shell/toast-store'
import { useDirectory, nameFor } from '../shell/use-directory'
import { useSession } from '../shell/session'
import { Button } from './ui/Button'
import { Text } from './ui/Text'

type MeState =
  | { kind: 'loading' }
  | { kind: 'off' }
  | { kind: 'out' }
  | { kind: 'in'; handle: string }

/** The handle as the name it would claim — `api/x/link.js`'s rule, mirrored for the signature. */
function nameFromHandle(handle: string): string | null {
  const name = handle.toLowerCase()
  return /^[a-z0-9_]{3,20}$/.test(name) ? name : null
}

export function XConnect() {
  const session = useSession()
  const ready = session.status === 'ready' ? session : null
  const directory = useDirectory()
  const [me, setMe] = useState<MeState>({ kind: 'loading' })
  const [busy, setBusy] = useState(false)
  const [boundNow, setBoundNow] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void fetch('/api/x/me', { headers: { accept: 'application/json' } }).then(
      async (response) => {
        if (!live) return
        if (response.status === 404) {
          setMe({ kind: 'off' })
          return
        }
        const body = (await response.json().catch(() => null)) as { signedIn?: boolean; handle?: string } | null
        setMe(body?.signedIn && typeof body.handle === 'string' ? { kind: 'in', handle: body.handle } : { kind: 'out' })
      },
      () => {
        if (live) setMe({ kind: 'off' })
      },
    )
    return () => {
      live = false
    }
  }, [])

  // Unconfigured deployments show nothing at all — an absent feature, not a broken one.
  if (me.kind === 'off' || me.kind === 'loading') return null

  const myEntry = ready
    ? directory.entries.find((e) => {
        try {
          return BigInt(e.address) === BigInt(ready.address)
        } catch {
          return false
        }
      })
    : null
  const boundHandle = boundNow ?? myEntry?.xHandle ?? null
  const myName = ready ? nameFor(directory.entries, ready.address) : null

  const onClaim = useCallback(async () => {
    if (!ready || me.kind !== 'in') return
    const name = nameFromHandle(me.handle)
    if (!name) {
      toast({
        kind: 'error',
        title: `@${me.handle} does not fit the name rules`,
        detail: 'Names are 3–20 characters of a-z, 0-9 and _. Claim one by hand below instead.',
      })
      return
    }
    setBusy(true)
    try {
      const { signClaim } = await import('@strk20/protocol/directory')
      const signature = signClaim(name, ready.address, ready.viewingKey)
      const response = await fetch('/api/x/link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ address: ready.address, signature }),
      })
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      if (!response.ok) {
        toast({ kind: 'error', title: 'The binding was refused', detail: body?.error ?? `HTTP ${response.status}` })
        return
      }
      setBoundNow(me.handle)
      toast({
        kind: 'success',
        title: `You are @${name}`,
        detail: 'Your X handle is your name now, with the attested badge beside it.',
      })
    } finally {
      setBusy(false)
    }
  }, [ready, me])

  return (
    <section className="flex flex-col gap-s8 rounded-large border border-solid border-surface3 p-s16">
      <Text variant="kicker">X account</Text>
      {boundHandle ? (
        <>
          <Text variant="body3" className="text-neutral1">
            Bound — you are <span className="font-medium">@{boundHandle.toLowerCase()}</span>
            <span className="ml-s6 rounded-pill border border-solid border-settled px-s6 font-mono text-mono text-settled">
              via 𝕏
            </span>
          </Text>
          <Text variant="body4" className="text-neutral3">
            The badge is the relayer&rsquo;s attestation that this name arrived over a live X
            sign-in. The binding is public, like every directory claim.
          </Text>
        </>
      ) : me.kind === 'in' ? (
        <>
          <Text variant="body3" className="text-neutral1">
            Signed in as @{me.handle}
          </Text>
          <Text variant="body4" className="text-neutral3">
            {myName
              ? `Claiming replaces @${myName} with @${me.handle.toLowerCase()} — one name per account.`
              : 'Your handle becomes your Passbook name, your X picture your avatar, with an attested badge.'}
          </Text>
          <Button
            variant="primary"
            size="md"
            className="self-start"
            disabled={busy || !ready}
            onClick={() => void onClaim()}
          >
            {busy ? 'Binding…' : `Use @${me.handle.toLowerCase()} as my name`}
          </Button>
        </>
      ) : (
        <>
          <Text variant="body4" className="text-neutral3">
            Connect your X account to use your handle as your name here, picture included. What X
            learns: that you signed into this app. What it never sees: your addresses or activity.
          </Text>
          <Button variant="secondary" size="md" className="self-start" onClick={() => {
            window.location.href = '/api/x/start?return=/settings'
          }}>
            Connect X
          </Button>
        </>
      )}
    </section>
  )
}
