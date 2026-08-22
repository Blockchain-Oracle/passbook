import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadDotEnv } from '../src/env.js'

// Every variable these tests touch, so one cleanup covers all of them and a failing
// assertion cannot leak a value into a later test.
const TOUCHED = ['STRK20_TEST_FROM_FILE', 'STRK20_TEST_PRECEDENCE', 'STRK20_TEST_SECOND']

let dir: string
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'strk20-env-'))
  for (const k of TOUCHED) {
    saved[k] = process.env[k]
    delete process.env[k]
  }
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
  for (const k of TOUCHED) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('loadDotEnv', () => {
  it('populates process.env from the file', () => {
    const path = join(dir, '.env')
    writeFileSync(path, 'STRK20_TEST_FROM_FILE=hello\nSTRK20_TEST_SECOND=world\n')

    const result = loadDotEnv(path)

    expect(result.loaded).toBe(true)
    expect(result.path).toBe(path)
    expect(process.env.STRK20_TEST_FROM_FILE).toBe('hello')
    expect(process.env.STRK20_TEST_SECOND).toBe('world')
  })

  it('lets an existing environment variable win over the file', () => {
    // The one that matters operationally: a CI secret or an inline
    // `FOO=… npx tsx …` prefix must beat a stale local .env, never the other way round.
    // Silently overwriting a real secret with a forgotten file value is the failure this
    // pins shut.
    process.env.STRK20_TEST_PRECEDENCE = 'from_environment'
    const path = join(dir, '.env')
    writeFileSync(path, 'STRK20_TEST_PRECEDENCE=from_file\nSTRK20_TEST_FROM_FILE=only_in_file\n')

    loadDotEnv(path)

    expect(process.env.STRK20_TEST_PRECEDENCE).toBe('from_environment')
    // …and the file still supplies anything the environment did not set.
    expect(process.env.STRK20_TEST_FROM_FILE).toBe('only_in_file')
  })

  it('treats a missing file as a normal, non-fatal outcome', () => {
    // The dry-runs exist to report which variables are absent. Throwing here would
    // replace that report with a stack trace.
    const result = loadDotEnv(join(dir, 'does-not-exist.env'))

    expect(result.loaded).toBe(false)
    expect(result.path).toBeUndefined()
    expect(result.reason).toMatch(/no \.env found/)
  })

  it('reports a file it cannot parse instead of yielding nothing silently', () => {
    // A directory named .env is the cheap way to make the read fail. The point is the
    // shape of the answer: name the file and the cause, because an empty result is
    // indistinguishable from "you forgot to set the variable".
    const path = join(dir, '.env')
    mkdirSync(path)

    const result = loadDotEnv(path)

    expect(result.loaded).toBe(false)
    expect(result.path).toBe(path)
    expect(result.reason).toContain(path)
    expect(result.reason).toMatch(/could not be parsed/)
  })

  it('ignores malformed lines but still applies the valid ones', () => {
    // Node's parser skips junk rather than throwing, so a typo costs one variable and
    // not the whole file. Pinned because a future switch to another loader could change
    // it, and the scripts would then fail in a much less obvious way.
    const path = join(dir, '.env')
    writeFileSync(path, 'this line is not valid\nSTRK20_TEST_FROM_FILE=survived\n')

    const result = loadDotEnv(path)

    expect(result.loaded).toBe(true)
    expect(process.env.STRK20_TEST_FROM_FILE).toBe('survived')
  })
})
