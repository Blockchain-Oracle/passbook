//
// The wire bodies `/recovery/*` accept, parsed by hand. Every field is checked against the cap the
// wire contract names, and a WebAuthn response is RE-SERIALISED to exactly the fields the verifier
// reads — nothing rides past the shape check, and a non-empty `clientExtensionResults` is refused
// outright: the browser must have stripped the PRF output before this body left it.
//
import {
  MAX_ATTESTATION_CHARS,
  MAX_AUTH_DATA_CHARS,
  MAX_CHALLENGE_CHARS,
  MAX_CLIENT_DATA_CHARS,
  MAX_CREDENTIAL_ID_CHARS,
  MAX_ORIGIN_CHARS,
  MAX_REMOTE_ENVELOPE_BYTES,
  MAX_SESSION_CHARS,
  MAX_SIGNATURE_CHARS,
  MAX_USER_HANDLE_CHARS,
  type AuthenticationResponseWire,
  type RegistrationResponseWire,
} from '../../../protocol/src/recovery-wire.js'
import { parseRemoteEnvelope, type RemoteEnvelope } from '../../../protocol/src/vault-envelope.js'

const B64URL = /^[A-Za-z0-9_-]+$/
const TRANSPORTS = new Set(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])

function b64url(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value === '' || value.length > max || !B64URL.test(value)) {
    throw new Error(`${name} must be base64url of at most ${max} characters`)
  }
  return value
}

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== 'string' || value === '' || value.length > max) throw new Error(`${name} must be a string of at most ${max} characters`)
  return value
}

function origin(value: unknown): string {
  const raw = text(value, 'origin', MAX_ORIGIN_CHARS)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error('origin must be an absolute URL')
  }
  if (url.origin !== raw) throw new Error('origin must be a bare origin — scheme, host and port only')
  return raw
}

function bag(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('body must be a JSON object')
  return raw as Record<string, unknown>
}

/** Absent or exactly `{}` — a client that forwards extension results speaks a wire this server refuses. */
function noExtensionResults(value: unknown) {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Object.keys(value).length !== 0) {
    throw new Error('clientExtensionResults must be empty — extension results never leave the browser')
  }
}

function attachment(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (value !== 'platform' && value !== 'cross-platform') throw new Error('authenticatorAttachment must be platform or cross-platform')
  return value
}

function transports(value: unknown): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > 8 || !value.every((t) => typeof t === 'string' && TRANSPORTS.has(t))) {
    throw new Error('transports must be a short list of known transport names')
  }
  return value as string[]
}

export function parseRegisterOptionsBody(raw: unknown): { origin: string; session?: string } {
  const body = bag(raw)
  return {
    origin: origin(body.origin),
    ...(body.session !== undefined ? { session: text(body.session, 'session', MAX_SESSION_CHARS) } : {}),
  }
}

export function parseRegisterVerifyBody(raw: unknown): { challenge: string; response: RegistrationResponseWire } {
  const body = bag(raw)
  const r = bag(body.response)
  const inner = bag(r.response)
  noExtensionResults(r.clientExtensionResults)
  if (r.type !== 'public-key') throw new Error('response.type must be public-key')
  const tr = transports(inner.transports)
  const at = attachment(r.authenticatorAttachment)
  return {
    challenge: b64url(body.challenge, 'challenge', MAX_CHALLENGE_CHARS),
    response: {
      id: b64url(r.id, 'response.id', MAX_CREDENTIAL_ID_CHARS),
      rawId: b64url(r.rawId, 'response.rawId', MAX_CREDENTIAL_ID_CHARS),
      type: 'public-key',
      response: {
        clientDataJSON: b64url(inner.clientDataJSON, 'clientDataJSON', MAX_CLIENT_DATA_CHARS),
        attestationObject: b64url(inner.attestationObject, 'attestationObject', MAX_ATTESTATION_CHARS),
        ...(tr ? { transports: tr } : {}),
      },
      ...(at ? { authenticatorAttachment: at } : {}),
      clientExtensionResults: {},
    },
  }
}

export function parseAuthOptionsBody(raw: unknown): { origin: string; credentialId?: string } {
  const body = bag(raw)
  return {
    origin: origin(body.origin),
    ...(body.credentialId !== undefined ? { credentialId: b64url(body.credentialId, 'credentialId', MAX_CREDENTIAL_ID_CHARS) } : {}),
  }
}

export function parseAuthVerifyBody(raw: unknown): { challenge: string; response: AuthenticationResponseWire } {
  const body = bag(raw)
  const r = bag(body.response)
  const inner = bag(r.response)
  noExtensionResults(r.clientExtensionResults)
  if (r.type !== 'public-key') throw new Error('response.type must be public-key')
  const at = attachment(r.authenticatorAttachment)
  const userHandle = inner.userHandle === undefined ? undefined : b64url(inner.userHandle, 'userHandle', MAX_USER_HANDLE_CHARS)
  return {
    challenge: b64url(body.challenge, 'challenge', MAX_CHALLENGE_CHARS),
    response: {
      id: b64url(r.id, 'response.id', MAX_CREDENTIAL_ID_CHARS),
      rawId: b64url(r.rawId, 'response.rawId', MAX_CREDENTIAL_ID_CHARS),
      type: 'public-key',
      response: {
        clientDataJSON: b64url(inner.clientDataJSON, 'clientDataJSON', MAX_CLIENT_DATA_CHARS),
        authenticatorData: b64url(inner.authenticatorData, 'authenticatorData', MAX_AUTH_DATA_CHARS),
        signature: b64url(inner.signature, 'signature', MAX_SIGNATURE_CHARS),
        ...(userHandle ? { userHandle } : {}),
      },
      ...(at ? { authenticatorAttachment: at } : {}),
      clientExtensionResults: {},
    },
  }
}

export function parseEnvelopePutBody(raw: unknown): { session: string; revision: number; envelope: RemoteEnvelope } {
  const body = bag(raw)
  if (typeof body.revision !== 'number' || !Number.isInteger(body.revision) || body.revision < 0) {
    throw new Error('revision must be a non-negative integer')
  }
  const envelope = parseRemoteEnvelope(body.envelope)
  if (!envelope) throw new Error('envelope must be a v2 remote envelope with passkey wrappers only')
  if (JSON.stringify(envelope).length > MAX_REMOTE_ENVELOPE_BYTES) throw new Error(`envelope must be at most ${MAX_REMOTE_ENVELOPE_BYTES} bytes`)
  return { session: text(body.session, 'session', MAX_SESSION_CHARS), revision: body.revision, envelope }
}

export function parseEnvelopeDeleteBody(raw: unknown): { session: string } {
  return { session: text(bag(raw).session, 'session', MAX_SESSION_CHARS) }
}
