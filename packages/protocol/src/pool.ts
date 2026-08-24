import { NET } from './constants.js'
import { withFallback } from './rpc.js'

async function call(entrypoint: string, calldata: string[] = []): Promise<string[]> {
  return withFallback((p) =>
    p.callContract({ contractAddress: NET.pool, entrypoint, calldata }),
  )
}

// ── Degraded-mode substrate (FR-052 / AD-9) ──────────────────────────────────────────────
// Classification precedes copy: an unreachable service and a real "paused" determination must
// never share a string. These classifiers are pure so the (un-forceable-live) paused/upgraded
// paths are unit-tested deterministically; readPoolHealth() wires them to live reads.

/** A user-facing pool state. Each maps to exactly one honest string in the UI. */
export type PoolHealth =
  | { state: 'ok'; feeWei: bigint; proofValidityBlocks: number; blockNumber: number }
  | { state: 'paused' }                                            // "paused by its operator"
  | { state: 'upgraded'; pinned: string; onchain: string }          // "pool was upgraded"
  | { state: 'unreachable' }                                        // "you're offline / RPC down"

/**
 * Pause requires TWO consecutive positive reads. A single positive read can be a transient;
 * more importantly a single *failed* read must classify as unreachable, never as paused —
 * "the pool stopped you" and "we couldn't reach the pool" are different sentences (FR-052).
 */
export function classifyPause(read1: boolean, read2: boolean): boolean {
  return read1 && read2
}

/** Normalizes two felt hashes and compares; a mismatch is the "pool upgraded" state. */
export function classHashMatches(onchain: string, pinned: string): boolean {
  const norm = (h: string) => BigInt(h).toString(16)
  return norm(onchain) === norm(pinned)
}

/** True when the on-chain error means "this entrypoint does not exist on the deployed class". */
export function isEntrypointNotFound(err: unknown): boolean {
  const m = String((err as { message?: string })?.message ?? err).toLowerCase()
  return /entry ?point|not found|-32601|invalid message selector|selector.*not found/.test(m)
}

/**
 * Canary for the unreleased default-deny screening rewrite. `get_open_note_screening_policy`
 * does not exist on the deployed class (block-list model), so today this returns `false`. When
 * the pool upgrades to the `OpenNoteScreeningPolicy { Required }` class the entrypoint appears
 * and this returns `true` — the signal for value-bearing surfaces to surface the *named*
 * blocked-deposit degraded mode instead of a silent revert. Chat (zero-deposit) ignores it.
 */
export async function screeningPolicyPresent(): Promise<boolean> {
  try {
    await call('get_open_note_screening_policy')
    return true
  } catch (e) {
    if (isEntrypointNotFound(e)) return false
    throw e   // a real RPC failure is not a "no" — let the caller classify it as unreachable
  }
}

/**
 * One honest read of pool health. Any RPC failure → `unreachable` (never `paused`); a class-hash
 * mismatch → `upgraded` (checked first — an upgraded pool's other reads are not trustworthy); two
 * positive pause reads → `paused`; otherwise `ok` with the live mutable numbers.
 */
export async function readPoolHealth(): Promise<PoolHealth> {
  try {
    const onchain = await withFallback((p) => p.getClassHashAt(NET.pool))
    if (NET.poolClassHash && !classHashMatches(onchain, NET.poolClassHash)) {
      return { state: 'upgraded', pinned: NET.poolClassHash, onchain }
    }
    const paused1 = BigInt((await call('is_paused'))[0]) !== 0n
    if (paused1) {
      const paused2 = BigInt((await call('is_paused'))[0]) !== 0n
      if (classifyPause(paused1, paused2)) return { state: 'paused' }
    }
    const [fee, validity, blockNumber] = await Promise.all([
      call('get_fee_amount'),
      call('get_proof_validity_blocks'),
      withFallback((p) => p.getBlockNumber()),
    ])
    return {
      state: 'ok',
      feeWei: BigInt(fee[0]),
      proofValidityBlocks: Number(BigInt(validity[0])),
      blockNumber,
    }
  } catch {
    return { state: 'unreachable' }
  }
}

export interface PoolConstants {
  feeWei: bigint
  paused: boolean
  proofValidityBlocks: number
  blockNumber: number
}

/**
 * Reads every mutable protocol number in one shot.
 * The fee is NOT a constant: it was 4 STRK earlier in this pool's history and the
 * upgrade delay is zero, so it can change between two page loads. Always read it.
 */
export async function readPoolConstants(): Promise<PoolConstants> {
  const [fee, paused, validity, blockNumber] = await Promise.all([
    call('get_fee_amount'),
    call('is_paused'),
    call('get_proof_validity_blocks'),
    withFallback((p) => p.getBlockNumber()),
  ])
  return {
    feeWei: BigInt(fee[0]),
    paused: BigInt(paused[0]) !== 0n,
    proofValidityBlocks: Number(BigInt(validity[0])),
    blockNumber,
  }
}

/** 0n means "never registered". Non-zero from another app means ForeignKey — see registration.ts. */
export async function getPublicKey(address: string): Promise<bigint> {
  const r = await call('get_public_key', [address])
  return BigInt(r[0])
}

/**
 * How many outgoing channels `address` has already opened.
 *
 * THE COUNT IS THE NEXT INDEX. `open_channel` asserts the index it is given equals this number
 * (`INDEX_NOT_SEQUENTIAL` otherwise — probed live, see ACTION_LIST_EVIDENCE), so a send that
 * opens a channel has to read this rather than assume zero. `u64` on the wire, one felt.
 */
export async function getNumOfChannels(address: string): Promise<number> {
  return channelCountFrom(await call('get_num_of_channels', [address]))
}

/**
 * The one place a channel-count response becomes a number. Exported so the decode is testable
 * without a chain — every send test injects past the read, so without this the decode itself
 * would be the one line nothing ever ran.
 */
export function channelCountFrom(result: readonly string[]): number {
  const raw = result?.[0]
  if (raw === undefined) throw new Error('the pool returned no value for get_num_of_channels')
  let count: bigint
  try {
    count = BigInt(raw)
  } catch {
    throw new Error(`the pool returned a non-numeric channel count: ${JSON.stringify(String(raw).slice(0, 64))}`)
  }
  // A `u64` fits a felt but not necessarily a JS number. Past 2^53 the value that comes back is
  // ROUNDED, so the index a new channel would be opened at is not the index the pool holds — and
  // `INDEX_NOT_SEQUENTIAL` would be the only symptom, on a batch already paid for. Nobody has
  // 9 quadrillion channels; the point is that a wrong answer here is silent and this one is not.
  if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(
      `the pool reported ${count} channels, which cannot be represented exactly as a number`,
    )
  }
  return Number(count)
}

/**
 * Whether the pool holds a note under `noteId` yet.
 *
 * `get_note` returns `(packed_value, token)` and the pool's own existence test throughout
 * `privacy.cairo` is `packed_value.is_non_zero()` — so that, and not the presence of a reply, is
 * what this reads. A note that has not landed answers with a zero packed value rather than
 * failing, so a `false` here means "not yet", never "the read broke": a read that breaks throws.
 *
 * THIS IS NOT A MATURITY VIEW, because the deployed class has none. It answers exactly one
 * question — is the note in pool storage — which is the closest thing to "can it be spent" that
 * can be asked without inventing a ripening window nobody published.
 */
export async function noteExists(noteId: bigint): Promise<boolean> {
  return notePresentIn(await call('get_note', [`0x${noteId.toString(16)}`]), noteId)
}

/**
 * The one place a `get_note` response becomes a yes or a no. Exported for the same reason
 * `channelCountFrom` is: the send tests all inject past the read.
 *
 * A NOTE THAT DOES NOT EXIST ANSWERS, IT DOES NOT REVERT — probed live on the deployed class,
 * where `get_note` on an invented id returns `["0x0","0x0"]`. That is what makes polling this a
 * usable maturity signal at all: a revert would be indistinguishable from an RPC failure, and
 * the watcher would have no way to tell "not yet" from "the read broke".
 */
export function notePresentIn(result: readonly string[], noteId: bigint): boolean {
  const packed = result?.[0]
  if (packed === undefined) throw new Error(`the pool returned no value for get_note(${noteId})`)
  try {
    return BigInt(packed) !== 0n
  } catch {
    throw new Error(
      `the pool returned a non-numeric packed value for get_note(${noteId}): ` +
        JSON.stringify(String(packed).slice(0, 64)),
    )
  }
}

/**
 * The StarkWare auditor key every registration escrows a copy of the viewing key to
 * (`get_auditor_public_key`, a zero-argument view returning one felt — SDK ABI
 * `dist/internal/abi.js:965`).
 *
 * READ LIVE, NEVER PINNED, and the reason is the sentence the product has to be able to
 * make honestly: a user's key stays encrypted to whichever auditor key was live at THEIR
 * registration block, because StarkWare can set a new one (`set_auditor_public_key` is on
 * the same class). A constant baked in here would silently become a claim about a block it
 * was not read at — which is exactly the field-means-what-it-says rule the Recovery File
 * header is built around. Empirically it has never rotated; that is an observation, not a
 * guarantee, and it is not a reason to stop reading it.
 *
 * Throws on an unreachable RPC rather than returning a zero. The caller writing this into a
 * Recovery File header must fail loudly and write no file at all — a header claiming the
 * auditor key is `0` would be worse than a header that does not exist.
 */
export async function getAuditorPublicKey(): Promise<bigint> {
  return auditorKeyFrom(await call('get_auditor_public_key'))
}

/**
 * The one place an auditor-key response is turned into a number, shared by both readers.
 *
 * Guards the empty array, which `BigInt(undefined)` turns into a TypeError from inside what
 * the caller experiences as a chain read — an RPC that answers `{result: []}` (a proxy
 * rewriting an error into a 200, a node mid-resync) would otherwise surface as a crash rather
 * than as a failed read. And it applies the SAME zero-guard to both readers: a zero is not an
 * auditor key, whether it was read at the head or pinned to a block, and neither caller has a
 * use for one. Duplicating the `r[0]!` assumption in two places is how the two would drift.
 */
export function auditorKeyFrom(result: readonly string[], atBlock?: number): bigint {
  const raw = result?.[0]
  if (raw === undefined) {
    throw new Error('the pool returned no value for get_auditor_public_key')
  }
  // `BigInt` THROWS a bare SyntaxError on anything that is not numeric, and this is the exact
  // function whose comment promises to classify the response — an untyped SyntaxError escaping
  // it is the promise being broken. The realistic source is not a malformed felt: it is a
  // proxy or captive portal rewriting an RPC error into a 200 with an HTML body, which arrives
  // here as `"<!DOCTYPE html>"` and would otherwise surface as a parse error from deep inside
  // a chain read.
  let key: bigint
  try {
    key = BigInt(raw)
  } catch {
    throw new Error(
      `the pool returned a non-numeric auditor key: ${JSON.stringify(String(raw).slice(0, 64))}`,
    )
  }
  if (key === 0n) {
    const where = atBlock === undefined ? 'at the current head' : `at block ${atBlock}`
    throw new Error(`the pool reported an auditor key of 0 ${where}`)
  }
  return key
}

/**
 * The auditor key together with the block it was read AT — the pair a Recovery File header
 * records (`BackupHeader.auditorKeyAtBackupBlock`).
 *
 * Two reads, ONE provider, one `withFallback` attempt, and each of those matters:
 *
 *   - Pinned, not head. `getAuditorPublicKey()` answers "right now" against a head that has
 *     moved by the time the block number is written down. That is fine for a disclosure
 *     link and not fine for a field named "at backup block", which would then be a field
 *     holding a different thing than its label says.
 *   - Same host for both. The two RPC hosts are independently synced and routinely differ
 *     by a block, so reading the height from one and pinning the call on the other asks a
 *     node for a block it has not seen yet. Both reads share the provider `withFallback`
 *     hands in, and a failure retries the PAIR on the next host rather than splicing two
 *     hosts' views together.
 */
export async function readAuditorKeyAtBlock(): Promise<{ blockNumber: number; auditorKey: bigint }> {
  return withFallback(async (p) => {
    const blockNumber = await p.getBlockNumber()
    const r = await p.callContract(
      { contractAddress: NET.pool, entrypoint: 'get_auditor_public_key', calldata: [] },
      blockNumber,
    )
    // A zero, or nothing at all, is a read that did not land — not an auditor key. Writing
    // either into a header would produce a file asserting that registrations escrow to nobody.
    return { blockNumber, auditorKey: auditorKeyFrom(r, blockNumber) }
  })
}
