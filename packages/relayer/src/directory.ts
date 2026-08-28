//
// The name directory — the relayer's one OPT-IN public record.
//
// Everything else this process holds is deliberately unreadable (ciphertext rooms) or private
// operational state (budgets, invites). This file is the opposite: a registry whose entire
// function is to be fetched by anyone, because chat search needs a name → address map and the
// only honest place for one is out in the open. What keeps it honest:
//
//   1. A claim must prove control of its address — a Stark signature over H(name, address),
//      verified against the viewing key the pool anchors on-chain (`get_public_key`, one free
//      view call). No proof, no entry: an unverified directory is a squatting service.
//   2. Names are first-come-first-served, ONE per address; re-claiming updates the record and
//      frees the old name. The signature makes "update" and "hijack" different words.
//   3. The ledger is capped. Growth past the cap fails LOUDLY (a refusal the client renders),
//      never by silently evicting someone's name.
//
// The store copies the invite-ledger discipline: atomic writes, and a corrupt file is a hard
// startup failure. This record is small but it is a PUBLIC registry — silently resetting it
// would un-claim every name at once and reopen them to squatters, which is an attack surface,
// not an inconvenience.
//
// THE ONE ASYNC GAP: the public-key read awaits the chain. Every availability check therefore
// happens AFTER the last await, synchronously with the write — two concurrent claims of one
// name cannot both win, because the loser's check runs after the winner's record lands.
//
import { existsSync, readFileSync } from 'node:fs'

import {
  AVATAR_PATTERN,
  DIRECTORY_NAME_PATTERN,
  MAX_AVATAR_CHARS,
  normalizeDirectoryName,
  verifyClaim,
  type ClaimSignature,
  type DirectoryEntry,
} from '../../protocol/src/directory.js'
import { atomicWriteJson } from './sponsorship-store.js'

export interface DirectoryRecord {
  name: string
  address: string
  avatar?: string
  claimedAt: number
}

interface Serialized {
  v: 1
  records: DirectoryRecord[]
}

export const DIRECTORY_CAP = 5_000

export type ClaimOutcome = { ok: true } | { ok: false; status: number; error: string }

export interface Directory {
  claim(input: unknown, now?: number): Promise<ClaimOutcome>
  /**
   * A claim that arrived through a live X OAuth session (`api/x/link.js`, over the
   * server-to-server channel — never the browser). Same proof as `claim` — the viewing-key
   * signature over (name, address) — plus the relayer's own stamp of the session's handle.
   */
  list(): readonly DirectoryEntry[]
  avatar(address: unknown): string | null
}

/** A felt-shaped address: 0x-hex, within the field. Loose on purpose — the chain read is the
 * real gate; this only refuses garbage before it costs an RPC call. */
function isAddress(value: unknown): value is string {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(value)) return false
  try {
    return BigInt(value) > 0n
  } catch {
    return false
  }
}

function isSignature(value: unknown): value is ClaimSignature {
  const s = value as ClaimSignature | null
  return (
    typeof s?.r === 'string' &&
    typeof s.s === 'string' &&
    /^0x[0-9a-fA-F]{1,64}$/.test(s.r) &&
    /^0x[0-9a-fA-F]{1,64}$/.test(s.s)
  )
}

export function openDirectory(opts: {
  file: string
  readPublicKey: (address: string) => Promise<bigint>
  cap?: number
}): Directory {
  const cap = opts.cap ?? DIRECTORY_CAP

  // Keyed by lowercased address — one record per identity is the invariant everything else
  // leans on, so the map enforces it structurally rather than by discipline.
  const byAddress = new Map<string, DirectoryRecord>()

  if (existsSync(opts.file)) {
    // A corrupt PUBLIC registry must stop the process, not silently become an empty one — see
    // the header. JSON.parse throwing here is the desired behaviour.
    const parsed = JSON.parse(readFileSync(opts.file, 'utf8')) as Serialized
    if (parsed.v !== 1 || !Array.isArray(parsed.records)) {
      throw new Error(`directory ledger at ${opts.file} has an unknown shape — refusing to start`)
    }
    for (const record of parsed.records) byAddress.set(record.address.toLowerCase(), record)
  }

  function persist() {
    atomicWriteJson(opts.file, { v: 1, records: [...byAddress.values()] } satisfies Serialized)
  }

  function nameHolder(name: string): DirectoryRecord | null {
    for (const record of byAddress.values()) if (record.name === name) return record
    return null
  }

  // The one verification-and-write path. It took an `x` attestation parameter while the X
  // binding existed; that feature was removed 2026-08-28 and so was the parameter.
  async function applyClaim(input: unknown, now: number): Promise<ClaimOutcome> {
      const body = input as {
        name?: unknown
        address?: unknown
        signature?: unknown
        avatar?: unknown
      } | null

      if (typeof body?.name !== 'string') return { ok: false, status: 400, error: 'name must be a string' }
      const name = normalizeDirectoryName(body.name)
      if (!DIRECTORY_NAME_PATTERN.test(name)) {
        return { ok: false, status: 400, error: 'a name is 3-20 characters of a-z, 0-9 and _' }
      }
      if (!isAddress(body.address)) return { ok: false, status: 400, error: 'address must be a felt' }
      if (!isSignature(body.signature)) {
        return { ok: false, status: 400, error: 'signature must carry hex r and s' }
      }
      let avatar: string | undefined
      if (body.avatar !== undefined) {
        if (typeof body.avatar !== 'string' || !AVATAR_PATTERN.test(body.avatar)) {
          return { ok: false, status: 400, error: 'avatar must be a png, jpeg or webp data URI' }
        }
        if (body.avatar.length > MAX_AVATAR_CHARS) {
          return { ok: false, status: 413, error: `avatar must be at most ${MAX_AVATAR_CHARS} characters` }
        }
        avatar = body.avatar
      }

      let publicKeyX: bigint
      try {
        publicKeyX = await opts.readPublicKey(body.address)
      } catch {
        // The chain could not be read. 502, not 403: "we do not know" must never wear the same
        // status as "you are not who you say", or a network blip reads as an accusation.
        return { ok: false, status: 502, error: 'could not read the chain to verify this claim — try again' }
      }
      if (publicKeyX <= 0n) {
        return { ok: false, status: 403, error: 'that address has not registered with the pool' }
      }
      if (!verifyClaim(name, body.address, body.signature, publicKeyX)) {
        return { ok: false, status: 403, error: 'the signature does not prove control of that address' }
      }

      // ── No awaits below this line — see the header's race note. ──
      const addressKey = body.address.toLowerCase()
      const holder = nameHolder(name)
      if (holder && holder.address.toLowerCase() !== addressKey) {
        return { ok: false, status: 409, error: 'that name is taken' }
      }
      const existing = byAddress.get(addressKey)
      if (!existing && byAddress.size >= cap) {
        return { ok: false, status: 503, error: 'the directory is full' }
      }

      byAddress.set(addressKey, {
        name,
        address: body.address,
        // A re-claim WITHOUT an avatar keeps the one already on file — sending the image again
        // on every rename would punish exactly the client that downscales properly.
        avatar: avatar ?? existing?.avatar,
        claimedAt: existing?.claimedAt ?? now,
      })
      persist()
      return { ok: true }
  }

  return {
    claim(input, now = Date.now()) {
      return applyClaim(input, now)
    },

    list() {
      return [...byAddress.values()]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(({ name, address, avatar }) => ({
          name,
          address,
          hasAvatar: avatar !== undefined,
        }))
    },

    avatar(address) {
      if (!isAddress(address)) return null
      return byAddress.get(address.toLowerCase())?.avatar ?? null
    },
  }
}
