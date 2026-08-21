import { describe, it, expect, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { NET, STRK_TOKEN } from '../../protocol/src/constants.js'
import {
  createRelayerServer,
  resolveHost,
  offHostWarning,
  resolveAllowedOrigins,
  type SubmitCalls,
  type RelayerServerOptions,
} from '../src/server.js'
import { MAX_CALLS_PER_SUBMISSION, APPROVE_FEE_MULTIPLE } from '../src/allowlist.js'

// An allowlisted call, so tests about everything else are not silently blocked by policy.
const A_CALL = { contractAddress: NET.pool, entrypoint: 'apply_actions', calldata: [] }
const ATTACKER = '0x0dead0000000000000000000000000000000000000000000000000000000beef'
const FEE_WEI = 6_000_000_000_000_000_000n
const FEE_CEILING = FEE_WEI * APPROVE_FEE_MULTIPLE
const AN_APPROVE = {
  contractAddress: STRK_TOKEN,
  entrypoint: 'approve',
  calldata: [NET.pool, `0x${FEE_WEI.toString(16)}`, '0x0'],
}

async function start(submit: SubmitCalls, extra: Partial<RelayerServerOptions> = {}) {
  const server = createRelayerServer({
    submit,
    resolveApproveCeiling: async () => FEE_CEILING,
    ...extra,
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function request(
  port: number,
  path: string,
  body: string,
  method = 'POST',
  headers: Record<string, string> = { 'content-type': 'application/json' },
) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers },
      (res) => {
        let data = ''
        res.on('data', (c) => (data += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

describe('relayer server', () => {
  it('returns the submitted transaction hash', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xdeadbeef')
    const s = await start(submit)
    try {
      const res = await request(s.port, '/submit', JSON.stringify({ calls: [A_CALL] }))
      expect(res.status).toBe(200)
      // The shape paymaster.executeTransaction expects back.
      expect(JSON.parse(res.body)).toEqual({ transactionHash: '0xdeadbeef' })
      expect(submit).toHaveBeenCalledWith([A_CALL])
    } finally {
      await s.close()
    }
  })

  it('answers 400 on a malformed body, without submitting anything', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xnope')
    const s = await start(submit)
    try {
      const res = await request(s.port, '/submit', 'not json at all')
      expect(res.status).toBe(400)
      // The important half: a bad request must never reach the signing path.
      expect(submit).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  it('answers 400 rather than 502 on an empty calls array', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xnope')
    const s = await start(submit)
    try {
      const res = await request(s.port, '/api/submit', JSON.stringify({ calls: [] }))
      expect(res.status).toBe(400)
      expect(submit).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  it('answers 502 when the submission itself fails', async () => {
    const submit = vi.fn<SubmitCalls>(async () => {
      throw new Error('sequencer rejected the invoke')
    })
    const s = await start(submit)
    try {
      const res = await request(s.port, '/submit', JSON.stringify({ calls: [A_CALL] }))
      // A chain-side failure is ours, not the caller's — the status has to say so.
      expect(res.status).toBe(502)
      expect(res.body).toMatch(/sequencer rejected/)
    } finally {
      await s.close()
    }
  })

  it('answers 404 on the wrong method or an unknown path', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xnope')
    const s = await start(submit)
    try {
      expect((await request(s.port, '/submit', '', 'GET')).status).toBe(404)
      expect((await request(s.port, '/elsewhere', '{}')).status).toBe(404)
      expect(submit).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  // The relayer signs with a funded key, so the only assertion that matters in these
  // is that submit was NEVER reached. A refusal reported after signing is not a refusal,
  // and a test that checked only the status code would pass against exactly that bug.
  describe('refuses to sign anything outside the allowlist', () => {
    const cases: Array<{ name: string; calls: unknown[] }> = [
      {
        name: 'STRK.transfer — the whole-balance drain',
        calls: [
          {
            contractAddress: STRK_TOKEN,
            entrypoint: 'transfer',
            calldata: [ATTACKER, '0xffffffffffffffff', '0x0'],
          },
        ],
      },
      {
        name: 'STRK.approve to an attacker — the drain with one extra step',
        calls: [
          {
            contractAddress: STRK_TOKEN,
            entrypoint: 'approve',
            calldata: [ATTACKER, '0xffffffffffffffff', '0x0'],
          },
        ],
      },
      {
        name: 'a contract that is not on the list',
        calls: [{ contractAddress: ATTACKER, entrypoint: 'apply_actions', calldata: [] }],
      },
      {
        name: 'a non-submission entrypoint on the pool',
        calls: [{ contractAddress: NET.pool, entrypoint: 'upgrade', calldata: [] }],
      },
      {
        name: 'an implausibly large batch',
        calls: Array.from({ length: MAX_CALLS_PER_SUBMISSION + 1 }, () => A_CALL),
      },
      {
        name: 'one bad call hidden among good ones',
        calls: [
          A_CALL,
          { contractAddress: STRK_TOKEN, entrypoint: 'transfer', calldata: [ATTACKER, '0x1', '0x0'] },
        ],
      },
    ]

    for (const { name, calls } of cases) {
      it(`refuses ${name}, without signing`, async () => {
        const submit = vi.fn<SubmitCalls>(async () => '0xshould-never-happen')
        const s = await start(submit)
        try {
          const res = await request(s.port, '/submit', JSON.stringify({ calls }))
          expect(res.status).toBe(403)
          expect(submit).not.toHaveBeenCalled()
        } finally {
          await s.close()
        }
      })
    }
  })

  // Loopback binds the socket; it does not keep out the operator's own browser, which
  // is already inside that boundary. These are what actually stand between a web page
  // and the funded key, so each asserts the key was never reached.
  describe('refuses what a web page can send', () => {
    // The whole exploit: <form enctype="text/plain"> is a CORS simple request, so no
    // preflight fires. The page cannot read the reply — it does not need to, because
    // the transaction would already be signed.
    it('refuses a cross-origin text/plain form post', async () => {
      const submit = vi.fn<SubmitCalls>(async () => '0xshould-never-happen')
      const s = await start(submit)
      try {
        const body = `{"calls":[{"contractAddress":"${NET.pool}","entrypoint":"apply_actions","calldata":["0x9"]}],"pad":"="}`
        const res = await request(s.port, '/submit', body, 'POST', {
          'content-type': 'text/plain',
          origin: 'https://evil.example',
        })
        expect(res.status).toBe(415)
        expect(submit).not.toHaveBeenCalled()
      } finally {
        await s.close()
      }
    })

    it.each([
      ['text/plain', 415],
      ['application/x-www-form-urlencoded', 415],
      ['multipart/form-data', 415],
      ['', 415],
    ])('refuses content-type %s, the only kinds a form can send', async (ct, expected) => {
      const submit = vi.fn<SubmitCalls>(async () => '0xshould-never-happen')
      const s = await start(submit)
      try {
        const res = await request(
          s.port,
          '/submit',
          JSON.stringify({ calls: [A_CALL] }),
          'POST',
          ct ? { 'content-type': ct } : {},
        )
        expect(res.status).toBe(expected)
        expect(submit).not.toHaveBeenCalled()
      } finally {
        await s.close()
      }
    })

    it('refuses a foreign Origin even with the right content-type', async () => {
      const submit = vi.fn<SubmitCalls>(async () => '0xshould-never-happen')
      const s = await start(submit)
      try {
        const res = await request(s.port, '/submit', JSON.stringify({ calls: [A_CALL] }), 'POST', {
          'content-type': 'application/json',
          origin: 'https://evil.example',
        })
        expect(res.status).toBe(403)
        expect(submit).not.toHaveBeenCalled()
      } finally {
        await s.close()
      }
    })

    it('accepts a configured Origin, so the browser app is not locked out', async () => {
      const submit = vi.fn<SubmitCalls>(async () => '0xok')
      const s = await start(submit, { allowedOrigins: new Set(['https://app.example']) })
      try {
        const res = await request(s.port, '/submit', JSON.stringify({ calls: [A_CALL] }), 'POST', {
          'content-type': 'application/json',
          origin: 'https://app.example',
        })
        expect(res.status).toBe(200)
        expect(submit).toHaveBeenCalled()
      } finally {
        await s.close()
      }
    })

    it('tolerates a charset parameter on the content-type', async () => {
      const submit = vi.fn<SubmitCalls>(async () => '0xok')
      const s = await start(submit)
      try {
        const res = await request(s.port, '/submit', JSON.stringify({ calls: [A_CALL] }), 'POST', {
          'content-type': 'application/json; charset=utf-8',
        })
        expect(res.status).toBe(200)
      } finally {
        await s.close()
      }
    })
  })

  it('refuses to sign when the live fee cannot be read', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xshould-never-happen')
    const s = await start(submit, {
      resolveApproveCeiling: async () => {
        throw new Error('all RPC hosts failed')
      },
    })
    try {
      const res = await request(s.port, '/submit', JSON.stringify({ calls: [AN_APPROVE] }))
      // Without a fee there is no ceiling to check an approve against, so we stop.
      expect(res.status).toBe(503)
      expect(submit).not.toHaveBeenCalled()
    } finally {
      await s.close()
    }
  })

  // Chain availability must not be a precondition for accepting a submission that has
  // nothing to check against a ceiling. Trading a spending risk for an outage is a bad
  // trade when the batch contains no approve at all.
  describe('reads the live fee only when it is needed', () => {
    it('accepts an approve-less batch without consulting the chain', async () => {
      const submit = vi.fn<SubmitCalls>(async () => '0xok')
      const resolveApproveCeiling = vi.fn(async () => {
        throw new Error('RPC is down')
      })
      const s = await start(submit, { resolveApproveCeiling })
      try {
        const res = await request(s.port, '/submit', JSON.stringify({ calls: [A_CALL] }))
        expect(res.status).toBe(200)
        expect(resolveApproveCeiling).not.toHaveBeenCalled()
      } finally {
        await s.close()
      }
    })

    it('consults the chain when the batch does contain an approve', async () => {
      const submit = vi.fn<SubmitCalls>(async () => '0xok')
      const resolveApproveCeiling = vi.fn(async () => FEE_CEILING)
      const s = await start(submit, { resolveApproveCeiling })
      try {
        const res = await request(
          s.port,
          '/submit',
          JSON.stringify({ calls: [AN_APPROVE, A_CALL] }),
        )
        expect(res.status).toBe(200)
        expect(resolveApproveCeiling).toHaveBeenCalledTimes(1)
      } finally {
        await s.close()
      }
    })
  })

  // The bind default is a security control, and it lived only in main() where no test
  // could reach it — which is exactly why the set-but-empty case went unnoticed.
  describe('host resolution', () => {
    it('defaults to loopback when RELAYER_HOST is unset', () => {
      expect(resolveHost({})).toBe('127.0.0.1')
    })

    // `??` would fall through to listen(port, ''), which binds every interface. A .env
    // placeholder or an empty compose value must not silently expose a funded signer.
    it('treats a set-but-empty RELAYER_HOST as unset', () => {
      expect(resolveHost({ RELAYER_HOST: '' })).toBe('127.0.0.1')
    })

    it('honours an explicit host', () => {
      expect(resolveHost({ RELAYER_HOST: '0.0.0.0' })).toBe('0.0.0.0')
    })

    it('warns off-loopback, naming what must be true first', () => {
      const warning = offHostWarning('0.0.0.0')
      expect(warning).toMatch(/authentication and rate limiting/)
      expect(warning).toMatch(/0\.0\.0\.0/)
    })

    it('stays silent on loopback', () => {
      expect(offHostWarning('127.0.0.1')).toBeNull()
    })
  })

  // Same failure shape as the ??/|| bug: an empty value must read as absence, never as
  // permission. There is no wildcard syntax to fall into — matching is exact.
  describe('allowed-origin resolution', () => {
    it.each([
      ['unset', {}],
      ['set but empty', { RELAYER_ALLOWED_ORIGINS: '' }],
      ['only separators', { RELAYER_ALLOWED_ORIGINS: ' , , ' }],
    ])('yields an empty set when %s, never "allow all"', (_label, env) => {
      expect(resolveAllowedOrigins(env).size).toBe(0)
    })

    it('parses and trims a real list, dropping stray commas', () => {
      const origins = resolveAllowedOrigins({
        RELAYER_ALLOWED_ORIGINS: ' https://app.example , ,https://admin.example',
      })
      expect([...origins].sort()).toEqual(['https://admin.example', 'https://app.example'])
    })

    it('treats a "*" entry as the literal string it is, not a wildcard', () => {
      const origins = resolveAllowedOrigins({ RELAYER_ALLOWED_ORIGINS: '*' })
      expect(origins.has('https://evil.example')).toBe(false)
    })
  })

  // The backstop that makes "a failure while answering cannot escape" true. Without
  // it this is an unhandled rejection, which Node turns into a dead process — and this
  // server is a singleton that has to outlive the whole judging session.
  it('cannot let a failure while answering escape as an unhandled throw', async () => {
    // An error whose own stringification throws, so building the 502 response fails.
    const hostile = {
      toString() {
        throw new Error('this error refuses to be described')
      },
    }
    const submit = vi.fn<SubmitCalls>(async () => {
      throw hostile
    })
    const s = await start(submit)
    try {
      const res = await request(s.port, '/submit', JSON.stringify({ calls: [A_CALL] }))
      expect(res.status).toBe(500)
      // And it is still serving, rather than having taken the process down with it.
      const after = await request(s.port, '/nope', '{}')
      expect(after.status).toBe(404)
    } finally {
      await s.close()
    }
  })

  // Regression test for the crash this server must not have. A long-lived singleton
  // that dies on one dropped connection is a total relayer outage.
  it('survives a client that vanishes mid-request', async () => {
    const submit = vi.fn<SubmitCalls>(async () => '0xstillalive')
    const s = await start(submit)
    try {
      // Announce a body we never finish sending, then rip the socket away. This is a
      // closed tab or a dropped network, and it makes Node error the request stream.
      await new Promise<void>((resolve) => {
        const req = http.request({
          host: '127.0.0.1',
          port: s.port,
          path: '/submit',
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': '9999' },
        })
        req.on('error', () => resolve()) // client-side reset is expected here
        req.write('{"calls":[')
        setTimeout(() => {
          req.destroy()
          resolve()
        }, 50)
      })
      await new Promise((r) => setTimeout(r, 100))

      // The proof: the process is still up and still serving. Had that stream error
      // gone unheard, it would have been rethrown and killed this run outright.
      const after = await request(s.port, '/submit', JSON.stringify({ calls: [A_CALL] }))
      expect(after.status).toBe(200)
      expect(JSON.parse(after.body)).toEqual({ transactionHash: '0xstillalive' })
    } finally {
      await s.close()
    }
  })
})
