// CHECK 1 empirical: will the pool's compiler accept an ARBITRARY ERC20 — including an
// address that is not a deployed contract at all — as an open-note token?
// This is the graduation case: our Launch contract names a token that does not exist yet.
import { ec, hash, shortString } from 'starknet'

const POOL = '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a'
const STRK = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d'
const RPC = 'https://starknet-rpc.publicnode.com'
const CA = { SetViewingKey: 0, OpenChannel: 1, OpenSubchannel: 2, CreateEncNote: 3, CreateOpenNote: 4, Deposit: 5, UseNote: 6, Withdraw: 7, InvokeExternal: 8 }
const f = (v) => '0x' + BigInt(v).toString(16)
const TAG = BigInt(shortString.encodeShortString('CHANNEL_KEY_TAG:V1'))
const HALF = 0x0400000000000010ffffffffffffffffb781126dcae7b2321e66a241adc64d2fn / 2n
const rnd = (b = 200) => { let x = 0n; for (const q of crypto.getRandomValues(new Uint8Array(b / 8))) x = (x << 8n) | BigInt(q); return x }
let PRIV = rnd(200); while (!PRIV || PRIV >= HALF) PRIV = rnd(200)
const PUB = BigInt(ec.starkCurve.getStarkKey(f(PRIV)))
const ADDR = rnd(240), TGT = f(rnd(240))
const CK = BigInt(hash.computePoseidonHashOnElements([TAG, ADDR, PRIV, ADDR, PUB].map(f)))

// A token address chosen at random. Nothing is deployed here — it stands in for the ERC20
// our Launch contract would deploy at graduation, which does not exist when the plan is built.
const PHANTOM = f(rnd(240))

function encode(as) {
  const o = [f(as.length)]
  for (const a of as) {
    const k = CA[a.type]
    if (a.type === 'SetViewingKey') o.push(f(k), f(a.random))
    else if (a.type === 'OpenChannel') o.push(f(k), f(a.recipientAddr), f(a.index), f(a.random), f(a.salt))
    else if (a.type === 'OpenSubchannel') o.push(f(k), f(a.recipientAddr), f(a.recipientPublicKey), f(a.channelKey), f(a.index), f(a.token), f(a.salt))
    else if (a.type === 'CreateOpenNote') o.push(f(k), f(a.recipientAddr), f(a.recipientPublicKey), f(a.token), f(a.index), f(a.random))
    else if (a.type === 'Deposit') o.push(f(k), f(a.token), f(a.amount))
    else if (a.type === 'Withdraw') o.push(f(k), f(a.toAddr), f(a.token), f(a.amount), f(a.random))
    else if (a.type === 'InvokeExternal') o.push(f(k), f(a.contractAddress), f(a.calldata.length), ...a.calldata.map(f))
  }
  return o
}
function reasons(p) {
  const s = new Set(); const walk = (v) => {
    if (typeof v === 'string') for (const m of v.match(/0x[0-9a-fA-F]{2,62}/g) ?? []) {
      let h = m.slice(2).replace(/^0+/, ''); if (h.length % 2) h = '0' + h
      const t = Buffer.from(h, 'hex').toString('utf8'); if (/^[\x20-\x7e]{3,31}$/.test(t)) s.add(t)
    } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x)
  }; walk(p); return [...s]
}
async function probe(label, actions) {
  const body = { jsonrpc: '2.0', id: 1, method: 'starknet_call', params: { request: { contract_address: POOL, entry_point_selector: hash.getSelectorFromName('compile_actions'), calldata: [f(ADDR), f(PRIV), ...encode(actions)] }, block_id: 'latest' } }
  const r = await (await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  console.log(`\n${label}`)
  console.log(r.result ? `   OK — ${Number(BigInt(r.result[0]))} server actions` : `   ERR ${JSON.stringify(reasons(r.error))}`)
  return !!r.result
}

const R = () => rnd(120) | 1n, S = () => rnd(120) | 3n
const svk = { type: 'SetViewingKey', random: R() }
const oc = { type: 'OpenChannel', recipientAddr: f(ADDR), index: 0, random: R(), salt: S() }
const sub = (token, index) => ({ type: 'OpenSubchannel', recipientAddr: f(ADDR), recipientPublicKey: PUB, channelKey: CK, index, token, salt: S() })
const open = (token, index) => ({ type: 'CreateOpenNote', recipientAddr: f(ADDR), recipientPublicKey: PUB, token, index, random: R() })
const inv = { type: 'InvokeExternal', contractAddress: TGT, calldata: [1n, 2n, 0n] }

console.log(`sender  ${f(ADDR)} (throwaway)`)
console.log(`PHANTOM token ${PHANTOM}`)
const code = await (await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'starknet_getClassHashAt', params: { block_id: 'latest', contract_address: PHANTOM } }) })).json()
console.log(`  class hash at PHANTOM: ${code.result ?? JSON.stringify(code.error?.message)}  <- nothing is deployed there`)

await probe('A1-1  OpenSubchannel(PHANTOM token) — is the token screened at all?', [svk, oc, sub(PHANTOM, 0)])
await probe('A1-2  + CreateOpenNote(PHANTOM, #0) + Invoke — the full graduation shape',
  [svk, oc, sub(PHANTOM, 0), open(PHANTOM, 0), inv])
await probe('A1-3  THREE open notes on the PHANTOM token',
  [svk, oc, sub(PHANTOM, 0), open(PHANTOM, 0), open(PHANTOM, 1), open(PHANTOM, 2), inv])
await probe('A1-4  TWO tokens at once: STRK subchannel #0 + PHANTOM subchannel #1, open notes on both',
  [svk, oc, sub(STRK, 0), sub(PHANTOM, 1), open(STRK, 0), open(PHANTOM, 0), inv])
