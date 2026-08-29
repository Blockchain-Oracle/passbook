// The Groundskeeper's seed ledger (`RELAYER_GROUNDSKEEPER_STORE`). Every seeded market mints a
// bearer position; its secret is written here BEFORE the submission is signed. A secret lost is
// STRK burned, so the write uses the package's one atomic discipline.
import { readFileSync } from 'node:fs'

import { atomicWriteJson } from './sponsorship-store.js'

export interface StoredSeed {
  pair: string
  secret: string
  commitment: string
  seedWei: string
  createdAt: number
  /** Filled in after the submission answers; a seed with none may still be live — check chain. */
  txHash?: string
}

export interface SeedStore {
  version: 1
  seeds: StoredSeed[]
}

/** First boot or an unreadable file begins empty; the write is what surfaces a refusing disk. */
export function loadSeedStore(path: string): SeedStore {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SeedStore
    if (parsed.version === 1 && Array.isArray(parsed.seeds)) return parsed
  } catch {
    // See above.
  }
  return { version: 1, seeds: [] }
}

export interface SeedLedger {
  recordSeed(seed: StoredSeed): void
  updateSeedTx(commitment: string, txHash: string): void
}

export function openSeedLedger(path: string): SeedLedger {
  const save = (record: SeedStore) => atomicWriteJson(path, record)
  return {
    recordSeed: (seed) => {
      const record = loadSeedStore(path)
      record.seeds.push(seed)
      save(record)
    },
    updateSeedTx: (commitment, txHash) => {
      const record = loadSeedStore(path)
      const found = record.seeds.find((s) => s.commitment === commitment)
      if (found) {
        found.txHash = txHash
        save(record)
      }
    },
  }
}
