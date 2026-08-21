import { writeFileSync, mkdirSync } from 'node:fs'
import { readPoolConstants } from '../packages/protocol/src/pool.js'

const c = await readPoolConstants()
const out = {
  ...c,
  feeWei: c.feeWei.toString(),
  feeStrk: Number(c.feeWei) / 1e18,
  readAt: new Date().toISOString(),
}
mkdirSync('evidence', { recursive: true })
writeFileSync('evidence/constants.json', JSON.stringify(out, null, 2))
console.log(out)
