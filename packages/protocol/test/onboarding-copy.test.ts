import { describe, it, expect } from 'vitest'

import { POOL_SEES } from '../src/disclosure-copy.js'
import {
  BACKUP_BODY,
  BANNED_CLAIMS,
  CUSTODY_BODY,
  DEADLOCK_TITLE,
  NAME_CAPTION,
  REGISTER_STEPS,
  TRIGGER_COST_CHIP,
  TRIGGER_HEADLINE,
  deadlockBody,
  deadlockFeeRow,
  deadlockInvitedTitle,
} from '../src/onboarding-copy.js'

//
// Onboarding copy is where the temptation to oversell is strongest — it is the screen selling the
// product to somebody who has not used it. Every claim below is either quoted from the ratified
// brief because it is a verified protocol fact, or it is a parameter. Nothing here is written to
// taste.
//

describe('the sourced sentences are reproduced byte-exact', () => {
  it('states the custody model as the brief does', () => {
    expect(CUSTODY_BODY).toBe(
      'Your key is made here, in this browser. It is not derived from a wallet signature — this protocol records your key once and never lets you change it, and a wallet upgrade would change the signature and orphan your funds permanently. The same key reads your history and signs your spending; there is no watch-only version. When you register, an encrypted copy is escrowed on-chain to StarkWare’s auditor. That is not optional.',
    )
  })

  it('states the backup gate as the brief does', () => {
    expect(BACKUP_BODY).toBe(
      'Save your key before we write anything on-chain. The key we register can never be replaced — the protocol writes it once.',
    )
  })

  it('states what the name is and is not', () => {
    expect(NAME_CAPTION).toBe(
      'This is the address people send to. It is the only address this app will ever show you. The name resolves only inside this app.',
    )
  })

  it('opens conversion with the brief’s trigger sentence', () => {
    expect(TRIGGER_HEADLINE).toBe(
      'You are reading a public account. Sending needs one of your own.',
    )
  })
})

//
// THE HARDEST CONSTRAINT IN THIS FILE. §1: durations do not render until one real proof has been
// timed against StarkWare's hosted prover, which is not ours to measure. The brief writes the chip
// as `one transaction` FOR THIS REASON and explicitly rejects "about 20 seconds".
//
describe('no duration is promised anywhere', () => {
  it('prices the trigger in transactions, not seconds', () => {
    expect(TRIGGER_COST_CHIP).toBe('one transaction')
  })

  it('names no unit of time in any sentence', () => {
    const everything = [
      TRIGGER_HEADLINE,
      TRIGGER_COST_CHIP,
      NAME_CAPTION,
      CUSTODY_BODY,
      BACKUP_BODY,
      DEADLOCK_TITLE,
      deadlockBody('6.0'),
      deadlockFeeRow('Passbook', '6.0'),
    ].join(' ')
    expect(everything).not.toMatch(/\bseconds?\b|\bminutes?\b|\bhours?\b|\bfast\b|\bquick(ly)?\b/i)
  })
})

//
// The eight banned strings. `watch-only` needs a word, because the sourced custody sentence
// contains it — and that is correct rather than a violation.
//
// The prohibition is on CLAIMING a watch-only mode exists: `open_channel` asserts the viewing key
// is the spending authenticator, so any read-only affordance would hand over spend authority. The
// brief's sentence says "there is no watch-only version", which is the DENIAL. Banning the token
// outright would ban the app from telling the truth about it.
//
describe('the banned claims', () => {
  const surfaces = [
    TRIGGER_HEADLINE,
    NAME_CAPTION,
    BACKUP_BODY,
    DEADLOCK_TITLE,
    deadlockBody('6.0'),
    deadlockFeeRow('Passbook', '6.0'),
  ]

  it('appear nowhere in the copy that makes claims', () => {
    for (const sentence of surfaces) {
      for (const banned of BANNED_CLAIMS) {
        expect(sentence.toLowerCase(), `"${sentence}" contains "${banned}"`).not.toContain(banned)
      }
    }
  })

  // The one that matters most: it is banned until the relayer's claim is proven on mainnet, and
  // the registration screens are exactly where somebody would be tempted to write it.
  it('never says the address does not appear', () => {
    const everything = [...surfaces, CUSTODY_BODY].join(' ').toLowerCase()
    expect(everything).not.toContain('your address never appears')
  })

  it('mentions watch-only only to deny that one exists', () => {
    expect(CUSTODY_BODY).toContain('there is no watch-only version')
    // Never as an offer. A read-only toggle, an observer link or a padlock icon are all things the
    // brief says to never ship, because there is no key that can do it.
    expect(CUSTODY_BODY.toLowerCase()).not.toMatch(/watch-only (mode|key|access|link)/)
  })
})

//
// The brief's governing runtime rule: no STRK amount, no user count, no duration and no fee ever
// appears as a hardcoded string. The fee is read from `get_fee_amount()` at render.
//
describe('the fee is a parameter, never a literal', () => {
  it('renders whatever fee it is given', () => {
    expect(deadlockBody('6.0')).toContain('~6.0 STRK')
    expect(deadlockBody('7.25')).toContain('~7.25 STRK')
  })

  // The fee is read live and the read can fail. Omitting the number is the honest answer; a
  // fallback figure would be a hardcoded fee wearing a disguise.
  it('omits the amount entirely when the chain could not be asked', () => {
    const body = deadlockBody(null)
    expect(body).toContain('Registering costs one pool transaction. We are paying it.')
    expect(body).not.toMatch(/\d/)
    expect(body).toContain('Someone has to go first')

    const row = deadlockFeeRow('Passbook', null)
    expect(row).toBe('Submitted by Passbook relayer · paid by us')
    expect(row).not.toMatch(/STRK/)
  })

  it('carries no baked number of its own', () => {
    // The template with its parameter removed must contain no digits at all — a "6" left in the
    // prose would survive every fee change and quietly become a lie.
    expect(deadlockBody('')).not.toMatch(/\d/)
    expect(deadlockFeeRow('Passbook', '')).not.toMatch(/\d/)
  })

  it('names the app and the payer in the fee row', () => {
    expect(deadlockFeeRow('Passbook', '6.0')).toBe('Submitted by Passbook relayer · 6.0 STRK · paid by us')
  })
})

describe('the deadlock is named rather than hidden', () => {
  it('explains why a new account cannot pay for itself', () => {
    const body = deadlockBody('6.0')
    expect(body).toContain('nobody may give you a shielded balance until you are registered')
    expect(body).toContain('Someone has to go first')
  })

  // §2: attribution is the accountability mechanism — a named inviter is one of the five abuse
  // layers, so the person paying is named on the screen where the payment happens.
  it('attributes a sponsored registration to the inviter', () => {
    expect(deadlockInvitedTitle('abu')).toBe('abu is covering your registration.')
  })

  // The sanctioned sentence, reproduced from `disclosure-copy.ts` rather than re-authored — one
  // string, one place, so the two can never drift into two different claims.
  it('uses the sanctioned disclosure sentence verbatim', () => {
    expect(POOL_SEES).toBe('The pool sees this transaction, not your notes.')
  })
})

describe('the pipeline', () => {
  // Registration mints no spendable note, so there is no maturity step. A fifth stage added for
  // symmetry with a send would be the app waiting for something that is never coming.
  it('has four steps and no maturity stage', () => {
    expect(REGISTER_STEPS).toEqual(['Build', 'Prove', 'Relay', 'Confirmed'])
    expect(REGISTER_STEPS).not.toContain('Mature')
  })
})
