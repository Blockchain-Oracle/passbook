import { describe, it, expect, vi } from 'vitest'

vi.mock('../src/pool.js', () => ({ getPublicKey: vi.fn() }))
const { getPublicKey } = await import('../src/pool.js')
const {
  buildInviteLink,
  CLAIMANT_TOKEN_MAX_LENGTH,
  CLAIMANT_TOKEN_MIN_LENGTH,
  claimInvite,
  isAcceptableClaimant,
  mintClaimantToken,
  INVITE_ALPHABET,
  INVITE_COMPOSER,
  inviteAlreadyUsedNotice,
  inviteeRow,
  inviteEndpoint,
  inviteExhaustedRow,
  inviteLadderRow,
  inviteMenuRow,
  inviteMoneyAttached,
  inviteMoneyWaiting,
  inviteShareText,
  inviteStatus,
  INVITE_MAX_WATCH_ROUNDS,
  INVITE_POLL_INTERVAL_MS,
  mintInvite,
  normalizeInviteCode,
  parseInviteLink,
  pollInviteSettlement,
  watchInviteSettlement,
} = await import('../src/invite.js')
const { INVITE_ALREADY_USED_NOTICE, inviteExhaustedNotice } = await import('../src/relayer-wire.js')

const RELAYER = '/api/submit'
const ORIGIN = 'https://app.example'
const CODE = '7f3a2b'

/** A fetch that answers one canned response and records what it was asked. */
function fetchOnce(status: number, body: unknown) {
  const calls: { url: string; body: unknown }[] = []
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? 'null')) })
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  })
  return { impl: impl as unknown as typeof fetch, calls }
}

describe('the link (I/O matrix: link parse)', () => {
  it('builds against the origin it is given, never a compiled-in host', () => {
    expect(buildInviteLink(CODE, ORIGIN)).toBe('https://app.example/i/7f3a2b')
    expect(buildInviteLink(CODE, 'https://app.example/')).toBe('https://app.example/i/7f3a2b')
    expect(buildInviteLink('7F3A2B', ORIGIN)).toBe('https://app.example/i/7f3a2b')
  })

  it('refuses to build a link for something that is not a code', () => {
    expect(() => buildInviteLink('nope', ORIGIN)).toThrow(/not an invite code/)
  })

  it('refuses an origin that is not an absolute http(s) origin', () => {
    // What comes out of here is pasted into a message and sent to a real person. A bare host or
    // a relative path builds a string that LOOKS like a link and resolves nowhere — and it fails
    // in the invitee's messaging app rather than in ours, where nobody can see it.
    for (const origin of ['', '  ', 'app.example', '/i', 'not a url', 'ftp://app.example']) {
      expect(() => buildInviteLink(CODE, origin), JSON.stringify(origin)).toThrow(/refusing to build a link/)
    }
  })

  it('strips any path, query or fragment that rode along with the origin', () => {
    // `URL.origin` is doing the work, so the shape stays exactly <origin>/i/<code>.
    expect(buildInviteLink(CODE, 'https://app.example/some/path?a=1#x')).toBe('https://app.example/i/7f3a2b')
    expect(buildInviteLink(CODE, 'http://localhost:5173')).toBe('http://localhost:5173/i/7f3a2b')
  })

  it('extracts the code from a whole link and from a bare code', () => {
    expect(parseInviteLink('https://app.example/i/7f3a2b')).toBe(CODE)
    expect(parseInviteLink(CODE)).toBe(CODE)
    expect(parseInviteLink('  7F3A2B ')).toBe(CODE)
    expect(parseInviteLink('/i/7f3a2b')).toBe(CODE)
    // A query string or fragment cannot smuggle characters into the code.
    expect(parseInviteLink('https://app.example/i/7f3a2b?utm=x#top')).toBe(CODE)
  })

  it('is null for anything else, including a near miss', () => {
    for (const input of [
      'https://app.example/invite/7f3a2b',
      'https://app.example/i/7f3a2bc',
      'https://app.example/i/7f3a2o',
      'https://app.example/i/',
      'https://app.example/',
      '',
      'not a link at all',
    ]) {
      expect(parseInviteLink(input), input).toBeNull()
    }
  })

  it('mirrors the relayer alphabet exactly, so a link parses the same on both sides', () => {
    expect(INVITE_ALPHABET).toBe('0123456789abcdefghjkmnpqrstvwxyz')
    expect(normalizeInviteCode('7f3a2i')).toBeNull()
  })
})

describe('the endpoints', () => {
  it('derives each leaf from the relayer submit URL', () => {
    expect(inviteEndpoint('/api/submit', 'mint')).toBe('/api/invite/mint')
    expect(inviteEndpoint('https://r.example/submit', 'claim')).toBe('https://r.example/invite/claim')
    expect(inviteEndpoint('/api/submit', 'status')).toBe('/api/invite/status')
  })

  it('refuses to improvise from a URL that is not a submit endpoint', () => {
    // Including the near miss: a trailing slash means the replace is a no-op, and improvising
    // would POST an invite body at the submit path instead of failing where somebody can see it.
    for (const url of ['/api/something', '/api/submit/', 'https://r.example/submit/', '/submitx']) {
      expect(() => inviteEndpoint(url, 'mint'), url).toThrow(/does not end in \/submit/)
    }
  })
})

describe('mintInvite', () => {
  it('posts an EMPTY body and returns the numbers the row renders', async () => {
    const f = fetchOnce(200, { code: CODE, expiresAt: 1000, left: 2, nextInHours: 19 })
    const r = await mintInvite(RELAYER, { fetch: f.impl })
    expect(r).toEqual({ ok: true, value: { code: CODE, expiresAt: 1000, left: 2, nextInHours: 19 } })
    // The inviter is never named by the caller: that would make the allowance the caller's to pick.
    expect(f.calls[0]).toEqual({ url: '/api/invite/mint', body: {} })
  })

  it('carries the relayer refusal, its reason, its notice AND its numbers', async () => {
    // The numbers matter as much as the sentence: the exhausted Door B row renders `left` and
    // `nextInHours`, and the server is the only party that can compute either. Dropping them
    // here would leave the row with nothing to say, which is the locked door this feature
    // refuses to be.
    const notice = inviteExhaustedNotice(19)
    const f = fetchOnce(429, { reason: 'invite-allowance-exhausted', left: 0, nextInHours: 19, notice })
    const r = await mintInvite(RELAYER, { fetch: f.impl })
    expect(r).toEqual({
      ok: false,
      failure: {
        kind: 'refused',
        status: 429,
        reason: 'invite-allowance-exhausted',
        notice,
        error: undefined,
        left: 0,
        nextInHours: 19,
      },
    })
  })

  it('carries the GLOBAL mint-cap refusal as its own reason, not as the per-inviter one', async () => {
    // Two different facts: "you have used yours" and "the relayer has used everyone's".
    const notice = inviteExhaustedNotice(3)
    const f = fetchOnce(429, { reason: 'invite-mint-daily-cap', left: 0, nextInHours: 3, notice })
    const r = await mintInvite(RELAYER, { fetch: f.impl })
    expect(!r.ok && r.failure).toMatchObject({ reason: 'invite-mint-daily-cap', nextInHours: 3, notice })
  })

  it('treats a 200 with no usable code as an unreadable relayer, never as a mint', async () => {
    for (const body of [{}, { code: 'nope' }, { code: 42 }]) {
      const f = fetchOnce(200, body)
      const r = await mintInvite(RELAYER, { fetch: f.impl })
      expect(r.ok, JSON.stringify(body)).toBe(false)
      expect(!r.ok && r.failure.kind).toBe('relayer-unreadable')
    }
  })

  it('holds EVERY field of a 200 to that standard, rather than coercing a missing one', async () => {
    // Coercing is how a broken relayer produces a confidently wrong screen: a missing
    // `expiresAt` defaulted to 0 renders an invite that expired in 1970, and a missing `left`
    // defaulted to 0 renders `No invites left` to somebody who has three. Neither is
    // recoverable by the user and both look like our bug.
    const ok = { code: CODE, expiresAt: 1000, left: 2, nextInHours: 19 }
    for (const bad of [
      { ...ok, expiresAt: undefined },
      { ...ok, expiresAt: 'soon' },
      { ...ok, expiresAt: null },
      { ...ok, left: undefined },
      { ...ok, left: 'lots' },
      { ...ok, left: -1 },
      { ...ok, left: 1.5 },
      { ...ok, nextInHours: 'later' },
    ]) {
      const f = fetchOnce(200, bad)
      const r = await mintInvite(RELAYER, { fetch: f.impl })
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      expect(!r.ok && r.failure.kind, JSON.stringify(bad)).toBe('relayer-unreadable')
    }
  })

  it('accepts nextInHours of null — "nothing is pending" is a real answer, not a missing one', async () => {
    const f = fetchOnce(200, { code: CODE, expiresAt: 1000, left: 2, nextInHours: null })
    const r = await mintInvite(RELAYER, { fetch: f.impl })
    expect(r).toEqual({ ok: true, value: { code: CODE, expiresAt: 1000, left: 2, nextInHours: null } })
  })

  it('accepts left of 0 with a clock — the last mint is not a locked door', async () => {
    const f = fetchOnce(200, { code: CODE, expiresAt: 1000, left: 0, nextInHours: 24 })
    const r = await mintInvite(RELAYER, { fetch: f.impl })
    expect(r.ok && r.value).toMatchObject({ left: 0, nextInHours: 24 })
    expect(inviteMenuRow(0, 24)).toBe('Invite · 0 left · 1 more in 24h')
  })

  it('reports an unreachable relayer as its own thing — nothing was minted', async () => {
    const impl = (async () => {
      throw new Error('fetch failed')
    }) as unknown as typeof fetch
    const r = await mintInvite(RELAYER, { fetch: impl })
    expect(!r.ok && r.failure).toMatchObject({ kind: 'relayer-unreachable' })
  })

  it('reports a non-JSON answer as unreadable rather than as a refusal', async () => {
    const impl = (async () => new Response('<html>502</html>', { status: 200 })) as unknown as typeof fetch
    const r = await mintInvite(RELAYER, { fetch: impl })
    expect(!r.ok && r.failure.kind).toBe('relayer-unreadable')
  })
})

describe('claimInvite and inviteStatus', () => {
  it('claims a normalised code', async () => {
    const f = fetchOnce(200, { claimed: true })
    expect(await claimInvite('7F3A2B', RELAYER, { fetch: f.impl })).toEqual({ ok: true, value: true })
    // No claimant offered: the body is exactly what it was before the parameter existed.
    expect(f.calls[0]).toEqual({ url: '/api/invite/claim', body: { code: CODE } })
  })

  it('carries a claimant token when one is offered', async () => {
    const f = fetchOnce(200, { claimed: true })
    const token = mintClaimantToken()
    await claimInvite(CODE, RELAYER, { fetch: f.impl }, token)
    expect(f.calls[0]!.body).toEqual({ code: CODE, claimant: token })
  })

  it('refuses a malformed claimant LOCALLY, before any request exists', async () => {
    // A token the relayer would reject on sight costs a round-trip and a 400 to discover.
    const tooShort = 'abc'
    const tooLong = 'a'.repeat(CLAIMANT_TOKEN_MAX_LENGTH + 1)
    for (const bad of [tooShort, tooLong, '']) {
      const f = fetchOnce(200, { claimed: true })
      const r = await claimInvite(CODE, RELAYER, { fetch: f.impl }, bad)
      expect(r.ok, JSON.stringify(bad)).toBe(false)
      // ITS OWN KIND. The code was fine; the token is the app's to mint and the user cannot act
      // on it, so calling this a bad code would send somebody to re-read a link that was correct.
      expect(!r.ok && r.failure.kind).toBe('invalid-claimant')
      expect(f.calls).toHaveLength(0)
    }
  })

  it('mints claimant tokens that are random, long enough, and derived from nothing', () => {
    const tokens = Array.from({ length: 500 }, () => mintClaimantToken())
    for (const t of tokens) {
      expect(t).toMatch(/^[0-9a-f]{32}$/)
      expect(isAcceptableClaimant(t)).toBe(true)
      expect(t.length).toBeGreaterThanOrEqual(CLAIMANT_TOKEN_MIN_LENGTH)
      expect(t.length).toBeLessThanOrEqual(CLAIMANT_TOKEN_MAX_LENGTH)
    }
    // 128 bits: 500 draws collide never. A token an observer can predict is one they can use to
    // inherit somebody else's burn.
    expect(new Set(tokens).size).toBe(500)
    // And it is not the invite code, the URL, or anything else in scope at the call site.
    expect(tokens[0]).not.toContain(CODE)
  })

  it('agrees with the wire on what a usable token is', () => {
    expect(isAcceptableClaimant('a'.repeat(CLAIMANT_TOKEN_MIN_LENGTH))).toBe(true)
    expect(isAcceptableClaimant('a'.repeat(CLAIMANT_TOKEN_MAX_LENGTH))).toBe(true)
    expect(isAcceptableClaimant('a'.repeat(CLAIMANT_TOKEN_MIN_LENGTH - 1))).toBe(false)
    expect(isAcceptableClaimant('a'.repeat(CLAIMANT_TOKEN_MAX_LENGTH + 1))).toBe(false)
    expect(isAcceptableClaimant(undefined)).toBe(false)
    expect(isAcceptableClaimant(12345678)).toBe(false)
  })

  it('carries the double-claim refusal with the notice the relayer sent', async () => {
    const f = fetchOnce(409, { reason: 'invite-already-used', notice: INVITE_ALREADY_USED_NOTICE })
    const r = await claimInvite(CODE, RELAYER, { fetch: f.impl })
    expect(!r.ok && r.failure).toMatchObject({
      kind: 'refused', status: 409, reason: 'invite-already-used', notice: INVITE_ALREADY_USED_NOTICE,
    })
  })

  it('refuses a malformed code LOCALLY, without spending a claim attempt', async () => {
    const f = fetchOnce(200, { claimed: true })
    const r = await claimInvite('nope', RELAYER, { fetch: f.impl })
    expect(r.ok).toBe(false)
    expect(f.calls).toHaveLength(0)
  })

  it('reports a local shape refusal as invalid-code, NEVER as a fabricated server reason', async () => {
    // Whether a code exists is a fact only the ledger can assert. Borrowing `invite-not-found`
    // for a shape check tells the surface "this invite is gone" when the truth is "check what
    // you pasted" — two different sentences with two different next actions.
    for (const call of [claimInvite, inviteStatus]) {
      const f = fetchOnce(200, {})
      const r = await call('nope', RELAYER, { fetch: f.impl })
      expect(r.ok).toBe(false)
      expect(!r.ok && r.failure.kind).toBe('invalid-code')
      expect(!r.ok && r.failure.kind === 'invalid-code' && r.failure.reason).toMatch(/not an invite code/)
      expect(f.calls).toHaveLength(0)
    }
  })

  it('reads the three states back and refuses a fourth', async () => {
    for (const state of ['unclaimed', 'claimed', 'expired'] as const) {
      const f = fetchOnce(200, { state })
      expect(await inviteStatus(CODE, RELAYER, { fetch: f.impl })).toEqual({ ok: true, value: state })
    }
    const bad = fetchOnce(200, { state: 'consumed' })
    const r = await inviteStatus(CODE, RELAYER, { fetch: bad.impl })
    expect(!r.ok && r.failure.kind).toBe('relayer-unreadable')
  })
})

describe('the copy', () => {
  it('renders the Door B row from the numbers the server returned', () => {
    expect(inviteMenuRow(3, 19)).toBe('Invite · 3 left · 1 more in 19h')
    // Nothing pending: the second clause is DROPPED rather than rendered as "1 more in 0h".
    expect(inviteMenuRow(3, null)).toBe('Invite · 3 left')
  })

  it('renders the exhausted refusal, singular included', () => {
    expect(inviteExhaustedRow(19)).toBe('No invites left. One returns in 19 hours.')
    expect(inviteExhaustedRow(1)).toBe('No invites left. One returns in 1 hour.')
  })

  it('renders the composer and its take-back promise', () => {
    expect(INVITE_COMPOSER.message).toBe(
      'They cannot receive private funds until they register. This invite pays their registration.',
    )
    expect(INVITE_COMPOSER.attachedAmount).toBe(
      'Held as your intent until they claim it. ' +
        'Take it back any time — taking it back is free, because nothing has moved yet.',
    )
  })

  it('renders the share text against a link, with the app name as a parameter', () => {
    expect(inviteShareText('Passbook', buildInviteLink(CODE, ORIGIN))).toBe(
      'I set up an account for you on Passbook. It is already paid for. https://app.example/i/7f3a2b',
    )
  })

  it('renders the invitee row WITHOUT a figure when no measured cost is passed', () => {
    // Story 1.13's ship gate: until one sponsored registration is banked on mainnet and
    // measured, the sentence renders without a price. No literal exists to un-ban later.
    expect(inviteeRow('abu')).toBe(
      'abu invited you. Creating an account costs one Starknet transaction. abu\'s invite covers it once.',
    )
  })

  it('renders the measured cost when the caller has one', () => {
    expect(inviteeRow('abu', '$0.30')).toBe(
      'abu invited you. Creating an account costs one Starknet transaction, about $0.30. ' +
        "abu's invite covers it once.",
    )
  })

  it('renders the attached-money lines, naming the dependency rather than hiding it', () => {
    expect(inviteMoneyAttached('abu', '25.00', 'USDC')).toBe('abu also sent you 25.00 USDC. It is waiting for you.')
    expect(inviteMoneyWaiting('abu', '25.00', 'USDC')).toBe(
      "abu is sending you 25.00 USDC. It lands once abu's app is open.",
    )
  })

  it('names the inviter in the double-claim line only where a name is honestly known', () => {
    // The relayer cannot know that abu is abu, so its constant names nobody.
    expect(INVITE_ALREADY_USED_NOTICE).not.toContain('abu')
    expect(inviteAlreadyUsedNotice('abu')).toBe(
      'This invite was already used. abu can send another, or you can create an account from a funded wallet.',
    )
  })

  it('renders every ladder row', () => {
    expect(inviteLadderRow(CODE, 'not-opened')).toBe('Invite 7f3a2b · not opened')
    expect(inviteLadderRow(CODE, 'opened-not-registered')).toBe('Invite 7f3a2b · opened, not registered')
    expect(inviteLadderRow(CODE, 'ready-to-settle', 'mia')).toBe('you → mia · registered')
    expect(inviteLadderRow(CODE, 'expired')).toBe('Invite expired. Nothing had moved.')
    expect(inviteLadderRow(CODE, 'revoked')).toBe('Invite 7f3a2b · taken back. Nothing had moved.')
  })
})

describe('the watcher (I/O matrix: watcher rows)', () => {
  const intent = { code: CODE, recipient: '0xmia' }

  it('reports not-opened while the code is unclaimed, without reading the chain', async () => {
    const f = fetchOnce(200, { state: 'unclaimed' })
    expect(await pollInviteSettlement(intent, RELAYER, { fetch: f.impl })).toEqual({ state: 'not-opened' })
    expect(getPublicKey).not.toHaveBeenCalled()
  })

  it('reports opened-not-registered while the invitee has no key yet', async () => {
    const f = fetchOnce(200, { state: 'claimed' })
    const readPublicKey = vi.fn(async () => 0n)
    expect(await pollInviteSettlement(intent, RELAYER, { fetch: f.impl, readPublicKey }))
      .toEqual({ state: 'opened-not-registered' })
  })

  it('reports ready-to-settle once get_public_key is non-zero', async () => {
    const f = fetchOnce(200, { state: 'claimed' })
    const readPublicKey = vi.fn(async () => 0x1234n)
    expect(await pollInviteSettlement(intent, RELAYER, { fetch: f.impl, readPublicKey }))
      .toEqual({ state: 'ready-to-settle' })
  })

  it('FAILS CLOSED on an RPC error — blocked-rpc-unknown, never registered', async () => {
    const f = fetchOnce(200, { state: 'claimed' })
    const readPublicKey = vi.fn(async () => {
      throw new Error('all RPC hosts failed')
    })
    const r = await pollInviteSettlement(intent, RELAYER, { fetch: f.impl, readPublicKey })
    expect(r.state).toBe('blocked-rpc-unknown')
    expect(r.state === 'blocked-rpc-unknown' && r.reason).toMatch(/RPC/)
  })

  it('FAILS CLOSED on an unreachable relayer too, rather than reading it as not-opened', async () => {
    const impl = (async () => {
      throw new Error('fetch failed')
    }) as unknown as typeof fetch
    expect((await pollInviteSettlement(intent, RELAYER, { fetch: impl })).state).toBe('blocked-rpc-unknown')
  })

  it('reads an expired code, and a code the ledger has forgotten, as expired', async () => {
    const expired = fetchOnce(200, { state: 'expired' })
    expect(await pollInviteSettlement(intent, RELAYER, { fetch: expired.impl })).toEqual({ state: 'expired' })
    const gone = fetchOnce(404, { reason: 'invite-not-found' })
    expect(await pollInviteSettlement(intent, RELAYER, { fetch: gone.impl })).toEqual({ state: 'expired' })
  })

  it('stops at opened-not-registered for a Door B intent with no address to check', async () => {
    const f = fetchOnce(200, { state: 'claimed' })
    const r = await pollInviteSettlement({ code: CODE }, RELAYER, { fetch: f.impl })
    expect(r).toEqual({ state: 'opened-not-registered' })
    expect(getPublicKey).not.toHaveBeenCalled()
  })

  it('never re-polls a revoked or settled intent', async () => {
    const f = fetchOnce(200, { state: 'claimed' })
    expect(await pollInviteSettlement({ ...intent, state: 'revoked' }, RELAYER, { fetch: f.impl }))
      .toEqual({ state: 'revoked' })
    expect(await pollInviteSettlement({ ...intent, state: 'settled' }, RELAYER, { fetch: f.impl }))
      .toEqual({ state: 'settled' })
    expect(f.calls).toHaveLength(0)
  })

  it('keeps polling through blocked-rpc-unknown and stops at ready-to-settle', async () => {
    const answers = [
      { status: 200, body: { state: 'unclaimed' } },
      { status: 502, body: {} },                       // a blip: not an answer
      { status: 200, body: { state: 'claimed' } },
    ]
    let n = 0
    const impl = (async () => {
      const a = answers[Math.min(n++, answers.length - 1)]!
      return new Response(JSON.stringify(a.body), { status: a.status })
    }) as unknown as typeof fetch

    const seen: string[] = []
    const r = await watchInviteSettlement(intent, RELAYER, {
      fetch: impl,
      readPublicKey: async () => 0x99n,
      sleep: async () => {},
      onOutcome: (o) => seen.push(o.state),
      maxRounds: 10,
    })
    expect(seen).toEqual(['not-opened', 'blocked-rpc-unknown', 'ready-to-settle'])
    expect(r).toEqual({ state: 'ready-to-settle' })
  })

  it('gives up after a FINITE default, and says so rather than reporting a conclusion', async () => {
    // The bound is for the forgotten tab. An infinite default would have documented a bound
    // while shipping none — polling a dead invite every fifteen seconds for as long as the
    // browser lives.
    expect(INVITE_MAX_WATCH_ROUNDS).toBe(5760)                       // 24h at the 15s default
    expect(INVITE_MAX_WATCH_ROUNDS * INVITE_POLL_INTERVAL_MS).toBe(24 * 3_600_000)

    let rounds = 0
    const impl = (async () => {
      rounds++
      return new Response(JSON.stringify({ state: 'unclaimed' }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await watchInviteSettlement(intent, RELAYER, {
      fetch: impl,
      sleep: async () => {},
      maxRounds: 3,
    })
    expect(rounds).toBe(3)
    // NOT `not-opened`: "we stopped looking" must not be readable as "it never opened", because
    // the invite may well have moved since.
    expect(r).toEqual({ state: 'gave-up-watching', rounds: 3, last: 'not-opened' })
  })

  it('stops when the caller aborts', async () => {
    const controller = new AbortController()
    let rounds = 0
    const impl = (async () => {
      rounds++
      controller.abort()
      return new Response(JSON.stringify({ state: 'unclaimed' }), { status: 200 })
    }) as unknown as typeof fetch
    await watchInviteSettlement(intent, RELAYER, { fetch: impl, sleep: async () => {}, signal: controller.signal })
    expect(rounds).toBe(1)
  })

  it('ignores an observer that throws — a watcher is not a vote', async () => {
    const f = fetchOnce(200, { state: 'expired' })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await watchInviteSettlement(intent, RELAYER, {
      fetch: f.impl,
      sleep: async () => {},
      onOutcome: () => {
        throw new Error('component unmounted')
      },
    })
    expect(r).toEqual({ state: 'expired' })
    warn.mockRestore()
  })

  it('makes no paid call anywhere: settlement is the sender own send, not this module', async () => {
    // There is no export here that signs, proves or submits. If one ever appears, this fails.
    const invite = await import('../src/invite.js')
    for (const name of Object.keys(invite)) {
      expect(name, name).not.toMatch(/^(settle|send|submit|prove|open)/i)
    }
  })
})
