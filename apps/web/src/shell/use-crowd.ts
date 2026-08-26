//
// The crowd reading, fetched once per mount (story 6.7b, AD-14).
//
// ── WHY THE READER IS `fetch` AND NOT `readPoolEvents` ───────────────────────────────────
//
// The first version of this hook dynamically imported a reader built on `pool-events.ts`, on the
// theory that a lazy boundary keeps `starknet` out of the eager bundle. `build:web` refused, and
// it was right twice: `APP_FORBIDDEN_IN_CHUNK` bans the `poseidon` graph from ANY emitted chunk,
// and `APP_MAX_EAGER_BYTES` sums every `.js` in `dist` — so the lazy boundary produced a 231 kB
// file and changed neither answer. Measured: 703,535 B against a 560,000 B budget.
//
// `crowd-rpc.ts` has no chain client in it at all, so this import is static and costs nothing.
//
// The meter itself never imports even that. `linkability.ts` takes a reading as DATA, so the
// component tree stays leaf-pure and this is the only place that knows a network exists.
//
// ── IT STARTS UNMEASURABLE, WHICH IS TRUE RATHER THAN CONVENIENT ─────────────────────────
//
// Before the read returns we have not measured anything, and the meter's honest rendering of that
// is the unmeasurable state — no count, no verdict, no spinner standing in for a number. There is
// deliberately no "loading" tier: a tier is a claim, and we have nothing to claim yet.
//
import { useEffect, useState } from 'react'
import type { CrowdReading } from '@strk20/protocol/crowd'
import { readCrowd } from '@strk20/protocol/crowd-rpc'
import { INDEXER_UNREACHABLE } from '@strk20/protocol/linkability-copy'

const NOT_READ_YET: CrowdReading = { state: 'unmeasurable', because: INDEXER_UNREACHABLE }

export function useCrowd(): CrowdReading {
  const [reading, setReading] = useState<CrowdReading>(NOT_READ_YET)

  useEffect(() => {
    // Guards a state write after the surface has gone. Navigating away mid-read is the common
    // case on a route the user is browsing rather than transacting on.
    let live = true

    void (async () => {
      const next = await readCrowd()
      if (live) setReading(next)
    })()

    return () => {
      live = false
    }
  }, [])

  return reading
}
