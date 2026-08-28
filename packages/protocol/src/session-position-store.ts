//
// Where position secrets live — the bearer material that claims a bet or a launch purchase.
//
// ── THIS FILE HOLDS MONEY, NOT A RECORD OF MONEY ──────────────────────────────────────────
//
// `session-invite-store.ts` persists what a user TYPED: a note-to-self about a transfer that has
// not happened. This one persists the thing itself. `markets.cairo` and `launch.cairo` key every
// position by `poseidon(secret)` and pay whoever reveals the secret — no address, no recovery, no
// second copy. A lost secret is a lost position, indistinguishable from never having bet.
//
// That is not a flaw in the contracts; it is the privacy claim. A bet that wrote the bettor's
// address on chain would be a bet anyone could trace, so the position had to be bearer, and the
// cost of bearer is that the client is the only party who can hold the claim.
//
// ── SO IT RIDES THE SAME BACKUP SURFACE AS NOTE MATERIAL ──────────────────────────────────
//
// Notes are already client-held bearer state and the app already has a ceremony for getting them
// out of one browser and into a user's own keeping. Position secrets go through the same door:
// `backupPayload` is what the backup surface serialises, and it is deliberately a plain,
// self-describing object rather than anything that needs this module to read it back. A backup you
// need the app to interpret is a backup that dies with the app.
//
// ── WHAT IS SAFE TO SHOW AND WHAT IS NOT ──────────────────────────────────────────────────
//
// The COMMITMENT is public — it is on chain, in `BetPlaced` and `Bought` events, by design. The
// SECRET is not. Every read path here returns records carrying both, because the app needs the
// commitment to look a position up and the secret to claim it; anything that renders a position
// must show the commitment and never the secret, which is a rule for the surface and stated here
// because this is where a reviewer will come looking for it.
//

import type { SessionStore } from './session-store.js'
import { SESSION_KEYS } from './session-store.js'

/** Which contract a position belongs to. They share a shape and nothing else. */
export type PositionVenue = 'market' | 'launch' | 'governance'

/** One bearer claim, everything needed to find it again and to spend it. */
export interface StoredPosition {
  venue: PositionVenue
  /** The market or launch this position is in. */
  id: number
  /** Bearer material. Never rendered, never logged, never sent anywhere but the pool. */
  secret: string
  /** `poseidon(secret)`. Public — it is already on chain. Safe to render and to search by. */
  commitment: string
  /** Unix milliseconds, so a surface can sort without re-deriving anything from the chain. */
  createdAt: number
  /**
   * What this position is, in the user's terms — "UP at $77,490", "4 units of PBK".
   *
   * Stored rather than re-derived because the market it names may have settled and been swept out
   * of the client's view by the time anyone opens the claim panel, and "a position you cannot
   * describe" is indistinguishable from a bug.
   */
  label?: string
}

export const POSITION_RECORD_VERSION = 1

interface PositionRecord {
  version: number
  positions: StoredPosition[]
}

/**
 * What `read` answers, and the reason it is not just an array.
 *
 * A parse failure here is different in kind from one in any other store: the data that failed to
 * parse is money. Returning `[]` would render an empty positions list, which reads exactly like
 * "you have no bets" — and a user who believes that stops looking for the backup that would have
 * recovered them. So a corrupt record is its own outcome, and the surface is expected to say so
 * loudly rather than showing an empty state.
 */
export type StoredPositions =
  | { readonly state: 'ok'; readonly positions: StoredPosition[] }
  | { readonly state: 'empty' }
  | { readonly state: 'corrupt'; readonly because: string; readonly raw: string }

const FELT = /^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/

function isPosition(value: unknown): value is StoredPosition {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    (p.venue === 'market' || p.venue === 'launch') &&
    typeof p.id === 'number' &&
    Number.isInteger(p.id) &&
    p.id >= 0 &&
    typeof p.secret === 'string' &&
    FELT.test(p.secret) &&
    typeof p.commitment === 'string' &&
    FELT.test(p.commitment) &&
    typeof p.createdAt === 'number' &&
    (p.label === undefined || typeof p.label === 'string')
  )
}

export function parseStoredPositions(raw: string | null): StoredPositions {
  if (raw === null || raw.trim() === '') return { state: 'empty' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { state: 'corrupt', because: `the stored record is not JSON: ${String(e)}`, raw }
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return { state: 'corrupt', because: 'the stored record is not an object', raw }
  }

  const record = parsed as Partial<PositionRecord>
  if (record.version !== POSITION_RECORD_VERSION) {
    return {
      state: 'corrupt',
      because: `the stored record is version ${String(record.version)}, and this app writes ${POSITION_RECORD_VERSION}`,
      raw,
    }
  }
  if (!Array.isArray(record.positions)) {
    return { state: 'corrupt', because: 'the stored record carries no positions array', raw }
  }

  // ONE BAD ENTRY DOES NOT DISCARD THE REST. Each position is independent bearer material, so a
  // record whose third entry is malformed still holds four claimable positions — throwing them
  // away to keep the parser tidy would be destroying money to avoid a branch.
  const positions = record.positions.filter(isPosition)
  if (positions.length === 0 && record.positions.length > 0) {
    return { state: 'corrupt', because: 'every stored position was malformed', raw }
  }
  return positions.length === 0 ? { state: 'empty' } : { state: 'ok', positions }
}

export function serializePositions(positions: readonly StoredPosition[]): string {
  const record: PositionRecord = { version: POSITION_RECORD_VERSION, positions: [...positions] }
  return JSON.stringify(record)
}

export interface PositionStore {
  read(): StoredPositions
  /** Everything claimable, or an empty array — for surfaces that cannot act on `corrupt`. */
  list(): StoredPosition[]
  /** Adds one position. Refuses a commitment already stored; see below. */
  add(position: StoredPosition): void
  /** Drops one by commitment, once it has been claimed and can never be claimed again. */
  remove(commitment: string): void
  /** Everything, as a plain object for the backup ceremony to serialise. */
  backupPayload(): { version: number; positions: StoredPosition[] }
}

export function sessionPositionStore(store: SessionStore): PositionStore {
  const list = (): StoredPosition[] => {
    const read = parseStoredPositions(store.read(SESSION_KEYS.positionSecrets))
    return read.state === 'ok' ? read.positions : []
  }

  return {
    read: () => parseStoredPositions(store.read(SESSION_KEYS.positionSecrets)),
    list,
    add(position) {
      if (!isPosition(position)) {
        throw new Error('refusing to store a position that is not a well-formed bearer record')
      }
      const existing = list()
      // A duplicate commitment is not a harmless repeat: the contracts refuse a reused commitment
      // outright, so two records sharing one means one of them names a position that does not
      // exist — and there is no way to tell which from here.
      if (existing.some((p) => BigInt(p.commitment) === BigInt(position.commitment))) {
        throw new Error(`a position with commitment ${position.commitment} is already stored`)
      }
      store.write(SESSION_KEYS.positionSecrets, serializePositions([...existing, position]))
    },
    remove(commitment) {
      const kept = list().filter((p) => BigInt(p.commitment) !== BigInt(commitment))
      store.write(SESSION_KEYS.positionSecrets, serializePositions(kept))
    },
    backupPayload: () => ({ version: POSITION_RECORD_VERSION, positions: list() }),
  }
}
