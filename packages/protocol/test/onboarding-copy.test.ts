import { describe, it, expect } from 'vitest'

import { POOL_SEES } from '../src/disclosure-copy.js'
import { ONBOARDING_STAGES, STAGE_TITLES } from '../src/pipeline-stage.js'
import {
  BACKUP_BODY,
  BANNED_CLAIMS,
  CUSTODY_BODY,
  DEADLOCK_TITLE,
  NAME_CAPTION,
  ONBOARDING_STAGE_NOTES,
  REGISTER_STEPS,
  TRIGGER_COST_CHIP,
  TRIGGER_HEADLINE,
  createFeeNote,
  deadlockBody,
  deadlockFeeRow,
  deadlockInvitedTitle,
  doneSub,
  fundRefused,
  doneTitle,
  namePreview,
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
    expect(body).toContain('Registering costs one pool transaction.')
    expect(body).not.toMatch(/\d/)
    expect(body).toContain('Someone has to stake you first')

    const row = deadlockFeeRow('Passbook', null)
    expect(row).toBe('Staked by Passbook · signed and paid by your own account')
    expect(row).not.toMatch(/STRK/)
  })

  it('carries no baked number of its own', () => {
    // The template with its parameter removed must contain no digits at all — a "6" left in the
    // prose would survive every fee change and quietly become a lie.
    expect(deadlockBody('')).not.toMatch(/\d/)
    expect(deadlockFeeRow('Passbook', '')).not.toMatch(/\d/)
  })

  it('names the app and the payer in the fee row — the staker and the self-paying signer (M8)', () => {
    expect(deadlockFeeRow('Passbook', '6.0')).toBe(
      'Staked by Passbook · 6.0 STRK · signed and paid by your own account',
    )
  })
})

describe('the deadlock is named rather than hidden', () => {
  it('explains why a new account cannot pay for itself', () => {
    const body = deadlockBody('6.0')
    expect(body).toContain('nobody may give you a shielded balance until you are registered')
    // M8's inversion, in the copy: the stake goes first and the user's own account pays with it.
    expect(body).toContain('Someone has to stake you first')
    expect(body).toContain('your own account signs and pays its own way')
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

//
// ── THE TWO-STEP FLOW (2026-08-28) ────────────────────────────────────────────────────────
//
// Account creation collapsed from six screens to two, and the drip stopped being a button. These
// pin the parts of that which are claims rather than layout — the fee stays a parameter, the
// public/private distinction stays two different sentences, and the ladder starts with the money.
//

describe('the creation ladder', () => {
  // The M8 inversion, as a property rather than a comment: the stake goes FIRST, because the
  // account signs and pays for its own registration out of it. A list that registered before it
  // was funded would be describing a transaction that cannot be paid for.
  it('drips before it registers', () => {
    expect(ONBOARDING_STAGES[0]).toBe('drip')
    expect(ONBOARDING_STAGES.indexOf('drip')).toBeLessThan(ONBOARDING_STAGES.indexOf('register'))
    expect(ONBOARDING_STAGES.indexOf('deploy')).toBeLessThan(ONBOARDING_STAGES.indexOf('register'))
  })

  // The titles live in `STAGE_TITLES` so one stage cannot be spelled two ways. If a rung is ever
  // added without a title, this fails rather than rendering `undefined` in the ladder.
  it('every rung has a title in the one shared table', () => {
    for (const stage of ONBOARDING_STAGES) {
      expect(STAGE_TITLES[stage], `no title for ${stage}`).toBeTruthy()
    }
  })

  it('every rung has a note, and none of them promises a duration', () => {
    for (const stage of ONBOARDING_STAGES) {
      const note = ONBOARDING_STAGE_NOTES[stage]
      expect(note, `no note for ${stage}`).toBeTruthy()
      expect(note).not.toMatch(/\bseconds?\b|\bminutes?\b|\bfast\b|\bquick(ly)?\b/i)
    }
  })

  // The drip's note is where "9.6 STRK" would land if anybody ported the prototype literally.
  it('bakes no STRK amount into the drip note', () => {
    expect(ONBOARDING_STAGE_NOTES.drip).not.toMatch(/\d/)
  })
})

describe('the fee note under Create', () => {
  it('renders whatever fee it is given', () => {
    expect(createFeeNote('6.0')).toContain('6.0 STRK registration fee')
    expect(createFeeNote('7.25')).toContain('7.25 STRK registration fee')
  })

  // The read can fail. Losing the number is the honest answer; a fallback figure would be a
  // hardcoded fee wearing a disguise.
  it('omits the amount entirely when the chain could not be asked', () => {
    const note = createFeeNote(null)
    expect(note).toContain('the pool’s registration fee')
    expect(note).not.toMatch(/\d/)
  })

  // The self-funding door, named UP FRONT rather than sprung at the moment the faucet refuses.
  // This is what keeps the six-to-two collapse from having silently deleted `f339cbf`'s path.
  it('names the self-funding door before anything is pressed', () => {
    expect(createFeeNote('6.0')).toContain('fund the account yourself')
    expect(createFeeNote(null)).toContain('the address is on this screen')
  })

  //
  // THE FAUCET GIVES ONCE. This is a commitment made to somebody who has not spent anything yet,
  // which makes it the most expensive kind of copy to get wrong — so it is pinned rather than
  // trusted. An earlier draft promised "if the faucet is dry, the fee is covered for you instead",
  // which was never true of this product.
  //
  it('promises no sponsor, anywhere, in either direction', () => {
    for (const note of [createFeeNote('6.0'), createFeeNote(null), fundRefused('Dry.')]) {
      expect(note.toLowerCase()).not.toContain('sponsor')
      expect(note.toLowerCase()).not.toContain('covered for you')
      expect(note.toLowerCase()).not.toContain('never a locked door')
    }
  })

  it('says the drip is once and bounded', () => {
    expect(createFeeNote('6.0')).toContain('gives once')
    expect(createFeeNote('6.0')).toContain('the account pays its own way')
  })

  // A refusal is a real refusal. It must point somewhere the user can actually go.
  it('points a refused drip at the user’s own wallet', () => {
    const refused = fundRefused('The faucet is empty.')
    expect(refused).toContain('The faucet is empty.')
    expect(refused).toContain('Fund the account yourself')
    expect(refused).toContain('notices when it lands')
  })

  it('names no duration', () => {
    expect(createFeeNote('6.0')).not.toMatch(/\bseconds?\b|\bminutes?\b|\bfast\b|\bquick(ly)?\b/i)
  })
})

describe('public and private are never blurred', () => {
  // One of these accounts is findable by strangers and the other is not. A single sentence would
  // have to be vague enough to cover both, and vagueness about what is public is the one thing
  // this product cannot afford.
  it('says different things about a claimed and an unclaimed name', () => {
    expect(namePreview('mira', true)).toContain('anyone can pay you by typing it')
    expect(namePreview('mira', false)).toContain('a private label')
    expect(namePreview('mira', true)).not.toEqual(namePreview('mira', false))
  })

  it('carries the name into both', () => {
    expect(namePreview('mira', true)).toContain('@mira')
    expect(namePreview('mira', false)).toContain('@mira')
  })

  it('says different things on arrival too', () => {
    expect(doneSub(true)).toContain('Anyone can now find this address by that name')
    expect(doneSub(false)).toContain('The name stays local to this browser')
  })

  // Both arrival sentences point at the history rows, because that is where the evidence is.
  it('points at the receipts either way', () => {
    for (const claimed of [true, false]) {
      expect(doneSub(claimed)).toContain('first two rows of your history')
    }
  })

  it('makes the name the subject of the arrival title', () => {
    expect(doneTitle('mira')).toBe('@mira is yours')
  })
})
