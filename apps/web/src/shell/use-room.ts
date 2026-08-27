//
// The chat surface's one hook: turn an address into a live, encrypted thread.
//
// NOT "END-TO-END", AND THAT PHRASE IS ON THE FORBIDDEN LIST FOR A REASON THAT APPLIES HERE
// EXACTLY. The room key is derived from the two parties' POOL VIEWING KEYS, and StarkWare's
// auditor holds an escrowed copy of those — `get_enc_private_key` is permissionless. So the
// auditor can derive this room's secret and read the messages, including old ones, without asking
// anyone. That is a property of the free key agreement, not a bug in it: what it buys is a
// conversation with no handshake and no directory. Say it on the surface; never imply otherwise.
//
// ── THE WHOLE HANDSHAKE IS TWO FREE READS AND NO SERVER ──────────────────────────────────
//
// `get_public_key(theirAddress)` is a view call. Combined with the viewing key this browser
// already derived at boot, it produces a shared secret neither party sent anywhere — so there is
// no key exchange to intercept, no directory to look anyone up in, and nothing published by
// starting a conversation. `protocol/src/room.ts` holds the derivation and the curve fact it
// rests on.
//
// ── THE UNREGISTERED PEER IS A PRODUCT STATE, NOT AN ERROR ───────────────────────────────
//
// An address with no viewing key on chain cannot be talked to: there is no public key to derive
// against. That is most addresses, so it gets its own arm with its own sentence rather than an
// exception — the surface invites them instead.
//
// ── EVERY MESSAGE IS OPENED, NEVER TRUSTED ───────────────────────────────────────────────
//
// The bus can inject. `openMessage` authenticates under the room key, so a forged envelope throws
// and is dropped here. It is dropped SILENTLY on purpose: a stranger who guessed a room id should
// not be able to make a notification appear in someone's thread.
//
// ── THE SDK STAYS LAZY ───────────────────────────────────────────────────────────────────
//
// `room.ts` reaches `starknet` for curve arithmetic, so every import below is dynamic. Importing
// it statically would put the crypto graph in the entry chunk and `build:web` would refuse the
// build by name — the same rule `session.ts` follows.
//
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { RoomEnvelope } from '@strk20/protocol/room'
import type { RoomMessage } from '@strk20/protocol/room-message'
import type { RoomStreamState } from '@strk20/protocol/room-transport'

/** One entry in the thread, as the surface renders it. */
export interface ThreadEntry {
  /** The envelope nonce — unique per message, and already the transport's de-duplication key. */
  readonly id: string
  readonly mine: boolean
  readonly message: RoomMessage
  /** When THIS browser saw it. Not a claim about when it was sent — nothing signs a clock. */
  readonly at: number
  /** Set on a message this browser could not hand to the bus. */
  readonly undelivered?: string
}

export type RoomStatus =
  /** No peer entered yet. */
  | { readonly kind: 'idle' }
  /** The address is not a felt. */
  | { readonly kind: 'invalid' }
  /** Reading their key. */
  | { readonly kind: 'checking' }
  /** They have never registered, so there is no key to derive a room against. */
  | { readonly kind: 'unregistered' }
  /** The chain could not be read. Distinct from unregistered: we do not know, rather than know. */
  | { readonly kind: 'unreadable'; readonly because: string }
  /** Talking to yourself. Derivable, but a room of one is not a conversation. */
  | { readonly kind: 'self' }
  /** The room exists and the socket is in `connection`. */
  | { readonly kind: 'open'; readonly roomId: string; readonly connection: RoomStreamState }

export interface RoomHandle {
  readonly status: RoomStatus
  readonly thread: readonly ThreadEntry[]
  /** Seal and send. Resolves to `null` on success or a sentence on failure. */
  readonly send: (message: RoomMessage) => Promise<string | null>
}

/** What `deriveRoom` returns, kept opaque here — this file never touches a key directly. */
type DerivedRoom = Awaited<ReturnType<typeof import('@strk20/protocol/room').deriveRoom>>

export function useRoom(
  peerAddress: string,
  session: { address: string; accountKey: string; viewingKey: bigint } | null,
): RoomHandle {
  const [status, setStatus] = useState<RoomStatus>({ kind: 'idle' })
  const [thread, setThread] = useState<readonly ThreadEntry[]>([])
  const room = useRef<DerivedRoom | null>(null)

  // Trimmed once, here, so every dependency below compares the same string a user pasted with
  // whitespace and one they did not.
  const peer = useMemo(() => peerAddress.trim(), [peerAddress])

  useEffect(() => {
    room.current = null
    setThread([])

    if (peer === '') {
      setStatus({ kind: 'idle' })
      return
    }
    if (!session) {
      // Not an error: the session arrives a beat after first paint. Reads as "checking".
      setStatus({ kind: 'checking' })
      return
    }

    let live = true
    let stream: { close(): void } | null = null

    void (async () => {
      setStatus({ kind: 'checking' })

      const [{ maybeAddress, sameAddress }, { getPublicKey }, roomModule, transport, { decodeRoomMessage }] =
        await Promise.all([
          import('@strk20/protocol/address'),
          import('@strk20/protocol/pool'),
          import('@strk20/protocol/room'),
          import('@strk20/protocol/room-transport'),
          import('@strk20/protocol/room-message'),
        ])
      if (!live) return

      const felt = maybeAddress(peer)
      if (felt === null) {
        setStatus({ kind: 'invalid' })
        return
      }
      if (sameAddress(peer, session.address)) {
        setStatus({ kind: 'self' })
        return
      }

      let theirKey: bigint
      try {
        theirKey = await getPublicKey(peer)
      } catch (e) {
        if (live) setStatus({ kind: 'unreadable', because: String(e) })
        return
      }
      if (!live) return
      if (theirKey === 0n) {
        setStatus({ kind: 'unregistered' })
        return
      }

      // Ours, from the key this browser already holds. Through `deriveRegisteredPublicKey` rather
      // than derived here, so this agrees with what registration actually wrote on chain —
      // including its odd-length-hex correction, which is exactly the kind of detail a second
      // derivation gets wrong once and then disagrees about forever.
      const { deriveRegisteredPublicKey } = await import('@strk20/protocol/registration')
      if (!live) return
      const mine = deriveRegisteredPublicKey(session.accountKey)

      let derived: DerivedRoom
      try {
        derived = await roomModule.deriveRoom({
          myViewingKey: session.viewingKey,
          myPublicKey: mine,
          theirPublicKey: theirKey,
        })
      } catch (e) {
        // A key on chain that is not a point on the curve, or a viewing key out of range. Both are
        // "we cannot build this room" rather than "they are not registered".
        if (live) setStatus({ kind: 'unreadable', because: String(e) })
        return
      }
      if (!live) return
      room.current = derived

      stream = transport.openRoomStream({
        room: derived.id,
        onState: (connection) => {
          if (live) setStatus({ kind: 'open', roomId: derived.id, connection })
        },
        onEnvelope: (envelope: RoomEnvelope) => {
          void (async () => {
            let plaintext: string
            try {
              plaintext = await roomModule.openMessage(derived, envelope)
            } catch {
              // Our own echo, or something that failed the tag. Neither belongs in the thread:
              // the echo is already rendered locally, and a forgery is a stranger's noise.
              return
            }
            if (!live) return
            setThread((current) => [
              ...current,
              {
                id: envelope.iv,
                mine: false,
                message: decodeRoomMessage(plaintext),
                at: Date.now(),
              },
            ])
          })()
        },
      })
    })()

    return () => {
      live = false
      stream?.close()
    }
    // `session` is compared by its two fields rather than by identity: `useSession` returns a new
    // object per render, and depending on it would tear down and rebuild the room on every one.
  }, [peer, session?.address, session?.accountKey])

  const send = useCallback(
    async (message: RoomMessage): Promise<string | null> => {
      const derived = room.current
      if (derived === null) return 'This thread is not open yet.'

      const [{ sealMessage }, { sendEnvelope }, { encodeRoomMessage }] = await Promise.all([
        import('@strk20/protocol/room'),
        import('@strk20/protocol/room-transport'),
        import('@strk20/protocol/room-message'),
      ])

      let envelope: RoomEnvelope
      try {
        envelope = await sealMessage(derived, encodeRoomMessage(message))
      } catch (e) {
        return e instanceof Error ? e.message : 'That message could not be sealed.'
      }

      // RENDERED BEFORE IT IS SENT, and corrected after. The alternative — waiting for the round
      // trip — makes every message feel like a form submission. The correction is the point: a
      // failure marks the entry rather than removing it, so nothing silently disappears.
      const entry: ThreadEntry = { id: envelope.iv, mine: true, message, at: Date.now() }
      setThread((current) => [...current, entry])

      const result = await sendEnvelope(derived.id, envelope)
      if (result.ok) return null

      const because =
        result.failure.kind === 'unreachable'
          ? 'Not delivered — the relay could not be reached.'
          : `Not delivered — the relay refused it (${result.failure.reason}).`
      setThread((current) =>
        current.map((e) => (e.id === entry.id ? { ...e, undelivered: because } : e)),
      )
      return because
    },
    [],
  )

  return { status, thread, send }
}
