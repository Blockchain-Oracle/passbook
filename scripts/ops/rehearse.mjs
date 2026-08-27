// FREE compile_actions rehearsal against the deployed mainnet pool.
// view-only: no transaction, no key material of value, nothing spent.

import { ec, hash, shortString, RpcProvider } from 'starknet'

const POOL = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const RPCS = ['https://starknet-rpc.publicnode.com', 'https://rpc.starknet.lava.build']
const SELECTOR_PRIVACY_INVOKE = '0x402925cce9218828b3ac9a72ac249103f8448a1e1d73c3efaf5da992625043'

const CLIENT_ACTION = {
  SetViewingKey: 0, OpenChannel: 1, OpenSubchannel: 2, CreateEncNote: 3, CreateOpenNote: 4,
  Deposit: 5, UseNote: 6, Withdraw: 7, InvokeExternal: 8, ComputeAndInvoke: 9,
}

const TAG = (s) => BigInt(shortString.encodeShortString(s))
const CHANNEL_KEY_TAG = TAG('CHANNEL_KEY_TAG:V1')

const f = (v) => '0x' + BigInt(v).toString(16)

// ── THROWAWAY IDENTITY ────────────────────────────────────────────────────────
// Random, canonical (< ORDER/2), never funded, never used for anything else.
const HALF_ORDER = 0x0400000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2fn / 2n
function randFelt(bits = 200) {
  let x = 0n
  for (const b of crypto.getRandomValues(new Uint8Array(bits / 8))) x = (x << 8n) | BigInt(b)
  return x
}
let PRIV = randFelt(200)
while (PRIV === 0n || PRIV >= HALF_ORDER) PRIV = randFelt(200)
const PUB = BigInt(ec.starkCurve.getStarkKey(f(PRIV)))
const ADDR = randFelt(240)                       // undeployed; compile_actions accepts one
const DUMMY_TARGET = '0x' + randFelt(240).toString(16)

const channelKey = (recipientAddr, recipientPub) =>
  BigInt(hash.computePoseidonHashOnElements(
    [CHANNEL_KEY_TAG, ADDR, PRIV, BigInt(recipientAddr), recipientPub].map(f),
  ))

// ── ENCODER (Span<ClientAction>, serde: [len, ...[variant, ...fields]]) ───────
function encode(actions) {
  const out = [f(actions.length)]
  for (const a of actions) {
    const k = CLIENT_ACTION[a.type]
    if (a.type === 'SetViewingKey') out.push(f(k), f(a.random))
    else if (a.type === 'OpenChannel') out.push(f(k), f(a.recipientAddr), f(a.index), f(a.random), f(a.salt))
    else if (a.type === 'OpenSubchannel')
      out.push(f(k), f(a.recipientAddr), f(a.recipientPublicKey), f(a.channelKey), f(a.index), f(a.token), f(a.salt))
    // CreateEncNoteInput ends at `salt: u128` — there is NO random field (actions.cairo:85-101).
    else if (a.type === 'CreateEncNote')
      out.push(f(k), f(a.recipientAddr), f(a.recipientPublicKey), f(a.token), f(a.amount), f(a.index), f(a.salt))
    else if (a.type === 'CreateOpenNote')
      out.push(f(k), f(a.recipientAddr), f(a.recipientPublicKey), f(a.token), f(a.index), f(a.random))
    else if (a.type === 'Deposit') out.push(f(k), f(a.token), f(a.amount))
    else if (a.type === 'UseNote') out.push(f(k), f(a.channelKey), f(a.token), f(a.index))
    else if (a.type === 'Withdraw') out.push(f(k), f(a.toAddr), f(a.token), f(a.amount), f(a.random))
    else if (a.type === 'InvokeExternal')
      out.push(f(k), f(a.contractAddress), f(a.calldata.length), ...a.calldata.map(f))
    else throw new Error('unencodable ' + a.type)
  }
  return out
}

// ── RPC ──────────────────────────────────────────────────────────────────────
let provider
async function pickRpc() {
  for (const url of RPCS) {
    try {
      const p = new RpcProvider({ nodeUrl: url })
      await p.getBlockLatestAccepted()
      console.log(`RPC: ${url}`)
      return p
    } catch { /* next */ }
  }
  throw new Error('no RPC reachable')
}

// The pool's own revert string is buried in the RPC error payload; dig it out rather
// than reporting the RPC envelope.
const revertName = (e) => {
  const blob = JSON.stringify(e?.baseError ?? e?.response ?? e?.message ?? String(e))
  const named = blob.match(/[A-Z][A-Z0-9_]{6,}/g)
  const drop = new Set(['CONTRACT_NOT_FOUND', 'ENTRYPOINT_NOT_FOUND', 'TRANSACTION_EXECUTION_ERROR', 'CONTRACT_ERROR', 'EXECUTION_ERROR'])
  const hits = named ? [...new Set(named)].filter((s) => !drop.has(s)) : []
  if (hits.length) return hits.join(',')
  const felt = blob.match(/0x[0-9a-f]{2,62}(?=['"\\ ])/gi) ?? []
  const decoded = felt.map((h) => { try { return Buffer.from(h.slice(2).padStart(h.length % 2 ? h.length + 1 : h.length - 2, '0'), 'hex').toString('utf8') } catch { return '' } })
    .filter((s) => /^[\x20-\x7e]{4,}$/.test(s))
  return decoded.length ? decoded.join('|') : blob.slice(0, 300)
}

async function probe(label, actions) {
  const calldata = [f(ADDR), f(PRIV), ...encode(actions)]
  try {
    const res = await provider.callContract({ contractAddress: POOL, entrypoint: 'compile_actions', calldata })
    console.log(`\n  ${label}`)
    console.log(`     OK — ${Number(BigInt(res[0]))} server actions (${res.length} felts returned)`)
    return { ok: true, n: Number(BigInt(res[0])), felts: res.length, calldata }
  } catch (e) {
    console.log(`\n  ${label}`)
    console.log(`     ERR ${revertName(e)}`)
    return { ok: false, err: revertName(e), calldata }
  }
}

// ── SHAPES ───────────────────────────────────────────────────────────────────
const R = () => randFelt(120) | 1n          // non-zero random
const SALT = () => (randFelt(120) | 3n)     // 120-bit, > OPEN_NOTE_SALT(=1)

provider = await pickRpc()
console.log(`pool:   ${POOL}`)
console.log(`sender: ${f(ADDR)}  (throwaway, undeployed, unregistered)`)
console.log(`key:    throwaway random canonical felt — generated in-process, never funded`)
console.log(`target: ${DUMMY_TARGET} (dummy invoke target)`)

const CK = channelKey(f(ADDR), PUB)   // self-channel: sender opens a channel to itself

const svk = { type: 'SetViewingKey', random: R() }
const oc = { type: 'OpenChannel', recipientAddr: f(ADDR), index: 0, random: R(), salt: SALT() }
const os = {
  type: 'OpenSubchannel', recipientAddr: f(ADDR), recipientPublicKey: PUB,
  channelKey: CK, index: 0, token: STRK, salt: SALT(),
}
const dep = (n) => ({ type: 'Deposit', token: STRK, amount: n })
const enc = (amount, index) => ({
  type: 'CreateEncNote', recipientAddr: f(ADDR), recipientPublicKey: PUB, token: STRK,
  amount, index, salt: SALT(), random: R(),
})
const open = (index) => ({
  type: 'CreateOpenNote', recipientAddr: f(ADDR), recipientPublicKey: PUB, token: STRK,
  index, random: R(),
})
const wd = (amount, to) => ({ type: 'Withdraw', toAddr: to ?? DUMMY_TARGET, token: STRK, amount, random: R() })
const inv = { type: 'InvokeExternal', contractAddress: DUMMY_TARGET, calldata: [1n, 2n, 0n] }
const useNote = (index) => ({ type: 'UseNote', channelKey: CK, token: STRK, index })

const SETUP = [svk, oc, os]

console.log(`\n${'='.repeat(78)}\nLADDER — establishing the throwaway sender can reach the shapes at all\n${'='.repeat(78)}`)
await probe('L1  [SetViewingKey]', [svk])
await probe('L2  [SVK, OpenChannel(0 -> self)]', [svk, oc])
await probe('L3  [SVK, OC(0), OpenSubchannel(0, STRK)]', SETUP)

console.log(`\n${'='.repeat(78)}\nSHAPE (a) BET — the proven bridge shape\n${'='.repeat(78)}`)
await probe('a1  literal: [UseNote, CreateEncNote, Withdraw, InvokeExternal]',
  [useNote(0), enc(2n, 1n), wd(1n), inv])
await probe('a2  [SVK,OC,OS, UseNote(0), CreateEncNote(2,#1), Withdraw(1), InvokeExternal]',
  [...SETUP, useNote(0), enc(2n, 1), wd(1n), inv])
const A = await probe('a3  DEPOSIT STAND-IN: [SVK,OC,OS, Deposit(3), CreateEncNote(2,#0), Withdraw(1), InvokeExternal]',
  [...SETUP, dep(3n), enc(2n, 0), wd(1n), inv])

console.log(`\n${'='.repeat(78)}\nSHAPE (b) CLAIM — the N-open-note generalisation (never emitted before)\n${'='.repeat(78)}`)
const B = await probe('b1  [SVK,OC,OS, Deposit(3), CreateEncNote(2,#0), CreateOpenNote #1,#2,#3, Withdraw(1), InvokeExternal]',
  [...SETUP, dep(3n), enc(2n, 0), open(1), open(2), open(3), wd(1n), inv])

console.log(`\n${'='.repeat(78)}\nSHAPE (b) VARIANTS — isolating each rule\n${'='.repeat(78)}`)
await probe('b2  open notes FIRST, enc note after: CreateOpenNote #0,#1,#2 then CreateEncNote #3',
  [...SETUP, dep(3n), open(0), open(1), open(2), enc(2n, 3), wd(1n), inv])
await probe('b3  ONE open note only: Deposit(3), CreateEncNote(2,#0), CreateOpenNote #1, Withdraw(1), Invoke',
  [...SETUP, dep(3n), enc(2n, 0), open(1), wd(1n), inv])
await probe('b4  open notes with a GAP in the index (#1,#2,#5)',
  [...SETUP, dep(3n), enc(2n, 0), open(1), open(2), open(5), wd(1n), inv])
await probe('b5  three open notes, NO invoke at all',
  [...SETUP, dep(3n), enc(2n, 0), open(1), open(2), open(3), wd(1n)])
await probe('b6  three open notes, NO enc-note change leg',
  [...SETUP, dep(1n), open(0), open(1), open(2), wd(1n), inv])
await probe('b7  FIVE open notes',
  [...SETUP, dep(3n), enc(2n, 0), open(1), open(2), open(3), open(4), open(5), wd(1n), inv])
await probe('b8  open note AFTER the withdraw (phase violation probe)',
  [...SETUP, dep(3n), enc(2n, 0), wd(1n), open(1), inv])

console.log(`\n${'='.repeat(78)}\nEXACT REQUEST for the two headline shapes\n${'='.repeat(78)}`)
for (const [name, r] of [['(a) BET a3', A], ['(b) CLAIM b1', B]]) {
  console.log(`\n${name}: ${r.ok ? `OK ${r.n} server actions` : `ERR ${r.err}`}`)
  console.log(`  calldata (${r.calldata.length} felts): ${JSON.stringify(r.calldata)}`)
}
