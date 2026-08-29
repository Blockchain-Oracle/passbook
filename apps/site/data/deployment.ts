//
// What is actually deployed, read from the files the deploy scripts wrote.
//
// ── WHY THIS IMPORTS THE EVIDENCE JSON DIRECTLY ───────────────────────────────────────────
//
// The whole argument of these two pages is "do not take our word for it". A table of hex strings
// retyped out of a deployment log is exactly the artifact that argument is against: it stays green
// forever, including on the day it starts naming a contract nobody deployed.
//
// So the rows below are derived from `evidence/*.json` — the files the deploy scripts WROTE and the
// verifier read back off the chain — and a redeploy that rewrites those files rewrites this page.
// The imports are build-time and tree-shaken: the JSON never ships as JSON, only the strings named
// here survive into the bundle.
//
// THIS IS ALSO WHAT KEEPS THE STATUS TABLE HONEST. Markets and Launch went to mainnet on
// 2026-08-27, and every hand-written status line in this repository kept saying "not deployed"
// afterwards — the design prototype these pages are built from, and the README table. Prose does
// that. `MARKETS_DEPLOYED` cannot: it is true because there is an address in a file.
//
import { NET } from '@strk20/protocol/constants'

import messageBook from '../../../evidence/deployment.json'
import marketsLaunch from '../../../evidence/markets-launch-deployment.json'
import registration from '../../../evidence/sponsored-registration.json'

/** Markets v2 — standing windows — when deployed; the v1 record stays in the file for its history. */
const markets = marketsLaunch.MarketsV2 ?? marketsLaunch.Markets

/** True when this build knows where Markets lives. False is a state, not an error. */
export const MARKETS_DEPLOYED = Boolean(markets?.contractAddress)

/** True when this build knows where Launch lives. */
export const LAUNCH_DEPLOYED = Boolean(marketsLaunch.Launch?.contractAddress)

/** True when this build knows where the Governor (the Houses) lives. */
export const GOVERNANCE_DEPLOYED = Boolean(marketsLaunch.Governance?.contractAddress)

/** The block the app contracts were last read back at. */
export const VERIFIED_AT_BLOCK = marketsLaunch.verifiedAtBlock

/** The pinned pool class hash, for the sentence about what the app refuses to guess at. */
export const POOL_CLASS_HASH = NET.poolClassHash

/** The network this build resolved to. `mainnet` or the build is not a production one. */
export const NETWORK = NET.chainId === '0x534e5f4d41494e' ? 'SN_MAIN' : NET.chainId

export type RecordKind = 'Contract' | 'Tx'

export interface RecordRow {
  readonly kind: RecordKind
  /** What it is, in the site's own words. */
  readonly label: string
  readonly address: string
  /** Where it opens — always the explorer for the network this build was made against. */
  readonly href: string
  /**
   * WHY THIS ROW IS TRUE: the file the value came out of, printed on the page.
   *
   * A row that cannot say where its value came from is a row somebody typed, and this table exists
   * in order not to be that.
   */
  readonly source: string
}

const contract = (address: string) => `${NET.explorer}/contract/${address}`
const tx = (hash: string) => `${NET.explorer}/tx/${hash}`

/**
 * The record, in the order it reads best: the thing the product stands on, then what this team put
 * on the chain, then the proof that a stranger's first transaction was paid for by somebody else.
 *
 * The pool is NOT ours and the row says so. Claiming a StarkWare deployment as this project's work
 * would be the same species of overstatement the rest of the site is about.
 */
export const MAINNET_RECORD: readonly RecordRow[] = [
  {
    kind: 'Contract',
    label: 'STRK20 pool — StarkWare’s, not ours',
    address: NET.pool,
    href: contract(NET.pool),
    source: 'packages/protocol/src/constants.ts',
  },
  {
    kind: 'Contract',
    label: 'MessageBook — ours',
    address: messageBook.contractAddress,
    href: contract(messageBook.contractAddress),
    source: 'evidence/deployment.json',
  },
  {
    kind: 'Contract',
    label: 'Markets — ours (v2, standing windows)',
    address: markets.contractAddress,
    href: contract(markets.contractAddress),
    source: 'evidence/markets-launch-deployment.json',
  },
  {
    kind: 'Contract',
    label: 'Launch — ours',
    address: marketsLaunch.Launch.contractAddress,
    href: contract(marketsLaunch.Launch.contractAddress),
    source: 'evidence/markets-launch-deployment.json',
  },
  {
    kind: 'Contract',
    label: 'Pragma oracle — read live by Markets',
    address: marketsLaunch.pragma,
    href: contract(marketsLaunch.pragma),
    source: 'evidence/markets-launch-deployment.json',
  },
  {
    kind: 'Tx',
    label: 'Sponsored registration, via our relayer',
    address: registration.registration.transactionHash,
    href: tx(registration.registration.transactionHash),
    source: 'evidence/sponsored-registration.json',
  },
  {
    kind: 'Tx',
    label: 'Markets v2 deploy',
    address: markets.deployTx,
    href: tx(markets.deployTx),
    source: 'evidence/markets-launch-deployment.json',
  },
  {
    kind: 'Tx',
    label: 'Launch deploy',
    address: marketsLaunch.Launch.deployTx,
    href: tx(marketsLaunch.Launch.deployTx),
    source: 'evidence/markets-launch-deployment.json',
  },
]
