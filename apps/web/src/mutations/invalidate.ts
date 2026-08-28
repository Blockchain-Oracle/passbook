import { queryClient } from '@/app/query-client'

/** Everything a pool write can move: the walk, its balance, public holdings, the record. */
export function invalidateMoney(): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['shielded'] }),
    queryClient.invalidateQueries({ queryKey: ['public-balances'] }),
    queryClient.invalidateQueries({ queryKey: ['activity'] }),
  ]).then(() => undefined)
}

export function invalidateVenues(): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['markets'] }),
    queryClient.invalidateQueries({ queryKey: ['launches'] }),
    queryClient.invalidateQueries({ queryKey: ['houses'] }),
    queryClient.invalidateQueries({ queryKey: ['proposals'] }),
    queryClient.invalidateQueries({ queryKey: ['position'] }),
  ]).then(() => undefined)
}

export function invalidateAccount(): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ['account-status'] }),
    queryClient.invalidateQueries({ queryKey: ['public-balances'] }),
  ]).then(() => undefined)
}
