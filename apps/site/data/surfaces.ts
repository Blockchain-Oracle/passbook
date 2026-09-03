//
// Where each of the nine surfaces stands, in one place, because both pages say it.
//
// `/` renders the short line and `/docs/` renders the long one. One array with two fields rather
// than two arrays: the failure mode of the alternative is not a crash, it is a landing page and a
// documentation page quietly disagreeing about what is shipped, which is the most embarrassing
// thing a project whose pitch is honesty can do.
//
// ── THE NINE COME FROM THE PROTOCOL PACKAGE, NOT FROM THIS FILE ─────────────────────────────
//
// `ACTIVITY_SURFACES` is the app's closed list of surfaces a transaction can originate from. Keying
// off it means a tenth surface is a COMPILE ERROR here rather than a row the public site has
// never heard of — and it gets that without this package depending on `apps/web` at all, which it
// deliberately does not. `@strk20/protocol` is the shared library; the app is not.
//
// ── AND THE ROWS THAT CAN CHANGE ARE COMPUTED ─────────────────────────────────────────────
//
// Markets, Launch, Houses and Earn read `*_DEPLOYED`, which are true because of what is in
// `evidence/markets-launch-deployment.json`. A build with no evidence file says "not deployed"
// and is right; a build with one cannot say it at all. The rest are prose, because their state
// is a fact about what is BUILT and no file on disk knows it.
//
import { ACTIVITY_SURFACES, type ActivitySurface } from '@strk20/protocol/surfaces'

import { EARN_DEPLOYED, GOVERNANCE_DEPLOYED, LAUNCH_DEPLOYED, MARKETS_DEPLOYED } from './deployment'

/** How a surface is doing. Three states, and `partial` is the one that earns its keep. */
export type SurfaceState = 'live' | 'partial' | 'coming'

export interface SurfaceStatus {
  /** `01`…`09` — the index into the closed list, not the order somebody typed these in. */
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
  mail: {
    name: 'Mail',
    state: 'live',
    status: 'Deployed',
    note: 'Mailbox on mainnet, 3 Sep',
    body: 'Every message is a shielded payment: the pool posts the sealed memo to our pool-only Mailbox in the same proved transaction. Threads rebuild from the chain with the viewing key; no server carries a message. Opt-in public name directory.',
  },
  chat: {
    name: 'Chat',
    state: 'partial',
    status: 'Relayed demo',
    note: 'Gas-free because it never touches the chain. The relay sees who talks to whom, and when.',
    body: 'Sealed messages over one multiplexed connection to our relay. Sending an ordinary message costs nothing because it is not a Starknet transaction — and that is also the limit: the relay carries the ciphertext, sees the metadata around it, and keeps a bounded in-memory backlog rather than durable storage. Money attached to a message is a separate pool transaction that pays the ordinary fee. For a message that survives on chain, use Mail.',
  },
  swap: {
    name: 'Swap',
    state: 'live',
    status: 'Live',
    note: '',
    body: 'A real route priced through an on-chain aggregator, executed in one transaction, proceeds land back in the pool.',
  },
  earn: EARN_DEPLOYED
    ? {
        name: 'Earn',
        state: 'live',
        status: 'Live',
        note: 'Shielded USDC into Vesu lending markets and back, through our own helper.',
        body: 'Seven Vesu V2 USDC markets in one catalog, every rate and liquidity figure a live contract read rather than a feed. Supplying withdraws shielded USDC to our helper, which supplies the market and returns the shares as a private note; redeeming burns an exact share count and returns shielded USDC. Positions rebuild from the note walk, so they survive a cleared browser.',
      }
    : {
        name: 'Earn',
        state: 'coming',
        status: 'Not deployed',
        note: 'Helper written and compiled. The market catalog and every rate are already live reads.',
        body: 'Helper contract written and compiled, and not deployed in this build. The catalog of seven Vesu V2 USDC markets is already real — identities validated against the PoolFactory, and every rate, utilization and liquidity figure read live from each market’s own pool contract. Nothing can be supplied until the declare lands.',
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

/** The nine, in the protocol's own order. */
export const SURFACE_STATUS: readonly SurfaceStatus[] = ACTIVITY_SURFACES.map((key, i) => ({
  n: String(i + 1).padStart(2, '0'),
  key,
  ...DETAIL[key],
}))
