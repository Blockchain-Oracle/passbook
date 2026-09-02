// The two WebAuthn ceremonies, through @simplewebauthn/browser, with one rule enforced here: the
// PRF output is read from the credential and handed back as bytes, and the object that goes to
// the relayer is rebuilt by hand with `clientExtensionResults: {}`. The library returns
// `getClientExtensionResults()` verbatim — an ArrayBuffer that JSON would serialise as `{}` by
// accident — and an accident is not a boundary.
//
// The PRF is asked for on `get()` only. `create()` may report `enabled` without a result, and a
// wallet sealed with nothing is a wallet nobody opens.
import { PASSKEY_ERROR_TEXT, type PasskeyErrorKind } from '@strk20/protocol/passkey-copy'
import { PRF_INPUT, type AuthenticationResponseWire, type RegistrationResponseWire, type WebAuthnOptionsJSON } from '@strk20/protocol/recovery-wire'

export class PasskeyError extends Error {
  constructor(
    readonly kind: PasskeyErrorKind,
    detail?: string,
  ) {
    super(detail ? `${PASSKEY_ERROR_TEXT[kind]} (${detail})` : PASSKEY_ERROR_TEXT[kind])
  }
}

type Lib = typeof import('@simplewebauthn/browser')

// Lazy: WebAuthn code belongs in the chunk of the screen that prompts, not the shell.
const lib = (): Promise<Lib> => import('@simplewebauthn/browser')

/** A missing platform authenticator is NOT unsupported — a phone passkey by QR still works. */
export async function passkeySupport(): Promise<'unsupported' | 'available'> {
  const { browserSupportsWebAuthn } = await lib()
  return browserSupportsWebAuthn() && typeof PublicKeyCredential !== 'undefined' ? 'available' : 'unsupported'
}

function toPasskeyError(e: unknown, WebAuthnError: Lib['WebAuthnError']): PasskeyError {
  if (e instanceof PasskeyError) return e
  if (e instanceof WebAuthnError) {
    const cause = e.cause as { name?: string } | undefined
    switch (e.code) {
      case 'ERROR_CEREMONY_ABORTED':
        return new PasskeyError('closed')
      case 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY':
        return cause?.name === 'NotAllowedError' ? new PasskeyError('closed') : new PasskeyError('failed', e.message)
      case 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED':
        return new PasskeyError('already-registered')
      case 'ERROR_AUTHENTICATOR_MISSING_DISCOVERABLE_CREDENTIAL_SUPPORT':
      case 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT':
        return new PasskeyError('unsupported')
      default:
        return new PasskeyError('failed', e.message)
    }
  }
  const message = e instanceof Error ? e.message : String(e)
  if (/not supported/i.test(message)) return new PasskeyError('unsupported')
  if (/not completed/i.test(message)) return new PasskeyError('closed')
  return new PasskeyError('failed', message)
}

/** Registration. Returns the wire shape only — nothing the relayer does not read. */
export async function createPasskey(options: WebAuthnOptionsJSON): Promise<RegistrationResponseWire> {
  const { startRegistration, WebAuthnError } = await lib()
  try {
    const r = await startRegistration({ optionsJSON: options as unknown as Parameters<Lib['startRegistration']>[0]['optionsJSON'] })
    return {
      id: r.id,
      rawId: r.rawId,
      type: 'public-key',
      response: {
        clientDataJSON: r.response.clientDataJSON,
        attestationObject: r.response.attestationObject,
        ...(r.response.transports ? { transports: r.response.transports } : {}),
      },
      ...(r.authenticatorAttachment ? { authenticatorAttachment: r.authenticatorAttachment } : {}),
      clientExtensionResults: {},
    }
  } catch (e) {
    throw toPasskeyError(e, WebAuthnError)
  }
}

type PrfOutputs = { prf?: { results?: { first?: ArrayBuffer | ArrayBufferView } } }

/**
 * Assertion, with the PRF evaluated on the stable public input. The bytes come back separately
 * and never enter the response object; `prf` is `null` when the provider evaluated nothing.
 */
export async function assertPasskey(options: WebAuthnOptionsJSON): Promise<{ response: AuthenticationResponseWire; prf: Uint8Array | null }> {
  const { startAuthentication, WebAuthnError } = await lib()
  // The library spreads `optionsJSON` into the native call, so the extension input is a real buffer here.
  const withPrf = { ...options, extensions: { ...((options.extensions as object | undefined) ?? {}), prf: { eval: { first: new TextEncoder().encode(PRF_INPUT) } } } }
  try {
    const r = await startAuthentication({ optionsJSON: withPrf as unknown as Parameters<Lib['startAuthentication']>[0]['optionsJSON'] })
    const first = (r.clientExtensionResults as PrfOutputs).prf?.results?.first
    const prf = first ? new Uint8Array(ArrayBuffer.isView(first) ? first.buffer.slice(first.byteOffset, first.byteOffset + first.byteLength) : first.slice(0)) : null
    return {
      response: {
        id: r.id,
        rawId: r.rawId,
        type: 'public-key',
        response: {
          clientDataJSON: r.response.clientDataJSON,
          authenticatorData: r.response.authenticatorData,
          signature: r.response.signature,
          ...(r.response.userHandle ? { userHandle: r.response.userHandle } : {}),
        },
        ...(r.authenticatorAttachment ? { authenticatorAttachment: r.authenticatorAttachment } : {}),
        clientExtensionResults: {},
      },
      prf,
    }
  } catch (e) {
    throw toPasskeyError(e, WebAuthnError)
  }
}

/**
 * Options for an unlock with no relayer in the loop: a random challenge nobody verifies, because
 * the ciphertext is the verifier — a wrong passkey yields a wrong PRF, and the wrapper refuses.
 */
export function localAssertionOptions(credentialId: string): WebAuthnOptionsJSON {
  const challenge = new Uint8Array(32)
  crypto.getRandomValues(challenge)
  return {
    challenge: btoa(String.fromCharCode(...challenge)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
    rpId: location.hostname,
    allowCredentials: [{ id: credentialId, type: 'public-key' }],
    userVerification: 'required',
    timeout: 60_000,
  }
}
