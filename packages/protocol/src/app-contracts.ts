//
// Where the Markets and Launch contracts live — read, never hardcoded.
//
// ── WHY THIS IS A PARSER AND NOT A CONSTANT ───────────────────────────────────────────────
//
// These addresses do not exist until `scripts/ops/deploy-markets-launch.ts` runs, and when they do
// exist they are facts about one deployment rather than protocol constants like the pool or STRK.
// Writing them into a logic file would mean a source edit is what makes a deployment real, and the
// two would drift the first time anything was redeployed.
//
// So the deploy script writes `evidence/markets-launch-deployment.json` and everything reads it:
// the relayer with `readFileSync` at boot (the shape `server.ts` already uses for MessageBook), the
// ops scripts the same way, and the web build through its env. This module owns the one thing all
// three share — turning that file's text into addresses, or saying clearly that there are none yet.
//
// PURE. No `fs`, no `fetch`, no `process`. The browser cannot read the evidence file and the
// relayer cannot import a browser shim, so I/O belongs to the caller and parsing belongs here,
// which is also what makes the "not deployed yet" path testable without a filesystem.
//
// ── ABSENT IS A FIRST-CLASS ANSWER ────────────────────────────────────────────────────────
//
// Before the declares land, every field here is `undefined`, and that is a state the app runs in
// rather than an error. A markets surface with no Markets address renders its coming-state; the
// relayer's allowlist simply never permits calls to a contract it has no address for, which fails
// closed. Neither one should be throwing at boot because a deployment has not happened yet.
//

/** The deployed app contracts, as far as anyone knows. Every field may legitimately be absent. */
export interface AppContracts {
  /** The Markets contract. Absent until deployed. */
  markets?: string
  /** The Launch contract. Absent until deployed. */
  launch?: string
  /**
   * Pragma's oracle, as the deployment recorded it.
   *
   * Carried here rather than pinned in source for a reason worth stating: it is the address
   * `Markets`'s CONSTRUCTOR was given, so it is a property of that deployment. A keeper that
   * pre-checks freshness must read the oracle the contract will actually read, not the one that
   * was current when somebody wrote a constant.
   */
  pragma?: string
  /** The `LaunchToken` class hash. Declared, never deployed — `graduate()` deploys from it. */
  launchTokenClassHash?: string
  /** The Governance contract (Houses). Absent until deployed. */
  governance?: string
}

/** Nothing is deployed. The state the app starts life in, and runs in perfectly well. */
export const NO_APP_CONTRACTS: AppContracts = {}

const FELT = /^(0x[0-9a-fA-F]{1,64}|[0-9]{1,78})$/

/**
 * A felt address, or `undefined`.
 *
 * Deliberately silent: a malformed entry is treated exactly like a missing one, which fails closed
 * everywhere this is used — an allowlist that never matches, a surface that shows its coming-state.
 * Throwing would take the relayer down at boot over a file that is only advisory until a deployment
 * exists, and a half-parsed address is the one outcome nothing downstream should ever see.
 */
function address(value: unknown): string | undefined {
  if (typeof value !== 'string' || !FELT.test(value)) return undefined
  try {
    // `0x0` parses as a felt and is not an address. It is also what an aborted deploy leaves behind.
    return BigInt(value) === 0n ? undefined : value
  } catch {
    return undefined
  }
}

function nested(record: unknown, key: string, field: string): string | undefined {
  if (typeof record !== 'object' || record === null) return undefined
  const entry = (record as Record<string, unknown>)[key]
  if (typeof entry !== 'object' || entry === null) return undefined
  return address((entry as Record<string, unknown>)[field])
}

/**
 * Parse `evidence/markets-launch-deployment.json`.
 *
 * Takes the raw text rather than a path, so the relayer can hand it a `readFileSync`, a test can
 * hand it a literal, and neither needs the other's environment. `null` — the file is not there
 * yet — is the ordinary pre-deployment case and returns empty rather than throwing.
 */
export function parseAppContracts(raw: string | null | undefined): AppContracts {
  if (!raw) return NO_APP_CONTRACTS

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // Same reasoning as `address`: a corrupt evidence file must not stop a relayer booting.
    return NO_APP_CONTRACTS
  }
  if (typeof parsed !== 'object' || parsed === null) return NO_APP_CONTRACTS

  const record = parsed as Record<string, unknown>
  const contracts: AppContracts = {}

  const markets = nested(record, 'Markets', 'contractAddress')
  if (markets) contracts.markets = markets

  const launch = nested(record, 'Launch', 'contractAddress')
  if (launch) contracts.launch = launch

  const pragma = address(record.pragma)
  if (pragma) contracts.pragma = pragma

  const tokenClass = nested(record, 'LaunchToken', 'classHash')
  if (tokenClass) contracts.launchTokenClassHash = tokenClass

  const governance = nested(record, 'Governance', 'contractAddress')
  if (governance) contracts.governance = governance

  return contracts
}

/**
 * The addresses as an env-shaped record, for the web build.
 *
 * The browser has no filesystem, so the deployment's addresses reach it as build-time environment
 * rather than as a file read. Same parser on both sides is not possible; same VALIDATION is, and
 * that is what this gives — an address that would be rejected in the relayer is rejected here too.
 */
export function appContractsFromEnv(env: Record<string, string | undefined>): AppContracts {
  const contracts: AppContracts = {}
  const markets = address(env.PASSBOOK_MARKETS_ADDRESS)
  if (markets) contracts.markets = markets
  const launch = address(env.PASSBOOK_LAUNCH_ADDRESS)
  if (launch) contracts.launch = launch
  const pragma = address(env.PASSBOOK_PRAGMA_ADDRESS)
  if (pragma) contracts.pragma = pragma
  const governance = address(env.PASSBOOK_GOVERNANCE_ADDRESS)
  if (governance) contracts.governance = governance
  return contracts
}
