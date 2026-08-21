import { RpcProvider } from 'starknet'
import { NET } from './constants.js'

let cached: RpcProvider | null = null

export function getProvider(): RpcProvider {
  if (!cached) cached = new RpcProvider({ nodeUrl: NET.rpc[0] })
  return cached
}

/** Runs `fn` against each RPC in turn; throws only if every host fails. */
export async function withFallback<T>(fn: (p: RpcProvider) => Promise<T>): Promise<T> {
  let last: unknown
  for (const nodeUrl of NET.rpc) {
    try {
      return await fn(new RpcProvider({ nodeUrl }))
    } catch (e) {
      last = e
    }
  }
  throw new Error(`all RPC hosts failed: ${String(last)}`)
}
