//
// The Teller — the governance spec's named trust party (docs/governance.md §3, §11.2), as a
// relayer subsystem: signer five, named before it existed, now existing.
//
// ── WHAT IT CAN AND CANNOT DO, said the way the rooms file says it ───────────────────────
//
// It holds each proposal's tally secret, so it CAN read sealed choices early (disclosed, on the
// product's who-sees-what panel) and it LEARNS the ballot book keyed to anonymous handles — never
// to addresses, which the pool keeps from everyone including us. It CANNOT forge a tally: the
// contract's accumulator equation (§6.3) refuses any sums the ballots did not commit, so a
// compromised Teller is a Teller that can only publish the truth or nothing. It CANNOT censor:
// ballots enter through the permissionless pool. And it cannot STRAND: past `VOID_AFTER` anyone
// voids the proposal and every escrow reopens, Teller or no Teller.
//
// ── THE KEYS ARE A LEDGER, AND THE LEDGER IS THE CUSTODY STORY ───────────────────────────
//
// Per-proposal secrets live in `RELAYER_TELLER_STORE` on the volume — the fourth-ledger
// discipline: their own file, atomic writes, never another concern's. Losing the file before a
// permanently-private close is the one loss that matters, and its blast radius is bounded by
// `void_proposal`: tokens come back, the vote is re-run. A key never rides a user submission —
// `publish_key` goes out through this process's own signer, the `sweep`-exclusion rule.
//
import { existsSync, readFileSync } from 'node:fs'

import { hash } from 'starknet'

import { mintTallyKey, openBallot } from '../../protocol/src/governance-seal.js'
import { CURVE_ORDER } from '../../protocol/src/governance-commitment.js'
import { atomicWriteJson } from './sponsorship-store.js'

/** How often the Teller sweeps for closable proposals. The keeper's cadence class. */
export const TELLER_INTERVAL_MS = 30_000

/** Proposal states, transcribed from `governance.cairo`. */
const PROPOSAL_ACTIVE = 1
const MODE_SECRET_UNTIL_CLOSE = 1

interface Serialized {
  v: 1
  /** publicX hex → secret hex. */
  keys: Record<string, string>
}

export interface TellerProposal {
  id: number
  state: number
  mode: number
  options: number
  deadline: number
  tallyKey: bigint
  totalWeight: bigint
}

export interface TellerBallot {
  identityKey: string
  weight: bigint
  seq: number
  sealed: readonly string[]
}

export interface TellerDeps {
  proposalCount(): Promise<number>
  getProposal(id: number): Promise<TellerProposal>
  /** Every BallotCast for one proposal, oldest first — the chain's own order. */
  ballotEvents(proposalId: number): Promise<TellerBallot[]>
  submitTally(
    proposalId: number,
    sums: readonly bigint[],
    blindSums: readonly bigint[],
    excluded: readonly string[],
  ): Promise<string>
  submitKey(proposalId: number, secret: bigint): Promise<string>
  now?: () => number
  log?: (line: string) => void
  warn?: (line: string) => void
}

export interface TallyWork {
  proposalId: number
  sums: readonly bigint[]
  blindSums: readonly bigint[]
  excluded: readonly string[]
  countedBallots: number
}

/**
 * The counting itself, pure and exported: final-ballot-per-identity (the replace rule read off
 * the event stream — last `seq` wins), the seal opened under the tally secret, and any ballot
 * that will not open or whose opened weight disagrees with its public weight lands on the
 * EXCLUDED list — publicly, per-ballot, the §4.1 lane.
 */
export async function countBallots(
  proposal: TellerProposal,
  ballots: readonly TellerBallot[],
  tallySecret: bigint,
): Promise<TallyWork> {
  const finals = new Map<string, TellerBallot>()
  for (const ballot of ballots) {
    const held = finals.get(ballot.identityKey)
    if (!held || ballot.seq >= held.seq) finals.set(ballot.identityKey, ballot)
  }

  const sums = Array.from({ length: proposal.options }, () => 0n)
  const blindSums = Array.from({ length: proposal.options }, () => 0n)
  const excluded: string[] = []
  let counted = 0

  for (const ballot of finals.values()) {
    try {
      const opened = await openBallot(ballot.sealed, tallySecret)
      if (
        opened.weight !== ballot.weight ||
        opened.blinds.length !== proposal.options ||
        opened.choice < 0 ||
        opened.choice >= proposal.options
      ) {
        throw new Error('the opened ballot disagrees with its public half')
      }
      sums[opened.choice] = sums[opened.choice]! + opened.weight
      for (let i = 0; i < proposal.options; i += 1) {
        blindSums[i] = (blindSums[i]! + opened.blinds[i]!) % CURVE_ORDER
      }
      counted += 1
    } catch {
      // A ballot the key does not open, or one whose sealed half lies about its public half.
      // Exclusion is public and the contract subtracts its vector before checking the equation;
      // a wrongly excluded voter can prove well-formedness by opening — self-incriminating for
      // a Teller that excluded them wrongly, which is the accountability the lane is built on.
      excluded.push(ballot.identityKey)
    }
  }

  return { proposalId: proposal.id, sums, blindSums, excluded, countedBallots: counted }
}

export interface Teller {
  /** Mint a fresh tally keypair, persist the secret, hand back the public half for `propose`. */
  mintKey(): bigint
  /** Whether this Teller holds the secret behind a proposal's tally key. */
  holds(tallyKey: bigint): boolean
  /** One sweep: tally (and, in secret-until-close mode, reveal) everything past its deadline. */
  tick(deps: TellerDeps): Promise<void>
  /** For the boot banner. */
  keyCount(): number
}

export function openTeller(opts: { file: string }): Teller {
  const keys = new Map<string, bigint>()

  if (existsSync(opts.file)) {
    // The directory's rule: a corrupt KEY ledger stops the process rather than silently
    // becoming an empty one — an empty one cannot tally any open vote, which is a void waiting.
    const parsed = JSON.parse(readFileSync(opts.file, 'utf8')) as Serialized
    if (parsed.v !== 1 || typeof parsed.keys !== 'object' || parsed.keys === null) {
      throw new Error(`teller ledger at ${opts.file} has an unknown shape — refusing to start`)
    }
    for (const [publicX, secret] of Object.entries(parsed.keys)) {
      keys.set(publicX.toLowerCase(), BigInt(secret))
    }
  }

  function persist() {
    const out: Record<string, string> = {}
    for (const [publicX, secret] of keys) out[publicX] = `0x${secret.toString(16)}`
    atomicWriteJson(opts.file, { v: 1, keys: out } satisfies Serialized)
  }

  /** Proposals already tallied or revealed this process-lifetime — a resubmission damper only;
   * the contract's own state asserts are the real idempotence. */
  const settled = new Set<number>()
  const revealed = new Set<number>()

  return {
    mintKey() {
      const minted = mintTallyKey()
      keys.set(`0x${minted.publicX.toString(16)}`.toLowerCase(), minted.secret)
      persist()
      return minted.publicX
    },

    holds(tallyKey: bigint): boolean {
      return keys.has(`0x${tallyKey.toString(16)}`.toLowerCase())
    },

    keyCount() {
      return keys.size
    },

    async tick(deps: TellerDeps) {
      const log = deps.log ?? console.log
      const warn = deps.warn ?? console.warn
      const now = Math.floor((deps.now ?? Date.now)() / 1000)

      let count: number
      try {
        count = await deps.proposalCount()
      } catch (e) {
        warn(`teller: could not read the proposal count — ${String(e)}`)
        return
      }

      for (let id = 0; id < count; id += 1) {
        try {
          const proposal = await deps.getProposal(id)
          if (proposal.state !== PROPOSAL_ACTIVE || now < proposal.deadline) continue

          const secret = keys.get(`0x${proposal.tallyKey.toString(16)}`.toLowerCase())
          if (secret === undefined) {
            // Not ours to tally — a proposal made against a key some other Teller minted. The
            // honest state, said once per sweep at most: the void escape is its backstop.
            continue
          }

          if (!settled.has(id)) {
            const ballots = await deps.ballotEvents(id)
            const work = await countBallots(proposal, ballots, secret)
            const txHash = await deps.submitTally(id, work.sums, work.blindSums, work.excluded)
            settled.add(id)
            log(
              `teller: tallied proposal ${id} — ${work.countedBallots} ballot(s), ` +
                `${work.excluded.length} excluded — ${txHash}`,
            )
          }

          if (proposal.mode === MODE_SECRET_UNTIL_CLOSE && !revealed.has(id)) {
            const txHash = await deps.submitKey(id, secret)
            revealed.add(id)
            log(`teller: published the key for proposal ${id} — the book is public data now — ${txHash}`)
          }
        } catch (e) {
          // LOG, NEVER THROW — the keeper's rule: a proposal that cannot settle this sweep gets
          // the next one, and the relayer's actual job is unaffected.
          warn(`teller: proposal ${id} failed this sweep — ${String(e)}`)
        }
      }
    },
  }
}

// ── The chain reads main() composes the deps from ─────────────────────────────────────────

const SEL = {
  proposal_count: () => hash.getSelectorFromName('proposal_count'),
  get_proposal: () => hash.getSelectorFromName('get_proposal'),
}

const BALLOT_CAST_KEY = () => hash.getSelectorFromName('BallotCast')

/**
 * Decode `get_proposal`'s felts — `Proposal`'s declaration order, `app-reads.ts`'s discipline:
 * `[house_id, mode, options, deadline, tally_key, published_key, quorum, threshold_bps,
 *   action_kind, action_amount, action_recipient, state, total_weight, ballot_count,
 *   tally_for, tally_against]` — sixteen, every member one felt.
 */
export function decodeTellerProposal(id: number, felts: readonly string[]): TellerProposal {
  if (felts.length < 16) throw new Error(`get_proposal returned ${felts.length} felts; Proposal is 16`)
  return {
    id,
    mode: Number(BigInt(felts[1]!)),
    options: Number(BigInt(felts[2]!)),
    deadline: Number(BigInt(felts[3]!)),
    tallyKey: BigInt(felts[4]!),
    state: Number(BigInt(felts[11]!)),
    totalWeight: BigInt(felts[12]!),
  }
}

export interface TellerChain {
  callContract(request: { contractAddress: string; entrypoint: string; calldata: string[] }): Promise<string[]>
  getEvents(filter: Record<string, unknown>): Promise<{ events?: unknown[]; continuation_token?: string }>
}

/** Compose the live deps for one governance address. Submission legs are the caller's. */
export function tellerChainDeps(
  governance: string,
  chain: TellerChain,
  fromBlock: number,
): Pick<TellerDeps, 'proposalCount' | 'getProposal' | 'ballotEvents'> {
  return {
    async proposalCount() {
      const out = await chain.callContract({
        contractAddress: governance,
        entrypoint: 'proposal_count',
        calldata: [],
      })
      return Number(BigInt(out[0] ?? '0x0'))
    },
    async getProposal(id) {
      const out = await chain.callContract({
        contractAddress: governance,
        entrypoint: 'get_proposal',
        calldata: [`0x${id.toString(16)}`],
      })
      return decodeTellerProposal(id, out)
    },
    async ballotEvents(proposalId) {
      const ballots: TellerBallot[] = []
      let token: string | undefined
      for (let page = 0; page < 20; page += 1) {
        const result = await chain.getEvents({
          address: governance,
          keys: [[BALLOT_CAST_KEY()], [`0x${proposalId.toString(16)}`]],
          from_block: { block_number: fromBlock },
          to_block: 'latest',
          chunk_size: 100,
          ...(token ? { continuation_token: token } : {}),
        })
        for (const raw of result.events ?? []) {
          const ev = raw as { data?: unknown }
          if (!Array.isArray(ev.data)) continue
          const data = ev.data as string[]
          // BallotCast data: [identity_key, weight, seq, sealed_len, ...sealed].
          if (data.length < 4) continue
          const sealedLen = Number(BigInt(data[3]!))
          ballots.push({
            identityKey: data[0]!,
            weight: BigInt(data[1]!),
            seq: Number(BigInt(data[2]!)),
            sealed: data.slice(4, 4 + sealedLen),
          })
        }
        token = typeof result.continuation_token === 'string' ? result.continuation_token : undefined
        if (!token) break
      }
      return ballots
    },
  }
}
