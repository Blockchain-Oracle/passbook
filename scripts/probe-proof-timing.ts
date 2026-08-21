//
// PROBE — proof wall-time. THIS SCRIPT DOES NOT MEASURE ANYTHING YET, AND REFUSES TO RUN.
//
// Proof wall-time has never been measured by anyone on this protocol. It gates the demo
// video (whether a live take is possible at all), the waiting-screen design, and every
// duration string in the product. Until this probe produces a real number, no
// user-facing duration may ship anywhere.
//
// The measurement needs a deployed `MessageBook` to invoke, and no such contract exists
// yet — Task 7 deploys it. So this file is the probe's structure with the prove/submit
// path left open, and it exits non-zero rather than running.
//
// It deliberately contains no file-writing code at all. A run that marked `proved`,
// `submitted` and `matured` with no work between them would write four zero-ish
// millisecond figures into `evidence/proof-timing.json` and present them as a
// measurement. That is not a placeholder, it is false evidence — in an evidence
// directory whose entire purpose is that a judge can trust what is in it.
//
import { existsSync, readFileSync } from 'node:fs'
import { readPoolConstants } from '../packages/protocol/src/pool.js'

const DEPLOYMENT_FILE = 'evidence/deployment.json'
const OUTPUT_FILE = 'evidence/proof-timing.json'

function abort(message: string): never {
  console.error(`probe-proof-timing: ${message}`)
  process.exit(1)
}

// The prerequisite check runs FIRST, before any network call: if the contract does not
// exist there is nothing to measure, and saying so should not cost an RPC round-trip.
if (!existsSync(DEPLOYMENT_FILE)) {
  abort(
    `${DEPLOYMENT_FILE} is missing, so there is no deployed MessageBook address to invoke.\n` +
      `  Task 7 (scripts/deploy-message-book.ts) declares and deploys the contract and\n` +
      `  writes that file. Run it first, then run this probe.\n` +
      `  Nothing was measured and ${OUTPUT_FILE} was NOT written.`,
  )
}

const deployment = JSON.parse(readFileSync(DEPLOYMENT_FILE, 'utf8')) as {
  contractAddress?: string
}
if (!deployment.contractAddress) {
  abort(
    `${DEPLOYMENT_FILE} has no contractAddress field. It is written by Task 7's deploy\n` +
      `  script; a hand-edited or truncated copy is not a deployment record.`,
  )
}

const marks: Record<string, number> = {}
const mark = (k: string) => {
  marks[k] = Date.now()
}

mark('start')
const constants = await readPoolConstants()
if (constants.paused) abort('pool is paused — probe aborted, retry later')
mark('constantsRead')

// ---------------------------------------------------------------------------------
// NOT YET IMPLEMENTED — the SDK prove/submit path. Fill this in once Task 7 has run.
//
// Build the smallest legal action list: one WriteOnce (1-wei self-note, which the pool
// mandates) plus one zero-value invoke of `MessageBook` at `deployment.contractAddress`
// in MODE_APPEND. That is the cheapest possible real transaction on this pool, and the
// zero-deposit invoke sets no screening subject, so it cannot be refused by the
// compliance screener mid-probe.
//
// Use the SDK's prove path against `NET.prover`, then submit through the relayer, then
// wait for the note to mature. Take a mark after each of the three, named `proved`,
// `submitted` and `matured`, with the real work between them:
//
//   proved     <- after the prover returns an attestation
//   submitted  <- after the transaction hash is accepted on L2
//   matured    <- after the resulting note is spendable
//
// Only then compute { proveMs, submitMs, maturityMs, totalMs, blockNumber, measuredAt }
// and write it to OUTPUT_FILE. Report proveMs to Abu immediately: if it exceeds roughly
// half a minute, the live-video plan in spec §10.4 changes.
//
// Do not add the marks without the work. The whole value of this file is that the
// number in it was measured.
// ---------------------------------------------------------------------------------
abort(
  `the prove/submit path is not implemented, so there is nothing to time.\n` +
    `  Pool read OK at block ${constants.blockNumber} in ${marks.constantsRead - marks.start} ms` +
    ` (that is an RPC read, not a proof).\n` +
    `  Fill in the marked section in this file, then re-run. ${OUTPUT_FILE} was NOT written.`,
)
