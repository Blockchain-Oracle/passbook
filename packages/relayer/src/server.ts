// SERVER-SIDE ONLY. The composition root: env → ledgers → signer → jobs → listen. This module
// reads the signing key out of the process environment and must never reach browser code.
// Importing it is side-effect free; `main()` runs only when this file is the entry point.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { NET } from '../../protocol/src/constants.js'
import { loadDotEnv } from '../../protocol/src/env.js'
import { readHead, readPoolConstants } from '../../protocol/src/pool.js'
import { resourceBoundsFor } from '../../protocol/src/fee-ceiling.js'
import { readAllMedians } from '../../protocol/src/pragma.js'
import {
  governanceWriteSafety,
  NO_APP_CONTRACTS,
  parseAppContracts,
  type AppContracts,
} from '../../protocol/src/app-contracts.js'
import { approveCeiling } from './allowlist.js'
import { createApp } from './app.js'
import { printBanner } from './banner.js'
import { ChainFeed } from './chain-feed.js'
import type { RelayerContext } from './context.js'
import { openDirectory } from './directory.js'
import { faucetDripWei, resolveEnv, starterDripWei } from './env.js'
import { createFundingMonitor } from './funding-monitor.js'
import { createChainKeeperDeps, scheduleKeeper, type KeeperSchedule } from './keeper.js'
import {
  openAccountAllowanceLedger,
  openFaucetLedger,
  openSendBudgetLedger,
  openSponsorshipLedger,
} from './ledger.js'
import { createGasCalibration, GAS_CALIBRATION_INTERVAL_MS } from './gas-calibration.js'
import type { LogoService } from './logo.js'
import { createQuoteCounter } from './quote-proxy.js'
import { openRevertWatch, REVERT_WATCH_INTERVAL_MS } from './revert-watch.js'
import { sendShieldedStarter } from './starter.js'
import { ROOM_IDLE_MS, RoomHub } from './rooms.js'
import { makeOpsPager, openSigner, readStrkBalance, tellerSubmitters } from './signer.js'
import { openTeller, tellerChainDeps, TELLER_INTERVAL_MS } from './teller.js'

// `Markets::resolve` is open for 300 s after a deadline; a 60 s pass gets five attempts.

/** Evidence files are optional: absent means "not deployed yet", never a refusal to boot. */
function evidence(name: string): string | undefined {
  try {
    return readFileSync(new URL(`../../../evidence/${name}`, import.meta.url), 'utf8')
  } catch {
    return undefined
  }
}
function deployedMessageBook(): string | undefined {
  try {
    return (JSON.parse(evidence('deployment.json') ?? 'null') as { contractAddress?: string } | null)?.contractAddress
  } catch {
    return undefined
  }
}
function deployedAppContracts(): AppContracts {
  try {
    return parseAppContracts(evidence('markets-launch-deployment.json'))
  } catch {
    return NO_APP_CONTRACTS
  }
}

/** Every timer here is unref'd: a job must never hold the process open through a shutdown. */
const every = (ms: number, tick: () => void) => setInterval(tick, ms).unref()

async function main(): Promise<void> {
  const envFile = loadDotEnv()
  if (envFile.loaded) console.log(`relayer: loaded ${envFile.path}`)
  else if (envFile.path) console.warn(`relayer: WARNING ${envFile.reason}`)

  const env = resolveEnv()
  // Ledgers before the socket: an unreadable ledger is not something to discover on request one.
  const sponsorship = openSponsorshipLedger(env.sponsor)
  const sendBudget = openSendBudgetLedger(env.sponsor, sponsorship.salt)
  const faucet = env.faucetOn ? openFaucetLedger(env.sponsor, sponsorship.salt) : undefined
  const accountAllowance = openAccountAllowanceLedger(env.sponsor, sponsorship.salt)

  const { nodeUrl, provider, account: signerAccount, execute, address } = await openSigner(env.address, env.privateKey)

  // The meters' second half: units spent on a transaction that lands and REVERTS come back.
  // Opened with the ledgers because it holds the same money; swept on a timer like every other job.
  const revertWatch = openRevertWatch({
    file: env.sponsor.revertWatchStore,
    readReceipt: (hash) => provider.getTransactionReceipt(hash),
    ledgers: { sponsorship, send: sendBudget, account: accountAllowance, faucet },
  })
  every(REVERT_WATCH_INTERVAL_MS, () => void revertWatch.sweep())
  const callContract = (contractAddress: string, entrypoint: string, calldata: string[]) =>
    provider.callContract({ contractAddress, entrypoint, calldata })

  // Measured gas, refreshed on a timer. Sampled rather than estimated because the fallback RPC is
  // pinned to a spec that cannot carry a proof, and because every screen that quotes a cost needs
  // the number before there is a proof to estimate against. First sample is fired now, not awaited:
  // the constant covers the seconds before it lands, and a slow public node must not delay boot.
  const gasCalibration = createGasCalibration(provider)
  void gasCalibration.sample()
  every(GAS_CALIBRATION_INTERVAL_MS, () => void gasCalibration.sample())

  const directory = openDirectory({
    file: env.directoryStore,
    readPublicKey: async (user) => BigInt((await callContract(NET.pool, 'get_public_key', [user]))[0] ?? '0x0'),
  })
  const monitor = createFundingMonitor({
    readBalance: () => readStrkBalance(address),
    readFeeWei: async () => (await readPoolConstants()).feeWei,
    pageOps: makeOpsPager(env.sponsor.opsWebhook),
    intervalMs: env.sponsor.fundingIntervalMs,
  })

  const messageBook = deployedMessageBook()
  const app = deployedAppContracts()
  const governanceSafety = governanceWriteSafety(app)
  // A vulnerable Governance stays readable in the feed; neither this signer nor the Teller writes it.
  const writableGovernance = governanceSafety.enabled ? app.governance : undefined

  const rooms = new RoomHub()
  every(ROOM_IDLE_MS / 6, () => {
    const dropped = rooms.sweep()
    if (dropped > 0) console.log(`rooms: swept ${dropped} idle`)
  })

  const chainFeed =
    env.chainFeedWanted && (app.markets || app.launch || app.pragma)
      ? new ChainFeed({
          markets: app.markets,
          launch: app.launch,
          governance: app.governance,
          readPrices: app.pragma ? () => readAllMedians(app.pragma) : undefined,
          storePath: env.chainFeedStore,
        })
      : undefined
  chainFeed?.start()

  const logos: LogoService | undefined =
    env.pinataJwt || env.geminiKey
      ? {
          pinataJwt: env.pinataJwt,
          geminiKey: env.geminiKey,
          imageModel: env.imageModel,
          pinCounter: createQuoteCounter(20, 200),
          generateCounter: createQuoteCounter(10, 100),
        }
      : undefined

  const teller = writableGovernance ? openTeller({ file: env.tellerStore }) : undefined
  if (teller && writableGovernance) {
    const deps = {
      ...tellerChainDeps(
        writableGovernance,
        {
          callContract: (req) => callContract(req.contractAddress, req.entrypoint, req.calldata),
          getEvents: (filter) => provider.channel.getEvents(filter as never) as never,
        },
        env.governanceFromBlock,
      ),
      ...tellerSubmitters(execute, writableGovernance),
    }
    every(TELLER_INTERVAL_MS, () => void teller.tick(deps).catch((e) => console.warn(`teller: sweep failed — ${String(e)}`)))
  }

  // Hoisted so the context and the starter share ONE resolver rather than two that can drift.
  const resolveResourceBounds = async () => {
    const { gasPrices } = await readHead()
    const m = gasCalibration?.current()
    return resourceBoundsFor(gasPrices, m ? { l2Gas: m.l2Gas, l1Gas: m.l1Gas, l1DataGas: m.l1DataGas } : undefined)
  }
  // Through the signer's queue, never `account.execute`: this key has four writers sharing one
  // nonce, and the queue is the only thing keeping them from colliding under load.
  const submitThroughQueue: RelayerContext['submit'] = async (calls, details) =>
    (await execute(calls, details)).transaction_hash

  const ctx: RelayerContext = {
    submit: submitThroughQueue,
    policy: { messageBook, markets: app.markets, launch: app.launch, governance: writableGovernance },
    resolveApproveCeiling: async () => approveCeiling((await readPoolConstants()).feeWei),
    // Prices live, units measured — `gasCalibration` reads the pool's own recent receipts, so this
    // is a better bound than any client could build. Falls back to the constant before the first sample.
    resolveResourceBounds,
    sponsorship,
    sendBudget,
    faucet,
    accountAllowance,
    revertWatch,
    // The gift. THIS PROCESS IS THE DEPOSITOR — its key proves it and its balance is what the pool
    // checks — and the recipient signs nothing. Only offered where a claim ledger exists to bound
    // it to once per account.
    ...(faucet
      ? {
          starter: (recipient: string) =>
            sendShieldedStarter(recipient, {
              accountKey: env.privateKey,
              account: signerAccount,
              amountWei: starterDripWei(),
              submit: submitThroughQueue,
              resolveResourceBounds,
            }),
        }
      : {}),
    feeRecipient: address,
    visitorSalt: sponsorship.salt,
    quoteCounter: createQuoteCounter(env.sponsor.quoteDailyPerVisitor, env.sponsor.quoteDailyGlobal),
    // `unknown` health reports ok: a failed read must not turn an RPC blip into an outage.
    relayerState: () => monitor.userState(),
    // Read by `/health` only, and never on a request path that could block on the chain.
    fundingObserved: () => monitor.observed(),
    rooms,
    directory,
    chainFeed,
    gasCalibration,
    logos,
    teller,
  }
  const web = createApp(ctx, { allowedOrigins: env.allowedOrigins, authToken: env.authToken })

  // The settlement keeper: gas only, no privileges; `resolve`/`void` are permissionless.
  const keeperReady = env.keeperWanted && Boolean(app.markets && app.pragma)
  let keeper: KeeperSchedule | undefined
  if (keeperReady) {
    const keeperDeps = createChainKeeperDeps({
      markets: app.markets!,
      pragma: app.pragma!,
      call: callContract,
      send: async (contractAddress, entrypoint, calldata) => {
        await execute([{ contractAddress, entrypoint, calldata }])
      },
    })
    keeper = scheduleKeeper(keeperDeps, { log: (l) => console.log(l), warn: (l) => console.warn(l) })
  }

  // Awaited so the first request answers from a measurement, not from `unknown`.
  await monitor.check()
  monitor.start()

  serve({ fetch: web.fetch, port: env.port, hostname: env.host }, () =>
    printBanner({
      host: env.host, port: env.port, address, nodeUrl, messageBook, appContracts: app, governanceSafety,
      keeperWanted: env.keeperWanted, keeperReady, keeperNextRun: keeper?.nextRun() ?? null,
      allowedOrigins: env.allowedOrigins, sponsor: env.sponsor,
      feedWanted: env.chainFeedWanted, chainFeed, chainFeedStore: env.chainFeedStore,
      logos, teller, tellerStore: env.tellerStore,
      faucetOn: faucet !== undefined, faucetDripWei: faucetDripWei(), monitor,
    }),
  )
}

// Only when run directly: importing must stay side-effect free, launching must fail loudly.
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  await main()
}
