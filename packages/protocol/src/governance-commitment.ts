//
// The ballot arithmetic — Pedersen vector commitments on the Stark curve (docs/architecture.md — Houses).
//
// A ballot with weight w choosing option j commits, per option i:
//     C_i = w·G + r_i·H   if i == j,   else   C_i = 0·G + r_i·H
// The contract adds every accepted ballot's vector into running accumulators ACC_i and, at
// publication, checks the Teller's revealed sums against them: `S_i·G + R_i·H == ACC_i`. A Teller
// that shifts, invents or drops weight has nothing it can publish. This module is the voter's half.
//
// H is nothing-up-my-sleeve: hash-to-curve by try-and-increment over the tag
// `passbook-governance-H-v1`, and the same (x, y) is a constant in `contracts/src/governance.cairo`.
//
// This module reaches `starknet` for the curve and must stay behind dynamic imports in the app.
//
import { ec } from 'starknet'

/** The Stark curve's order — scalars live mod this. */
export const CURVE_ORDER = ec.starkCurve.CURVE.n

/** The second generator. */
export const GOV_H = {
  x: 0x7582d6899a59b074653bb9f46db0e7c95e5b0e0ea34ce2eda2ea3b75bff2cben,
  y: 0x33dfd9feace1e45c79c4c1488f4cd456b96f534ec997977d4bbd2bb0a668a26n,
} as const

/** An affine point, `null` being the identity — the accumulator's starting value. */
export type Point = { readonly x: bigint; readonly y: bigint } | null

type Projective = InstanceType<typeof ec.starkCurve.ProjectivePoint>

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
