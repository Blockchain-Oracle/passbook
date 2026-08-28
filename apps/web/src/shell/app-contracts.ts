//
// Where Markets and Launch live, from the browser's side — and the honest answer today is nowhere.
//
// ── ABSENT IS A STATE THE APP RUNS IN, NOT AN ERROR ──────────────────────────────────────
//
// `app-contracts.ts` in the protocol package states the rule and this is the web half of it: the
// contracts are written, tested and committed, and they are NOT deployed. So both surfaces render
// their real layout around an honest "nothing has been created yet" — never a fixture, never a
// greyed-out mock with plausible numbers in it. `evidence/markets-launch-deployment.json` is what
// makes them live, and until it exists every address here is `undefined`.
//
// FAILS CLOSED BY CONSTRUCTION. There is no default address and no placeholder: a surface with no
// address cannot build a call, so the buttons that would submit one are not rendered at all rather
// than rendered and disabled. The relayer's allowlist makes the same choice from the same file.
//
// ── THE BROWSER CANNOT READ THE EVIDENCE FILE ────────────────────────────────────────────
//
// No filesystem, so the addresses arrive as build-time environment. `appContractsFromEnv` does the
// VALIDATION — the same felt check the relayer applies — so an address that would be rejected
// server-side is rejected here too, and a half-set variable cannot become a call.
//
import { appContractsFromEnv, type AppContracts } from '@strk20/protocol/app-contracts'

/**
 * Vite inlines `VITE_`-prefixed variables at build time and nothing else, so the deployment's
 * addresses reach the bundle under that prefix and are mapped onto the protocol module's names.
 *
 * Read ONCE at module scope: these are build constants, and re-reading them per render would imply
 * they can change while the page is open.
 */
export const APP_CONTRACTS: AppContracts = appContractsFromEnv({
  PASSBOOK_MARKETS_ADDRESS: import.meta.env.VITE_PASSBOOK_MARKETS_ADDRESS as string | undefined,
  PASSBOOK_LAUNCH_ADDRESS: import.meta.env.VITE_PASSBOOK_LAUNCH_ADDRESS as string | undefined,
  PASSBOOK_PRAGMA_ADDRESS: import.meta.env.VITE_PASSBOOK_PRAGMA_ADDRESS as string | undefined,
  PASSBOOK_GOVERNANCE_ADDRESS: import.meta.env.VITE_PASSBOOK_GOVERNANCE_ADDRESS as string | undefined,
})

/** True once the Markets contract has an address. Everything on `/markets` that submits keys on it. */
export const MARKETS_DEPLOYED = APP_CONTRACTS.markets !== undefined

/** True once the Launch contract has an address. */
export const LAUNCH_DEPLOYED = APP_CONTRACTS.launch !== undefined

/** Whether the Governance (Houses) contract exists in this build. */
export const GOVERNANCE_DEPLOYED = APP_CONTRACTS.governance !== undefined

/**
 * The oracle the Markets contract was constructed with, when there is a deployment.
 *
 * `undefined` here means `readMedian` falls back to its pinned mainnet address — which is correct
 * and is why the price strip is live today. Once a deployment exists this is the address the
 * contract will actually resolve against, and the chart must read the same one or it would be
 * drawing a market that settles somewhere else.
 */
export const PRAGMA_ORACLE = APP_CONTRACTS.pragma
