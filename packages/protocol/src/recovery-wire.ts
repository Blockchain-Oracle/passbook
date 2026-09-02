//
// The `/api/recovery/*` wire contract: passkey registration, assertion, and the sealed envelope.
//
// ONE DEFINITION, both ends — the browser builds these bodies and the relayer parses them. A
// runtime LEAF (type-only imports) so a form can reach a path or a sentence without pulling
// crypto into its chunk. Everything here survives `JSON.stringify`: no bigints, no buffers.
//
// What never rides this wire: the PRF output, the VEK, a password, an account key, an address.
// The relayer stores ciphertext and WebAuthn public state, and that is all it can read.
//

import type { RemoteEnvelope } from './vault-envelope.js'

export const RECOVERY_PATHS = {
  registerOptions: '/api/recovery/register/options',
  registerVerify: '/api/recovery/register/verify',
  authOptions: '/api/recovery/auth/options',
  authVerify: '/api/recovery/auth/verify',
  envelopePut: '/api/recovery/envelope/put',
  envelopeDelete: '/api/recovery/envelope/delete',
} as const

/** Shown by the passkey provider as the site name. */
export const RECOVERY_RP_NAME = 'strk20.run'

/**
 * The PRF input, public and STABLE: one value for every credential, so a fresh device can ask
 * for the secret in the same prompt that identifies the passkey (a per-credential input would
 * need the credential id first, which a fresh device does not have — two prompts).
 */
export const PRF_INPUT = 'strk20.run/vek/v1'

// ── Caps: every opaque string has one, so no field becomes a side channel ──────────────────
export const MAX_ORIGIN_CHARS = 256
export const MAX_CHALLENGE_CHARS = 128
export const MAX_CREDENTIAL_ID_CHARS = 1400 // base64url of the spec's 1023-byte ceiling
export const MAX_SESSION_CHARS = 64 // 32 random bytes as hex
export const MAX_CLIENT_DATA_CHARS = 4096
export const MAX_ATTESTATION_CHARS = 16_384 // `attestationType: 'none'` is ~300; headroom for packed/self
export const MAX_AUTH_DATA_CHARS = 4096
export const MAX_SIGNATURE_CHARS = 1024
export const MAX_USER_HANDLE_CHARS = 128
export const MAX_REMOTE_ENVELOPE_BYTES = 65_536 // an account is ~200 bytes sealed; 300× headroom

/** WebAuthn's JSON options as the browser library takes them; shaped by the server library. */
export type WebAuthnOptionsJSON = Readonly<Record<string, unknown>> & { readonly challenge: string }

/** A registration response with the client extension results ALREADY STRIPPED. */
export interface RegistrationResponseWire {
  readonly id: string
  readonly rawId: string
  readonly type: 'public-key'
  readonly response: {
    readonly clientDataJSON: string
    readonly attestationObject: string
    readonly transports?: readonly string[]
  }
  readonly authenticatorAttachment?: string
  readonly clientExtensionResults: Readonly<Record<never, never>>
}

/** An assertion response with the client extension results ALREADY STRIPPED. */
export interface AuthenticationResponseWire {
  readonly id: string
  readonly rawId: string
  readonly type: 'public-key'
  readonly response: {
    readonly clientDataJSON: string
    readonly authenticatorData: string
    readonly signature: string
    readonly userHandle?: string
  }
  readonly authenticatorAttachment?: string
  readonly clientExtensionResults: Readonly<Record<never, never>>
}

// ── Bodies ───────────────────────────────────────────────────────────────────────────────

/** `session` present = add a passkey to the vault the session opened; absent = a new vault. */
export interface RegisterOptionsBody {
  readonly origin: string
  readonly session?: string
}
export interface RegisterOptionsReply {
  readonly options: WebAuthnOptionsJSON
}

export interface RegisterVerifyBody {
  readonly challenge: string
  readonly response: RegistrationResponseWire
}
export interface RegisterVerifyReply {
  readonly vaultId: string
  readonly session: string
  readonly credentialId: string
  readonly backedUp: boolean
}

/** `credentialId` present = one known passkey (unlock); absent = discoverable (fresh device). */
export interface AuthOptionsBody {
  readonly origin: string
  readonly credentialId?: string
}
export interface AuthOptionsReply {
  readonly options: WebAuthnOptionsJSON
}

export interface AuthVerifyBody {
  readonly challenge: string
  readonly response: AuthenticationResponseWire
}
export interface AuthVerifyReply {
  readonly vaultId: string
  readonly session: string
  readonly credentialId: string
  readonly backedUp: boolean
  /** `null` when the vault was registered but no sealed copy was ever uploaded. */
  readonly envelope: RemoteEnvelope | null
}

/** `revision` is the one the client last saw; the server refuses (409) when it has moved on. */
export interface EnvelopePutBody {
  readonly session: string
  readonly revision: number
  readonly envelope: RemoteEnvelope
}
export interface EnvelopePutReply {
  readonly revision: number
}
/** The 409 body: the copy the client must open and merge before trying again. */
export interface EnvelopeConflictReply {
  readonly error: string
  readonly revision: number
  readonly envelope: RemoteEnvelope | null
}

export interface EnvelopeDeleteBody {
  readonly session: string
}

// ── Sentences the browser renders verbatim ───────────────────────────────────────────────

export const RECOVERY_UNREACHABLE = 'The recovery service could not be reached. Nothing changed.'

export const RECOVERY_ORIGIN_REFUSED = 'This site is not one the recovery service makes passkeys for.'

export const RECOVERY_NO_ENVELOPE =
  'This passkey is registered, but no sealed copy of the accounts was ever uploaded. Your Recovery File still opens the account.'

export const RECOVERY_ENVELOPE_UNOPENABLE =
  'The sealed copy could not be opened with this passkey. Your Recovery File still opens the account.'

export const RECOVERY_BEHIND = 'The sealed copy is behind this browser. Approve your passkey to sync it.'

export const RECOVERY_CONFLICT =
  'Another browser changed the sealed copy and this one could not open that change. Nothing was overwritten.'

export const RECOVERY_NOT_EMPTY =
  'This browser already holds a wallet. Restoring would write over it — forget the wallet first, or unlock it and add accounts with a Recovery File.'

export const RECOVERY_SESSION_EXPIRED = 'The recovery session ended. Approve your passkey again to continue.'

export const RECOVERY_UNKNOWN_PASSKEY =
  'That passkey is not registered with the recovery service. If you were offered more than one, choose the one named “strk20.run wallet”.'
