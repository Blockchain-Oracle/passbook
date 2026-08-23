// A guard nobody has seen fail is a guard nobody knows works. These run the real script
// as a subprocess against a fixture tree, so what is tested is the thing CI runs.
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/lint-secrets.mjs')

const dirs = []
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true })
})

// Line 1 of every fixture's browser code, so the default exception citation (web/app.js:1)
// always points at a line that genuinely reaches out. Each test's own source starts at line 2.
const CANONICAL_CALL = "fetch('https://rpc.starknet.lava.build')\n"

/** A minimal repository shaped like ours: declared hosts, an exceptions list, browser code. */
function fixture(
  browserSource = '',
  { serverSource = '', exceptionSite = 'web/app.js:1', exceptionLeaks = 'the RPC provider sees the IP' } = {},
) {
  const root = mkdtempSync(join(tmpdir(), 'passbook-lint-'))
  dirs.push(root)
  mkdirSync(join(root, 'packages/protocol/src'), { recursive: true })
  mkdirSync(join(root, 'packages/relayer/src'), { recursive: true })
  mkdirSync(join(root, 'web'), { recursive: true })
  writeFileSync(
    join(root, 'packages/protocol/src/constants.ts'),
    "export const RPC = ['https://rpc.starknet.lava.build']\n" +
      "export const EXPLORER = 'https://voyager.online'\n",
  )
  writeFileSync(
    join(root, 'packages/relayer/src/quote-proxy.ts'),
    `export const PROXY_EXCEPTIONS = [{ where: '${exceptionSite}', leaks: '${exceptionLeaks}' }]\n`,
  )
  writeFileSync(join(root, 'packages/relayer/src/server.ts'), serverSource)
  writeFileSync(join(root, 'web/app.js'), CANONICAL_CALL + browserSource)
  return root
}

/** Runs from an unrelated cwd on purpose: the root comes from the argument, not from here. */
function run(root) {
  try {
    return {
      code: 0,
      out: execFileSync('node', [SCRIPT, root], { cwd: tmpdir(), encoding: 'utf8' }),
    }
  } catch (e) {
    return { code: e.status, out: `${e.stdout ?? ''}${e.stderr ?? ''}` }
  }
}

describe('lint-secrets', () => {
  it('passes on the real repository, which is the state it must hold', () => {
    expect(run(process.cwd()).code).toBe(0)
  })

  // A guard that passes because it was run from the wrong directory is worse than no guard.
  it('checks its own repository when given no root, whatever the cwd', () => {
    const out = execFileSync('node', [SCRIPT], { cwd: tmpdir(), encoding: 'utf8' })
    expect(out).toMatch(/secrets lint: clean/)
  })

  it('accepts a browser host that constants.ts declares', () => {
    expect(run(fixture("fetch('https://rpc.starknet.lava.build')\n")).code).toBe(0)
  })

  it('reports paths relative to the scanned root, not the cwd it was run from', () => {
    const r = run(fixture("fetch('https://quotes.evil.example')\n"))
    expect(r.out).toMatch(/^web\/app\.js:2 /m)
  })

  // The check this file exists for: a third-party fetch added to browser code is exactly
  // the leak FR-029 claims to close, and nothing else in the build notices it.
  it('fails on a third-party host reached directly from the browser', () => {
    const r = run(fixture("fetch('https://starknet.api.avnu.fi/swap/v3/quotes')\n"))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/starknet\.api\.avnu\.fi/)
    expect(r.out).toMatch(/POST \/api\/quote/)
  })

  it.each([
    ['an AWS key id', "const k = 'AKIAIOSFODNN7EXAMPLE'\n"],
    ['a GitHub token', "const k = 'ghp_" + 'a'.repeat(36) + "'\n"],
    ['a PEM private key', '// -----BEGIN RSA PRIVATE KEY-----\n'],
    ['an assigned api key', "const c = { apiKey: 'live_9f3a2b7c4d1e8006' }\n"],
  ])('fails on %s in browser code', (_label, source) => {
    expect(run(fixture(source)).code).toBe(1)
  })

  it('fails on a credential in server code too, where a bad import would carry it out', () => {
    const r = run(fixture('', { serverSource: "const password = 'hunter2hunter2hunter2'\n" }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/read it from the environment/)
  })

  // Server code is where a third-party host BELONGS — that is what the proxy is.
  it('allows a third-party host in server code', () => {
    expect(run(fixture('', { serverSource: "const h = 'https://iris-api.circle.com'\n" })).code).toBe(0)
  })

  it.each([
    ['an env var name', "const apiKey = process.env.AVNU_KEY || 'AVNU_API_KEY'\n"],
    ['a template', 'const secret = `Bearer ${credential}`\n'],
    ['a class hash', "const privateKey = '0xdeadbeefdeadbeefdeadbeef'\n"],
    ['a placeholder', "const password = 'your-password-here'\n"],
  ])('does not cry wolf on %s', (_label, source) => {
    expect(run(fixture(source)).code).toBe(0)
  })

  it.each([
    ['a wss:// socket', "new WebSocket('wss://feed.evil.example')\n"],
    ['a ws:// socket', "new WebSocket('ws://feed.evil.example')\n"],
    ['a protocol-relative URL', "fetch('//quotes.evil.example/v1')\n"],
  ])('fails on %s to an undeclared host', (_label, source) => {
    const r = run(fixture(source))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/evil\.example/)
  })

  it('does not read a // comment or a root-relative path as a host', () => {
    const r = run(fixture("// see docs.example for notes\nfetch('/api/quote')\n"))
    expect(r.code).toBe(0)
  })

  // A disclosure that points at code which has moved is a disclosure nobody can check.
  it('fails when a PROXY_EXCEPTIONS site points past the end of its file', () => {
    const r = run(fixture('one line\n', { exceptionSite: 'web/app.js:400' }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/the code moved and the disclosure did not/)
  })

  it('fails when a PROXY_EXCEPTIONS site names a file that is gone', () => {
    const r = run(fixture('x\n', { exceptionSite: 'web/deleted.js:3' }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/does not exist/)
  })

  // The realistic way a citation rots: code is inserted above it and every line below
  // shifts, still inside the file and now pointing at something unrelated.
  it('fails when a cited line has shifted to code that reaches nowhere', () => {
    const r = run(fixture('const UNRELATED = 1\n', { exceptionSite: 'web/app.js:2' }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/does not look like the browser-direct call it describes/)
  })

  // The fallback branch: a cited line that makes no obvious call is still corroborated when
  // it names something the disclosure itself names.
  it('accepts a citation whose line names a host the disclosure mentions', () => {
    const r = run(
      fixture("const target = 'voyager.online'\n", {
        exceptionSite: 'web/app.js:2',
        exceptionLeaks: 'voyager.online sees the transaction you clicked',
      }),
    )
    expect(r.code).toBe(0)
  })

  it.each(['web/app.js', 'web/app.js:0', 'web/app.js:abc'])(
    'fails on %s, which is not a file:line citation',
    (site) => {
      const r = run(fixture('x\n', { exceptionSite: site }))
      expect(r.code).toBe(1)
      expect(r.out).toMatch(/not a "file:line" citation/)
    },
  )

  // A claim cannot be its own evidence. `where: 'web/app.js:2'` contains the dotted name
  // `app.js`, so a cited line merely mentioning app.js must not corroborate the citation.
  it('does not let the citation corroborate itself from its own filename', () => {
    const r = run(fixture("const label = 'app.js'\n", { exceptionSite: 'web/app.js:2' }))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/does not look like the browser-direct call it describes/)
  })

  // A formatter switching quote style would otherwise degrade every citation check above into
  // a silent no-op, and the script would still print "clean".
  it('parses double-quoted and backtick entries rather than silently finding none', () => {
    const root = fixture()
    writeFileSync(
      join(root, 'packages/relayer/src/quote-proxy.ts'),
      'export const PROXY_EXCEPTIONS = [{ where: "web/app.js:400", leaks: "x" }]\n',
    )
    const r = run(root)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/past the end of/)   // parsed, then failed on the real problem
  })

  it('fails loudly when PROXY_EXCEPTIONS is declared but nothing parses out of it', () => {
    const root = fixture()
    writeFileSync(
      join(root, 'packages/relayer/src/quote-proxy.ts'),
      'export const PROXY_EXCEPTIONS = buildExceptions()\n',
    )
    const r = run(root)
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/no entries could be parsed/)
  })

  // A concatenated URL has no literal hostname for the host patterns to find, so the
  // destination is invisible to this lint and perfectly visible to the browser.
  it.each([
    ['string concatenation', "fetch('https://' + host)\n"],
    ['protocol-relative concatenation', "fetch('//' + host)\n"],
    ['a template literal', 'fetch(`https://${host}/quote`)\n'],
    ['a protocol-relative template', 'fetch(`//${host}/quote`)\n'],
  ])('fails on a URL built by %s in browser code', (_label, source) => {
    const r = run(fixture(source))
    expect(r.code).toBe(1)
    expect(r.out).toMatch(/builds a URL from a scheme plus a variable/)
  })

  it('does not flag ordinary string concatenation or template paths', () => {
    const r = run(fixture('const p = `/api/quote/${id}`\nconst q = "swap/" + pair\n'))
    expect(r.code).toBe(0)
  })
})
