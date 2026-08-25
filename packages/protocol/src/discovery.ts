//
// Discovery — finding the user's own notes, indexer-free (FR-011a / FR-015, story 1.9).
//
// This module answers one question: what does this account hold, and as of which block. It is
// the producer for three consumers that already exist as seams — `backup-cadence.ts`'s
// `ShieldedBalancePresence`, `send.ts`'s `SendWalletData`, and the activity record — and it
// holds nothing of its own between calls.
//
// ── WHY THE WALK IS PURE POOL VIEWS, AND WHAT THAT BUYS ──────────────────────────────────
//
// The SDK ships two discovery providers. `IndexerDiscoveryProvider` posts the VIEWING KEY to a
// hosted service, which then reads the pool on your behalf; `ContractDiscoveryProvider` walks
// the pool's own view entrypoints from wherever it is running. We use the second, and the
// difference is not a preference: the viewing key is the key that decrypts every note this
// account has ever received, and handing it to a host makes that host a party to the account
// forever. Walking the pool directly means the key is used here and never transmitted.
//
// The cost is round trips — roughly two view calls per note, plus a bisect over channels and a
// scan over each subchannel. That is the trade this story took deliberately, with the walk
// timed live on mainnet (`test/discovery-live.test.ts`).
//
// ── THE ONE `/testing` IMPORT IN THE REPOSITORY, AND THE SWAP POINT ───────────────────────
//
// `ContractDiscoveryProvider` and the two Cairo-derived hashes below are reachable only through
// the package's `/testing` subpath: the vendored 0.14.3-rc.2 exports map publishes `.`,
// `./testing`, `./browser`, `./browser/testing` and `./abi`, and nothing under `./internal/*`.
// The provider itself is not a test double — it is the production indexer-free walk, filed
// under `/testing` upstream. Upstream #121 may later publish it properly; when it does, THIS
// FILE IS THE ONLY EDIT, which is why every consumer imports the two hashes from here rather
// than reaching for the subpath itself.
//
// A BUNDLING HAZARD EPIC 6 INHERITS, recorded here because here is where it is created. The
// `/testing` barrel also re-exports `./devnet.js`, which imports `fs`, `path` and `url` at the
// top level and pulls in the `starknet-devnet` package — none of which belong in a browser
// bundle (AD-4). Nothing in this file uses them, and named ESM imports are shakeable, but the
// package publishes no `sideEffects: false` and `devnet.js` evaluates `join(...)` at module
// scope, so a bundler is entitled to keep it. The published tarball also ships no `dist/browser`
// despite the exports map declaring it, so the prebundled route is not available either. The
// app build has to alias or stub those three built-ins; this is the module to point the alias at.
//

import { Contract, type BigNumberish, type RpcProvider } from 'starknet'
import {
  ContractDiscoveryProvider,
  compute_note_id,
  compute_nullifier,
  type PoolContractInterface,
} from '@starkware-libs/starknet-privacy-sdk/testing'
import { PrivacyPoolABI } from '@starkware-libs/starknet-privacy-sdk/abi'
import { NET } from './constants.js'
import { deriveViewingKey } from './identity.js'
import { withFallback } from './rpc.js'
import type { ShieldedBalancePresence } from './backup-cadence.js'
import type { SendChannelData, SendNoteData, SendWalletData } from './send.js'

/**
 * The SDK's own Cairo-derived hashes, re-exported so the rule that they are IMPORTED and never
 * reimplemented survives contact with the modules that need them.
 *
 * `activity.ts` recomputes every historical note id and nullifier from the discovered registry
 * in order to recognise this account's rows in a public event stream. Those two hashes are pool
 * consensus rules — a second copy of either in this repository would be a protocol rule nobody
 * would notice drifting, and the symptom would be a feed that quietly stopped matching.
 */
export { compute_note_id, compute_nullifier }

/**
 * Every pool view entrypoint this story depends on, checked at construction.
 *
 * The eight the SDK's walk calls, plus `get_public_key`, which `discoverWallet` calls itself.
 * The remaining `PoolContractInterface` members are forwarded but not required — nothing here
 * calls them, and refusing to build over a pool that merely lacks `get_fee_collector` would be
 * a stricter rule than the walk actually needs.
 */
const POOL_ENTRYPOINTS = [
  'channel_exists',
  'get_num_of_channels',
  'get_channel_info',
  'get_subchannel_info',
  'get_outgoing_channel_info',
  'get_note',
  'nullifier_exists',
  'get_public_key',
] as const

/**
 * A hex felt, lower-case and unpadded — the one spelling every model in this story uses.
 *
 * GUARDED IN BOTH DIRECTIONS, because both failures are silent. A negative bigint formats as
 * `0x-1`, which is not a felt and which `BigInt()` will refuse the next time anything reads it
 * back — so a sign error would travel as a plausible-looking id all the way to a rendered
 * activity row. And `BigInt('<!DOCTYPE html>')` throws a bare `SyntaxError` from inside what a
 * caller experiences as reading their own notes; the realistic source is a proxy rewriting an
 * RPC error into a 200 with an HTML body, which is the same trap `auditorKeyFrom` documents.
 */
export function toFeltHex(value: bigint | string | number): string {
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error(`a felt must be a whole number, not ${value}`)
  }
  let felt: bigint
  try {
    felt = BigInt(value)
  } catch {
    throw new Error(`not a felt: ${JSON.stringify(String(value).slice(0, 64))}`)
  }
  if (felt < 0n) throw new Error(`a felt cannot be negative, and this one is: ${felt}`)
  return `0x${felt.toString(16)}`
}

/**
 * A value the SDK handed back, as a bigint, or a classified failure.
 *
 * The `/testing` subpath's types promise `bigint` for note ids, amounts and channel keys, and
 * those types are the vendored SDK's word rather than a runtime guarantee — a `NoteId` is
 * declared `BigNumberish`, and the walk's own `toBigInt` accepts strings. Trusting the
 * declaration means a hex-string id would flow into `compute_note_id` and into a `Map` key as
 * a string, silently failing every Personal-feed match while nothing threw. Coercing here
 * makes the boundary explicit and turns junk into a named failure instead of a wrong feed.
 */
function feltFromSdk(value: unknown, field: string): bigint {
  if (typeof value === 'bigint') return value
  if (typeof value === 'number' && !Number.isInteger(value)) {
    throw new Error(`the SDK returned a non-integer ${field}: ${value}`)
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error(`the SDK returned a ${typeof value} for ${field}, which is not a felt`)
  }
  try {
    return BigInt(value)
  } catch {
    throw new Error(
      `the SDK returned a non-numeric ${field}: ${JSON.stringify(String(value).slice(0, 64))}`,
    )
  }
}

/**
 * One note this account holds, in this story's own shape.
 *
 * Richer than `SendNoteData` by exactly one field. `open` is not decoration: an open note's
 * amount sits in pool storage as plaintext, an encrypted note's does not, and the activity
 * record and the disclosure copy both turn on which kind a row is. `SendNoteData`'s shape is
 * story 1.16's and is not ours to grow, so this carries the extra field and `toSendWallet`
 * projects it away.
 */
export interface DiscoveredNote {
  id: bigint
  token: string
  amount: bigint
  witness: { channelKey: bigint; nonce: number; r: bigint }
  /** Who sent it. For a change note or a self-transfer, this account. */
  sender: string
  /** True when the amount above was read as plaintext rather than decrypted. */
  open: boolean
}

/** One incoming channel — a counterparty who has opened a channel TO this account. */
export interface DiscoveredIncomingChannel {
  /** The sender on the other end. */
  counterparty: string
  /**
   * The channel key. SESSION-ONLY, and the reason this whole result may never be persisted:
   * it decrypts every note that channel has ever carried, spent ones included.
   */
  channelKey: bigint
  /**
   * Per token, the exclusive upper bound of note indices ever written. Index `n` exists for
   * every `0 <= n < nextIndex`, SPENT ONES INCLUDED — which is what makes the Personal feed
   * possible without keeping anything: every historical id and nullifier is recomputable.
   *
   * NOT THE SDK'S CURSOR VALUE. `ContractDiscoveryProvider` advances its `noteIndexes` only
   * inside `addNoteIfNotSpent`, so a spent note never moves it — an account that has spent
   * everything comes back with a cursor of 0 and no way to recognise its own spends in a
   * `NoteUsed` stream. `extendSpentSlots` walks past the SDK's bound to the real one.
   */
  noteSlots: { token: string; nextIndex: number }[]
}

/**
 * Everything the walk learned, beyond the spendable notes themselves.
 *
 * NEVER PERSISTED. `session.ts`'s storage boundary names this module's output explicitly on the
 * must-never list, and `test/discovery-never-persisted.test.ts` holds it there structurally.
 */
export interface DiscoveredRegistry {
  incoming: DiscoveredIncomingChannel[]
  /** Outgoing channels, keyed by the address each points at. */
  outgoing: SendChannelData[]
  /** The live outgoing-channel count — the index a NEW channel must open at (FR-060). */
  outgoingTotal: number
}

/**
 * The result of one discovery attempt.
 *
 * A UNION RATHER THAN A NULLABLE RESULT, and that is the fail-closed rule made structural. The
 * boundary this story is held to is that `'present'`/`'absent'` may come only from a COMPLETED
 * walk, and everything else is `'unknown'`. Returned as one flat object with an empty note
 * list on failure, the commonest possible caller — read `.notes`, sum it, render it — would
 * show a confident zero balance to a user whose RPC was simply unreachable. There is no field
 * to read on the failed variant, so that caller does not compile. `PoolHealth` in `pool.ts` is
 * the same shape for the same reason.
 */
export type DiscoveryResult =
  | {
      state: 'walked'
      /** The 1.16 seam: exactly what `planSend` takes as caller-supplied wallet data. */
      wallet: SendWalletData
      /** The richer model balances and the activity record are built from. */
      notes: DiscoveredNote[]
      registry: DiscoveredRegistry
      /** The height this walk was read BESIDE. See `blockNumber` on the interface below. */
      blockNumber: number
      /** The 1.8 seam. Only ever `'present'` or `'absent'` on this variant. */
      presence: Exclude<ShieldedBalancePresence, 'unknown'>
      /** False when `get_public_key` answered zero — a different sentence from an empty book. */
      registered: boolean
    }
  | {
      state: 'unreachable'
      presence: 'unknown'
      /** What actually went wrong, for a log. Never rendered as-is — copy is in activity-copy. */
      reason: string
    }

/**
 * The pool as the SDK's `PoolContractInterface` — a PLAIN OBJECT of forwarding methods.
 *
 * The forwarding layer is not ceremony, and it is not optional. A starknet.js
 * `Contract.typedv2()` defines its entrypoints as data properties that are neither writable nor
 * configurable, and the SDK's own rate limiter wraps whatever it is given in a `Proxy` whose
 * `get` trap returns a throttled wrapper. Handing back a different value for a property of that
 * kind violates a JS proxy invariant, so the engine throws a `TypeError` naming
 * `get_outgoing_channel_info` the moment the walk reaches the outgoing-channel scan.
 *
 * Verified live: handing `typedv2()` straight to `new ContractDiscoveryProvider(pool, {rateLimit})`
 * fails exactly there, and — the part that makes it worth a paragraph — it fails as an
 * unhandled rejection inside the SDK's fire-and-forget scan, so the walk surfaces as a plain
 * `unreachable` and a test tolerating network blips passes over a broken build.
 *
 * A plain object's properties are configurable, so the proxy is legal over this. It also makes
 * the surface the walk is allowed to touch explicit, which is worth having on its own: these
 * are view entrypoints and nothing else, so no code path here can write.
 *
 * Built per provider rather than cached, because `withFallback` hands a different provider per
 * attempt and a contract bound to a dead host would retry against the same dead host.
 *
 * THROWS if the ABI does not expose every entrypoint the walk needs — see `POOL_ENTRYPOINTS`.
 */
export function poolContractFor(
  provider: RpcProvider,
  poolAddress: string = NET.pool,
): PoolContractInterface {
  const contract = new Contract({
    abi: PrivacyPoolABI,
    address: poolAddress,
    providerOrAccount: provider,
  }).typedv2(PrivacyPoolABI)

  // `BigNumberish` in, and the interface's own types out. Every entrypoint takes a felt-ish
  // value, which is the same latitude `PoolContractInterface` grants, so a caller may pass a
  // hex string, a bigint or a number without converting first.
  type Felt = BigNumberish
  const call = contract as unknown as Record<string, (...args: Felt[]) => Promise<never>>

  // CHECKED AT CONSTRUCTION, not at first call, and the difference is the whole point. The
  // return type says `PoolContractInterface`, but the cast above buys nothing at runtime: if
  // the vendored ABI renames or drops an entrypoint, `call.get_note` is `undefined` and the
  // non-null assertion turns it into a `TypeError` thrown from deep inside the SDK's walk —
  // which `discoverWallet` then classifies as `unreachable`, i.e. "your RPC is down" for a
  // fault that is really "this build cannot talk to this pool". Checking here fails once,
  // immediately, and names the entrypoint that went missing.
  const missing = POOL_ENTRYPOINTS.filter((name) => typeof call[name] !== 'function')
  if (missing.length > 0) {
    throw new Error(
      `the pool ABI does not expose ${missing.join(', ')} — this build cannot walk this pool. ` +
        'The vendored SDK ABI and the deployed class have diverged.',
    )
  }

  return {
    channel_exists: (marker) => call.channel_exists!(marker),
    get_num_of_channels: (recipient) => call.get_num_of_channels!(recipient),
    get_channel_info: (recipient, index) => call.get_channel_info!(recipient, index),
    subchannel_exists: (marker) => call.subchannel_exists!(marker),
    get_subchannel_info: (id) => call.get_subchannel_info!(id),
    get_outgoing_channel_info: (id) => call.get_outgoing_channel_info!(id),
    get_note: (noteId) => call.get_note!(noteId),
    nullifier_exists: (nullifier) => call.nullifier_exists!(nullifier),
    get_public_key: (address) => call.get_public_key!(address),
    get_enc_private_key: (address) => call.get_enc_private_key!(address),
    get_auditor_public_key: () => call.get_auditor_public_key!(),
    get_fee_amount: () => call.get_fee_amount!(),
    get_fee_collector: () => call.get_fee_collector!(),
    get_proof_validity_blocks: () => call.get_proof_validity_blocks!(),
  }
}

/**
 * How hard the walk is allowed to hit the RPC host.
 *
 * ON BY DEFAULT, which is a change from the SDK's own behaviour and is deliberate. Passing no
 * `rateLimit` leaves `ContractDiscoveryProvider` completely unthrottled: it fires the channel
 * bisect, every subchannel scan and two calls per note concurrently and with no retry
 * (`contract-discovery.js` wraps the pool only when the option is present). Against a public
 * RPC host that is how a large account gets rate-limited partway through — and a refusal
 * partway through is `'unknown'`, so the whole balance disappears rather than arriving slowly.
 *
 * The numbers are the SDK's own documented defaults, applied rather than skipped. `maxRetries`
 * is the half that matters most: it turns a single transient refusal into a completed walk
 * instead of a session that cannot say what it holds.
 */
export const DEFAULT_DISCOVERY_RATE_LIMIT = {
  concurrency: 8,
  maxRetries: 3,
  baseDelayMs: 100,
} as const

/** What `discoverWallet` needs beyond the account. Every seam defaults to the real thing. */
export interface DiscoverOptions {
  /** Overrides `DEFAULT_DISCOVERY_RATE_LIMIT`. Pass `null` to walk unthrottled. */
  rateLimit?: { concurrency?: number; maxRetries?: number; baseDelayMs?: number } | null
  /** Injected by tests: a pool interface to walk instead of the live one. */
  pool?: PoolContractInterface
  /** Injected by tests: the block height to stamp with, instead of a live read. */
  blockNumber?: number
}

/**
 * Walks the pool for everything this account holds, and stamps it with a block height.
 *
 * THE STAMP IS ADJACENT, NOT PINNED, and saying so is the honest half of the feature. The SDK
 * walk accepts a `blockIdentifier` and never passes it to a single call (verified in
 * `dist/internal/contract-discovery.js` — the parameter is declared and unread), so there is no
 * way to pin the walk short of reimplementing it. What we do instead is what `readPoolHealth`
 * does: read the height from the SAME provider, inside the same `withFallback` attempt, so the
 * two cannot come from two independently-synced hosts. The result is "as of about block N" and
 * the copy says exactly that. Pinning the walk would mean owning a reimplementation of it, and
 * a walk we wrote would be less trustworthy than the one we are stamping.
 *
 * FAILURE IS ONE SHAPE. Any throw from any leg — an exhausted RPC, a host that answered
 * garbage, a walk that stopped halfway — arrives here as `unreachable`/`'unknown'`, because
 * from the outside those are the same fact: we do not know what this account holds. The one
 * thing that is NOT a failure is an account with nothing in it, which completes normally and
 * answers `'absent'`.
 */
export async function discoverWallet(
  address: string,
  accountKey: string,
  options: DiscoverOptions = {},
): Promise<DiscoveryResult> {
  const viewingKey = deriveViewingKey(accountKey, NET.chainId, NET.pool)
  try {
    return await withFallback(async (provider) => {
      const pool = options.pool ?? poolContractFor(provider)
      // Read the height FIRST, from the provider that is about to do the walking. Reading it
      // afterwards would stamp the result with a block the walk had not seen, which is the
      // wrong direction to be wrong in: a stamp must never claim to include something it
      // could not have.
      const blockNumber = options.blockNumber ?? (await provider.getBlockNumber())
      const registered = BigInt(await pool.get_public_key(address)) !== 0n
      return await walk(pool, address, viewingKey, blockNumber, registered, options)
    })
  } catch (e) {
    return { state: 'unreachable', presence: 'unknown', reason: String((e as Error)?.message ?? e) }
  }
}

/**
 * The walk itself, once a provider and a height are settled.
 *
 * An unregistered account is walked anyway rather than short-circuited, and the reason is that
 * the two facts are independent: the pool's channel storage is keyed by address and does not
 * consult the public-key slot, so an address could in principle be sent to before it registers.
 * Short-circuiting would turn that into a silent empty book. The walk over an unregistered
 * address is cheap — one `get_num_of_channels` that answers zero — and it is measured in the
 * live test.
 */
async function walk(
  pool: PoolContractInterface,
  address: string,
  viewingKey: bigint,
  blockNumber: number,
  registered: boolean,
  options: DiscoverOptions,
): Promise<DiscoveryResult> {
  const rateLimit = options.rateLimit === undefined ? DEFAULT_DISCOVERY_RATE_LIMIT : options.rateLimit
  const provider = new ContractDiscoveryProvider(pool, rateLimit ? { rateLimit } : undefined)
  const self = BigInt(address)

  // Both halves, and both are needed. `discoverNotes` finds what we HOLD (incoming channels,
  // spendable notes); `discoverChannels(…, 'all')` finds what we have OPENED, which is the
  // half a send needs in order to know which recipients are already set up and at which index
  // the next channel must open.
  const [notesResult, channelsResult] = await Promise.all([
    provider.discoverNotes(self, viewingKey),
    provider.discoverChannels(self, viewingKey, 'all'),
  ])

  const notes: DiscoveredNote[] = []
  for (const [token, tokenNotes] of notesResult.notes.entries()) {
    for (const note of tokenNotes) {
      notes.push({
        id: feltFromSdk(note.id, 'note id'),
        token: toFeltHex(token),
        amount: feltFromSdk(note.amount, 'note amount'),
        witness: {
          channelKey: feltFromSdk(note.witness.channelKey, 'witness channel key'),
          nonce: note.witness.nonce,
          r: feltFromSdk(note.witness.r, 'witness salt'),
        },
        sender: toFeltHex(feltFromSdk(note.sender, 'note sender')),
        open: note.open === true,
      })
    }
  }

  const incoming: DiscoveredIncomingChannel[] = []
  for (const [counterparty, cursor] of notesResult.cursor.incomingChannels.entries()) {
    incoming.push({
      counterparty: toFeltHex(counterparty),
      channelKey: feltFromSdk(cursor.channelKey, 'incoming channel key'),
      noteSlots: [...cursor.noteIndexes.entries()].map(([token, nextIndex]) => ({
        token: toFeltHex(token),
        nextIndex,
      })),
    })
  }

  await extendSpentSlots(pool, incoming)

  const outgoing: SendChannelData[] = []
  for (const [recipient, channel] of channelsResult.channels?.entries() ?? []) {
    outgoing.push({
      address: toFeltHex(recipient),
      publicKey: feltFromSdk(channel.publicKey, 'recipient public key'),
      ...(channel.key === undefined ? {} : { key: feltFromSdk(channel.key, 'outgoing channel key') }),
      tokens: [...channel.tokens.entries()].map(([token, nonces]) => ({
        token: toFeltHex(token),
        tokenIndex: nonces.tokenIndex,
        noteNonce: nonces.noteNonce,
      })),
    })
  }

  const wallet: SendWalletData = { channels: outgoing, notes: notes.map(toSendNote) }
  return {
    state: 'walked',
    wallet,
    notes,
    registry: { incoming, outgoing, outgoingTotal: outgoingTotalFrom(channelsResult, outgoing.length) },
    blockNumber,
    // A COMPLETED walk that found nothing is the only thing allowed to say `'absent'`, and
    // this is the line where that holds: every non-completion threw and never reached here.
    presence: notes.length > 0 ? 'present' : 'absent',
    registered,
  }
}

/**
 * The most trailing spent notes one subchannel's bound may be extended by.
 *
 * A hang guard on a loop whose termination depends on pool storage: each step is one view call,
 * so a pathological answer would page forever. Far above any real subchannel.
 */
const MAX_SPENT_SLOT_PROBE = 2_000

/**
 * Pushes each subchannel's note bound past the SDK's, out to the last note ever written.
 *
 * THE SDK'S CURSOR COUNTS HOLDINGS, NOT HISTORY. `noteIndexes` is advanced inside
 * `addNoteIfNotSpent`, which returns early for a spent note — so the cursor stops at the last
 * UNSPENT index, and an account that has spent everything reports a bound of zero. The Personal
 * feed needs the other number: a `NoteUsed` row is recognised by recomputing the nullifier of a
 * note that is, by definition, spent.
 *
 * A spent note stays in pool storage — the pool writes a nullifier rather than clearing the
 * slot, which is exactly why the SDK's own boundary scan can walk past spent notes to find
 * later unspent ones. So `get_note` answering non-zero remains the honest "a note was written
 * here" test, and walking it upward from the SDK's bound finds the trailing spent ones.
 *
 * Costs one view call per subchannel plus one per trailing spent note. Mutates in place because
 * the alternative is rebuilding the whole registry to change one integer per token.
 */
async function extendSpentSlots(
  pool: PoolContractInterface,
  incoming: DiscoveredIncomingChannel[],
): Promise<void> {
  await Promise.all(
    incoming.flatMap((channel) =>
      channel.noteSlots.map(async (slot) => {
        const token = BigInt(slot.token)
        let index = slot.nextIndex
        while (index < slot.nextIndex + MAX_SPENT_SLOT_PROBE) {
          const note = await pool.get_note(compute_note_id(channel.channelKey, token, index))
          if (feltFromSdk(note.packed_value, 'packed note value') === 0n) break
          index += 1
        }
        slot.nextIndex = index
      }),
    ),
  )
}

/**
 * The live outgoing-channel count, or a classified refusal — never a silent zero.
 *
 * THIS NUMBER IS THE INDEX A NEW CHANNEL MUST OPEN AT (FR-060). The pool asserts that the index
 * an `OpenChannel` is given equals its stored count and reverts `INDEX_NOT_SEQUENTIAL`
 * otherwise, on a batch the user has already paid to prove. So a wrong answer here is not a
 * cosmetic bug: it is a send that fails for every account that has ever opened a channel.
 *
 * A bare `?? 0` cannot be right, because it collapses two different facts. `undefined` is what
 * the SDK legitimately returns for an account with no outgoing channels — its scan stops before
 * ever assigning `total` — and it is ALSO what a future SDK returns if the field is renamed or
 * dropped. Pinning both to zero means an upgrade silently reintroduces the exact revert this
 * repository already fought once, with a green suite the whole way.
 *
 * So the two are separated by the KEY rather than the value: the SDK always writes `total` into
 * its result object, so a missing key is a contract change and refuses. A present-but-undefined
 * value means zero, cross-checked against the channels actually discovered — every discovered
 * outgoing channel occupies an index, so a count below that is incoherent and also refuses.
 */
export function outgoingTotalFrom(
  result: { total?: number },
  discoveredChannelCount: number,
): number {
  if (!('total' in result)) {
    throw new Error(
      'the SDK returned no `total` for the outgoing-channel walk. That field is the index a ' +
        'new channel must open at, and guessing it reverts INDEX_NOT_SEQUENTIAL.',
    )
  }
  const total = result.total ?? 0
  if (!Number.isInteger(total) || total < 0) {
    throw new Error(`the SDK reported a nonsensical outgoing-channel count: ${String(total)}`)
  }
  if (total < discoveredChannelCount) {
    throw new Error(
      `the SDK reported ${total} outgoing channel(s) but handed back ${discoveredChannelCount}. ` +
        'Every discovered channel occupies an index, so this walk is internally inconsistent.',
    )
  }
  return total
}

/** Projects a discovered note onto story 1.16's frozen `SendNoteData`, dropping `open`. */
export function toSendNote(note: DiscoveredNote): SendNoteData {
  return {
    id: note.id,
    token: note.token,
    amount: note.amount,
    witness: note.witness,
    sender: note.sender,
  }
}

/**
 * The presence value for any result — the single line `backup-cadence.ts` is fed from.
 *
 * Exists so no caller has to remember that a failed walk is `'unknown'`. The cadence ladder
 * advances only on `'present'`, so getting this wrong in the other direction would let an
 * account that could not be read climb to a 28-day backup interval.
 */
export function presenceOf(result: DiscoveryResult): ShieldedBalancePresence {
  return result.presence
}
