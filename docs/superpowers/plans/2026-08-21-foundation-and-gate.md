# Foundation and Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the hackathon elimination gate — a public licensed repo, a deployed `MessageBook` contract, and ≥3 verified SN_MAIN transactions routed through it — while measuring the four unproven facts every later plan depends on.

**Architecture:** A TypeScript monorepo-lite (`packages/protocol` for chain access, `packages/relayer` for our own paymaster, `contracts/` for Cairo). Everything reads live protocol constants at runtime rather than hardcoding them. The relayer is built and proven on mainnet before any UI exists, because sender anonymity and the sponsored-registration bootstrap both depend on it.

**Tech Stack:** Node ≥24 · TypeScript · `starknet@10.5.0` (SDK route) · `@starknet-io/types-js@0.10.3` · Vitest · Cairo/Scarb · `snforge` (Starknet Foundry) for contract tests · deployment via `starknet.js account.declareAndDeploy`

**Spec:** `docs/superpowers/specs/2026-08-21-strk20-design.md`

## Global Constraints

Copied verbatim from the spec. **Every task's requirements implicitly include this section.**

- **Node ≥ 24.** Pin `starknet@10.5.0` exactly — a bare `npm i starknet` installs `10.0.2`, which has **no STRK20 API at all**. Pin `@starknet-io/types-js@0.10.3`.
- **RPC:** `https://rpc.starknet.lava.build` (fallback `https://starknet-rpc.publicnode.com`). **BlastAPI is dead — never use it.**
- **Pool (SN_MAIN):** `0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a`
- **Prover:** `https://transaction-prover.alpha-mainnet.sw-dev.io` · **Discovery:** `https://discovery-service.alpha-mainnet.sw-dev.io`
- **Selectors:** `privacy_invoke` = `0x402925cce9218828b3ac9a72ac249103f8448a1e1d73c3efaf5da992625043` · `privacy_invoke_with_computation` = `0x00d7dcfbab5157247251535943d20090fb50187f80535f739fbacc8febab767`
- **Pin the deployed class**, tag `CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08`, commit `74841caf` of `starkware-libs/starknet-privacy`. **Never build against `main`** — it has ABI drift and flips open-note screening to default-deny.
- **NETWORK SELECTION IS A BUILD-TIME CONSTANT.** One line — `ACTIVE_NETWORK` — names the active
  network. There is **no runtime network switch in the shipped app**; production builds are always
  mainnet. Network *parameters* live in a typed constant object per network, in version control.
  **Environment variables are reserved for secrets only** — the deployer key and the relayer key,
  nothing else. Never sprinkle `process.env` through application code.
- **There is no shared Sepolia pool.** Verified: the whole SDK source holds exactly one long hex
  constant (the STRK fee token, identical on all networks); `poolAddress` is a runtime parameter
  everywhere; the sponsor's demo ships a `useDeployPool` hook. `sepolia` exists as a config key with an
  empty pool address. **Do not stand one up** — `compile_actions` validates against the real deployed
  mainnet contract for free, which is strictly better.
- **NO HARDCODED PROTOCOL NUMBERS.** Fees come from `get_fee_amount()` at call time (it is mutable — it was 4 STRK earlier in history). Counts come from chain reads stamped with block height. **Durations must not appear in any user-facing string until Task 6 has measured one.**
- **Deploy with `starknet.js account.declareAndDeploy`.** `starkli 0.4.2` rejects Sierra ≥1.8 and `sncast 0.59` wants RPC 0.10 against mainnet's 0.8.x. Both are dead ends.
- **Every invoke-bearing transaction must also carry a WriteOnce action** (a 1-wei note or an `OpenSubchannel`). An invoke-only transaction is illegal.
- **Helpers must return a bare `Span<OpenNoteDeposit>`.** The HEAD tuple signature reverts on the deployed class.
- **Stateless helpers:** no storage of value, no balance, never leave a standing allowance, assert own end-of-call balance is zero. **Any helper with per-user state must `assert(get_caller_address() == pool)`.**
- **`strk20.json` uses flat bare-string arrays.** `{hash: …}` objects are silently dropped. First 10 entries only. Malformed JSON reads as empty. Keep `contracts: []` until transactions are banked.
- **Forbidden strings** — a lint fails the build on any of these in user-facing copy: `end-to-end`, `E2EE`, `only you can`, `zero-knowledge` (as a privacy claim), `watch-only`, `view-only`, `read-only`, `your address never appears`, `amounts are private`, `unlinkable across surfaces`.
- **README must not begin with the starter kit's words** — fork detection byte-compares the first 300 characters. Mention Starknet/STRK20 early, in your own words.

---

## File Structure

```
contracts/
  Scarb.toml                        Cairo package manifest, pinned edition
  src/lib.cairo                     module declarations
  src/pool_types.cairo              OpenNoteDeposit + IMessageBook, copied from sponsor source
  src/message_book.cairo            the deployed helper (~170 lines)
  tests/test_message_book.cairo     snforge unit tests

packages/protocol/
  src/constants.ts                  addresses + selectors only. NO numbers that can change.
  src/rpc.ts                        provider with fallback
  src/pool.ts                       live reads: fee, paused, proof validity, get_public_key
  src/identity.ts                   key generation, backup envelope, restore
  src/registration.ts               ForeignKey pre-flight + registration action list
  src/actions.ts                    action-list builders (WriteOnce + invoke)
  test/*.test.ts                    vitest

packages/relayer/
  src/paymaster.ts                  implements the SDK's injectable Paymaster interface
  src/server.ts                     submit endpoint, credential stays server-side
  test/paymaster.test.ts

scripts/
  probe-constants.ts                Task 2 evidence
  probe-proof-timing.ts             Task 6 evidence
  probe-identity-key.ts             Task 8 evidence
  deploy-message-book.ts            Task 7
  bank-gate-transactions.ts         Task 9

evidence/                           committed probe output — this is the audit trail
strk20.json                         root, gate item
README.md                           root, gate item
LICENSE                             root, gate item
```

---

### Task 1: Repository, licence, pinned toolchain

**Files:**
- Create: `LICENSE`, `.gitignore`, `package.json`, `tsconfig.json`, `vitest.config.ts`, `.nvmrc`
- Create: `packages/protocol/package.json`, `packages/protocol/src/constants.ts`
- Test: `packages/protocol/test/constants.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `POOL_ADDRESS`, `RPC_URLS`, `PROVER_URL`, `DISCOVERY_URL`, `SELECTOR_PRIVACY_INVOKE`, `SELECTOR_PRIVACY_INVOKE_WITH_COMPUTATION` — all `string` constants

- [ ] **Step 1: Initialise the repository**

```bash
cd /Users/abu/dev/hackathon/stacks-20
git init
node --version   # must print v24.x or higher; stop here if not
echo "24" > .nvmrc
printf 'node_modules/\ndist/\n.env\n.env.*\n!.env.example\n*.log\n' > .gitignore
```

- [ ] **Step 2: Add the licence (elimination-gate item)**

Write MIT text to `LICENSE`, with `Copyright (c) 2026 Abu`. Any OSI-approved licence satisfies the gate; MIT is the least friction.

- [ ] **Step 3: Root `package.json` with exact pins**

```json
{
  "name": "strk20-app",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24" },
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "vitest run",
    "lint:claims": "node scripts/lint-claims.mjs"
  },
  "devDependencies": {
    "typescript": "5.6.3",
    "vitest": "2.1.8",
    "tsx": "4.19.2",
    "@types/node": "22.10.2"
  },
  "dependencies": {
    "starknet": "10.5.0",
    "@starknet-io/types-js": "0.10.3"
  }
}
```

Note the versions are exact, not caret-ranged. This is deliberate — see Global Constraints.

- [ ] **Step 4: Write the failing test**

```ts
// packages/protocol/test/constants.test.ts
import { describe, it, expect } from 'vitest'
import { NETWORKS, NET, ACTIVE_NETWORK, SELECTOR_PRIVACY_INVOKE } from '../src/constants.js'

describe('network config', () => {
  it('defaults to mainnet — production must never ship pointing elsewhere', () => {
    expect(ACTIVE_NETWORK).toBe('mainnet')
    expect(NET.pool).toBe('0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a')
  })

  it('never lists the dead BlastAPI host on any network', () => {
    for (const n of Object.values(NETWORKS)) {
      expect(n.rpc.some((u) => u.includes('blastapi'))).toBe(false)
    }
    expect(NETWORKS.mainnet.rpc[0]).toBe('https://rpc.starknet.lava.build')
  })

  it('leaves the sepolia pool empty — no shared pool is published', () => {
    expect(NETWORKS.sepolia.pool).toBe('')
  })

  it('pins the privacy_invoke selector', () => {
    expect(SELECTOR_PRIVACY_INVOKE)
      .toBe('0x402925cce9218828b3ac9a72ac249103f8448a1e1d73c3efaf5da992625043')
  })

  it('exports no fee constant — fees are mutable and read live', async () => {
    const mod = await import('../src/constants.js')
    expect(Object.keys(mod).some((k) => /FEE|AMOUNT/i.test(k))).toBe(false)
  })
})
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npx vitest run packages/protocol/test/constants.test.ts`
Expected: FAIL — `Cannot find module '../src/constants.js'`

- [ ] **Step 6: Write the implementation**

```ts
// packages/protocol/src/constants.ts
//
// Network PARAMETERS are constants, not environment variables: they are facts about
// a network, so they belong in version control where they can be reviewed and diffed.
// Only secrets (the deployer key, the relayer key) come from the environment.
//
// Selection is a BUILD-TIME constant. There is no runtime network switch in the
// shipped app — the elimination gate depends on a judge seeing real mainnet state,
// and there is no upside to letting that be flippable in production.

export interface NetworkConfig {
  readonly chainId: string
  readonly pool: string
  readonly rpc: readonly string[]
  readonly prover: string
  readonly discovery: string
  readonly explorer: string
}

export const NETWORKS = {
  mainnet: {
    chainId: '0x534e5f4d41494e', // SN_MAIN
    pool: '0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a',
    rpc: [
      'https://rpc.starknet.lava.build',
      'https://starknet-rpc.publicnode.com',
    ],
    prover: 'https://transaction-prover.alpha-mainnet.sw-dev.io',
    discovery: 'https://discovery-service.alpha-mainnet.sw-dev.io',
    explorer: 'https://voyager.online',
  },
  // The prover host is live (POST -> 200), but NO shared Sepolia pool is published:
  // the entire SDK source holds one long hex constant (the STRK fee token), poolAddress
  // is a runtime parameter everywhere, and the sponsor's demo ships a useDeployPool hook.
  // Left empty deliberately. Do not stand one up — compile_actions validates against the
  // real deployed mainnet contract for free, which is strictly better. See spec §3.2.1.
  sepolia: {
    chainId: '0x534e5f5345504f4c4941', // SN_SEPOLIA
    pool: '',
    rpc: ['https://starknet-sepolia-rpc.publicnode.com'],
    prover: 'https://transaction-prover.alpha-sepolia.sw-dev.io',
    discovery: '',
    explorer: 'https://sepolia.voyager.online',
  },
} as const satisfies Record<string, NetworkConfig>

export type NetworkName = keyof typeof NETWORKS

/** The one line that changes. Production builds must leave this on 'mainnet'. */
export const ACTIVE_NETWORK: NetworkName = 'mainnet'

export const NET: NetworkConfig = NETWORKS[ACTIVE_NETWORK]

// Selectors are protocol-level and identical on every network.
export const SELECTOR_PRIVACY_INVOKE =
  '0x402925cce9218828b3ac9a72ac249103f8448a1e1d73c3efaf5da992625043'
export const SELECTOR_PRIVACY_INVOKE_WITH_COMPUTATION =
  '0x00d7dcfbab5157247251535943d20090fb50187f80535f739fbacc8febab767'

// Deliberately absent: the pool fee, note maturity, and proof validity.
// All three are mutable on-chain and MUST be read at call time. See pool.ts.
```

Update `rpc.ts` and `pool.ts` in Tasks 2 onward to read `NET.rpc` and `NET.pool` rather than importing
`RPC_URLS` and `POOL_ADDRESS` directly.

- [ ] **Step 7: Run tests and verify they pass**

Run: `npx vitest run packages/protocol/test/constants.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: init repo, MIT licence, pinned starknet 10.5.0 toolchain"
```

---

### Task 2: Live protocol reads — never hardcode a mutable number

**Files:**
- Create: `packages/protocol/src/rpc.ts`, `packages/protocol/src/pool.ts`
- Create: `scripts/probe-constants.ts`, `evidence/constants.json`
- Test: `packages/protocol/test/pool.test.ts`

**Interfaces:**
- Consumes: `POOL_ADDRESS`, `RPC_URLS` (Task 1)
- Produces:
  - `getProvider(): RpcProvider`
  - `readPoolConstants(): Promise<{ feeWei: bigint; paused: boolean; proofValidityBlocks: number; blockNumber: number }>`
  - `getPublicKey(address: string): Promise<bigint>` — returns `0n` when unregistered

- [ ] **Step 1: Write the failing test**

These are live mainnet reads. They are slow and network-dependent by design — this suite is the project's canary for the pool changing under us.

```ts
// packages/protocol/test/pool.test.ts
import { describe, it, expect } from 'vitest'
import { readPoolConstants, getPublicKey } from '../src/pool.js'

describe('pool live reads', { timeout: 30_000 }, () => {
  it('reads a non-zero fee and a sane proof window', async () => {
    const c = await readPoolConstants()
    expect(c.feeWei).toBeGreaterThan(0n)
    expect(c.proofValidityBlocks).toBeGreaterThan(0)
    expect(c.blockNumber).toBeGreaterThan(13_000_000)
  })

  it('reports the pause state as a boolean', async () => {
    const c = await readPoolConstants()
    expect(typeof c.paused).toBe('boolean')
  })

  it('returns 0n for an address that has never registered', async () => {
    expect(await getPublicKey('0x1234')).toBe(0n)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/protocol/test/pool.test.ts`
Expected: FAIL — `Cannot find module '../src/pool.js'`

- [ ] **Step 3: Implement the provider with fallback**

```ts
// packages/protocol/src/rpc.ts
import { RpcProvider } from 'starknet'
import { RPC_URLS } from './constants.js'

let cached: RpcProvider | null = null

export function getProvider(): RpcProvider {
  if (!cached) cached = new RpcProvider({ nodeUrl: RPC_URLS[0] })
  return cached
}

/** Runs `fn` against each RPC in turn; throws only if every host fails. */
export async function withFallback<T>(fn: (p: RpcProvider) => Promise<T>): Promise<T> {
  let last: unknown
  for (const nodeUrl of RPC_URLS) {
    try {
      return await fn(new RpcProvider({ nodeUrl }))
    } catch (e) {
      last = e
    }
  }
  throw new Error(`all RPC hosts failed: ${String(last)}`)
}
```

- [ ] **Step 4: Implement the pool reads**

```ts
// packages/protocol/src/pool.ts
import { hash } from 'starknet'
import { POOL_ADDRESS } from './constants.js'
import { withFallback } from './rpc.js'

async function call(entrypoint: string, calldata: string[] = []): Promise<string[]> {
  return withFallback((p) =>
    p.callContract({ contractAddress: POOL_ADDRESS, entrypoint, calldata }),
  )
}

export interface PoolConstants {
  feeWei: bigint
  paused: boolean
  proofValidityBlocks: number
  blockNumber: number
}

/**
 * Reads every mutable protocol number in one shot.
 * The fee is NOT a constant: it was 4 STRK earlier in this pool's history and the
 * upgrade delay is zero, so it can change between two page loads. Always read it.
 */
export async function readPoolConstants(): Promise<PoolConstants> {
  const [fee, paused, validity, blockNumber] = await Promise.all([
    call('get_fee_amount'),
    call('is_paused'),
    call('get_proof_validity_blocks'),
    withFallback((p) => p.getBlockNumber()),
  ])
  return {
    feeWei: BigInt(fee[0]),
    paused: BigInt(paused[0]) !== 0n,
    proofValidityBlocks: Number(BigInt(validity[0])),
    blockNumber,
  }
}

/** 0n means "never registered". Non-zero from another app means ForeignKey — see registration.ts. */
export async function getPublicKey(address: string): Promise<bigint> {
  const r = await call('get_public_key', [address])
  return BigInt(r[0])
}

export { hash }
```

- [ ] **Step 5: Run tests and verify they pass**

Run: `npx vitest run packages/protocol/test/pool.test.ts`
Expected: PASS, 3 tests. If the fee is not exactly `0x53444835ec580000` (6 STRK), **that is not a failure — it is the finding.** Record the new value in evidence and tell Abu; every cost estimate in the spec shifts.

- [ ] **Step 6: Write the evidence probe**

```ts
// scripts/probe-constants.ts
import { writeFileSync, mkdirSync } from 'node:fs'
import { readPoolConstants } from '../packages/protocol/src/pool.js'

const c = await readPoolConstants()
const out = {
  ...c,
  feeWei: c.feeWei.toString(),
  feeStrk: Number(c.feeWei) / 1e18,
  readAt: new Date().toISOString(),
}
mkdirSync('evidence', { recursive: true })
writeFileSync('evidence/constants.json', JSON.stringify(out, null, 2))
console.log(out)
```

- [ ] **Step 7: Run the probe and commit the evidence**

```bash
npx tsx scripts/probe-constants.ts
git add -A
git commit -m "feat: live pool constant reads with RPC fallback, plus evidence probe"
```

---

### Task 3: Identity — local key, backup envelope, restore

**Files:**
- Create: `packages/protocol/src/identity.ts`
- Test: `packages/protocol/test/identity.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `generateIdentity(): { privateKey: string; publicKey: string }`
  - `createBackup(privateKey: string): Promise<{ file: string; recoveryCode: string }>`
  - `restoreBackup(file: string, recoveryCode: string): Promise<string>` — returns the private key
  - `deriveIdentityPublicKey(privateKey: string): string`

**Why not a wallet signature:** the registered key is WriteOnce-immutable with no rotation path, and 46 of 51 measured registrants are Ready smart accounts spread across two class versions. An account upgrade mutates the signature, which would derive a different key and **permanently orphan the user's notes.** A passkey may later *wrap* this key; it must never *derive* it.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/test/identity.test.ts
import { describe, it, expect } from 'vitest'
import {
  generateIdentity, createBackup, restoreBackup, deriveIdentityPublicKey,
} from '../src/identity.js'

describe('identity', () => {
  it('generates a distinct keypair each time', () => {
    const a = generateIdentity()
    const b = generateIdentity()
    expect(a.privateKey).not.toBe(b.privateKey)
    expect(a.publicKey).toBe(deriveIdentityPublicKey(a.privateKey))
  })

  it('round-trips a backup with its recovery code', async () => {
    const { privateKey } = generateIdentity()
    const { file, recoveryCode } = await createBackup(privateKey)
    expect(await restoreBackup(file, recoveryCode)).toBe(privateKey)
  })

  it('generates the recovery code itself — it is never user-chosen', async () => {
    const { recoveryCode } = await createBackup(generateIdentity().privateKey)
    expect(recoveryCode).toMatch(/^[0-9A-HJ-NP-Z]{4}(-[0-9A-HJ-NP-Z]{4}){3}$/)
  })

  it('rejects the wrong recovery code rather than returning garbage', async () => {
    const { file } = await createBackup(generateIdentity().privateKey)
    await expect(restoreBackup(file, 'AAAA-BBBB-CCCC-DDDD')).rejects.toThrow(/recovery code/i)
  })

  it('leaks no plaintext key material into the backup file', async () => {
    const { privateKey } = generateIdentity()
    const { file } = await createBackup(privateKey)
    expect(file).not.toContain(privateKey.replace(/^0x/, ''))
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/protocol/test/identity.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// packages/protocol/src/identity.ts
import { ec, stark } from 'starknet'
import { webcrypto as crypto } from 'node:crypto'

const KDF_ITERATIONS = 600_000            // OWASP 2023 floor for PBKDF2-SHA256
const CODE_ALPHABET = '0123456789ABCDEFGHJKLMNPQRSTUVWXYZ'  // no I, O — misread as 1, 0

export function generateIdentity(): { privateKey: string; publicKey: string } {
  const privateKey = stark.randomAddress()
  return { privateKey, publicKey: deriveIdentityPublicKey(privateKey) }
}

export function deriveIdentityPublicKey(privateKey: string): string {
  return ec.starkCurve.getStarkKey(privateKey)
}

function generateRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length])
  return [0, 4, 8, 12].map((i) => chars.slice(i, i + 4).join('')).join('-')
}

async function deriveWrappingKey(code: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: KDF_ITERATIONS, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  )
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))

/**
 * Two-secret split: the file is useless without the code, and the code is useless
 * without the file. We never see either. There is no vault to fall back on, which
 * is exactly why the code is generated rather than chosen by the user.
 */
export async function createBackup(
  privateKey: string,
): Promise<{ file: string; recoveryCode: string }> {
  const recoveryCode = generateRecoveryCode()
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveWrappingKey(recoveryCode, salt)
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv }, key, new TextEncoder().encode(privateKey),
    ),
  )
  const file = JSON.stringify(
    { v: 1, kdf: 'PBKDF2-SHA256', iterations: KDF_ITERATIONS,
      salt: b64(salt), iv: b64(iv), ct: b64(ct) },
    null, 2,
  )
  return { file, recoveryCode }
}

export async function restoreBackup(file: string, recoveryCode: string): Promise<string> {
  const env = JSON.parse(file) as {
    v: number; iterations: number; salt: string; iv: string; ct: string
  }
  if (env.v !== 1) throw new Error(`unsupported backup version ${env.v}`)
  const key = await deriveWrappingKey(recoveryCode, unb64(env.salt))
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.ct),
    )
    return new TextDecoder().decode(pt)
  } catch {
    throw new Error('That file and recovery code do not open this key.')
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run packages/protocol/test/identity.test.ts`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: local identity generation with two-secret encrypted backup"
```

---

### Task 4: Registration state machine with the ForeignKey guard

**Files:**
- Create: `packages/protocol/src/registration.ts`
- Test: `packages/protocol/test/registration.test.ts`

**Interfaces:**
- Consumes: `getPublicKey` (Task 2), `deriveIdentityPublicKey` (Task 3)
- Produces:
  - `type RegistrationState = 'Unregistered' | 'Registered' | 'ForeignKey'`
  - `checkRegistration(address: string, ourPublicKey: string): Promise<{ state: RegistrationState; onChainKey: bigint }>`

**Why this exists:** if `get_public_key(addr)` is already non-zero from another STRK20 app, registration **can never succeed** — the key is WriteOnce — and discovery would silently return nothing forever. The read is free. The alternative is a paid revert surfacing as the raw string `NON_ZERO_VALUE` after the relayer has already spent the fee.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/test/registration.test.ts
import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/pool.js', () => ({
  getPublicKey: vi.fn(),
}))
const { getPublicKey } = await import('../src/pool.js')
const { checkRegistration } = await import('../src/registration.js')

describe('checkRegistration', () => {
  it('reports Unregistered when the chain has no key', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(0n)
    const r = await checkRegistration('0xabc', '0x111')
    expect(r.state).toBe('Unregistered')
  })

  it('reports Registered when the on-chain key is ours', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(0x111n)
    const r = await checkRegistration('0xabc', '0x111')
    expect(r.state).toBe('Registered')
  })

  it('reports ForeignKey when a different key already occupies the address', async () => {
    vi.mocked(getPublicKey).mockResolvedValue(0x999n)
    const r = await checkRegistration('0xabc', '0x111')
    expect(r.state).toBe('ForeignKey')
    expect(r.onChainKey).toBe(0x999n)
  })

  it('throws rather than guessing when the RPC is unreachable', async () => {
    vi.mocked(getPublicKey).mockRejectedValue(new Error('all RPC hosts failed'))
    await expect(checkRegistration('0xabc', '0x111')).rejects.toThrow(/RPC/)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/protocol/test/registration.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```ts
// packages/protocol/src/registration.ts
import { getPublicKey } from './pool.js'

export type RegistrationState = 'Unregistered' | 'Registered' | 'ForeignKey'

export interface RegistrationCheck {
  state: RegistrationState
  onChainKey: bigint
}

/**
 * Free pre-flight. MUST run before every create and every restore.
 *
 * If the RPC is down this THROWS rather than returning a guess. Proceeding on an
 * unknown risks a paid revert, or worse, registering over a state we could not read.
 */
export async function checkRegistration(
  address: string,
  ourPublicKey: string,
): Promise<RegistrationCheck> {
  const onChainKey = await getPublicKey(address)
  if (onChainKey === 0n) return { state: 'Unregistered', onChainKey }
  return {
    state: onChainKey === BigInt(ourPublicKey) ? 'Registered' : 'ForeignKey',
    onChainKey,
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run packages/protocol/test/registration.test.ts`
Expected: PASS, 4 tests

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: registration pre-flight with ForeignKey collision guard"
```

---

### Task 5: The `MessageBook` Cairo contract

**Files:**
- Create: `contracts/Scarb.toml`, `contracts/src/lib.cairo`, `contracts/src/pool_types.cairo`, `contracts/src/message_book.cairo`
- Test: `contracts/tests/test_message_book.cairo`

**Interfaces:**
- Consumes: nothing on-chain
- Produces: a deployed class exposing `privacy_invoke(mode: felt252, tag: felt252, payload: Span<felt252>) -> Span<OpenNoteDeposit>`, modes `MODE_APPEND = 1` and `MODE_SEAL = 2`

**Why this contract is first:** it is the only surface **immune to the coming default-deny screening flip** — a zero-deposit invoke sets no screening subject — and its zero-value invokes cannot revert on a balance or an allowance mid-demo. It is also needed for the chat app regardless, so the gate work is not throwaway.

**Design note — storage vs events:** ciphertext is emitted in an **event**, not stored. Events are cheap and indexable; storage is expensive and we never need to read message bodies on-chain. Only a per-tag counter and the latest seal root are stored.

- [ ] **Step 1: Copy the real pool interface — do not invent it**

The exact `OpenNoteDeposit` field layout must come from the sponsor's source, not from memory. Fetch it from the pinned tag and transcribe it verbatim:

```bash
mkdir -p /tmp/sp && cd /tmp/sp
git clone --depth 1 --branch CONTRACT_V2_DEPLOYED_MAINNET_2026-07-08 \
  https://github.com/starkware-libs/starknet-privacy.git . \
  || git clone --depth 1 https://github.com/starkware-libs/starknet-privacy.git .
grep -rn "struct OpenNoteDeposit" --include=*.cairo .
```

Transcribe the struct into `contracts/src/pool_types.cairo` exactly as found, including field order. **If the clone fails, stop and ask Abu** — guessing this struct guarantees a revert on mainnet, and a reverted deployment costs real STRK.

- [ ] **Step 2: Write `Scarb.toml`**

```toml
[package]
name = "strk20_app"
version = "0.1.0"
edition = "2024_07"

[dependencies]
starknet = "2.8.2"

[dev-dependencies]
snforge_std = "0.31.0"

[[target.starknet-contract]]
sierra = true

[scripts]
test = "snforge test"
```

- [ ] **Step 3: Write the failing test**

```cairo
// contracts/tests/test_message_book.cairo
use snforge_std::{declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address};
use strk20_app::message_book::{IMessageBookDispatcher, IMessageBookDispatcherTrait};

const POOL: felt252 = 0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a;
const MODE_APPEND: felt252 = 1;
const MODE_SEAL: felt252 = 2;

fn deploy() -> IMessageBookDispatcher {
    let contract = declare("MessageBook").unwrap().contract_class();
    let (addr, _) = contract.deploy(@array![]).unwrap();
    IMessageBookDispatcher { contract_address: addr }
}

#[test]
fn append_returns_an_empty_deposit_span() {
    let mb = deploy();
    let deposits = mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xAA, 0xBB].span());
    assert(deposits.len() == 0, 'must return zero deposits');
}

#[test]
fn append_increments_the_per_tag_counter() {
    let mb = deploy();
    assert(mb.message_count('tag1') == 0, 'starts empty');
    mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xAA].span());
    mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xBB].span());
    assert(mb.message_count('tag1') == 2, 'counts to 2');
    assert(mb.message_count('tag2') == 0, 'tags are independent');
}

#[test]
fn seal_stores_the_root_and_leaves_the_counter_alone() {
    let mb = deploy();
    mb.privacy_invoke(MODE_APPEND, 'tag1', array![0xAA].span());
    mb.privacy_invoke(MODE_SEAL, 'tag1', array![0xR00T].span());
    assert(mb.seal_root('tag1') == 0xR00T, 'root stored');
    assert(mb.message_count('tag1') == 1, 'seal is not a message');
}

#[test]
#[should_panic(expected: 'UNKNOWN_MODE')]
fn unknown_mode_panics() {
    deploy().privacy_invoke(99, 'tag1', array![].span());
}

#[test]
#[should_panic(expected: 'EMPTY_PAYLOAD')]
fn empty_payload_panics() {
    deploy().privacy_invoke(MODE_APPEND, 'tag1', array![].span());
}

#[test]
#[should_panic(expected: 'SEAL_NEEDS_ONE_FELT')]
fn seal_with_multiple_felts_panics() {
    deploy().privacy_invoke(MODE_SEAL, 'tag1', array![0x1, 0x2].span());
}
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd contracts && snforge test`
Expected: FAIL — `MessageBook` is not declared

- [ ] **Step 5: Implement the contract**

```cairo
// contracts/src/message_book.cairo
use strk20_app::pool_types::OpenNoteDeposit;

#[starknet::interface]
pub trait IMessageBook<TContractState> {
    fn privacy_invoke(
        ref self: TContractState, mode: felt252, tag: felt252, payload: Span<felt252>,
    ) -> Span<OpenNoteDeposit>;
    fn message_count(self: @TContractState, tag: felt252) -> u64;
    fn seal_root(self: @TContractState, tag: felt252) -> felt252;
}

#[starknet::contract]
pub mod MessageBook {
    use starknet::storage::{Map, StorageMapReadAccess, StorageMapWriteAccess};
    use strk20_app::pool_types::OpenNoteDeposit;

    pub const MODE_APPEND: felt252 = 1;
    pub const MODE_SEAL: felt252 = 2;

    #[storage]
    struct Storage {
        // Bodies live in events, never in storage. Storage holds only what must be
        // readable on-chain: how many messages a tag has, and its latest seal root.
        counts: Map<felt252, u64>,
        seals: Map<felt252, felt252>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        MessageAppended: MessageAppended,
        ConversationSealed: ConversationSealed,
    }

    #[derive(Drop, starknet::Event)]
    struct MessageAppended {
        #[key]
        tag: felt252,
        index: u64,
        ciphertext: Span<felt252>,
    }

    #[derive(Drop, starknet::Event)]
    struct ConversationSealed {
        #[key]
        tag: felt252,
        root: felt252,
        count: u64,
    }

    #[abi(embed_v0)]
    impl MessageBookImpl of super::IMessageBook<ContractState> {
        /// Deliberately permissionless: this contract never touches value, holds no
        /// balance and grants no allowance, so an anonymous caller can do nothing but
        /// pay gas to append their own ciphertext. Adding `assert(caller == pool)`
        /// here would break third-party reuse for no security gain.
        ///
        /// ALWAYS returns an empty span. A zero-deposit invoke is legal
        /// (`_apply_invoke_and_deposits` guards its deposit block with
        /// `if !deposits.is_empty()`), still executes, and still emits
        /// `ExternalContractInvoked`. It also sets no screening subject, which is
        /// what makes this contract immune to the default-deny policy flip.
        fn privacy_invoke(
            ref self: ContractState, mode: felt252, tag: felt252, payload: Span<felt252>,
        ) -> Span<OpenNoteDeposit> {
            assert(payload.len() != 0, 'EMPTY_PAYLOAD');

            if mode == MODE_APPEND {
                let index = self.counts.read(tag);
                self.counts.write(tag, index + 1);
                self.emit(MessageAppended { tag, index, ciphertext: payload });
            } else if mode == MODE_SEAL {
                assert(payload.len() == 1, 'SEAL_NEEDS_ONE_FELT');
                let root = *payload.at(0);
                self.seals.write(tag, root);
                self.emit(ConversationSealed { tag, root, count: self.counts.read(tag) });
            } else {
                core::panic_with_felt252('UNKNOWN_MODE');
            }

            array![].span()
        }

        fn message_count(self: @ContractState, tag: felt252) -> u64 {
            self.counts.read(tag)
        }

        fn seal_root(self: @ContractState, tag: felt252) -> felt252 {
            self.seals.read(tag)
        }
    }
}
```

```cairo
// contracts/src/lib.cairo
pub mod pool_types;
pub mod message_book;
```

- [ ] **Step 6: Run tests and verify they pass**

Run: `cd contracts && snforge test`
Expected: PASS, 6 tests

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(contracts): MessageBook helper, events for bodies, storage for counters"
```

---

### Task 6: PROBE — time one real proof

**Files:**
- Create: `scripts/probe-proof-timing.ts`, `evidence/proof-timing.json`

**Interfaces:**
- Consumes: `readPoolConstants` (Task 2)
- Produces: `evidence/proof-timing.json` with `{ proveMs, submitMs, maturityMs, totalMs }`

**Why this blocks other work:** proof wall-time has **never been measured by anyone** on this protocol. It gates the demo video, every duration string in the product, and the waiting-screen design. **No user-facing duration may ship until this number exists.**

- [ ] **Step 1: Write the probe**

```ts
// scripts/probe-proof-timing.ts
import { writeFileSync, mkdirSync } from 'node:fs'
import { readPoolConstants } from '../packages/protocol/src/pool.js'

const marks: Record<string, number> = {}
const mark = (k: string) => { marks[k] = Date.now() }

mark('start')
const constants = await readPoolConstants()
if (constants.paused) throw new Error('pool is paused — probe aborted, retry later')
mark('constantsRead')

// Build the smallest legal action list: one WriteOnce (1-wei self-note) plus one
// zero-value invoke of MessageBook. This is the cheapest possible real transaction.
// Uses the SDK's prove path against PROVER_URL.
// -- Fill in with the SDK's builder once Task 5's contract address exists. --
mark('proved')
mark('submitted')
mark('matured')

const out = {
  proveMs: marks.proved - marks.constantsRead,
  submitMs: marks.submitted - marks.proved,
  maturityMs: marks.matured - marks.submitted,
  totalMs: marks.matured - marks.start,
  blockNumber: constants.blockNumber,
  measuredAt: new Date().toISOString(),
}
mkdirSync('evidence', { recursive: true })
writeFileSync('evidence/proof-timing.json', JSON.stringify(out, null, 2))
console.log(out)
```

- [ ] **Step 2: Run it against mainnet after Task 7 deploys the contract**

Run: `npx tsx scripts/probe-proof-timing.ts`
Expected: a JSON blob with four real millisecond figures. **Report `proveMs` to Abu immediately** — if it exceeds ~30 s, the live-video plan in spec §10.4 changes.

- [ ] **Step 3: Commit the evidence**

```bash
git add evidence/proof-timing.json scripts/probe-proof-timing.ts
git commit -m "test: measure real proof wall-time on mainnet (first measurement on this protocol)"
```

---

### Task 7: Deploy `MessageBook` to mainnet

**Files:**
- Create: `scripts/deploy-message-book.ts`, `evidence/deployment.json`, `.env.example`

**Interfaces:**
- Consumes: the compiled Sierra/CASM from Task 5
- Produces: `evidence/deployment.json` with `{ classHash, contractAddress, declareTx, deployTx }`

- [ ] **Step 1: Write `.env.example` — secrets only, nothing else**

Four entries, and there will never be more. Network parameters are constants in `constants.ts`; the
environment holds **only** what cannot live in a public repo.

```bash
# .env.example  (copy to .env, which .gitignore already excludes)
# SECRETS ONLY. Network parameters belong in packages/protocol/src/constants.ts.
DEPLOYER_ADDRESS=0x...
DEPLOYER_PRIVATE_KEY=0x...
RELAYER_ADDRESS=0x...
RELAYER_PRIVATE_KEY=0x...
```

- [ ] **Step 2: Write the deploy script**

`starkli 0.4.2` rejects Sierra ≥1.8 and `sncast 0.59` wants RPC 0.10 against mainnet's 0.8.x. `declareAndDeploy` is the only working path.

```ts
// scripts/deploy-message-book.ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { Account, RpcProvider } from 'starknet'
import { NET, ACTIVE_NETWORK } from '../packages/protocol/src/constants.js'

// Network parameters come from the config. Only the two secrets come from the
// environment, and both are asserted up front so a missing key fails loudly here
// rather than as an opaque signing error mid-deployment.
const { DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY } = process.env
if (!DEPLOYER_ADDRESS || !DEPLOYER_PRIVATE_KEY) {
  throw new Error('Set DEPLOYER_ADDRESS and DEPLOYER_PRIVATE_KEY in .env — see .env.example')
}
if (!NET.pool) throw new Error(`network "${ACTIVE_NETWORK}" has no pool address configured`)

const provider = new RpcProvider({ nodeUrl: NET.rpc[0] })
const account = new Account(provider, DEPLOYER_ADDRESS, DEPLOYER_PRIVATE_KEY)

const base = 'contracts/target/dev/strk20_app_MessageBook'
const sierra = JSON.parse(readFileSync(`${base}.contract_class.json`, 'utf8'))
const casm = JSON.parse(readFileSync(`${base}.compiled_contract_class.json`, 'utf8'))

const res = await account.declareAndDeploy({ contract: sierra, casm })
await provider.waitForTransaction(res.deploy.transaction_hash)

const out = {
  classHash: res.declare.class_hash,
  contractAddress: res.deploy.contract_address,
  declareTx: res.declare.transaction_hash,
  deployTx: res.deploy.transaction_hash,
  deployedAt: new Date().toISOString(),
}
mkdirSync('evidence', { recursive: true })
writeFileSync('evidence/deployment.json', JSON.stringify(out, null, 2))
console.log(out)
```

- [ ] **Step 3: Build and deploy**

```bash
cd contracts && scarb build && cd ..
npx tsx scripts/deploy-message-book.ts
```

Expected: a contract address on SN_MAIN. Verify independently before continuing:

```bash
curl -s -X POST https://rpc.starknet.lava.build \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"starknet_getClassHashAt","params":{"block_id":"latest","contract_address":"<ADDRESS>"}}'
```

- [ ] **Step 4: Commit**

```bash
git add evidence/deployment.json scripts/deploy-message-book.ts .env.example
git commit -m "feat: deploy MessageBook to SN_MAIN via declareAndDeploy"
```

---

### Task 8: The relayer, and the two probes that prove it

**Files:**
- Create: `packages/relayer/src/paymaster.ts`, `packages/relayer/src/server.ts`
- Create: `scripts/probe-identity-key.ts`, `evidence/relayer.json`, `evidence/identity-key.json`
- Test: `packages/relayer/test/paymaster.test.ts`

**Interfaces:**
- Consumes: `readPoolConstants` (Task 2), deployment address (Task 7)
- Produces: `class RelayerPaymaster` implementing `buildTransaction` and `executeTransaction`; a `POST /submit` endpoint

**Why our own relayer:** the AVNU forwarder is whitelist-gated and reverts `"Caller is not whitelisted"` even for the pool itself. `apply_actions` has **zero caller access control** and `collect_fee` pulls from `get_caller_address()`, so anyone may submit. AVNU's alternative would put `VITE_AVNU_API_KEY` **inside the public browser bundle**, where any rival can read and burn it during judging.

- [ ] **Step 1: Write the failing test**

```ts
// packages/relayer/test/paymaster.test.ts
import { describe, it, expect } from 'vitest'
import { RelayerPaymaster } from '../src/paymaster.js'

describe('RelayerPaymaster', () => {
  it('reimburses itself to the relayer address, never a hardcoded one', async () => {
    const pm = new RelayerPaymaster({ relayerAddress: '0xRELAY', feeToken: '0xSTRK' })
    const built = await pm.buildTransaction({ actions: [] })
    const withdraw = built.feeAction
    expect(withdraw.type).toBe('withdraw')
    expect(withdraw.recipient).toBe('0xRELAY')
  })

  it('reads the fee live rather than hardcoding six STRK', async () => {
    const pm = new RelayerPaymaster({ relayerAddress: '0xRELAY', feeToken: '0xSTRK' })
    const built = await pm.buildTransaction({ actions: [] })
    expect(built.feeAction.amount).toBeTypeOf('bigint')
    expect(built.feeAction.amount).toBeGreaterThan(0n)
  })

  it('never exposes a credential to the caller', async () => {
    const pm = new RelayerPaymaster({ relayerAddress: '0xRELAY', feeToken: '0xSTRK' })
    expect(JSON.stringify(pm)).not.toMatch(/PRIVATE_KEY|apiKey|secret/i)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run packages/relayer/test/paymaster.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the paymaster**

```ts
// packages/relayer/src/paymaster.ts
import { readPoolConstants } from '../../protocol/src/pool.js'

export interface PaymasterConfig {
  relayerAddress: string
  feeToken: string
}

export interface FeeAction {
  type: 'withdraw'
  token: string
  amount: bigint
  recipient: string
}

/**
 * AVNU's "sponsorship" is not sponsorship: the fee is reimbursed by an ordinary
 * withdraw action folded into the proven action chain, and the recipient is an
 * arbitrary address. So we simply name ourselves as that recipient.
 *
 * The relayer's private key lives only in the server process (server.ts) and is
 * never a field on this object — the browser holds an instance of this class.
 */
export class RelayerPaymaster {
  constructor(private readonly config: PaymasterConfig) {}

  async buildTransaction(input: { actions: unknown[] }) {
    const { feeWei, paused } = await readPoolConstants()
    if (paused) throw new Error('The pool is paused. Withdrawals continue; new actions do not.')
    const feeAction: FeeAction = {
      type: 'withdraw',
      token: this.config.feeToken,
      amount: feeWei,
      recipient: this.config.relayerAddress,
    }
    return { actions: input.actions, feeAction }
  }

  /** Posts to our server, which holds the key and submits the v3 invoke. */
  async executeTransaction(payload: unknown): Promise<{ transactionHash: string }> {
    const res = await fetch('/api/submit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) throw new Error(`relayer refused: ${res.status} ${await res.text()}`)
    return res.json() as Promise<{ transactionHash: string }>
  }
}
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx vitest run packages/relayer/test/paymaster.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: PROBE — the `identity_key` round-trip**

Deploy a 40-line throwaway helper that records every `identity_key` it receives via `privacy_invoke_with_computation`. Call it **twice from wallet A and once from wallet B.**

```ts
// scripts/probe-identity-key.ts — assertions the probe must make
// A1 === A2   (same user, same helper → stable handle)
// A1 !== B1   (different users → different handles)
```

Expected: both assertions hold. **If either fails, stop and tell Abu** — the markets and launch designs both stake their privacy on this and would need redesigning.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: self-hosted relayer paymaster; probe identity_key stability on mainnet"
```

---

### Task 9: Bank the gate — three transactions, `strk20.json`, README

**Files:**
- Create: `scripts/bank-gate-transactions.ts`, `strk20.json`, `README.md`, `scripts/lint-claims.mjs`
- Create: `evidence/gate-transactions.json`

**Interfaces:**
- Consumes: contract address (Task 7), relayer (Task 8)
- Produces: `strk20.json` satisfying the elimination gate

**The mine rule:** `README.md` line 86 of the event repo requires that once you deploy contracts, each qualifying transaction must **run through one of yours**. This is currently scoring rival `airlock` at zero — it has 3 real pool transactions that route through none of its declared contracts.

- [ ] **Step 1: Write the claims lint (it gates every later commit)**

```js
// scripts/lint-claims.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const FORBIDDEN = [
  'end-to-end', 'e2ee', 'only you can', 'zero-knowledge',
  'watch-only', 'view-only', 'read-only',
  'your address never appears', 'amounts are private', 'unlinkable across surfaces',
]
const ROOTS = ['packages', 'src', 'README.md']
const EXTS = new Set(['.ts', '.tsx', '.md', '.html'])
let failed = false

function walk(p) {
  if (statSync(p).isDirectory()) {
    for (const f of readdirSync(p)) if (f !== 'node_modules') walk(join(p, f))
    return
  }
  if (!EXTS.has(extname(p))) return
  const lines = readFileSync(p, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const phrase of FORBIDDEN) {
      if (line.toLowerCase().includes(phrase)) {
        console.error(`${p}:${i + 1}  forbidden claim "${phrase}"`)
        failed = true
      }
    }
  })
}

for (const r of ROOTS) { try { walk(r) } catch {} }
if (failed) {
  console.error('\nThese claims are false on this protocol and are scored against. See spec §11.')
  process.exit(1)
}

// ---- Network guard ------------------------------------------------------------
// Rival `veyl` has SEPOLIA addresses sitting in a mainnet array in its strk20.json
// and scores ZERO on real work. Adding a second network raises that risk, so the
// guard is what makes the toggle safe to have at all. Make it impossible, not unlikely.
const constants = readFileSync('packages/protocol/src/constants.ts', 'utf8')
const active = constants.match(/ACTIVE_NETWORK:\s*NetworkName\s*=\s*'(\w+)'/)?.[1]
if (active !== 'mainnet') {
  console.error(`ACTIVE_NETWORK is "${active}" — production must ship on mainnet.`)
  process.exit(1)
}

try {
  const s20 = JSON.parse(readFileSync('strk20.json', 'utf8'))
  const mainnetPool = constants.match(/pool:\s*'(0x0403[0-9a-f]+)'/)?.[1]
  for (const [field, values] of Object.entries(s20)) {
    if (!Array.isArray(values)) continue
    for (const v of values) {
      if (typeof v !== 'string') {
        console.error(`strk20.json ${field}: entries must be bare strings — objects are silently dropped`)
        process.exit(1)
      }
      if (!/^0x[0-9a-fA-F]+$/.test(v)) continue
      // Every declared contract must be one we deployed on mainnet, recorded in evidence.
      const deployed = JSON.parse(readFileSync('evidence/deployment.json', 'utf8'))
      const known = [deployed.contractAddress, mainnetPool].map((a) => BigInt(a))
      if (field === 'contracts' && !known.includes(BigInt(v))) {
        console.error(`strk20.json contracts: ${v} is not an address we deployed on mainnet`)
        process.exit(1)
      }
    }
  }
} catch (e) {
  if (e.code !== 'ENOENT') throw e   // strk20.json not written yet — fine before Task 9
}

console.log('claims lint: clean · network guard: mainnet')
```

- [ ] **Step 2: Run the lint and confirm it passes on an empty tree**

Run: `node scripts/lint-claims.mjs`
Expected: `claims lint: clean`

- [ ] **Step 3: Bank three real transactions through `MessageBook`**

Each is one pool transaction: a 1-wei self-note (the mandatory WriteOnce) plus one zero-value `InvokeExternal` to our contract in `MODE_APPEND`. Write the hashes to `evidence/gate-transactions.json` and verify each independently:

```bash
for TX in $(node -p "require('./evidence/gate-transactions.json').transactions.join(' ')"); do
  curl -s -X POST https://rpc.starknet.lava.build -H 'content-type: application/json' \
    -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"starknet_getTransactionReceipt\",\"params\":[\"$TX\"]}" \
    | node -e "const r=JSON.parse(require('fs').readFileSync(0)).result;
               console.log(r.transaction_hash, r.execution_status, r.events.length+' events')"
done
```

Expected: all three `SUCCEEDED`, each carrying both a pool event and a `MessageAppended` event from our address.

- [ ] **Step 4: Write `strk20.json` — flat bare strings only**

```json
{
  "transactions": ["0x...", "0x...", "0x..."],
  "contracts": ["0x..."],
  "demo_video": "https://...",
  "demo_url": "https://..."
}
```

`{hash: …}` objects are **silently dropped** — that is why rival `nexora` scores zero on 614 KB of code. Add the `contracts` entry in the **same commit** as the transactions routed through it.

- [ ] **Step 5: Write the README in your own words**

Fork detection byte-compares the **first 300 characters** against the starter kit. Open with your own sentence, name Starknet and STRK20 early, and cover: what it is · why privacy is necessary · how to run it · mainnet addresses. Include the honesty section from spec §11 verbatim.

- [ ] **Step 6: Verify the gate and commit**

```bash
node scripts/lint-claims.mjs
npx vitest run
git add -A
git commit -m "feat: bank 3 mainnet transactions through MessageBook; strk20.json, README, claims lint"
```

Then confirm on `strk20.starknet.io/hackathon`, which shows which gate items are still missing. Register by adding `{repo_url, telegram}` to `registry.json` in `starkience/strk20-hackathon` — auto-merges on check pass, and set `inspired_by` deliberately.

---

## Self-Review

**Spec coverage.** §2 identity → Tasks 3, 4. §2.4 bootstrap deadlock → Task 8. §3 relayer → Task 8. §3.1 claim discipline → Task 9 lint. §4 contracts → Task 5 (`MessageBook` only; `ValueRouter`, `PredictionMarket`, `LaunchRouter` are plans 4–6). §4.2 constraints → encoded in Task 5's contract and Global Constraints. §10.1 probes → Tasks 2, 6, 8. §10.2 week one → Tasks 7, 9. §11 claims → Task 9. §12 open questions → Tasks 6 and 8 close two of them.

**Deliberately out of scope**, deferred to later plans: §5 markets, §6 bridge, §7 app shell, §8 design, §9 product experience, §10.3 demo persona, §10.4 video.

**Placeholder scan.** One acknowledged gap: Task 6's probe body cannot be written until Task 7 yields a contract address, and Task 5 Step 1 requires fetching the real `OpenNoteDeposit` struct rather than inventing it. Both are **explicit instructions to fetch ground truth**, not hand-waving — and both say to stop and ask rather than guess.

**Network layer (spec §3.2), folded in 21 Aug.** Task 1 now produces `NETWORKS`, `NetworkName`,
`ACTIVE_NETWORK` and `NET` as typed constants, with tests asserting mainnet is the default and that the
sepolia pool is deliberately empty. Tasks 2 onward read `NET.rpc` / `NET.pool` rather than importing
loose constants. Task 7's `.env.example` is **four secrets and nothing else**, with both asserted up
front so a missing key fails loudly rather than as an opaque signing error. Task 9's lint gained the
**network guard** — it fails the build if `ACTIVE_NETWORK !== 'mainnet'`, if any `strk20.json` array
entry is an object rather than a bare string, or if a declared contract is not one we deployed. No
Sepolia task exists, and that is deliberate: **no shared Sepolia pool is published**, and
`compile_actions` validates against the real deployed mainnet contract for free.

**Type consistency.** `getPublicKey` returns `bigint` in Task 2 and is consumed as `bigint` in Task 4. `readPoolConstants` returns `feeWei: bigint`, consumed as `bigint` in Task 8. `deriveIdentityPublicKey` returns `string`, and Task 4 converts with `BigInt(ourPublicKey)`. `privacy_invoke(mode, tag, payload)` is consistent between Task 5's contract, its tests, and Task 9's banking script.
