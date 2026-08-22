//
// The browser route for a MessageBook append.
//
// WHY THIS EXISTS AT ALL: `scripts/bank-gate-transactions.ts` can build and validate the
// action list but cannot submit one — it would have to reimplement the pool's client
// (prover, fee approval, replay-protection companion) by hand. The wallet already has
// all of that, so the whole submission path is one `wallet_strk20InvokeTransaction`
// call. We describe the actions; the wallet compiles, proves, approves and pays.
//
// THE FOUR CHECKS THIS PAGE REFUSES TO SKIP, and why they are not the pool's job:
// `compile_actions` on the deployed mainnet pool was verified to accept an empty
// payload, a wrong length prefix AND an unknown mode without complaint, because it only
// lays out the action list and never executes the invoke. All three reach
// `apply_actions`, revert there, and cost the full fee. See `web/message-book.js` and
// `packages/protocol/src/message-book.ts`.
//
import {
  MODE_APPEND,
  MODE_SEAL,
  buildInvokeCalldata,
  checkInvokeCalldata,
  packUtf8ToFelts,
} from './message-book.js'

// ---------------------------------------------------------------------------
// Facts. Mirrored from packages/protocol/src/constants.ts and evidence/deployment.json,
// which stay the source of truth. Nothing here is a runtime switch: a testnet
// submission is worth nothing to the gate, so there is deliberately no way to point
// this page at another network.
// ---------------------------------------------------------------------------
const CHAIN_SN_MAIN = 0x534e5f4d41494en
const MESSAGE_BOOK = '0x3105b6a327ba11f5464335f480046348a4052be2c12df726f37633d50ae35bc'
const POOL = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'

// The pool is upgradeable with a ZERO delay, so "it matched when we tested" says nothing
// about now. This is the class every rule on this page was established against; if the
// deployed class has moved, none of those rules can be relied on and submitting is a
// gamble with the fee. Spec §10.5.
const EXPECTED_POOL_CLASS = '0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d'
const EXPECTED_MB_CLASS = '0x52c432b3751ef6e61aa742e6b04a75bd929f2c85e1f2e632df812d424e4460f'

const RPC_URLS = ['https://rpc.starknet.lava.build', 'https://starknet-rpc.publicnode.com']
const EXPLORER = 'https://voyager.online'

// The three bodies that close the gate. They are PLAINTEXT in a public event, so they
// are chosen to be things we are content to have world-readable forever.
const DEFAULT_MESSAGES = [
  'strk20 messagebook: gate transaction 1 of 3',
  'strk20 messagebook: gate transaction 2 of 3',
  'strk20 messagebook: gate transaction 3 of 3',
]

const $ = (id) => document.getElementById(id)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---------------------------------------------------------------------------
// Log
// ---------------------------------------------------------------------------
function log(text, cls = '') {
  const line = document.createElement('div')
  line.className = 'log-line'
  const time = document.createElement('span')
  time.className = 'log-time'
  time.textContent = new Date().toLocaleTimeString()
  const body = document.createElement('span')
  body.className = `grow ${cls}`
  body.textContent = text
  line.append(time, body)
  const box = $('log-lines')
  box.append(line)
  box.scrollTop = box.scrollHeight
  return body
}

function logLink(text, href, cls = '') {
  const body = log(text, cls)
  const a = document.createElement('a')
  a.href = href
  a.target = '_blank'
  a.rel = 'noreferrer noopener'
  a.textContent = href
  a.className = 'mono'
  body.append(' ', a)
}

function describeError(err) {
  // Wallet API errors arrive as { code, message } and the code is the only part that
  // tells the user what to do about it.
  const code = err?.code
  const base = err?.message || String(err)
  const guidance = {
    113: 'you refused the operation in the wallet',
    114: 'the wallet rejected the request payload — the action list is malformed for this wallet',
    117: 'the wallet does not support this chain',
    118: 'the wallet reports this account is not registered in the pool; register it in the wallet, then retry',
    120: 'the wallet refused because the request would leak private state',
    162: 'this wallet does not support the STRK20 wallet API version this page uses',
  }[code]
  return guidance ? `${base} — ${guidance}` : base
}

// ---------------------------------------------------------------------------
// starknet.js
//
// The library is loaded from the pinned dependency in node_modules rather than vendored
// into this directory, so it cannot drift from the version the rest of the repository is
// tested against. That is why the page must be served from the REPOSITORY ROOT.
//
// It is evaluated inside `new Function` rather than loaded with a <script src> tag on
// purpose. The bundle is an IIFE whose top-level statement is `var starknet = ...`, and
// several Starknet wallets inject their own `window.starknet`. At global scope that
// assignment would either clobber the wallet's object or, if the wallet defined it as a
// getter, throw outright — the bundle is in strict mode. Inside `new Function` the
// binding is function-local and neither can happen.
// ---------------------------------------------------------------------------
const STARKNET_BUNDLE = '../node_modules/starknet/dist/index.global.js'
let sn = null

async function loadStarknet() {
  let res
  try {
    res = await fetch(STARKNET_BUNDLE)
  } catch (e) {
    throw new Error(`could not fetch ${STARKNET_BUNDLE}: ${e.message}`)
  }
  if (!res.ok) throw new Error(`${STARKNET_BUNDLE} returned HTTP ${res.status}`)
  const src = await res.text()
  // eslint-disable-next-line no-new-func
  return new Function(`${src}\nreturn starknet;`)()
}

function bootFailed(message) {
  $('boot-error').hidden = false
  $('boot-error-text').textContent = message
  log(message, 'bad')
}

// ---------------------------------------------------------------------------
// JSON-RPC. Deliberately plain `fetch` rather than starknet.js's provider: the reads on
// this page are three `starknet_call`s and two class-hash lookups, and hand-rolling them
// means a failing endpoint produces a message naming the endpoint and the method instead
// of a generic "fetch failed".
// ---------------------------------------------------------------------------
let rpcId = 0

async function rpc(method, params) {
  const failures = []
  for (const url of RPC_URLS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      if (body.error) throw new Error(body.error.message ?? JSON.stringify(body.error))
      return body.result
    } catch (e) {
      failures.push(`${new URL(url).host}: ${e.message}`)
    }
  }
  throw new Error(`${method} failed on every endpoint — ${failures.join('; ')}`)
}

const callContract = (address, entrypoint, calldata = []) =>
  rpc('starknet_call', [
    {
      contract_address: address,
      entry_point_selector: sn.hash.getSelectorFromName(entrypoint),
      calldata,
    },
    'latest',
  ])

// ---------------------------------------------------------------------------
// Wallet discovery, over the Wallet Standard handshake: the app announces itself with
// `wallet-standard:app-ready` and every wallet already loaded registers in response;
// wallets that load later fire `wallet-standard:register-wallet` at us instead. Both
// directions are needed — an extension can be either side of the race.
//
// Only wallets exposing `starknet:walletApi` are listed. That feature is where
// `wallet_strk20InvokeTransaction` lives; a legacy `window.starknet_*` injection cannot
// carry it, so offering one here would just fail later with a worse message.
// ---------------------------------------------------------------------------
const wallets = new Map()

function acceptWallet(wallet) {
  if (!wallet?.features?.['starknet:walletApi'] || !wallet.features['standard:connect']) return
  const key = wallet.name || `wallet-${wallets.size}`
  if (wallets.get(key) === wallet) return
  wallets.set(key, wallet)
  log(`discovered wallet: ${key}`)
  renderWallets()
}

function scanForWallets() {
  // The deprecated `navigator.wallets` queue is deliberately not used. It is ambiguous
  // about which side registers what, and a half-understood fallback that silently
  // registers nothing is worse than not having one — it would make "no wallet found"
  // mean two different things.
  window.dispatchEvent(
    new CustomEvent('wallet-standard:app-ready', {
      detail: {
        register(...found) {
          found.forEach(acceptWallet)
          return () => {}
        },
      },
    }),
  )
  renderWallets()
}

window.addEventListener('wallet-standard:register-wallet', (event) => {
  try {
    event.detail({
      register(...found) {
        found.forEach(acceptWallet)
        return () => {}
      },
    })
  } catch (e) {
    log(`a wallet failed to register: ${e.message}`, 'bad')
  }
})

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const state = {
  wallet: null, // the raw Wallet Standard object
  account: null, // WalletAccountV6
  address: '',
  chainId: null, // bigint
  poolPaused: null,
  poolClassOk: null,
  feeWei: null,
  tagFelt: null,
  tagError: '',
  rows: [],
}

const onMainnet = () => state.chainId === CHAIN_SN_MAIN

/** Every reason it is not safe to spend right now, in the order a user would fix them. */
function blockingReasons() {
  const reasons = []
  if (!state.account) reasons.push('no wallet connected')
  else if (state.chainId === null) reasons.push('wallet chain unknown')
  else if (!onMainnet()) reasons.push('wallet is not on SN_MAIN')
  if (state.poolPaused === true) reasons.push('the pool is paused')
  if (state.poolClassOk === false) reasons.push('the pool implementation is not the one these rules were verified against')
  if (state.tagError) reasons.push(`tag is invalid: ${state.tagError}`)
  return reasons
}

// ---------------------------------------------------------------------------
// Wallet UI
// ---------------------------------------------------------------------------
function renderWallets() {
  const list = $('wallet-list')
  list.replaceChildren()
  if (state.account) {
    $('wallet-hint').textContent = `Connected through ${state.wallet?.name ?? 'the wallet'}.`
    return
  }
  if (wallets.size === 0) {
    $('wallet-hint').innerHTML =
      'No Starknet wallet exposing the STRK20 wallet API was found. Install or unlock the ' +
      'wallet, then press <em>Scan again</em>. A wallet that only injects the legacy ' +
      '<code>window.starknet</code> object cannot submit these transactions.'
    return
  }
  $('wallet-hint').textContent = 'Choose a wallet to connect.'
  for (const [name, wallet] of wallets) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'primary'
    button.textContent = `Connect ${name}`
    button.addEventListener('click', () => connect(wallet, name))
    list.append(button)
  }
}

async function connect(wallet, name) {
  try {
    log(`connecting to ${name}…`)
    const provider = new sn.RpcProvider({ nodeUrl: RPC_URLS[0] })
    const account = await sn.WalletAccountV6.connect(provider, wallet)
    state.wallet = wallet
    state.account = account
    state.address = account.address
    log(`connected: ${account.address}`, 'ok')

    // A wallet that switches network or account under us must not leave a stale
    // "SN_MAIN" on screen while a submit button is live.
    try {
      account.onChange(() => {
        log('wallet reported a change; re-reading address and chain')
        refreshWalletFacts()
      })
    } catch {
      log('this wallet does not report change events; press Refresh after switching networks', 'warn')
    }

    await refreshWalletFacts()
  } catch (e) {
    log(`connect failed: ${describeError(e)}`, 'bad')
  }
  renderWallets()
  renderAll()
}

async function refreshWalletFacts() {
  if (!state.wallet) return
  try {
    // The chain is asked of the WALLET, never of our RPC endpoint: our endpoint is
    // hardcoded to mainnet, so asking it would always answer SN_MAIN and the guard
    // would be theatre.
    const chainId = await sn.walletV6.requestChainId(state.wallet)
    state.chainId = BigInt(chainId)
  } catch (e) {
    state.chainId = null
    log(`could not read the wallet chain id: ${describeError(e)}`, 'bad')
  }
  try {
    const accounts = await sn.walletV6.requestAccounts(state.wallet, true)
    if (accounts?.[0]) {
      if (state.address && BigInt(accounts[0]) !== BigInt(state.address)) {
        log(`wallet switched account to ${accounts[0]}`, 'warn')
      }
      state.address = accounts[0]
      if (state.account) state.account.address = accounts[0]
    }
  } catch {
    /* keep the address from connect() */
  }
  try {
    const versions = await sn.walletV6.supportedWalletApi(state.wallet)
    $('wallet-api').textContent = Array.isArray(versions) ? versions.join(', ') : String(versions)
  } catch {
    $('wallet-api').textContent = 'not reported'
  }
  renderAll()
}

function renderWalletFacts() {
  const connected = !!state.account
  $('wallet-facts').hidden = !connected
  $('wallet-actions').hidden = !connected
  if (!connected) return

  $('wallet-address').textContent = state.address
  const chain = $('wallet-chain')
  if (state.chainId === null) {
    chain.textContent = 'unknown'
    chain.className = 'warn'
  } else if (onMainnet()) {
    chain.textContent = 'SN_MAIN (0x534e5f4d41494e)'
    chain.className = 'ok'
  } else {
    chain.textContent = `NOT SN_MAIN — 0x${state.chainId.toString(16)}. Nothing can be submitted from here.`
    chain.className = 'bad'
  }
  $('chain-switch').hidden = onMainnet() || state.chainId === null
}

// ---------------------------------------------------------------------------
// Chain state
// ---------------------------------------------------------------------------
function formatStrk(wei) {
  const whole = wei / 10n ** 18n
  const frac = (wei % 10n ** 18n).toString().padStart(18, '0').replace(/0+$/, '')
  return `${whole}${frac ? `.${frac}` : ''} STRK`
}

function parseTag(text) {
  const trimmed = text.trim()
  if (!trimmed) throw new Error('a tag is required')
  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) return BigInt(trimmed)
  // A tag is one felt252, so a short string tag is at most 31 UTF-8 bytes. Reusing the
  // packer means that limit is enforced by the same code that enforces it for payloads.
  const felts = packUtf8ToFelts(trimmed)
  if (felts.length !== 1) {
    throw new Error(`a tag must fit in one felt (31 bytes); "${trimmed}" needs ${felts.length}`)
  }
  return felts[0]
}

function readTag() {
  try {
    state.tagFelt = parseTag($('tag-input').value)
    state.tagError = ''
    $('tag-felt').textContent = `= 0x${state.tagFelt.toString(16)}`
  } catch (e) {
    state.tagFelt = null
    state.tagError = e.message
    $('tag-felt').textContent = e.message
  }
}

let lastCount = null

// Typing in the tag box starts a refresh per keystroke, so several are always in flight
// at once. Each one reads the tag ONCE into a local and answers only for that tag, and
// only the newest is allowed to paint — otherwise a slow reply for an old tag lands after
// a fast reply for the new one and the page shows a count that belongs to neither.
let refreshGeneration = 0

async function refreshChainState() {
  const generation = ++refreshGeneration
  readTag()
  const tagFelt = state.tagFelt
  $('pool-address').textContent = POOL
  $('mb-address').textContent = MESSAGE_BOOK
  // Repaint before the network round-trip, not only after it. A tag that has just become
  // invalid must show as blocking immediately; leaving the rows green for the half second
  // the RPC takes is exactly the window in which someone clicks.
  renderAll()

  // Clear first. A stale "not paused" left over from a previous refresh would be read by
  // `blockingReasons` as a green light that nothing had actually checked.
  state.feeWei = null
  state.poolPaused = null
  state.poolClassOk = null

  const results = await Promise.allSettled([
    callContract(POOL, 'get_fee_amount'),
    callContract(POOL, 'is_paused'),
    rpc('starknet_getClassHashAt', ['latest', POOL]),
    rpc('starknet_getClassHashAt', ['latest', MESSAGE_BOOK]),
    rpc('starknet_blockNumber', []),
    tagFelt === null
      ? Promise.resolve(null)
      : callContract(MESSAGE_BOOK, 'message_count', [`0x${tagFelt.toString(16)}`]),
    tagFelt === null
      ? Promise.resolve(null)
      : callContract(MESSAGE_BOOK, 'seal_root', [`0x${tagFelt.toString(16)}`]),
  ])
  if (generation !== refreshGeneration) return
  const [fee, paused, poolClass, mbClass, block, count, seal] = results

  const show = (id, result, render) => {
    const el = $(id)
    if (result.status === 'rejected') {
      el.textContent = `unavailable — ${result.reason.message}`
      el.className = 'bad'
      return
    }
    render(el, result.value)
  }

  show('pool-fee', fee, (el, v) => {
    state.feeWei = BigInt(v[0])
    el.textContent = formatStrk(state.feeWei)
    el.className = ''
  })

  show('pool-paused', paused, (el, v) => {
    state.poolPaused = BigInt(v[0]) !== 0n
    el.textContent = state.poolPaused ? 'YES — the pool is paused, nothing will go through' : 'no'
    el.className = state.poolPaused ? 'bad' : 'ok'
  })

  show('pool-class', poolClass, (el, v) => {
    state.poolClassOk = BigInt(v) === BigInt(EXPECTED_POOL_CLASS)
    el.className = state.poolClassOk ? 'ok' : 'bad'
    el.textContent = state.poolClassOk
      ? 'matches the implementation these rules were verified against'
      : `CHANGED — deployed ${v}, expected ${EXPECTED_POOL_CLASS}. The pool upgrades with zero ` +
        'delay, so every rule this page relies on may no longer hold. Re-verify before spending.'
  })

  show('mb-class', mbClass, (el, v) => {
    const ok = BigInt(v) === BigInt(EXPECTED_MB_CLASS)
    el.className = ok ? 'ok' : 'bad'
    el.textContent = ok ? 'matches evidence/deployment.json' : `CHANGED — deployed ${v}`
  })

  show('block-number', block, (el, v) => {
    el.textContent = String(v)
    el.className = 'dim'
  })

  if (tagFelt === null) {
    $('message-count').textContent = '—'
    $('seal-root').textContent = '—'
  } else {
    show('message-count', count, (el, v) => {
      const now = BigInt(v[0])
      el.textContent = String(now)
      el.className = ''
      if (lastCount !== null && now !== lastCount) {
        $('counter-note').textContent = `counter moved ${lastCount} → ${now}`
        $('counter-note').className = 'ok'
        log(`message_count moved ${lastCount} → ${now}`, 'ok')
      }
      lastCount = now
    })
    show('seal-root', seal, (el, v) => {
      el.textContent = BigInt(v[0]) === 0n ? '0x0 (never sealed)' : v[0]
      el.className = 'mono'
    })
  }

  renderAll()
}

// ---------------------------------------------------------------------------
// Message rows
// ---------------------------------------------------------------------------
function buildRow(index) {
  const row = {
    index,
    text: DEFAULT_MESSAGES[index],
    mode: MODE_APPEND,
    dryRanFor: null, // the exact calldata a dry run succeeded for
    submitted: null,
    txStatus: null,
    busy: false,
    el: {},
  }

  const wrap = document.createElement('div')
  wrap.className = 'row'

  const head = document.createElement('div')
  head.className = 'row-head'
  const title = document.createElement('h3')
  title.textContent = `Message ${index + 1}`
  const modeSelect = document.createElement('select')
  for (const [label, value] of [
    ['MODE_APPEND (1)', String(MODE_APPEND)],
    ['MODE_SEAL (2)', String(MODE_SEAL)],
  ]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = label
    modeSelect.append(option)
  }
  head.append(title, modeSelect)

  const input = document.createElement('input')
  input.type = 'text'
  input.value = row.text

  const calldataBox = document.createElement('pre')
  calldataBox.className = 'calldata'

  const verdict = document.createElement('div')
  verdict.className = 'verdict'

  const controls = document.createElement('div')
  controls.className = 'controls'
  const dryButton = document.createElement('button')
  dryButton.type = 'button'
  dryButton.textContent = 'Dry run (free)'
  const submitButton = document.createElement('button')
  submitButton.type = 'button'
  submitButton.className = 'spend'
  const status = document.createElement('span')
  status.className = 'dim'
  controls.append(dryButton, submitButton, status)

  wrap.append(head, input, calldataBox, verdict, controls)
  $('rows').append(wrap)

  row.el = { input, verdict, calldataBox, dryButton, submitButton, status, modeSelect }

  const changed = () => {
    row.text = input.value
    row.mode = BigInt(modeSelect.value)
    // A dry run proves one exact calldata array is sound. Editing the message makes it
    // prove nothing, so the submit button goes back behind another dry run.
    row.dryRanFor = null
    renderRow(row)
  }
  input.addEventListener('input', changed)
  modeSelect.addEventListener('change', changed)
  dryButton.addEventListener('click', () => dryRun(row))
  submitButton.addEventListener('click', () => submit(row))

  return row
}

/** The calldata for a row, plus every local check that must pass before it is paid for. */
function prepare(row) {
  if (state.tagFelt === null) return { calldata: null, failures: [{ rule: 'BAD_TAG', detail: state.tagError }] }
  const payload = packUtf8ToFelts(row.text)
  let calldata
  try {
    calldata = buildInvokeCalldata(row.mode, state.tagFelt, payload)
  } catch (e) {
    // buildInvokeCalldata only throws when its own length header is inconsistent, which
    // is exactly the failure the wire-shape check exists for. Surface it, do not swallow.
    return { calldata: null, failures: [{ rule: 'LENGTH_PREFIX_MISMATCH', detail: e.message }] }
  }
  return { calldata, failures: checkInvokeCalldata(calldata) }
}

function renderRow(row) {
  const { calldata, failures } = prepare(row)
  const { verdict, calldataBox, dryButton, submitButton, status } = row.el

  calldataBox.textContent = calldata
    ? `privacy_invoke calldata (${calldata.length} felts)\n` +
      `  mode        ${calldata[0]}\n` +
      `  tag         ${calldata[1]}\n` +
      `  payload_len ${calldata[2]}\n` +
      `  payload     ${calldata.slice(3).join(' ')}`
    : 'no calldata — fix the errors below'

  verdict.replaceChildren()
  if (failures.length === 0) {
    const ok = document.createElement('span')
    ok.className = 'ok'
    ok.textContent =
      '✓ passes all four local checks: payload is not empty, mode is known, MODE_SEAL arity, ' +
      'length prefix matches the payload.'
    verdict.append(ok)
  } else {
    const head = document.createElement('span')
    head.className = 'bad'
    // Be exact about which kind of failure this is. BAD_TAG means no calldata was ever
    // built; the other rules mean calldata was built and the chain would reject it after
    // charging for it. Saying "would revert" about the first one is not true.
    head.textContent = failures.some((f) => f.rule === 'BAD_TAG')
      ? 'This message cannot be turned into a call:'
      : 'This call would revert on-chain after the fee is taken:'
    const list = document.createElement('ul')
    for (const f of failures) {
      const li = document.createElement('li')
      li.className = 'bad'
      li.textContent = `${f.rule} — ${f.detail}`
      list.append(li)
    }
    verdict.append(head, list)
  }

  const blocked = blockingReasons()
  const key = calldata?.join(',') ?? null
  const dryRunCurrent = key !== null && row.dryRanFor === key

  dryButton.disabled = row.busy || failures.length > 0 || blocked.length > 0
  submitButton.disabled = row.busy || failures.length > 0 || blocked.length > 0 || !dryRunCurrent
  submitButton.textContent = state.feeWei
    ? `Submit — spends ${formatStrk(state.feeWei)}`
    : 'Submit — spends the pool fee'

  if (row.submitted) {
    status.className = row.txStatus?.startsWith('REVERTED') ? 'bad' : 'ok'
    status.textContent = `submitted ${row.submitted.slice(0, 12)}…${row.txStatus ? ` · ${row.txStatus}` : ''}`
  } else if (row.busy) {
    status.className = 'warn'
    status.textContent = 'waiting on the wallet…'
  } else if (failures.length) {
    status.className = 'bad'
    status.textContent = 'blocked by the checks above'
  } else if (blocked.length) {
    status.className = 'warn'
    status.textContent = `blocked: ${blocked.join('; ')}`
  } else if (!dryRunCurrent) {
    status.className = 'dim'
    status.textContent = 'dry run this exact message before it can be submitted'
  } else {
    status.className = 'ok'
    status.textContent = 'dry run passed for this exact calldata'
  }
}

function renderAll() {
  renderWalletFacts()
  for (const row of state.rows) renderRow(row)
}

/** The action list. One invoke and nothing else — the wallet adds the rest. */
const actionsFor = (calldata) => [{ type: 'invoke', contract: MESSAGE_BOOK, calldata }]

/**
 * Does `needle` appear contiguously inside `haystack`, comparing as field elements?
 *
 * Used to check that our calldata actually survived into the call the wallet assembled.
 * `invoke_external` copies calldata verbatim, so it should appear untouched.
 */
function containsRun(haystack, needle) {
  let h
  let n
  try {
    h = haystack.map((v) => BigInt(v))
    n = needle.map((v) => BigInt(v))
  } catch {
    return false // an entry that is not a felt cannot match ours, which all are
  }
  outer: for (let i = 0; i + n.length <= h.length; i++) {
    for (let j = 0; j < n.length; j++) if (h[i + j] !== n[j]) continue outer
    return true
  }
  return false
}

async function dryRun(row) {
  const { calldata, failures } = prepare(row)
  if (failures.length || !calldata) {
    log(`message ${row.index + 1}: refusing to call the wallet — ${failures.map((f) => f.rule).join(', ')}`, 'bad')
    return
  }
  const blocked = blockingReasons()
  if (blocked.length) {
    log(`message ${row.index + 1}: refusing to call the wallet — ${blocked.join('; ')}`, 'bad')
    return
  }

  row.busy = true
  renderRow(row)
  try {
    log(`message ${row.index + 1}: dry run (strk20PrepareInvoke, simulate)…`)
    const result = await state.account.strk20PrepareInvoke(actionsFor(calldata), true)
    const call = result?.call
    const outgoing = call?.calldata ?? []
    log(
      `message ${row.index + 1}: the wallet would call ${call?.entrypoint ?? call?.entry_point ?? '?'} ` +
        `on ${call?.contractAddress ?? call?.contract_address ?? '?'} with ${outgoing.length} felts`,
      'ok',
    )
    // A simulate-mode proof is empty by definition; say so rather than letting the empty
    // fields look like a failure.
    log('proof fields are empty because this was a simulation — it is not submittable', 'dim')

    if (Array.isArray(outgoing) && outgoing.length) {
      if (containsRun(outgoing, calldata)) {
        log(`message ${row.index + 1}: our privacy_invoke calldata is present verbatim in the assembled call`, 'ok')
      } else {
        log(
          `message ${row.index + 1}: could not find our calldata inside the assembled call. That may ` +
            'just mean this wallet encodes the action list differently, but it is worth reading the ' +
            'call above before spending.',
          'warn',
        )
      }
    }

    row.dryRanFor = calldata.join(',')
  } catch (e) {
    row.dryRanFor = null
    log(`message ${row.index + 1}: dry run failed — ${describeError(e)}`, 'bad')
  } finally {
    row.busy = false
    renderRow(row)
  }
}

async function submit(row) {
  const { calldata, failures } = prepare(row)
  // Re-run every check against the calldata as it is NOW. The button was enabled at some
  // earlier moment, and between then and this click the tag could have changed, the
  // wallet could have switched network, or the pool could have been paused.
  if (failures.length || !calldata) {
    log(`message ${row.index + 1}: refusing to submit — ${failures.map((f) => f.rule).join(', ')}`, 'bad')
    renderRow(row)
    return
  }
  const blocked = blockingReasons()
  if (blocked.length) {
    log(`message ${row.index + 1}: refusing to submit — ${blocked.join('; ')}`, 'bad')
    renderRow(row)
    return
  }
  if (row.dryRanFor !== calldata.join(',')) {
    log(`message ${row.index + 1}: refusing to submit — this exact calldata has not been dry run`, 'bad')
    renderRow(row)
    return
  }

  row.busy = true
  renderRow(row)
  try {
    log(`message ${row.index + 1}: submitting. The wallet generates a proof, which can take a while.`, 'warn')
    const { transaction_hash: hash } = await state.account.strk20InvokeTransaction(actionsFor(calldata))
    row.submitted = hash
    // Spend once. Clearing the dry-run receipt puts this row back behind another dry run,
    // so a second click cannot quietly pay the fee twice for the same message.
    row.dryRanFor = null
    logLink(`message ${row.index + 1} submitted:`, `${EXPLORER}/tx/${hash}`, 'ok')
    watchTransaction(row, hash)
  } catch (e) {
    log(`message ${row.index + 1}: submit failed — ${describeError(e)}`, 'bad')
  } finally {
    row.busy = false
    renderRow(row)
  }
}

/**
 * Follows one transaction to a verdict, then re-reads the counter.
 *
 * A hash is not a result: the gate counts transactions that ran, and an ACCEPTED but
 * REVERTED transaction has taken the fee and appended nothing. This reports which.
 */
async function watchTransaction(row, hash) {
  let last = ''
  for (let attempt = 0; attempt < 60; attempt++) {
    await sleep(5000)
    let status
    try {
      status = await rpc('starknet_getTransactionStatus', [hash])
    } catch {
      continue // not indexed yet
    }
    const line = `${status.finality_status}${status.execution_status ? ` / ${status.execution_status}` : ''}`
    if (line !== last) {
      last = line
      row.txStatus = status.execution_status === 'REVERTED' ? `REVERTED (${line})` : line
      renderRow(row)
      log(`message ${row.index + 1}: ${line}`, status.execution_status === 'REVERTED' ? 'bad' : '')
    }
    if (status.execution_status === 'REVERTED') {
      log(`message ${row.index + 1} reverted: ${status.failure_reason ?? 'no reason given'}`, 'bad')
      return
    }
    if (status.finality_status === 'ACCEPTED_ON_L2' || status.finality_status === 'ACCEPTED_ON_L1') {
      await refreshChainState()
      return
    }
  }
  log(`message ${row.index + 1}: stopped following ${hash} after 5 minutes; check the explorer`, 'warn')
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function main() {
  $('mb-address').textContent = MESSAGE_BOOK
  $('pool-address').textContent = POOL

  try {
    sn = await loadStarknet()
  } catch (e) {
    bootFailed(
      `${e.message}. This page loads starknet.js from the repository's own node_modules, so it ` +
        'must be served from the REPOSITORY ROOT, not from web/. Run "npm install", then ' +
        '"python3 -m http.server 8080" in the repository root and open ' +
        'http://localhost:8080/web/ — and check node_modules/starknet exists.',
    )
    return
  }
  log(`starknet.js loaded`, 'ok')

  state.rows = DEFAULT_MESSAGES.map((_, i) => buildRow(i))
  readTag()
  renderAll()

  $('wallet-rescan').addEventListener('click', scanForWallets)
  $('wallet-disconnect').addEventListener('click', () => {
    state.wallet = null
    state.account = null
    state.address = ''
    state.chainId = null
    log('wallet forgotten locally; the extension may still consider this site connected')
    renderWallets()
    renderAll()
  })
  $('chain-refresh').addEventListener('click', () => refreshChainState())
  $('tag-input').addEventListener('input', () => {
    lastCount = null
    $('counter-note').textContent = ''
    refreshChainState()
  })
  $('chain-switch').addEventListener('click', async () => {
    try {
      await sn.walletV6.switchStarknetChain(state.wallet, '0x534e5f4d41494e')
    } catch (e) {
      log(`chain switch failed: ${describeError(e)}`, 'bad')
    }
    await refreshWalletFacts()
  })

  scanForWallets()
  await refreshChainState()

  // A test hook, not an API. It lets the page's own wiring be driven from a headless
  // browser without a wallet installed; nothing in the page reads it.
  window.__messageBookConsole = { state, prepare, parseTag, containsRun, rpc }
}

main().catch((e) => bootFailed(`unexpected failure while starting: ${e.message}`))
