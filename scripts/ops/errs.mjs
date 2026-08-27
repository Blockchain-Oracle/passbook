// Re-run only the failing shapes and print the pool's REAL revert string.
import { ec, hash, shortString } from 'starknet'

const POOL = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const RPC = 'https://starknet-rpc.publicnode.com'
const CA = { SetViewingKey: 0, OpenChannel: 1, OpenSubchannel: 2, CreateEncNote: 3, CreateOpenNote: 4, Deposit: 5, UseNote: 6, Withdraw: 7, InvokeExternal: 8 }
const f = (v) => '0x' + BigInt(v).toString(16)
const CHANNEL_KEY_TAG = BigInt(shortString.encodeShortString('CHANNEL_KEY_TAG:V1'))
const HALF = 0x0400000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2fn / 2n
const rnd = (bits = 200) => { let x = 0n; for (const b of crypto.getRandomValues(new Uint8Array(bits / 8))) x = (x << 8n) | BigInt(b); return x }
let PRIV = rnd(200); while (!PRIV || PRIV >= HALF) PRIV = rnd(200)
const PUB = BigInt(ec.starkCurve.getStarkKey(f(PRIV)))
const ADDR = rnd(240), TGT = f(rnd(240))
const CK = BigInt(hash.computePoseidonHashOnElements([CHANNEL_KEY_TAG, ADDR, PRIV, ADDR, PUB].map(f)))

function encode(as) {
  const o = [f(as.length)]
  for (const a of as) {
    const k = CA[a.type]
    if (a.type === 'SetViewingKey') o.push(f(k), f(a.random))
    else if (a.type === 'OpenChannel') o.push(f(k), f(a.recipientAddr), f(a.index), f(a.random), f(a.salt))
    else if (a.type === 'OpenSubchannel') o.push(f(k), f(a.recipientAddr), f(a.recipientPublicKey), f(a.channelKey), f(a.index), f(a.token), f(a.salt))
    else if (a.type === 'CreateEncNote') o.push(f(k), f(a.recipientAddr), f(a.recipientPublicKey), f(a.token), f(a.amount), f(a.index), f(a.salt))
    else if (a.type === 'CreateOpenNote') o.push(f(k), f(a.recipientAddr), f(a.recipientPublicKey), f(a.token), f(a.index), f(a.random))
    else if (a.type === 'Deposit') o.push(f(k), f(a.token), f(a.amount))
    else if (a.type === 'UseNote') o.push(f(k), f(a.channelKey), f(a.token), f(a.index))
    else if (a.type === 'Withdraw') o.push(f(k), f(a.toAddr), f(a.token), f(a.amount), f(a.random))
    else if (a.type === 'InvokeExternal') o.push(f(k), f(a.contractAddress), f(a.calldata.length), ...a.calldata.map(f))
  }
  return o
}

const R = () => rnd(120) | 1n, S = () => rnd(120) | 3n
const svk = { type: 'SetViewingKey', random: R() }
const oc = { type: 'OpenChannel', recipientAddr: f(ADDR), index: 0, random: R(), salt: S() }
const os = { type: 'OpenSubchannel', recipientAddr: f(ADDR), recipientPublicKey: PUB, channelKey: CK, index: 0, token: STRK, salt: S() }
const dep = (n) => ({ type: 'Deposit', token: STRK, amount: n })
const enc = (a, i) => ({ type: 'CreateEncNote', recipientAddr: f(ADDR), recipientPublicKey: PUB, token: STRK, amount: a, index: i, salt: S() })
const open = (i) => ({ type: 'CreateOpenNote', recipientAddr: f(ADDR), recipientPublicKey: PUB, token: STRK, index: i, random: R() })
const wd = (a) => ({ type: 'Withdraw', toAddr: TGT, token: STRK, amount: a, random: R() })
const inv = { type: 'InvokeExternal', contractAddress: TGT, calldata: [1n, 2n, 0n] }
const un = (i) => ({ type: 'UseNote', channelKey: CK, token: STRK, index: i })
const SETUP = [svk, oc, os]

// Pull every printable short-string out of the nested error payload.
function reasons(payload) {
  const seen = new Set()
  const walk = (v) => {
    if (typeof v === 'string') {
      for (const m of v.match(/0x[0-9a-fA-F]{2,62}/g) ?? []) {
        let h = m.slice(2).replace(/^0+/, ''); if (h.length % 2) h = '0' + h
        const s = Buffer.from(h, 'hex').toString('utf8')
        if (/^[\x20-\x7e]{3,31}$/.test(s)) seen.add(s)
      }
      const direct = v.match(/[A-Z][A-Z0-9_]{6,}/g) ?? []
      for (const d of direct) if (!['ENTRYPOINT_FAILED', 'CONTRACT_ERROR', 'TRANSACTION_EXECUTION_ERROR'].includes(d)) seen.add(d)
    } else if (v && typeof v === 'object') for (const k of Object.values(v)) walk(k)
  }
  walk(payload)
  return [...seen]
}

async function probe(label, actions) {
  const body = {
    jsonrpc: '2.0', id: 1, method: 'starknet_call',
    params: { request: { contract_address: POOL, entry_point_selector: hash.getSelectorFromName('compile_actions'), calldata: [f(ADDR), f(PRIV), ...encode(actions)] }, block_id: 'latest' },
  }
  const r = await (await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  if (r.result) { console.log(`\n${label}\n   OK — ${Number(BigInt(r.result[0]))} server actions`); return }
  console.log(`\n${label}\n   ERR reasons: ${JSON.stringify(reasons(r.error))}`)
}

console.log(`sender ${f(ADDR)} (throwaway)`)
await probe('a1  literal [UseNote, CreateEncNote, Withdraw, InvokeExternal] — no setup', [un(0), enc(2n, 1), wd(1n), inv])
await probe('a2  [SVK,OC,OS, UseNote(0), CreateEncNote(2,#1), Withdraw(1), Invoke]', [...SETUP, un(0), enc(2n, 1), wd(1n), inv])
await probe('b4  open-note index GAP (#1,#2,#5)', [...SETUP, dep(3n), enc(2n, 0), open(1), open(2), open(5), wd(1n), inv])
await probe('b8  CreateOpenNote AFTER Withdraw (phase order)', [...SETUP, dep(3n), enc(2n, 0), wd(1n), open(1), inv])
await probe('b9  two open notes on the SAME index (#1,#1)', [...SETUP, dep(3n), enc(2n, 0), open(1), open(1), wd(1n), inv])
await probe('b10 open note on a token with NO subchannel (ETH)', [...SETUP, dep(3n), enc(2n, 0),
  { type: 'CreateOpenNote', recipientAddr: f(ADDR), recipientPublicKey: PUB, token: '0x49d36570d4e46f48e99674bd3fcc84644ddd6b96f7c741b1562b82f9e004dc7', index: 0, random: R() }, wd(1n), inv])
