import { describe, it, expect, vi } from 'vitest'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { NET, STRK_TOKEN } from '../../protocol/src/constants.js'
import { createRelayerServer, type SubmitCalls } from '../src/server.js'
import { MAX_CALLS_PER_SUBMISSION } from '../src/allowlist.js'

// An allowlisted call, so tests about everything else are not silently blocked by policy.
const A_CALL = { contractAddress: NET.pool, entrypoint: 'apply_actions', calldata: [] }
const ATTACKER = '0x0dead0000000000000000000000000000000000000000000000000000000beef'

async function start(submit: SubmitCalls) {
  const server = createRelayerServer(submit)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function request(port: number, path: string, body: string, method = 'POST') {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method, headers: { 'content-type': 'application/json' } },
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
