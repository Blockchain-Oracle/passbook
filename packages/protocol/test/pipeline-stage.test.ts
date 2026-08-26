import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import {
  REGISTRATION_STAGES,
  SEND_STAGES,
  STAGE_TITLES,
  ownsComputation,
  type PipelineStage,
} from '../src/pipeline-stage.js'

describe('one stage vocabulary, shared by both pipelines', () => {
  it('a send has five stages in order', () => {
    expect(SEND_STAGES).toEqual(['build', 'prove', 'relay', 'mature', 'confirmed'])
  })

  it('a registration has four, and the missing one is `mature`', () => {
    expect(REGISTRATION_STAGES).toEqual(['build', 'prove', 'relay', 'confirmed'])
    expect(REGISTRATION_STAGES).not.toContain('mature')
    // The asymmetry is the whole "registration omits Mature" criterion, and it lives in the DATA.
    expect(SEND_STAGES.filter((s) => !REGISTRATION_STAGES.includes(s as never))).toEqual(['mature'])
  })

  it('every stage has a title', () => {
    for (const stage of SEND_STAGES) {
      expect(STAGE_TITLES[stage], stage).toBeTruthy()
    }
  })
})

describe('the honesty predicate', () => {
  it('we own `build` and nothing else', () => {
    expect(ownsComputation('build')).toBe(true)
    for (const stage of ['prove', 'relay', 'mature', 'confirmed'] as PipelineStage[]) {
      expect(ownsComputation(stage), stage).toBe(false)
    }
  })

  it('the hosted prover is never ours — the one that would be tempting to flip', () => {
    // DESIGN §7.7 says "(build, prove)" and EXPERIENCE §4.2 says "(build)" plus "the hosted prover
    // is ALWAYS the indeterminate ring". This test is the tiebreak, so a future reader who finds
    // the DESIGN line cannot quietly "restore" it.
    expect(ownsComputation('prove')).toBe(false)
  })
})

describe('the leaf stays a leaf', () => {
  it('imports nothing at all', () => {
    const source = readFileSync(new URL('../src/pipeline-stage.ts', import.meta.url), 'utf8')
    // The entire point of this module is that a browser can import the vocabulary without
    // importing a chain client. One `import` line here is how that silently stops being true.
    expect(source.match(/^\s*import\s/m)).toBeNull()
    // AND NO RE-EXPORT. `export * from './pool.js'` and `export { x } from './pool.js'` both pull
    // the whole module graph in exactly as an import would, and neither matches the line above —
    // which is how a leaf-purity check passes while the leaf stops being one.
    expect(source.match(/^\s*export\s[\s\S]{0,200}?\bfrom\s+['"]/m)).toBeNull()
  })

  it('`send.ts` and `register.ts` re-export rather than redeclare', () => {
    const send = readFileSync(new URL('../src/send.ts', import.meta.url), 'utf8')
    const register = readFileSync(new URL('../src/register.ts', import.meta.url), 'utf8')
    expect(send).toContain("export type { SendStage } from './pipeline-stage.js'")
    expect(register).toContain("export type { RegistrationStage } from './pipeline-stage.js'")
    // A second literal declaration is the drift this whole extraction exists to prevent.
    expect(send).not.toMatch(/export type SendStage\s*=/)
    expect(register).not.toMatch(/export type RegistrationStage\s*=/)
  })
})
