// The Groundskeeper's pool participation: the relayer's own account registers, shields a seed
// budget and submits proven batches through the privacy SDK. Everything heavy loads on the
// call, so a boot with the job off never touches the crypto graph.

/**
 * Sized from the measured create probe (88M l2) with a lean margin. THE CEILING IS A BALANCE
 * REQUIREMENT: the sequencer refuses a tx whose worst-case bounds exceed the balance, so a fat
 * ceiling on a lean wallet is an outage. This one reserves ~4.7 STRK.
 */
export const BOUNDS = {
  l2_gas: { max_amount: 120_000_000n, max_price_per_unit: 35_000_000_000n },
  l1_gas: { max_amount: 5_000n, max_price_per_unit: 100_000_000_000_000n },
  l1_data_gas: { max_amount: 30_000n, max_price_per_unit: 300_000_000_000n },
}

/** Worst-case gas the BOUNDS reserve, in wei. */
export const BOUNDS_CEILING_WEI =
  BOUNDS.l2_gas.max_amount * BOUNDS.l2_gas.max_price_per_unit +
  BOUNDS.l1_gas.max_amount * BOUNDS.l1_gas.max_price_per_unit +
  BOUNDS.l1_data_gas.max_amount * BOUNDS.l1_data_gas.max_price_per_unit

export interface ProvisionConfig {
  address: string
  accountKey: string
  seedWei: bigint
  log?: (line: string) => void
}

export interface Provisioner {
  /** Free RPC read with host failover. */
  transportCall(contract: string, entrypoint: string, calldata: string[]): Promise<string[]>
  /** Prove one built batch and submit it from the relayer's account, bounds set. */
  proveAndSubmit(build: (b: unknown) => void, approveWei: bigint): Promise<string>
  /** Register + shield if needed; a sentence when the job cannot act. One attempt per boot. */
  ensureReady(): Promise<string | null>
}

export function createProvisioner(config: ProvisionConfig): Provisioner {
  // A wallet that could not cover it will not grow richer by being asked every three minutes.
  let provisioned: string | null | undefined

  const transportCall = async (contract: string, entrypoint: string, calldata: string[]) => {
    const { withFallback } = await import('../../protocol/src/rpc.js')
    return withFallback((p) => p.callContract({ contractAddress: contract, entrypoint, calldata }))
  }

  const openAccount = async () => {
    const { Account, RpcProvider } = await import('starknet')
    const { NET } = await import('../../protocol/src/constants.js')
    const provider = new RpcProvider({ nodeUrl: NET.rpc[0]! })
    return {
      provider,
      account: new Account({ provider, address: config.address, signer: config.accountKey }),
    }
  }

  const openTransfers = async () => {
    const { constants } = await import('starknet')
    const { IndexerDiscoveryProvider, createPrivateTransfers } = await import(
      '@starkware-libs/starknet-privacy-sdk'
    )
    const { NET } = await import('../../protocol/src/constants.js')
    const { deriveViewingKey } = await import('../../protocol/src/identity.js')
    const { account, provider } = await openAccount()
    const viewingKey = deriveViewingKey(config.accountKey, NET.chainId, NET.pool)
    const discovery = new IndexerDiscoveryProvider(NET.discovery, NET.pool, { ohttp: true })
    const transfers = createPrivateTransfers({
      account,
      viewingKeyProvider: { getViewingKey: async () => viewingKey },
      provingProvider: {
        url: NET.prover,
        chainId: NET.chainId as (typeof constants)['StarknetChainId'][keyof (typeof constants)['StarknetChainId']],
        ohttp: true,
      },
      discoveryProvider: discovery,
      poolContractAddress: NET.pool,
    })
    return { account, provider, transfers }
  }

  const shieldedStrk = async (): Promise<bigint> => {
    const { NET, STRK_TOKEN } = await import('../../protocol/src/constants.js')
    const { deriveViewingKey } = await import('../../protocol/src/identity.js')
    const { IndexerDiscoveryProvider } = await import('@starkware-libs/starknet-privacy-sdk')
    const discovery = new IndexerDiscoveryProvider(NET.discovery, NET.pool, { ohttp: true })
    const viewingKey = deriveViewingKey(config.accountKey, NET.chainId, NET.pool)
    const { notes } = await discovery.discoverNotes(
      BigInt(config.address) as never,
      viewingKey as never,
      {},
    )
    const mine = (notes.get(BigInt(STRK_TOKEN) as never) ?? []) as { amount: bigint }[]
    return mine.reduce((sum, n) => sum + n.amount, 0n)
  }

  const proveAndSubmit = async (build: (b: unknown) => void, approveWei: bigint): Promise<string> => {
    const { CallData, cairo } = await import('starknet')
    const { NET, STRK_TOKEN } = await import('../../protocol/src/constants.js')
    const { PROVING_BLOCK_LAG, proofBlobFrom } = await import('../../protocol/src/register.js')
    const { withFallback } = await import('../../protocol/src/rpc.js')
    const { account, provider, transfers } = await openTransfers()

    const provingBlockId = (await withFallback((p) => p.getBlockNumber())) - PROVING_BLOCK_LAG
    const builder = transfers.build({
      autoSetup: true,
      autoSelectNotes: 'naive',
      autoDiscover: { notes: 'refresh', channels: 'refresh' },
    })
    builder.surplusTo(config.address)
    build(builder)
    const invocation = await builder.createProofInvocation({ provingBlockId })
    const { callAndProof } = await transfers.executeWithInvocation(invocation, provingBlockId)
    const { call, proof } = callAndProof

    const calls = [
      {
        contractAddress: STRK_TOKEN,
        entrypoint: 'approve',
        calldata: CallData.compile([NET.pool, cairo.uint256(approveWei)]),
      },
      call,
    ]
    const out = await account.execute(calls, {
      proofFacts: [...proof.proofFacts],
      proof: proofBlobFrom(proof),
      resourceBounds: BOUNDS,
    } as never)
    const receipt = (await provider.waitForTransaction(out.transaction_hash)) as {
      execution_status?: string
      revert_reason?: string
    }
    if (receipt.execution_status !== 'SUCCEEDED') {
      throw new Error(
        `submission ${out.transaction_hash} ended ${receipt.execution_status}: ${receipt.revert_reason ?? 'no reason on the receipt'}`,
      )
    }
    return out.transaction_hash
  }

  const register = async (feeWei: bigint): Promise<void> => {
    const { proveRegistration, assembleRegistrationCalls, PROVING_BLOCK_LAG, formatStrk } = await import(
      '../../protocol/src/register.js'
    )
    const { withFallback } = await import('../../protocol/src/rpc.js')
    const { account, provider } = await openAccount()
    config.log?.(
      `groundskeeper: registering the relayer with the pool — fee ${formatStrk(feeWei)}, its own STRK`,
    )
    const provingBlockId = (await withFallback((p) => p.getBlockNumber())) - PROVING_BLOCK_LAG
    const proved = await proveRegistration({
      accountKey: config.accountKey,
      account: account as never,
      provingBlockId,
    })
    // `proved.proof` is already the broadcast blob — both-or-neither with the facts.
    const calls = assembleRegistrationCalls(proved.call, feeWei)
    const out = await account.execute(calls, {
      proofFacts: [...proved.proofFacts],
      proof: proved.proof,
    } as never)
    const receipt = (await provider.waitForTransaction(out.transaction_hash)) as {
      execution_status?: string
    }
    if (receipt.execution_status !== 'SUCCEEDED') {
      throw new Error(`registration ${out.transaction_hash} ended ${receipt.execution_status}`)
    }
    config.log?.(`groundskeeper: registered — ${out.transaction_hash}`)
  }

  const ensureReady = async (): Promise<string | null> => {
    if (provisioned !== undefined) return provisioned
    try {
      const { NET, STRK_TOKEN } = await import('../../protocol/src/constants.js')
      const { readPoolConstants } = await import('../../protocol/src/pool.js')
      const { formatStrk } = await import('../../protocol/src/register.js')

      const pool = await readPoolConstants()
      // Deliberately NOT cached: a paused pool unpauses without this process restarting.
      if (pool.paused) return 'the pool is paused; the Groundskeeper waits with everyone else'

      // `get_public_key` answers zero for an address the pool has no key for.
      const pk = await transportCall(NET.pool, 'get_public_key', [config.address])
      if (BigInt(pk[0] ?? '0x0') === 0n) await register(pool.feeWei)

      // Two markets' worth per shield: each deposit pays its own pool fee, so batching beats a
      // deposit per market, but the wallet also backs sponsorship and gas.
      const held = await shieldedStrk()
      const perMarket = config.seedWei + pool.feeWei
      if (held < perMarket) {
        const depositWei = perMarket * 2n
        config.log?.(
          `groundskeeper: shielding ${formatStrk(depositWei)} for seeds (held ${formatStrk(held)})`,
        )
        const txHash = await proveAndSubmit(
          (b) =>
            (b as { with: (t: string, f: (x: { deposit: (i: unknown) => unknown }) => unknown) => unknown }).with(
              STRK_TOKEN,
              (t) => t.deposit({ recipient: config.address, amount: depositWei }),
            ),
          depositWei + pool.feeWei,
        )
        config.log?.(`groundskeeper: shielded — ${txHash}`)
      }
      provisioned = null
      return null
    } catch (error) {
      // Cached ON PURPOSE: retrying a failing spend every sweep is how a wallet drains on gas.
      provisioned = `provisioning failed and will not be retried until restart: ${
        error instanceof Error ? error.message : String(error)
      }`
      return provisioned
    }
  }

  return { transportCall, proveAndSubmit, ensureReady }
}
