import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  activityExportFilename,
  buildActivityExport,
  csvCell,
  disclosureBlock,
  selectedColumns,
  ACTIVITY_COLUMNS,
  COLUMN_HEADERS,
} from '../src/export.js'
import { EXPORT_KEY_DISCLOSURE } from '../src/activity-copy.js'
import { STRK_TOKEN } from '../src/constants.js'
import type { ActivityEntry } from '../src/activity.js'

function entry(over: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id: '0xtx-0',
    blockNumber: 13_800_000,
    transactionHash: '0xtx',
    kind: 'deposit',
    mine: true,
    fee: { state: 'charged', amountWei: 2_594_270_938_553_438_960n, unit: 'FRI' },
    token: '0x4718f',
    amount: 7_000_000_000_000_000_000n,
    counterparty: '0xa11ce',
    noteCommitment: null,
    ...over,
  } as ActivityEntry
}

describe('the export is a pure function of rows and toggles', () => {
  it('emits the disclosure block, a header row, then one row per entry', () => {
    const out = buildActivityExport([entry(), entry({ id: '0xtx-1' })])
    const lines = out.csv.split('\r\n').filter(Boolean)
    expect(lines).toHaveLength(out.disclosure.length + 1 + 2)
    expect(out.rowCount).toBe(2)
    expect(lines[out.disclosure.length]).toBe(
      ACTIVITY_COLUMNS.map((c) => COLUMN_HEADERS[c]).join(','),
    )
  })

  it('also returns a preamble-free section whose header is line 1', () => {
    // The disclosure is right for a person and wrong for `read_csv`, which would name a column
    // after a sentence. Both audiences are served rather than one being told to delete rows.
    const out = buildActivityExport([entry(), entry({ id: '0xtx-1' })])
    const lines = out.data.split('\r\n').filter(Boolean)
    expect(lines[0]).toBe(ACTIVITY_COLUMNS.map((c) => COLUMN_HEADERS[c]).join(','))
    expect(lines).toHaveLength(3)
    expect(out.data).not.toContain(EXPORT_KEY_DISCLOSURE)
    // And the two agree about the rows themselves.
    expect(out.csv).toContain(lines[1]!)
  })

  it('honours per-column toggles, and keeps canonical column order regardless', () => {
    const out = buildActivityExport([entry()], {
      columns: { amount: false, fee: false, noteCommitment: false },
    })
    expect(out.columns).not.toContain('amount')
    expect(out.columns).not.toContain('fee')
    // Order follows ACTIVITY_COLUMNS, not the toggle record, so two exports line up.
    expect(out.columns).toEqual(ACTIVITY_COLUMNS.filter((c) => !['amount', 'fee', 'noteCommitment'].includes(c)))
  })

  it('a column absent from the toggles defaults to included', () => {
    expect(selectedColumns({})).toEqual([...ACTIVITY_COLUMNS])
    expect(selectedColumns()).toEqual([...ACTIVITY_COLUMNS])
    expect(selectedColumns({ block: true })).toEqual([...ACTIVITY_COLUMNS])
  })

  it('turning every column off still produces a parseable file with its disclosure', () => {
    const off = Object.fromEntries(ACTIVITY_COLUMNS.map((c) => [c, false]))
    const out = buildActivityExport([entry()], { columns: off })
    expect(out.columns).toEqual([])
    expect(out.csv).toContain(EXPORT_KEY_DISCLOSURE)
  })

  it('amounts are exact integers, never decimal strings a spreadsheet would round', () => {
    const out = buildActivityExport([entry()])
    expect(out.csv).toContain('7000000000000000000')
    expect(out.csv).toContain('2594270938553438960')
    // A float would lose wei on import. There must be no decimal point in a value column.
    const dataRow = out.data.split('\r\n')[1]!
    expect(dataRow).not.toMatch(/\d\.\d/)
  })

  it('a null field is an empty cell — never a zero', () => {
    const out = buildActivityExport([
      entry({ amount: null, counterparty: null, token: null, noteCommitment: null }),
    ])
    const dataRow = out.data.split('\r\n')[1]!
    // An amount of "0" in a statement is a claim that nothing moved.
    expect(dataRow).not.toContain(',0,')
    expect(dataRow.split(',').filter((c) => c === '').length).toBeGreaterThan(0)
  })

  it('an unreadable fee leaves both fee cells blank rather than charging zero', () => {
    const out = buildActivityExport([
      entry({ fee: { state: 'unknown', reason: 'the receipt was not read' } }),
    ])
    const cells = out.data.split('\r\n')[1]!.split(',')
    const columns = out.columns
    expect(cells[columns.indexOf('feeUnit')]).toBe('')
    expect(cells[columns.indexOf('fee')]).toBe('')
    // And the reason string never reaches the file.
    expect(out.csv).not.toContain('the receipt was not read')
  })

  it('scope reflects the row, so a mixed export is still readable', () => {
    const out = buildActivityExport([entry({ mine: true }), entry({ id: '0xtx-1', mine: false })])
    expect(out.csv).toContain('personal')
    expect(out.csv).toContain('global')
  })
})

describe('the disclosure travels inside the file', () => {
  it('carries the verbatim Account Key sentence', () => {
    expect(disclosureBlock()).toContain(EXPORT_KEY_DISCLOSURE)
    expect(buildActivityExport([]).csv).toContain(EXPORT_KEY_DISCLOSURE)
  })

  it('stamps the block range, and warns when the range was truncated', () => {
    const complete = buildActivityExport([], {
      range: { fromBlock: 13_000_000, toBlock: 13_800_000, complete: true },
    })
    expect(complete.disclosure.join(' ')).toContain('Covers blocks 13000000 to 13800000.')
    expect(complete.disclosure.join(' ')).not.toMatch(/page limit/)

    const truncated = buildActivityExport([], {
      range: { fromBlock: 1, toBlock: 2, complete: false },
    })
    expect(truncated.disclosure.join(' ')).toMatch(/page limit/)
  })

  it('the disclosure is returned separately so the screen shows the same sentences', () => {
    const out = buildActivityExport([entry()])
    for (const line of out.disclosure) expect(out.csv).toContain(line)
    // No disclosure sentence may contain a double quote: CSV escaping doubles inner quotes, so
    // the sentence in the file would stop being the sentence the screen shows.
    for (const line of out.disclosure) expect(line, line).not.toContain('"')
  })
})

describe('NO KEY MATERIAL CAN REACH THE FILE', () => {
  it('a row smuggling secrets emits none of them', () => {
    // The rule stated as a test. Every column is a named function reading one whitelisted
    // field, so extra properties on an entry are structurally unreachable — this asserts that
    // rather than trusting it.
    const contaminated = {
      ...entry(),
      accountKey: '0xACCOUNTKEYSECRET',
      viewingKey: 0xdeadbeefn,
      channelKey: 0xc0ffeen,
      witness: { channelKey: 0xc0ffeen, nonce: 0, r: 0xbadbadn },
      r: 0xbadbadn,
      privateKey: '0xPRIVATE',
    } as unknown as ActivityEntry

    const out = buildActivityExport([contaminated])
    for (const secret of ['ACCOUNTKEYSECRET', 'deadbeef', 'c0ffee', 'badbad', 'PRIVATE', 'witness']) {
      expect(out.csv.toLowerCase(), secret).not.toContain(secret.toLowerCase())
    }
  })

  it('the column list cannot name a field that does not exist on an entry', () => {
    // If a future column is added, it has to be added to BOTH the header map and the value map,
    // and this keeps the three in step so a half-added column cannot emit `undefined`.
    expect(Object.keys(COLUMN_HEADERS).sort()).toEqual([...ACTIVITY_COLUMNS].sort())
    const out = buildActivityExport([entry()])
    expect(out.csv).not.toContain('undefined')
    expect(out.csv).not.toContain('[object Object]')
  })

  it('the source names no key-bearing field at all', () => {
    // A grep over the module itself. The exporter reads `ActivityEntry`, which carries no key
    // material — this catches the commit that starts reading one.
    const source = readFileSync('packages/protocol/src/export.ts', 'utf8')
    for (const forbidden of ['accountKey', 'viewingKey', 'channelKey', '.witness', 'privateKey']) {
      expect(source, forbidden).not.toContain(forbidden)
    }
  })
})

describe('the file is safe to open in a spreadsheet', () => {
  it('escapes RFC 4180 specials', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('has,comma')).toBe('"has,comma"')
    expect(csvCell('has"quote')).toBe('"has""quote"')
    expect(csvCell('has\nnewline')).toBe('"has\nnewline"')
  })

  it('defuses cells a spreadsheet would evaluate as a formula', () => {
    // Excel, LibreOffice and Sheets all evaluate a leading =, +, -, @ or control character.
    // The apostrophe goes on the VALUE; RFC 4180 quoting then wraps it where the value also
    // contains a comma, quote or newline — so the marker is inside the quotes, not before them.
    const defused = (cell: string) => (cell.startsWith('"') ? cell.slice(1, -1) : cell)
    for (const dangerous of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) {
      expect(defused(csvCell(dangerous)), dangerous).toMatch(/^'/)
    }
    expect(csvCell('=cmd|calc')).toBe("'=cmd|calc")
    // A carriage return needs both treatments at once.
    expect(csvCell('\rx')).toBe('"\'\rx"')
  })

  it('leaves ordinary hex and integers untouched', () => {
    // The defusing must not corrupt the values this actually emits today.
    expect(csvCell('0xa11ce')).toBe('0xa11ce')
    expect(csvCell('7000000000000000000')).toBe('7000000000000000000')
    expect(csvCell('deposit')).toBe('deposit')
  })

  it('a defused cell that also needs quoting gets both', () => {
    expect(csvCell('=a,b')).toBe('"\'=a,b"')
  })

  it('defaults to CRLF, and honours an override', () => {
    expect(buildActivityExport([entry()]).csv).toContain('\r\n')
    expect(buildActivityExport([entry()], { newline: '\n' }).csv).not.toContain('\r\n')
  })

  it('the file ends with a newline, as a well-formed text file does', () => {
    expect(buildActivityExport([entry()]).csv.endsWith('\r\n')).toBe(true)
  })
})

describe('the filename is stamped with a block, not a clock', () => {
  it('names the block the statement is true as of', () => {
    expect(activityExportFilename(13_818_013)).toBe('passbook-activity-block-13818013.csv')
  })

  it('two exports of the same range collide on purpose — they are the same statement', () => {
    expect(activityExportFilename(1)).toBe(activityExportFilename(1))
  })
})

describe('the fee is stated once per transaction, not once per row', () => {
  // One `apply_actions` emits several events, and the network charged for it once. Printing
  // the fee on every row hands a bookkeeper a column that sums to several times what was paid.
  const threeRows = [
    entry({ id: '0xtx-0', transactionHash: '0xtx' }),
    entry({ id: '0xtx-1', transactionHash: '0xtx' }),
    entry({ id: '0xtx-2', transactionHash: '0xtx' }),
  ]

  const feeColumn = (out: { data: string; columns: readonly string[] }) =>
    out.data
      .split('\r\n')
      .slice(1)
      .filter(Boolean)
      .map((row) => row.split(',')[out.columns.indexOf('fee')]!)

  it('the fee column sums to the fee exactly once', () => {
    const out = buildActivityExport(threeRows)
    const cells = feeColumn(out)
    expect(cells).toHaveLength(3)
    const total = cells.filter(Boolean).reduce((sum, cell) => sum + BigInt(cell), 0n)
    expect(total).toBe(2_594_270_938_553_438_960n)
    // Exactly one row carries it; the other two are blank, not zero.
    expect(cells.filter(Boolean)).toHaveLength(1)
    expect(cells.filter((c) => c === '')).toHaveLength(2)
  })

  it('the fee lands on the first row of its transaction', () => {
    expect(feeColumn(buildActivityExport(threeRows))[0]).not.toBe('')
  })

  it('two transactions each state their own fee once', () => {
    const out = buildActivityExport([
      ...threeRows,
      entry({ id: '0xother-0', transactionHash: '0xother' }),
      entry({ id: '0xother-1', transactionHash: '0xother' }),
    ])
    expect(feeColumn(out).filter(Boolean)).toHaveLength(2)
  })

  it('the convention is stated in the file, so the blanks are not read as missing data', () => {
    expect(buildActivityExport(threeRows).disclosure.join(' ')).toMatch(/once per transaction/)
  })
})

describe('the decimals column interprets the exact integers without guessing', () => {
  it('STRK shows 18, from the same verified map the balance model uses', () => {
    const out = buildActivityExport([entry({ token: STRK_TOKEN })])
    const cells = out.data.split('\r\n')[1]!.split(',')
    expect(cells[out.columns.indexOf('tokenDecimals')]).toBe('18')
  })

  it('the padded and unpadded spellings of STRK both resolve', () => {
    const unpadded = `0x${BigInt(STRK_TOKEN).toString(16)}`
    const out = buildActivityExport([entry({ token: unpadded })])
    expect(out.data.split('\r\n')[1]!.split(',')[out.columns.indexOf('tokenDecimals')]).toBe('18')
  })

  it('an unverified token stays blank — never a guessed 18', () => {
    const out = buildActivityExport([entry({ token: '0xdeadbeef' })])
    expect(out.data.split('\r\n')[1]!.split(',')[out.columns.indexOf('tokenDecimals')]).toBe('')
  })

  it('a row with no token at all is blank too', () => {
    const out = buildActivityExport([entry({ token: null })])
    expect(out.data.split('\r\n')[1]!.split(',')[out.columns.indexOf('tokenDecimals')]).toBe('')
  })

  it('a caller-supplied decimals map fills a gap the verified map cannot', () => {
    const out = buildActivityExport([entry({ token: '0xdeadbeef' })], {
      decimals: { '0xdeadbeef': 6 },
    })
    expect(out.data.split('\r\n')[1]!.split(',')[out.columns.indexOf('tokenDecimals')]).toBe('6')
  })
})
