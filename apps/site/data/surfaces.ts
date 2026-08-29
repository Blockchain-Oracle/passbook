//
// Where each of the seven surfaces stands, in one place, because both pages say it.
//
// `/` renders the short line and `/docs/` renders the long one. One array with two fields rather
// than two arrays: the failure mode of the alternative is not a crash, it is a landing page and a
// documentation page quietly disagreeing about what is shipped, which is the most embarrassing
// thing a project whose pitch is honesty can do.
//
// ── THE SEVEN COME FROM THE PROTOCOL PACKAGE, NOT FROM THIS FILE ────────────────────────────
//
// `ACTIVITY_SURFACES` is the app's closed list of surfaces a transaction can originate from. Keying
// off it means a seventh surface is a COMPILE ERROR here rather than a row the public site has
// never heard of — and it gets that without this package depending on `apps/web` at all, which it
// deliberately does not. `@strk20/protocol` is the shared library; the app is not.
//
// ── AND THE TWO ROWS THAT CAN CHANGE ARE COMPUTED ─────────────────────────────────────────
//
// Markets and Launch read `MARKETS_DEPLOYED` / `LAUNCH_DEPLOYED`, which are true because of what is
// in `evidence/markets-launch-deployment.json`. A build with no evidence file says "not deployed"
// and is right; a build with one cannot say it at all. The other four are prose, because their
// state is a fact about what is BUILT and no file on disk knows it.
//
import { ACTIVITY_SURFACES, type ActivitySurface } from '@strk20/protocol/surfaces'

import { GOVERNANCE_DEPLOYED, LAUNCH_DEPLOYED, MARKETS_DEPLOYED } from './deployment'

/** How a surface is doing. Three states, and `partial` is the one that earns its keep. */
export type SurfaceState = 'live' | 'partial' | 'coming'

export interface SurfaceStatus {
  /** `01`…`07` — the index into the closed list, not the order somebody typed these in. */
  readonly n: string
  readonly key: ActivitySurface
  readonly name: string
  readonly state: SurfaceState
  /** The status words — "Live", "Outbound only", "Not deployed". */
  readonly status: string
  /** One clause for the landing row. Empty when the status alone is not an overstatement. */
  readonly note: string
  /** The full sentence, for the documentation table. */
  readonly body: string
}

type Detail = Omit<SurfaceStatus, 'n' | 'key'>

/**
 * `satisfies Record<ActivitySurface, Detail>` is the load-bearing half: a surface added to the
 * protocol's list with no entry here fails to compile, and an entry here naming a surface that does
 * not exist fails too. Both directions, because they are different mistakes.
 */
const DETAIL = {
  wallet: {
    name: 'Wallet',
    state: 'live',
    status: 'Live',
    note: '',
    body: 'Balance read from the pool, four honest states, send, deploy, register, QR receive, account lifecycle, history.',
  },
  chat: {
    name: 'Chat',
    state: 'live',
    status: 'Live',
    note: '',
    body: 'Multi-conversation over one multiplexed socket, sealed messages, money attached to a message, opt-in public name directory.',
  },
  swap: {
    name: 'Swap',
    state: 'live',
    status: 'Live',
    note: '',
    body: 'A real route priced through an on-chain aggregator, executed in one transaction, proceeds land back in the pool.',
  },
  bridge: {
    name: 'Bridge',
    state: 'partial',
    status: 'Outbound only',
    note: 'Shielded USDC out through StarkWare’s OutboundAnonymizer. Bringing value back is not built.',
    body: 'Shielded USDC out through StarkWare’s deployed OutboundAnonymizer. Bringing value back is not built, and no crossing has been sent from this code.',
  },
  markets: MARKETS_DEPLOYED
    ? {
        name: 'Markets',
        state: 'live',
        status: 'Live',
        note: 'Standing windows every 15 minutes, hour and day; prices are live reads from Pragma.',
        body: 'Deployed on mainnet. Standing windows on BTC, ETH, STRK and BTC/EUR every 15 minutes, hour and day — a window exists before anyone bets, the first bet sets its line from Pragma and the house float seeds the other side. The bet ticket and create-a-market write the deployed contract; every price is a live read from the oracle a market settles against. 87 snforge tests.',
      }
    : {
        name: 'Markets',
        state: 'coming',
        status: 'Not deployed',
        note: 'Contract written, 52 snforge tests. Nothing to bet on until the declare lands.',
        body: 'Contract written and tested — 52 snforge tests — and not deployed in this build. The price strip and chart are already real reads from Pragma. Nothing to bet on until the declare lands.',
      },
  launch: LAUNCH_DEPLOYED
    ? {
        name: 'Launch',
        state: 'live',
        status: 'Live',
        note: 'Buys arrive as withdrawals from the pool, so the launch records no buyer address.',
        body: 'Deployed on mainnet. True-phase cards, buy through the deployed contract, and launch-a-token. Buys arrive as withdrawals from the pool, so the launch records no buyer address — which is the narrow true claim, not “your address never appears”. 47 snforge tests.',
      }
    : {
        name: 'Launch',
        state: 'coming',
        status: 'Not deployed',
        note: 'Contract written, 47 snforge tests. Nothing can be created until the declare lands.',
        body: 'Contract written and tested — 47 snforge tests — and not deployed in this build. The surface explains the epoch mechanism; nothing can be created until the declare lands.',
      },
  houses: GOVERNANCE_DEPLOYED
    ? {
        name: 'Houses',
        state: 'live',
        status: 'Live',
        note: 'Sealed ballots with public weight; the Teller opens the tally, and the contract checks its math.',
        body: 'Deployed on mainnet. A house is a treasury with members; a ballot’s weight is public, its choice is sealed to the proposal’s tally key, and no address is written on it. Our Teller opens the tally at close and cannot forge, drop or miscount a ballot, because the contract checks the arithmetic.',
      }
    : {
        name: 'Houses',
        state: 'coming',
        status: 'Not deployed',
        note: 'Contract written and tested; nothing to vote in until the declare lands.',
        body: 'Contract written and tested, and not deployed in this build. Nothing to vote in until the declare lands.',
      },
} as const satisfies Record<ActivitySurface, Detail>

/** The seven, in the protocol's own order. */
export const SURFACE_STATUS: readonly SurfaceStatus[] = ACTIVITY_SURFACES.map((key, i) => ({
  n: String(i + 1).padStart(2, '0'),
  key,
  ...DETAIL[key],
}))
