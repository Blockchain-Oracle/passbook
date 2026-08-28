//
// The Markets and Launch sentences, byte-exact (Wave 3).
//
// The two properties worth testing here are the ones a screenshot cannot show: that the empty
// states say the contracts are NOT DEPLOYED rather than implying an empty market, and that no
// sentence widens the privacy claim past "who" into "how much".
//
import { describe, it, expect } from 'vitest'

import * as copy from '../src/markets-copy.js'
import { FORBIDDEN_CLAIMS } from '../src/forbidden-claims.js'

describe('the empty states name what is missing and what would fill it', () => {
  it('the markets empty state says the contract is not deployed, and what IS live', () => {
    expect(copy.MARKETS_NOT_DEPLOYED).toBe(
      'No markets yet. The contract is written and tested but not deployed, so there is nothing ' +
        'to bet on until it lands — the prices above are live from the same oracle a market will ' +
        'settle against.',
    )
    // The distinction a reader needs: "this is a mockup" versus "this is waiting on a
    // transaction". The sentence has to carry the checkable half.
    expect(copy.MARKETS_NOT_DEPLOYED).toMatch(/not deployed/)
    expect(copy.MARKETS_NOT_DEPLOYED).toMatch(/prices above are live/)
  })

  it('not-deployed and none-open are different facts with different sentences', () => {
    // "Be the first to create one" was the review's exact complaint: people come to bet, not to
    // found markets. The empty board now names the automation and keeps creation as a besides.
    expect(copy.MARKETS_NONE_OPEN).toBe(
      'Between windows — the Groundskeeper opens the next standing markets shortly. Anyone can ' +
        'open their own besides, and the first bet in it sets the odds.',
    )
    expect(copy.MARKETS_NONE_OPEN).not.toBe(copy.MARKETS_NOT_DEPLOYED)
    expect(copy.LAUNCH_NOT_DEPLOYED).not.toBe(copy.LAUNCH_NONE_OPEN)
    // A deployed-but-empty registry must not claim the contract is missing, and vice versa.
    expect(copy.MARKETS_NONE_OPEN).not.toMatch(/deployed/)
  })

  it('the launch empty state does the same', () => {
    expect(copy.LAUNCH_NOT_DEPLOYED).toBe(
      'No launches yet. The contract is written and tested but not deployed, so nothing can be ' +
        'created until it lands.',
    )
    expect(copy.LAUNCH_NONE_OPEN).toBe(
      'No launches are open right now. Anyone can start one, and it graduates when it fills.',
    )
  })
})

describe('the privacy claim is about WHO, never about how much', () => {
  it('both standing lines say the size is public and the account is not', () => {
    expect(copy.MARKETS_STANDING_LINE).toBe(
      'Take a side on where a price ends up. The size you bet and the odds you move are public; ' +
        'which account placed the bet is not.',
    )
    expect(copy.LAUNCH_STANDING_LINE).toBe(
      'Buy into a token as it is being sold. The price and the progress are public; who is buying ' +
        'is not.',
    )
    // The sponsor's own rule: claim identity privacy, never amount privacy.
    expect(copy.MARKETS_STANDING_LINE).toMatch(/public/)
    expect(copy.LAUNCH_STANDING_LINE).toMatch(/public/)
  })

  it('the crowd sentence treats the denomination as a choice, not a statistic', () => {
    expect(copy.DENOMINATION_CROWD).toBe(
      'Bets hide in the crowd at their own size. Pick one others are using and you are one of ' +
        'many; pick a size nobody else has and the amount alone points back at you.',
    )
    expect(copy.DENOMINATION_ALONE).toBe(
      'Nobody else is at this size yet, so this bet would be identifiable by its amount.',
    )
    // FR-009 as copy: being alone at a size is the thing that identifies you.
    expect(copy.DENOMINATION_ALONE).toMatch(/identifiable/)
  })

  it('the launch hides the buyer without claiming the price is hidden', () => {
    expect(copy.LAUNCH_BUYER_HIDDEN).toBe(
      'Buys arrive as withdrawals from the pool, so the launch records no buyer address. The ' +
        'price action is fully visible; the buyers are not.',
    )
    expect(copy.LAUNCH_BUYER_HIDDEN).toMatch(/fully visible/)
    // The banned absolute, caught by the forbidden-claims sweep on the first draft of this very
    // sentence: the address DOES appear, on the deposit and on any public withdrawal. This
    // contract simply never records it.
    expect(copy.LAUNCH_BUYER_HIDDEN).not.toMatch(/never appears/)
  })
})

describe('the two contract facts a user acts on', () => {
  it('the odds lock at bet time — the FPMM property, said plainly', () => {
    expect(copy.BET_PRICE_LOCKS).toBe(
      'The odds you see are the odds you get — the price is fixed the moment the bet lands, not ' +
        'averaged out at the end.',
    )
  })

  it('being first inside an epoch is worth nothing, in those terms', () => {
    expect(copy.LAUNCH_EPOCH_FACT).toBe(
      'Everyone in the same epoch pays the same price, so being first inside one is worth ' +
        'nothing. The price steps up when the epoch does.',
    )
    // Every other launch mechanism a reader has met rewards racing. This one does not, and the
    // sentence has to say so in the words that contradict the expectation.
    expect(copy.LAUNCH_EPOCH_FACT).toMatch(/worth nothing/)
  })
})

describe('the claim linkability choice is offered, not decided', () => {
  it('both options state their real cost, and neither is sold as safe', () => {
    expect(copy.CLAIM_TOGETHER_LABEL).toBe('Collect together — one transaction')
    expect(copy.CLAIM_TOGETHER_DETAIL).toBe(
      'Cheaper: one proof and one fee for all of them. It also shows that these positions belong ' +
        'to the same person, because they are collected in one transaction.',
    )
    expect(copy.CLAIM_SEPARATELY_LABEL).toBe('Collect one at a time')
    expect(copy.CLAIM_SEPARATELY_DETAIL).toBe(
      'Costs a fee per position and keeps them unlinked, because nothing on chain ties one ' +
        'collection to the next.',
    )
    // The cheap option must state its disclosure and the private option must state its cost —
    // otherwise the product has chosen for the user while appearing to ask.
    expect(copy.CLAIM_TOGETHER_DETAIL).toMatch(/same person/)
    expect(copy.CLAIM_SEPARATELY_DETAIL).toMatch(/fee per position/)
  })

  it('the position secret is described as money, because it is', () => {
    expect(copy.POSITION_SECRETS_ARE_MONEY).toBe(
      'A position is held by a secret in this browser, not by your address — that is what keeps ' +
        'the bet from naming you. It is also the only way to collect, so it is worth backing up.',
    )
  })
})

describe('the price strip never implies more than it has', () => {
  it('names the oracle and ties it to settlement', () => {
    expect(copy.PRICE_STRIP_SOURCE).toBe(
      'Live from Pragma — the same oracle these markets resolve against.',
    )
  })

  it('has a stale state at all, because the feed genuinely stalls', () => {
    expect(copy.PRICE_STALE).toBe('Not updated recently')
  })

  it('names the dashed line as an observation, never as a strike somebody set', () => {
    expect(copy.CHART_REFERENCE_IS_WINDOW_OPEN).toBe(
      'The dashed line is the first price of the drawn window — green above it, red below. A market ' +
        'puts its own level there instead.',
    )
    // A dashed line on a price chart reads as a target. Absent a market there is no target, so
    // the sentence has to say what it actually is.
    expect(copy.CHART_REFERENCE_IS_WINDOW_OPEN).toMatch(/first price of the drawn window/)
  })

  it('refuses to call the witnessed line a market history, and names its narrow arm', () => {
    // The relay feed gave the line a real past (M1) — the sentence grew to carry it, and the two
    // claims that must survive any rewording are pinned: it is STILL not a market history, and a
    // dead feed makes the line shorter rather than silently thinner.
    expect(copy.PRICE_SERIES_PROVENANCE).toMatch(/not a market history/)
    expect(copy.PRICE_SERIES_PROVENANCE).toMatch(/what the relay has witnessed/)
    expect(copy.PRICE_SERIES_PROVENANCE).toMatch(/getting shorter/)
  })
})

describe('nothing here states a claim this protocol cannot keep', () => {
  it('no forbidden claim appears in any exported sentence', () => {
    // "amounts are private" is the one this surface would walk into: every leg touching an open
    // note is public, and a bet is exactly such a leg.
    const sentences = Object.values(copy).filter((v): v is string => typeof v === 'string')
    expect(sentences.length).toBeGreaterThan(25)
    for (const sentence of sentences) {
      for (const claim of FORBIDDEN_CLAIMS) {
        expect(sentence.toLowerCase()).not.toContain(claim)
      }
    }
  })
})
