// The `/api/recovery/*` calls, one function per door, each returning exactly the wire reply after
// checking its shape. Network failure and relayer refusal are told apart here: the first is
// "could not be reached", the second carries the relayer's own sentence and status.
import {
  RECOVERY_PATHS,
  RECOVERY_UNREACHABLE,
  type AuthOptionsBody,
  type AuthOptionsReply,
  type AuthVerifyBody,
  type AuthVerifyReply,
  type EnvelopeDeleteBody,
  type EnvelopePutBody,
  type RegisterOptionsBody,
  type RegisterOptionsReply,
  type RegisterVerifyBody,
  type RegisterVerifyReply,
} from '@strk20/protocol/recovery-wire'
import { parseRemoteEnvelope, type RemoteEnvelope } from '@strk20/protocol/session-vault'

import { RelayerError, relayerPost } from '@/lib/relayer'

export class RecoveryError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message)
    this.name = 'RecoveryError'
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  try {
    return await relayerPost<T>(path, body)
  } catch (e) {
    if (e instanceof RelayerError) throw new RecoveryError(e.message, e.status)
    throw new RecoveryError(RECOVERY_UNREACHABLE, null)
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

function optionsReply(raw: unknown): { options: RegisterOptionsReply['options'] } {
  const options = isObject(raw) && isObject(raw.options) ? raw.options : null
  if (!options || typeof options.challenge !== 'string') throw new RecoveryError('the recovery service answered without a challenge', null)
  return { options: options as RegisterOptionsReply['options'] }
}

function verifiedReply(raw: unknown): { vaultId: string; session: string; credentialId: string; backedUp: boolean } {
  if (!isObject(raw) || typeof raw.vaultId !== 'string' || typeof raw.session !== 'string' || typeof raw.credentialId !== 'string' || typeof raw.backedUp !== 'boolean') {
    throw new RecoveryError('the recovery service answered in a shape this build does not read', null)
  }
  return { vaultId: raw.vaultId, session: raw.session, credentialId: raw.credentialId, backedUp: raw.backedUp }
}

export const postRegisterOptions = async (body: RegisterOptionsBody): Promise<RegisterOptionsReply> => optionsReply(await post(RECOVERY_PATHS.registerOptions, body))

export const postRegisterVerify = async (body: RegisterVerifyBody): Promise<RegisterVerifyReply> => verifiedReply(await post(RECOVERY_PATHS.registerVerify, body))

export const postAuthOptions = async (body: AuthOptionsBody): Promise<AuthOptionsReply> => optionsReply(await post(RECOVERY_PATHS.authOptions, body))

export async function postAuthVerify(body: AuthVerifyBody): Promise<AuthVerifyReply> {
  const raw = await post<unknown>(RECOVERY_PATHS.authVerify, body)
  const head = verifiedReply(raw)
  const envelope = (raw as Record<string, unknown>).envelope
  return { ...head, envelope: envelope === null ? null : parseRemoteEnvelope(envelope) }
}

export type PutOutcome = { ok: true; revision: number } | { ok: false; conflict: { revision: number; envelope: RemoteEnvelope | null } }

/** A 409 is an outcome, not an error: it hands back the copy this browser must merge with. */
export async function postEnvelopePut(body: EnvelopePutBody): Promise<PutOutcome> {
  try {
    const raw = await relayerPost<unknown>(RECOVERY_PATHS.envelopePut, body)
    if (!isObject(raw) || typeof raw.revision !== 'number') throw new RecoveryError('the recovery service answered without a revision', null)
    return { ok: true, revision: raw.revision }
  } catch (e) {
    if (e instanceof RelayerError && e.status === 409) {
      const revision = typeof e.body.revision === 'number' ? e.body.revision : 0
      const envelope = e.body.envelope === null || e.body.envelope === undefined ? null : parseRemoteEnvelope(e.body.envelope)
      return { ok: false, conflict: { revision, envelope } }
    }
    if (e instanceof RecoveryError) throw e
    if (e instanceof RelayerError) throw new RecoveryError(e.message, e.status)
    throw new RecoveryError(RECOVERY_UNREACHABLE, null)
  }
}

export const postEnvelopeDelete = async (body: EnvelopeDeleteBody): Promise<void> => {
  await post(RECOVERY_PATHS.envelopeDelete, body)
}
