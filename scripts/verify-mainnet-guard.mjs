//
// Proves the mainnet guard BOTH ways, by actually flipping the repository to sepolia and putting
// it back. A guard nobody has watched refuse is a guard nobody knows works.
//
// ┌─ READ THIS BEFORE RUNNING ────────────────────────────────────────────────────────────────┐
// │ For roughly two seconds this script rewrites `packages/protocol/src/constants.ts` in your  │
// │ WORKING TREE, and that edit is visible to every other process in the repository — a dev    │
// │ server running alongside it served `ACTIVE_NETWORK = "sepolia"` two seconds after the flip. │
// │ Do not run it concurrently with other repo work.                                           │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// WHY THIS IS THREE LAYERS AND NOT A try/finally. "Back up, mutate, restore in `finally`" is the
// obvious shape and it is not sufficient — measured, it restored on ZERO of four signals: SIGINT
// (exit 130), SIGTERM (143), SIGHUP (129) and SIGKILL (137) each left `constants.ts` MUTATED. A
// developer pressing Ctrl-C would be left with `ACTIVE_NETWORK = 'sepolia'` in their tree, under a
// constraint that forbids fixing it with `git checkout --`. So:
//
//   layer 1 — an on-disk sidecar written BEFORE the mutation, and a self-heal that runs before
//             anything else. This is the only layer that can survive SIGKILL, which cannot be
//             caught by any handler.
//   layer 2 — synchronous signal handlers (INT/TERM/HUP/QUIT) plus `exit` and `uncaughtException`.
//             writeFileSync, because an async restore never completes during signal teardown.
//   layer 3 — try/finally, for the ordinary path.
//
// Exit codes: 0 verified · 1 guard failure · 2 precondition refusal.
//
import { spawn, spawnSync } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findActiveNetworkDeclarations, flipActiveNetwork } from './active-network.mjs'

const REPO_ROOT = resolve(fileURLToPath(import.meta.url), '../..')
const CONSTANTS = join(REPO_ROOT, 'packages/protocol/src/constants.ts')
const SIDECAR = join(REPO_ROOT, '.guard-verify-backup')
const WEB_ROOT = join(REPO_ROOT, 'apps/web')
const VITE_BIN = join(REPO_ROOT, 'node_modules/vite/bin/vite.js')


// Only for proving the restore path: `PASSBOOK_GUARD_HOLD_MS=5000 node scripts/verify-mainnet-guard.mjs`
// holds the tree flipped so a test can deliver a real signal mid-flip. Unset in every normal run.
const HOLD_MS = Number(process.env.PASSBOOK_GUARD_HOLD_MS ?? 0)

const log = (m) => console.log(`[verify] ${m}`)

function fail(message, code = 1) {
  console.error(`[verify] FAILED: ${message}`)
  process.exit(code)
}

// ---- layer 0: the concurrency lock --------------------------------------------------------------
//
// Two runs at once would restore each other mid-flip, and the loser would "restore" a tree the
// winner had already flipped. The lock is a SEPARATE file from the sidecar, and that separation is
// the whole design: the sidecar means "a byte-exact backup exists", the lock means "a live process
// owns the window". Collapsing them breaks the self-heal below, which must be free to consume a
// sidecar left by a process that is already dead.
//
// The holder is identified by pid and probed with signal 0, so a lock left behind by a SIGKILLed
// run is recognised as stale instead of blocking every future run until someone deletes it by hand.
//
const LOCK = `${SIDECAR}.lock`

function lockHolder() {
  if (!existsSync(LOCK)) return null
  const pid = Number(readFileSync(LOCK, 'utf8').trim())
  if (!Number.isInteger(pid) || pid <= 0) return { pid: null, alive: false }
  try {
    process.kill(pid, 0) // probe only — signal 0 delivers nothing
    return { pid, alive: true }
  } catch {
    return { pid, alive: false }
  }
}

const holder = lockHolder()
if (holder?.alive) {
  fail(
    `another verify run (pid ${holder.pid}) currently holds ${LOCK}. Two runs would flip and ` +
      `restore the same file underneath each other. Wait for it, or kill it and re-run.`,
    2,
  )
}
if (holder) {
  log(`stale lock from dead pid ${holder.pid ?? '(unreadable)'} — clearing it`)
  rmSync(LOCK, { force: true })
}

// ---- layer 1: self-heal, BEFORE the precondition check -----------------------------------------
//
// Ordering matters. If a previous run died mid-flip, the tree says `sepolia` and the precondition
// below would refuse — leaving the developer stuck with a broken tree AND a script that will not
// repair it. Heal first, then check.
if (existsSync(SIDECAR)) {
  //
  // VALIDATE BEFORE RESTORING. An unconditional `writeFileSync(CONSTANTS, readFileSync(SIDECAR))`
  // is silent data loss waiting to happen: a stale sidecar from last week, or a truncated one from
  // a kill during the sidecar write itself, would overwrite a constants.ts that has since been
  // legitimately edited — under a rule that forbids repairing it with `git checkout --`.
  //
  // So the sidecar has to look like the file it claims to be a backup of, and the copy it is about
  // to overwrite is kept. Refusing costs a developer one minute; clobbering costs them their work.
  //
  const sidecar = readFileSync(SIDECAR)
  const text = sidecar.toString('utf8')
  const looksRight =
    sidecar.byteLength > 0 &&
    findActiveNetworkDeclarations(text).length === 1 &&
    text.includes('export const NETWORKS') &&
    text.includes('export type NetworkName')

  if (!looksRight) {
    fail(
      `${SIDECAR} exists but does not look like a constants.ts backup ` +
        `(${sidecar.byteLength} bytes, ` +
        `${findActiveNetworkDeclarations(text).length} live ACTIVE_NETWORK declarations). ` +
        `Refusing to overwrite ${CONSTANTS} with it. Inspect both files and delete the sidecar by ` +
        `hand once you are sure which one you want.`,
      2,
    )
  }

  const displaced = `${SIDECAR}.displaced`
  writeFileSync(displaced, readFileSync(CONSTANTS))
  writeFileSync(CONSTANTS, sidecar)
  rmSync(SIDECAR, { force: true })
  log('sidecar found — a previous run died mid-flip. Restored constants.ts before continuing.')
  log(`the overwritten copy was kept at ${displaced} — delete it once you have checked it.`)
}

const ORIGINAL = readFileSync(CONSTANTS)

// ---- precondition ------------------------------------------------------------------------------
//
// Count EVERY live declaration, not just the mainnet one. A file carrying two of them cannot be
// flipped back to a known state at all, so it is refused here, before anything is written, rather
// than discovered halfway through.
//
// Via the SHARED matcher — the same function the guard itself calls. This script used to carry its
// own copy here and a different, unanchored one at the flip; that disagreement is the whole reason
// `scripts/active-network.mjs` exists.
const declared = findActiveNetworkDeclarations(ORIGINAL.toString('utf8'))
if (declared.length !== 1) {
  fail(
    `${CONSTANTS} has ${declared.length} live ACTIVE_NETWORK declarations and I need exactly 1. ` +
      `Refusing to flip a file I cannot flip back exactly.`,
    2,
  )
}
if (declared[0].network !== 'mainnet') {
  fail(
    `${CONSTANTS} already declares ACTIVE_NETWORK = '${declared[0].network}'. This script proves the ` +
      `guard by flipping a mainnet tree to sepolia and back; there is nothing here to flip, and ` +
      `starting from an off-mainnet tree would mean "restoring" to a state that is itself wrong.`,
    2,
  )
}

// ---- the two builds ----------------------------------------------------------------------------

/** A real production build, run the way CI would. Returns exit code + merged output. */
function viteBuild() {
  const r = spawnSync(process.execPath, [VITE_BIN, 'build', '--configLoader', 'native'], {
    cwd: WEB_ROOT,
    encoding: 'utf8',
  })
  return { code: r.status, output: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

//
// The dev server MUST NOT outlive this script, and that is not the free-by-default behaviour it
// looks like. `child.kill('SIGTERM')` on `vite dev` is not reliably fatal, and a SIGKILL delivered
// to THIS process cannot kill a child at all — either way a `vite dev` is left running, and this
// one is not a harmless stray: the router plugin watches `apps/web/src/routes/` and REGENERATES
// `routeTree.gen.ts` on every change. An orphan silently heals a deliberately corrupted route tree
// under whatever runs next, which is the `routeTree.gen.ts` ordering hazard (a build healing a
// broken tree before anything can observe it) arriving through a side door. It cost real debugging
// time once already.
//
// So: spawn DETACHED, which puts the child in its own process group, and kill the whole group by
// negative pid — hard, and from the exit and signal handlers too, not only from the happy path.
//
const DEV_PORT = 51997
let devChild = null

/** Synchronous, callable from a signal handler or `process.on('exit')`. */
function killDevSync() {
  const child = devChild
  devChild = null
  if (!child || child.exitCode !== null) return
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }
}

/** Starts `vite dev` and resolves with how it went. Kills the server either way. */
function viteDev(timeoutMs = 30_000) {
  return new Promise((resolveDev) => {
    const child = spawn(
      process.execPath,
      [VITE_BIN, '--configLoader', 'native', '--port', String(DEV_PORT), '--strictPort'],
      { cwd: WEB_ROOT, detached: true },
    )
    devChild = child
    let output = ''
    let settled = false
    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      killDevSync()
      resolveDev({ ...result, output })
    }
    const timer = setTimeout(() => done({ ready: false, reason: 'timed out' }), timeoutMs)
    const onData = (buf) => {
      output += buf.toString()
      if (/ready in \d+/.test(output)) done({ ready: true })
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => done({ ready: false, reason: `exited with code ${code}` }))
  })
}

//
// ---- the off-mainnet trees this script puts the guard in front of ------------------------------
//
// THREE, not one. A script that only ever tries a plain `'sepolia'` line verifies almost none of
// the guard's hardening: reverting `assertMainnet()` to its naive pre-6-1 shape left every gate in
// this repository green, while a decoy tree then built at exit 0, printed "production build
// permitted", and emitted the sepolia chain id. The anchoring and the count assertion were the
// point of the story and nothing was checking them.
//
// Built as pure strings BEFORE the window opens, so a construction bug fails with the tree still
// intact rather than halfway through a mutation.
//
const ORIGINAL_TEXT = ORIGINAL.toString('utf8')

/** Splices `line` in immediately above the single live declaration. */
function insertAboveDeclaration(text, line) {
  const decl = findActiveNetworkDeclarations(text)[0]
  return `${text.slice(0, decl.index)}${line}\n${text.slice(decl.index)}`
}

// The index-splice flip, via the shared helper. NOT `String.replace` with a string needle: that is
// the defect this round found. On the decoy tree below, the needle matches inside the COMMENT
// first, so the comment gets rewritten, the live declaration stays on mainnet, the build correctly
// succeeds, and the script then reports "the guard did not fire" — falsely accusing a guard that
// works. Splicing at the matched index cannot target anything the matcher did not find.
const SEPOLIA_TEXT = flipActiveNetwork(ORIGINAL_TEXT, 'sepolia', { file: CONSTANTS })

const OFF_MAINNET_TREES = [
  {
    name: 'a plain sepolia declaration',
    text: SEPOLIA_TEXT,
    expectLive: [ 'sepolia' ],
  },
  {
    name: 'a commented-out mainnet decoy above a live sepolia line',
    text: insertAboveDeclaration(
      SEPOLIA_TEXT,
      "// was: export const ACTIVE_NETWORK: NetworkName = 'mainnet' <- decoy",
    ),
    expectLive: [ 'sepolia' ],
  },
  {
    name: 'two live declarations, which no first-match rule can resolve',
    text: insertAboveDeclaration(
      SEPOLIA_TEXT,
      "export const ACTIVE_NETWORK: NetworkName = 'mainnet'",
    ),
    expectLive: [ 'mainnet', 'sepolia' ],
  },
]

// Each constructed tree is checked to BE the tree it claims to be. A decoy variant that
// accidentally contains no decoy would pass the assertions below while testing nothing.
for (const tree of OFF_MAINNET_TREES) {
  const live = findActiveNetworkDeclarations(tree.text).map((d) => d.network)
  if (live.join(',') !== tree.expectLive.join(',')) {
    fail(
      `internal: the "${tree.name}" fixture has live declarations [${live.join(', ')}], expected ` +
        `[${tree.expectLive.join(', ')}]. Nothing has been written; fix the fixture.`,
      2,
    )
  }
}

// ---- leg 1: the guard must PERMIT mainnet ------------------------------------------------------
log(`leg 1/${OFF_MAINNET_TREES.length + 2} — production build on the unmodified (mainnet) tree, expecting exit 0`)
const mainnetLeg = viteBuild()
if (mainnetLeg.code !== 0) {
  fail(
    `a production build of the UNMODIFIED tree failed with exit ${mainnetLeg.code}. Nothing has ` +
      `been flipped, so this is not a guard failure — the build is broken on its own:\n${mainnetLeg.output}`,
  )
}
log(`leg 1/${OFF_MAINNET_TREES.length + 2} — mainnet build permitted, exit 0`)

// ---- layer 2: signal handlers, armed before the first mutation ---------------------------------
let flipped = false

function restoreSync() {
  killDevSync()
  if (!flipped) {
    rmSync(LOCK, { force: true })
    return
  }
  writeFileSync(CONSTANTS, ORIGINAL)
  rmSync(SIDECAR, { force: true })
  rmSync(LOCK, { force: true })
  flipped = false
}

const SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT']
for (const signal of SIGNALS) {
  process.on(signal, () => {
    restoreSync()
    console.error(`[verify] ${signal} received mid-run — constants.ts restored.`)
    // Re-raise with the handler removed, so the exit status is the one the signal would have
    // produced rather than a plain 0. A wrapper that reads exit codes must not be lied to.
    process.removeAllListeners(signal)
    process.kill(process.pid, signal)
  })
}
process.on('exit', restoreSync)
process.on('uncaughtException', (e) => {
  restoreSync()
  console.error(e)
  process.exit(1)
})

// ---- legs 2..N and the dev leg: inside the flip window. Keep it short. --------------------------
try {
  //
  // LOCK, then sidecar, then `flipped = true`, THEN the mutation. Every step of that order is load
  // bearing:
  //   - `openSync(LOCK, 'wx')` is the atomic acquisition — an `existsSync` check followed by a
  //     write has a race between them that two runs can both win.
  //   - the sidecar is written BEFORE the mutation, never after: in between is a window where a
  //     SIGKILL leaves a mutated file and no record of what it used to be.
  //   - `flipped` is set BEFORE `writeFileSync(CONSTANTS, …)` returns, not after. If that call
  //     throws, or is killed after truncating and before writing, the flag would still be false and
  //     both the signal handlers and the `finally` would skip the restore — leaving a truncated
  //     constants.ts and doing it silently.
  //
  try {
    const fd = openSync(LOCK, 'wx')
    writeFileSync(fd, String(process.pid))
    closeSync(fd)
  } catch (e) {
    if (e.code === 'EEXIST') {
      fail(`another verify run acquired ${LOCK} first. Not flipping anything.`, 2)
    }
    throw e
  }
  writeFileSync(SIDECAR, ORIGINAL)
  flipped = true
  log('window open — constants.ts is about to be mutated')

  let leg = 1
  for (const tree of OFF_MAINNET_TREES) {
    leg += 1
    writeFileSync(CONSTANTS, tree.text)
    log(`leg ${leg}/${OFF_MAINNET_TREES.length + 2} — production build on ${tree.name}, expecting refusal`)
    const refusal = viteBuild()

    // BOTH halves are required. A nonzero exit on its own proves nothing: a MAINNET build with
    // `index.html` moved away also exits 1, with a rolldown stack and no guard involved. The
    // `MAINNET GUARD` string is what identifies the refusal as ours.
    if (refusal.code === 0) {
      fail(`the build SUCCEEDED on ${tree.name}. The guard did not fire:\n${refusal.output}`)
    }
    if (!refusal.output.includes('MAINNET GUARD')) {
      fail(
        `the build on ${tree.name} failed with exit ${refusal.code}, but its output never mentions ` +
          `MAINNET GUARD — so something else broke and the guard is unproven:\n${refusal.output}`,
      )
    }
    log(`leg ${leg}/${OFF_MAINNET_TREES.length + 2} — refused, exit ${refusal.code}, message names MAINNET GUARD`)
  }

  // Back to the plain sepolia tree for the dev leg: "dev still starts off-mainnet" is a statement
  // about an ordinary off-mainnet tree, not about a malformed one.
  writeFileSync(CONSTANTS, SEPOLIA_TEXT)

  // The guard is build-only by design: it must never take development down. Proving that needs the
  // tree to be OFF mainnet, so it belongs inside the window.
  log(`leg ${OFF_MAINNET_TREES.length + 2}/${OFF_MAINNET_TREES.length + 2} — dev server on the sepolia tree, expecting it to start normally`)
  const dev = await viteDev()
  if (!dev.ready) {
    fail(
      `\`vite dev\` did not start on the sepolia tree (${dev.reason}). The guard is supposed to be ` +
        `build-only; taking dev down is a regression. If the reason is that port ${DEV_PORT} is ` +
        `already in use, a previous dev server was orphaned — kill it and re-run:\n${dev.output}`,
    )
  }
  log(`leg ${OFF_MAINNET_TREES.length + 2}/${OFF_MAINNET_TREES.length + 2} — dev server started off-mainnet, as intended`)

  if (HOLD_MS > 0) {
    log(`PASSBOOK_GUARD_HOLD_MS=${HOLD_MS} — holding the flip open (restore-path proof only)`)
    await new Promise((r) => setTimeout(r, HOLD_MS))
  }
} finally {
  // ---- layer 3 -----------------------------------------------------------------------------
  restoreSync()
}

// ---- and prove the restore, rather than assuming it --------------------------------------------
const restored = readFileSync(CONSTANTS)
if (!restored.equals(ORIGINAL)) {
  fail(
    `constants.ts was NOT restored byte-identically. The original is in ${SIDECAR} if it still ` +
      `exists; do not resolve this with \`git checkout --\` without reading the diff first.`,
  )
}
if (existsSync(SIDECAR)) fail(`the sidecar ${SIDECAR} was left behind`)
if (existsSync(LOCK)) fail(`the lock ${LOCK} was left behind`)

log('window closed — constants.ts is byte-identical to its pre-run state')
log(
  `OK — the guard permits mainnet, refuses all ${OFF_MAINNET_TREES.length} off-mainnet tree shapes ` +
    `(${OFF_MAINNET_TREES.map((t) => t.name).join('; ')}), and leaves dev alone`,
)
