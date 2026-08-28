//
// The ballot arithmetic — Pedersen vector commitments on the Stark curve, and the accumulator
// equation that makes a wrong tally unpublishable (docs/governance.md §6.3).
//
// ── THE WHOLE MECHANISM IN FOUR LINES ────────────────────────────────────────────────────
//
// A ballot with weight w choosing option j commits, per option i:
//     C_i = w·G + r_i·H   if i == j,   else   C_i = 0·G + r_i·H
// The contract adds every accepted ballot's vector into running accumulators ACC_i. At
// publication the Teller reveals per-option sums S_i and blind-sums R_i, and the CONTRACT checks
// `S_i·G + R_i·H == ACC_i` — homomorphically, that is "the sums are exactly what the sealed
// ballots committed", so a Teller that shifts, invents or drops weight has nothing it can
// publish. This module is the client half: minting vectors, and re-running the check offline so
// anyone can audit a published tally from chain data.
//
// ── H IS NOTHING-UP-MY-SLEEVE, AND ITS DERIVATION SHIPS ──────────────────────────────────
//
// If anyone knew k with H = k·G they could forge tallies. H is therefore hash-to-curve by
// try-and-increment over a fixed tag — `deriveH()` below re-derives it from the tag, the test
// pins the constant to the derivation, and the SAME (x, y) is a constant in
// `contracts/src/governance.cairo` with a cross-test vector holding the two to each other (the
// `commitment.ts` discipline).
//
// This module reaches `starknet` for the curve and must stay behind dynamic imports in the app.
//
import { ec } from 'starknet'

/** The Stark curve's order — scalars live mod this. */
export const CURVE_ORDER = ec.starkCurve.CURVE.n

/** The Stark prime, for the hash-to-curve reduction. */
const STARK_P = 2n ** 251n + 17n * 2n ** 192n + 1n

export const H_TAG = 'passbook-governance-H-v1'

/** The second generator. Pinned; `deriveH()` is the proof nobody picked it. */
export const GOV_H = {
  x: 0x7582d6899a59b074653bb9f46db0e7c95e5b0e0ea34ce2eda2ea3b75bff2cben,
  y: 0x33dfd9feace1e45c79c4c1488f4cd456b96f534ec997977d4bbd2bb0a668a26n,
} as const

/** An affine point, `null` being the identity — the accumulator's starting value. */
export type Point = { readonly x: bigint; readonly y: bigint } | null

type Projective = InstanceType<typeof ec.starkCurve.ProjectivePoint>

function lift(point: Point): Projective {
  if (point === null) return ec.starkCurve.ProjectivePoint.ZERO
  return ec.starkCurve.ProjectivePoint.fromAffine({ x: point.x, y: point.y })
}

function drop(point: Projective): Point {
  if (point.equals(ec.starkCurve.ProjectivePoint.ZERO)) return null
  const affine = point.toAffine()
  return { x: affine.x, y: affine.y }
}

function hPoint(): Projective {
  return ec.starkCurve.ProjectivePoint.fromAffine({ x: GOV_H.x, y: GOV_H.y })
}

/** `s·P`, total over the scalars the callers actually produce (0 and sums past the order). */
function mul(point: Projective, scalar: bigint): Projective {
  const reduced = ((scalar % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER
  if (reduced === 0n) return ec.starkCurve.ProjectivePoint.ZERO
  return point.multiply(reduced)
}

/**
 * Re-derive H from the tag: SHA-256(tag:i) reduced into the field, lifted to the even-y root,
 * first hit wins. Exported so the pin test derives rather than trusts — and so a reader can run
 * the four lines themselves.
 */
export async function deriveH(): Promise<{ x: bigint; y: bigint }> {
  for (let i = 0; i < 1_000; i += 1) {
    const bytes = new TextEncoder().encode(`${H_TAG}:${i}`)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
    const x = [...digest].reduce((acc, b) => (acc << 8n) | BigInt(b), 0n) % STARK_P
    try {
      const point = ec.starkCurve.ProjectivePoint.fromHex(`02${x.toString(16).padStart(64, '0')}`)
      point.assertValidity()
      const affine = point.toAffine()
      return { x: affine.x, y: affine.y }
    } catch {
      // Not on the curve — next counter.
    }
  }
  throw new Error('no curve point within 1000 counters — the tag itself is broken')
}

/** One option's commitment: `w·G + r·H`. */
export function commit(weight: bigint, blind: bigint): Point {
  const wG = mul(ec.starkCurve.ProjectivePoint.BASE, weight)
  const rH = mul(hPoint(), blind)
  return drop(wG.add(rH))
}

export interface BallotVector {
  /** One commitment per option; the chosen option carries the weight, the rest carry zero. */
  readonly vector: readonly Point[]
  /** The blinds, in option order — the sealed half the Teller decrypts and later sums. */
  readonly blinds: readonly bigint[]
}

/** Mint a ballot's vector. `choice` is the option index; every blind is fresh CSPRNG. */
export function mintBallotVector(weight: bigint, choice: number, options: number): BallotVector {
  if (!Number.isInteger(options) || options < 2 || options > 8) {
    throw new Error(`a proposal has 2–8 options, not ${options}`)
  }
  if (!Number.isInteger(choice) || choice < 0 || choice >= options) {
    throw new Error(`choice ${choice} is not one of ${options} options`)
  }
  if (weight < 0n) throw new Error('weight cannot be negative')

  const vector: Point[] = []
  const blinds: bigint[] = []
  for (let i = 0; i < options; i += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const blind = ([...bytes].reduce((acc, b) => (acc << 8n) | BigInt(b), 0n) % (CURVE_ORDER - 1n)) + 1n
    blinds.push(blind)
    vector.push(commit(i === choice ? weight : 0n, blind))
  }
  return { vector, blinds }
}

/** `acc + point` — the contract's per-ballot accumulation, mirrored for the offline audit. */
export function accAdd(acc: Point, point: Point): Point {
  return drop(lift(acc).add(lift(point)))
}

/** `acc − point` — what a replaced (or excluded) ballot's vector does to the accumulator. */
export function accSub(acc: Point, point: Point): Point {
  return drop(lift(acc).subtract(lift(point)))
}

/**
 * The publication check, exactly as the contract runs it: per option,
 * `S_i·G + R_i·H == ACC_i`, plus the weight-conservation line `Σ S_i == totalWeight` that closes
 * the missing-lane hole (every ballot's weight is public, so the total is public arithmetic).
 */
export function verifyTally(
  sums: readonly bigint[],
  blindSums: readonly bigint[],
  accumulators: readonly Point[],
  totalWeight: bigint,
): boolean {
  if (sums.length !== accumulators.length || blindSums.length !== accumulators.length) return false
  let total = 0n
  for (let i = 0; i < sums.length; i += 1) {
    if (sums[i]! < 0n) return false
    total += sums[i]!
    const expected = drop(mul(ec.starkCurve.ProjectivePoint.BASE, sums[i]!).add(mul(hPoint(), blindSums[i]!)))
    const held = accumulators[i]!
    if (expected === null || held === null) {
      if (expected !== held) return false
      continue
    }
    if (expected.x !== held.x || expected.y !== held.y) return false
  }
  return total === totalWeight
}
