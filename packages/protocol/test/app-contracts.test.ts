import { describe, it, expect } from 'vitest'

import { appContractsFromEnv, parseAppContracts, NO_APP_CONTRACTS } from '../src/app-contracts.js'

//
// The addresses do not exist until the deploy script runs, so "not deployed yet" is a state the app
// has to run in rather than an error it reports. Every test here is really about one of two things:
// does a real deployment file parse, and does the absence of one fail closed.
//

const MARKETS = '0x750ec8f6c6c96f1e66129f84ac8ca798973bb3e5fd9384269706a7e079f4388'
const LAUNCH = '0x7c4a3f7cd257beb5a8243fb1cd3ac3e5f59b36f08a436bbd657ef214c970d22'
const PRAGMA = '0x2a85bd616f912537c50a49a4076db02c00b29b2cdc8a197ce92ed1837fa875b'
const TOKEN_CLASS = '0x6bc12b93be701b35f48d30acdf4caddf9fe603a3d7ca4f2ce8444a175262782'

/** The shape `scripts/ops/deploy-markets-launch.ts` actually writes. */
const deployment = JSON.stringify({
  network: 'mainnet',
  chainId: '0x534e5f4d41494e',
  pragma: PRAGMA,
  poolClassHash: '0x67dddd89d80fedadc06b6f160798f94800a4a70164e5a24301cd0d6076b554d',
  declaredVia: 'https://starknet-rpc.publicnode.com',
  LaunchToken: { classHash: TOKEN_CLASS, note: 'declare only — graduate() deploys instances' },
  Markets: { classHash: '0xaaa', deployTx: '0xbbb', contractAddress: MARKETS },
  Launch: { classHash: '0xccc', deployTx: '0xddd', contractAddress: LAUNCH },
  verifiedAtBlock: 13955303,
})

describe('a real deployment file', () => {
  it('yields both addresses, the oracle and the token class', () => {
    expect(parseAppContracts(deployment)).toEqual({
      markets: MARKETS,
      launch: LAUNCH,
      pragma: PRAGMA,
      launchTokenClassHash: TOKEN_CLASS,
    })
  })

  // The oracle comes from the file rather than a constant because it is the address Markets's
  // CONSTRUCTOR was given. A keeper pre-checking freshness must read the oracle the contract will
  // read, not the one that happened to be current when someone wrote a source line.
  it('takes the oracle from the deployment, not from anywhere else', () => {
    expect(parseAppContracts(deployment).pragma).toBe(PRAGMA)
  })
})

//
// FAILING CLOSED IS THE WHOLE POINT. Everything downstream treats a missing address as "permit
// nothing / show the coming-state", so every malformed input has to arrive as missing rather than
// as something that half-parses.
//
describe('before anything is deployed', () => {
  it('returns nothing for a file that is not there', () => {
    expect(parseAppContracts(null)).toEqual(NO_APP_CONTRACTS)
    expect(parseAppContracts(undefined)).toEqual(NO_APP_CONTRACTS)
    expect(parseAppContracts('')).toEqual(NO_APP_CONTRACTS)
  })

  // A corrupt evidence file must not stop the relayer booting: it is advisory until a deployment
  // exists, and a half-parsed address is the one outcome nothing downstream should ever see.
  it('returns nothing rather than throwing on a corrupt file', () => {
    expect(parseAppContracts('{not json')).toEqual(NO_APP_CONTRACTS)
    expect(parseAppContracts('"a string"')).toEqual(NO_APP_CONTRACTS)
    expect(parseAppContracts('null')).toEqual(NO_APP_CONTRACTS)
  })

  it('ignores a contract entry that has no address yet', () => {
    const halfDone = JSON.stringify({ Markets: { classHash: '0xaaa' }, Launch: { contractAddress: LAUNCH } })
    expect(parseAppContracts(halfDone)).toEqual({ launch: LAUNCH })
  })

  // `0x0` parses as a felt and is not an address — it is also what an aborted deploy leaves behind.
  it('treats a zero address as absent', () => {
    const zeroed = JSON.stringify({ Markets: { contractAddress: '0x0' } })
    expect(parseAppContracts(zeroed)).toEqual(NO_APP_CONTRACTS)
  })

  it('treats a non-felt address as absent', () => {
    const junk = JSON.stringify({ Markets: { contractAddress: 'not an address' } })
    expect(parseAppContracts(junk)).toEqual(NO_APP_CONTRACTS)
  })

  it('treats an address that is not a string as absent', () => {
    const arrayish = JSON.stringify({ Markets: { contractAddress: [MARKETS] } })
    expect(parseAppContracts(arrayish)).toEqual(NO_APP_CONTRACTS)
  })
})

//
// The browser has no filesystem, so its addresses arrive as build-time env. The same VALIDATION
// applies on both sides even though the same parser cannot.
//
describe('the browser’s route to the same addresses', () => {
  it('reads them from env', () => {
    expect(
      appContractsFromEnv({
        PASSBOOK_MARKETS_ADDRESS: MARKETS,
        PASSBOOK_LAUNCH_ADDRESS: LAUNCH,
        PASSBOOK_PRAGMA_ADDRESS: PRAGMA,
      }),
    ).toEqual({ markets: MARKETS, launch: LAUNCH, pragma: PRAGMA })
  })

  it('holds env to the same validation the file gets', () => {
    expect(appContractsFromEnv({ PASSBOOK_MARKETS_ADDRESS: '0x0' })).toEqual(NO_APP_CONTRACTS)
    expect(appContractsFromEnv({ PASSBOOK_MARKETS_ADDRESS: 'nope' })).toEqual(NO_APP_CONTRACTS)
    expect(appContractsFromEnv({})).toEqual(NO_APP_CONTRACTS)
  })
})
