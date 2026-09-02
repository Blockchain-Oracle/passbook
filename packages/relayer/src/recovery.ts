//
// The recovery service: passkey registration and assertion (verified by @simplewebauthn/server),
// and custody of one sealed envelope per vault that this process CANNOT open.
//
// What this process learns, and all it learns: a passkey's public key, its counter and backup
// flag, an opaque user handle it minted itself, and ciphertext. It never sees the PRF output (the
// browser strips it), the VEK, a password, an address or a label. The envelope's AAD is bound to
// the vault id, so a copy lifted from the ledger cannot be replayed under another vault.
//
// Origin and RP ID come from CONFIGURATION, never from the request: the Vercel hop strips the
// browser's Origin header, so the client names its origin in the body, this service refuses one
// outside the allow-list, binds the named origin to the challenge, and verifies the signed
// `clientDataJSON.origin` against exactly that — a lie in the body fails the signature check.
//
// Challenges and sessions are in memory: one machine, and a deploy invalidates them, which the
// browser reads as "behind — approve your passkey to sync". Each challenge is deleted BEFORE it is
// verified, so a replayed body meets no challenge at all.
//
import { randomBytes } from 'node:crypto'

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server'
import { isoBase64URL } from '@simplewebauthn/server/helpers'

import {
  RECOVERY_ORIGIN_REFUSED,
  RECOVERY_RP_NAME,
  RECOVERY_SESSION_EXPIRED,
  type AuthOptionsReply,
  type AuthVerifyReply,
  type AuthenticationResponseWire,
  type EnvelopePutReply,
  type RegisterOptionsReply,
  type RegisterVerifyReply,
  type RegistrationResponseWire,
} from '../../protocol/src/recovery-wire.js'
import type { RemoteEnvelope } from '../../protocol/src/vault-envelope.js'
import { createQuoteCounter, type DailyQuoteCounter } from './quote-proxy.js'
import type { RecoveryStore, StoredCredential, StoredVault } from './recovery-store.js'

export const RECOVERY_SWEEP_MS = 60_000
export const CHALLENGE_TTL_MS = 5 * 60_000
export const SESSION_TTL_MS = 12 * 60 * 60_000
/** A vault registered but never uploaded to: the browser failed between the two steps. */
export const ORPHAN_VAULT_TTL_MS = 60 * 60_000
export const MAX_CREDENTIALS_PER_VAULT = 5
export const MAX_VAULTS = 10_000
export const MAX_PENDING = 5_000

export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; error: string; extra?: Record<string, unknown> }

export interface RecoveryService {
  registerOptions(input: { origin: string; session?: string }): Promise<Outcome<RegisterOptionsReply>>
  registerVerify(input: { challenge: string; response: RegistrationResponseWire }): Promise<Outcome<RegisterVerifyReply>>
  authOptions(input: { origin: string; credentialId?: string }): Promise<Outcome<AuthOptionsReply>>
  authVerify(input: { challenge: string; response: AuthenticationResponseWire }): Promise<Outcome<AuthVerifyReply>>
  putEnvelope(input: { session: string; revision: number; envelope: RemoteEnvelope }): Outcome<EnvelopePutReply>
  deleteEnvelope(input: { session: string }): Outcome<{ ok: true }>
  sweep(): number
  stats(): { vaults: number; challenges: number; sessions: number }
  /** Day-scoped per-visitor brake on the two `options` doors, where a challenge is minted. */
  readonly optionsCounter: DailyQuoteCounter
}

type Challenge =
  | { kind: 'register'; origin: string; vaultId: string; userHandle: string; fresh: boolean; expiresAt: number }
  | { kind: 'auth'; origin: string; credentialId: string | null; expiresAt: number }

interface Session {
  vaultId: string
  expiresAt: number
}

const refuse = <T>(status: number, error: string, extra?: Record<string, unknown>): Outcome<T> => ({ ok: false, status, error, extra })

function rpIdOf(origin: string): string {
  return new URL(origin).hostname
}

export function openRecovery(opts: {
  store: RecoveryStore
  origins: ReadonlySet<string>
  optionsPerVisitorPerDay: number
  optionsPerDay: number
  now?: () => number
}): RecoveryService {
  const { store } = opts
  const now = opts.now ?? Date.now
  const challenges = new Map<string, Challenge>()
  const sessions = new Map<string, Session>()

  function take(challenge: string): Challenge | null {
    const rec = challenges.get(challenge)
    challenges.delete(challenge) // ONE use, deleted before anything is verified
    if (!rec || rec.expiresAt < now()) return null
    return rec
  }

  function mintSession(vaultId: string): string {
    const token = randomBytes(32).toString('hex')
    sessions.set(token, { vaultId, expiresAt: now() + SESSION_TTL_MS })
    return token
  }

  function sessionVault(token: string): { vaultId: string; vault: StoredVault } | null {
    const s = sessions.get(token)
    if (!s || s.expiresAt < now()) {
      sessions.delete(token)
      return null
    }
    const vault = store.vault(s.vaultId)
    if (!vault) return null
    s.expiresAt = now() + SESSION_TTL_MS
    return { vaultId: s.vaultId, vault }
  }

  function originAllowed(origin: string): boolean {
    return opts.origins.has(origin)
  }

  return {
    optionsCounter: createQuoteCounter(opts.optionsPerVisitorPerDay, opts.optionsPerDay),

    async registerOptions(input) {
      if (!originAllowed(input.origin)) return refuse(403, RECOVERY_ORIGIN_REFUSED)
      if (challenges.size >= MAX_PENDING) return refuse(503, 'too many passkey ceremonies in flight; try again in a minute')
      let vaultId: string
      let userHandle: string
      let exclude: StoredCredential[] = []
      let fresh: boolean
      if (input.session !== undefined) {
        const held = sessionVault(input.session)
        if (!held) return refuse(401, RECOVERY_SESSION_EXPIRED)
        if (held.vault.credentials.length >= MAX_CREDENTIALS_PER_VAULT) return refuse(409, `a wallet can hold at most ${MAX_CREDENTIALS_PER_VAULT} passkeys`)
        vaultId = held.vaultId
        userHandle = held.vault.userHandle
        exclude = held.vault.credentials
        fresh = false
      } else {
        if (store.count() >= MAX_VAULTS) return refuse(503, 'the recovery service is full')
        vaultId = randomBytes(16).toString('hex')
        userHandle = isoBase64URL.fromBuffer(randomBytes(32))
        fresh = true
      }
      const options = await generateRegistrationOptions({
        rpName: RECOVERY_RP_NAME,
        rpID: rpIdOf(input.origin),
        userName: `strk20.run wallet · ${randomBytes(3).toString('hex')}`,
        userID: isoBase64URL.toBuffer(userHandle),
        attestationType: 'none',
        // Discoverable + verified: a fresh device has no credential id to offer, and the PRF the
        // browser evaluates on this passkey must sit behind the same biometric every time.
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        excludeCredentials: exclude.map((c) => ({ id: c.id, transports: c.transports as AuthenticatorTransportFuture[] | undefined })),
      })
      challenges.set(options.challenge, { kind: 'register', origin: input.origin, vaultId, userHandle, fresh, expiresAt: now() + CHALLENGE_TTL_MS })
      return { ok: true, value: { options: options as unknown as RegisterOptionsReply['options'] } }
    },

    async registerVerify(input) {
      const rec = take(input.challenge)
      if (!rec || rec.kind !== 'register') return refuse(400, 'that passkey ceremony is unknown or has expired; start again')
      let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>
      try {
        verification = await verifyRegistrationResponse({
          response: input.response as RegistrationResponseJSON,
          expectedChallenge: input.challenge,
          expectedOrigin: rec.origin,
          expectedRPID: rpIdOf(rec.origin),
          requireUserVerification: true,
        })
      } catch (e) {
        return refuse(403, `the passkey could not be verified: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (!verification.verified) return refuse(403, 'the passkey could not be verified')
      const info = verification.registrationInfo
      const { credential } = info
      // ── No awaits below this line: every check runs in the same tick as the write. ──
      if (store.vaultIdByCredential(credential.id)) return refuse(409, 'that passkey is already registered')
      const vault: StoredVault = rec.fresh
        ? { userHandle: rec.userHandle, createdAt: now(), credentials: [], envelope: null }
        : (store.vault(rec.vaultId) ?? { userHandle: rec.userHandle, createdAt: now(), credentials: [], envelope: null })
      const t = now()
      vault.credentials.push({
        id: credential.id,
        publicKey: isoBase64URL.fromBuffer(credential.publicKey),
        counter: credential.counter,
        ...(credential.transports ? { transports: credential.transports } : {}),
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        createdAt: t,
        lastUsedAt: t,
      })
      store.putVault(rec.vaultId, vault)
      return { ok: true, value: { vaultId: rec.vaultId, session: mintSession(rec.vaultId), credentialId: credential.id, backedUp: info.credentialBackedUp } }
    },

    async authOptions(input) {
      if (!originAllowed(input.origin)) return refuse(403, RECOVERY_ORIGIN_REFUSED)
      if (challenges.size >= MAX_PENDING) return refuse(503, 'too many passkey ceremonies in flight; try again in a minute')
      let allow: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined
      if (input.credentialId !== undefined) {
        const vaultId = store.vaultIdByCredential(input.credentialId)
        const credential = vaultId ? store.vault(vaultId)?.credentials.find((c) => c.id === input.credentialId) : undefined
        if (!credential) return refuse(404, 'that passkey is not registered here')
        allow = [{ id: credential.id, transports: credential.transports as AuthenticatorTransportFuture[] | undefined }]
      }
      const options = await generateAuthenticationOptions({
        rpID: rpIdOf(input.origin),
        userVerification: 'required',
        ...(allow ? { allowCredentials: allow } : {}),
      })
      challenges.set(options.challenge, { kind: 'auth', origin: input.origin, credentialId: input.credentialId ?? null, expiresAt: now() + CHALLENGE_TTL_MS })
      return { ok: true, value: { options: options as unknown as AuthOptionsReply['options'] } }
    },

    async authVerify(input) {
      const rec = take(input.challenge)
      if (!rec || rec.kind !== 'auth') return refuse(400, 'that passkey ceremony is unknown or has expired; start again')
      if (rec.credentialId !== null && rec.credentialId !== input.response.id) return refuse(400, 'a different passkey answered than the one asked for')
      const vaultId = store.vaultIdByCredential(input.response.id)
      const vault = vaultId ? store.vault(vaultId) : null
      const credential = vault?.credentials.find((c) => c.id === input.response.id)
      if (!vaultId || !vault || !credential) return refuse(404, 'that passkey is not registered here')
      // A user handle, when the authenticator returns one, must be the one this vault was minted with.
      if (input.response.response.userHandle !== undefined && input.response.response.userHandle !== vault.userHandle) {
        return refuse(403, 'that passkey belongs to a different wallet')
      }
      let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>
      try {
        verification = await verifyAuthenticationResponse({
          response: input.response as AuthenticationResponseJSON,
          expectedChallenge: input.challenge,
          expectedOrigin: rec.origin,
          expectedRPID: rpIdOf(rec.origin),
          credential: {
            id: credential.id,
            publicKey: isoBase64URL.toBuffer(credential.publicKey),
            counter: credential.counter,
            transports: credential.transports as AuthenticatorTransportFuture[] | undefined,
          },
          requireUserVerification: true,
        })
      } catch (e) {
        return refuse(403, `the passkey could not be verified: ${e instanceof Error ? e.message : String(e)}`)
      }
      if (!verification.verified) return refuse(403, 'the passkey could not be verified')
      // ── No awaits below this line. ──
      const live = store.vault(vaultId)
      const current = live?.credentials.find((c) => c.id === credential.id)
      if (!live || !current) return refuse(404, 'that passkey is not registered here')
      current.counter = verification.authenticationInfo.newCounter
      current.backedUp = verification.authenticationInfo.credentialBackedUp
      current.lastUsedAt = now()
      store.putVault(vaultId, live)
      return { ok: true, value: { vaultId, session: mintSession(vaultId), credentialId: credential.id, backedUp: current.backedUp, envelope: live.envelope } }
    },

    putEnvelope(input) {
      const held = sessionVault(input.session)
      if (!held) return refuse(401, RECOVERY_SESSION_EXPIRED)
      const known = new Set(held.vault.credentials.map((c) => c.id))
      if (!input.envelope.wrappers.every((w) => known.has(w.credentialId))) {
        return refuse(400, 'the envelope names a passkey this wallet has not registered')
      }
      // Compare-and-swap on the revision the client last saw: a stale writer gets the current copy
      // back, opens it, merges, and tries again. Last-write-wins is never an option here.
      const current = held.vault.envelope?.revision ?? 0
      if (input.revision !== current) {
        return refuse(409, 'the sealed copy changed since this browser last saw it', { revision: current, envelope: held.vault.envelope })
      }
      const next = current + 1
      store.putVault(held.vaultId, { ...held.vault, envelope: { ...input.envelope, revision: next } })
      return { ok: true, value: { revision: next } }
    },

    deleteEnvelope(input) {
      const held = sessionVault(input.session)
      if (!held) return refuse(401, RECOVERY_SESSION_EXPIRED)
      store.deleteVault(held.vaultId)
      for (const [token, s] of sessions) if (s.vaultId === held.vaultId) sessions.delete(token)
      return { ok: true, value: { ok: true } }
    },

    sweep() {
      const t = now()
      let dropped = 0
      for (const [k, c] of challenges) if (c.expiresAt < t) { challenges.delete(k); dropped += 1 }
      for (const [k, s] of sessions) if (s.expiresAt < t) { sessions.delete(k); dropped += 1 }
      return dropped + store.sweepOrphans(t, ORPHAN_VAULT_TTL_MS)
    },

    stats: () => ({ vaults: store.count(), challenges: challenges.size, sessions: sessions.size }),
  }
}
