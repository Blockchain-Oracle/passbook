//
// Export activity — a client-side CSV with its own disclosure block (FR-011a, story 1.9 AC4).
//
// A PURE FUNCTION, `(rows, column toggles) → string`. No fetch, no file system, no download.
// Epic 6 turns the string into a Blob; everything that decides what is IN the string is here,
// where it can be tested exhaustively and where the one rule that matters is enforceable:
//
//   NO KEY MATERIAL, EVER, BY CONSTRUCTION.
//
// The enforcement is structural rather than a review promise. Every column is a named function
// in `COLUMN_VALUES`, the record below is exhaustive over a closed union, and a column reads
// exactly one whitelisted field of `ActivityEntry`. There is no spread of an entry into a row
// and no `Object.entries` over anything — so a field added to `ActivityEntry` later cannot
// appear in an export by default, which is the direction this has to fail in. The account key,
// the viewing key, channel keys and witness material are not on `ActivityEntry` at all, and
// `test/export.test.ts` asserts that a row carrying them still cannot emit them.
//

import {
  EXPORT_FEE_ONCE_PER_TRANSACTION,
  EXPORT_FILE_SCOPE,
  EXPORT_IN_BROWSER,
  EXPORT_KEY_DISCLOSURE,
  EXPORT_PREAMBLE_NOTE,
  EXPORT_RANGE_INCOMPLETE,
  exportRangeLine,
} from './activity-copy.js'
import { KNOWN_TOKEN_DECIMALS, lookupDecimals } from './balances.js'
import type { ActivityEntry } from './activity.js'

/**
 * Every column an export can contain, and the order they appear in.
 *
 * Order is fixed by this array rather than by the toggles, so two exports with different
 * columns selected still line up against each other — a bookkeeper diffing two statements
 * should not have to re-map the columns.
 */
export const ACTIVITY_COLUMNS = [
  'block',
  'transaction',
  'entry',
  'kind',
  'scope',
  'token',
  'amount',
  'counterparty',
  'noteCommitment',
  'fee',
  'feeUnit',
  'tokenDecimals',
] as const

export type ActivityColumn = (typeof ACTIVITY_COLUMNS)[number]

/** The header each column prints. Human-readable, because a spreadsheet shows these. */
export const COLUMN_HEADERS: Readonly<Record<ActivityColumn, string>> = {
  block: 'Block',
  transaction: 'Transaction',
  entry: 'Entry',
  kind: 'Type',
  scope: 'Scope',
  token: 'Token',
  amount: 'Amount',
  counterparty: 'Counterparty',
  noteCommitment: 'Note commitment',
  fee: 'Fee charged',
  feeUnit: 'Fee unit',
  tokenDecimals: 'Token decimals',
}

/**
 * The one place an entry becomes text, one closed function per column.
 *
 * EVERY VALUE IS A STRING AND EVERY UNKNOWN IS EMPTY. A blank cell is the honest rendering of
 * "the chain did not publish this" — an encrypted note's amount, a spend's counterparty before
 * it is recognised, a fee whose receipt was never fetched. Writing a `0` into any of them would
 * turn an absence into an assertion, which on a fee column is a claim that a paid transaction
 * was free and on an amount column is a claim that nothing moved.
 *
 * Amounts are the exact integer in the token's smallest unit, never a decimal string. A
 * spreadsheet parses `0.1` as a float and loses wei; the integer survives every importer.
 */
const COLUMN_VALUES: Readonly<
  Record<ActivityColumn, (entry: ActivityEntry, row: RowContext) => string>
> = {
  block: (e) => String(e.blockNumber),
  transaction: (e) => e.transactionHash,
  entry: (e) => e.id,
  kind: (e) => e.kind,
  scope: (e) => (e.mine ? 'personal' : 'global'),
  token: (e) => e.token ?? '',
  amount: (e) => (e.amount === null ? '' : e.amount.toString()),
  counterparty: (e) => e.counterparty ?? '',
  noteCommitment: (e) => e.noteCommitment ?? '',
  // ON EXACTLY ONE ROW PER TRANSACTION. The fee is charged once for the whole `apply_actions`,
  // and one of those emits several events — so stamping it on every row hands the bookkeeper
  // this file was built for a fee column that sums to three or four times what was paid. The
  // rows are not independent transactions and the file must not read as though they are.
  fee: (e, row) => (row.carriesFee && e.fee.state === 'charged' ? e.fee.amountWei.toString() : ''),
  feeUnit: (e, row) => (row.carriesFee && e.fee.state === 'charged' ? e.fee.unit : ''),
  // A null-safe interpretation aid: amounts are exact smallest-unit integers, and without the
  // scale a reader cannot tell 7000000000000000000 from seven of anything. Blank when we have
  // not verified the token's decimals — never guessed, same rule as the balance model.
  tokenDecimals: (e, row) => (row.tokenDecimals === null ? '' : String(row.tokenDecimals)),
}

/** Per-row facts the column functions need that are not on the entry itself. */
interface RowContext {
  /** True on the one row of each transaction that prints the fee. */
  carriesFee: boolean
  tokenDecimals: number | null
}

/** What the caller chooses. Any column left out of the record is included. */
export type ColumnToggles = Partial<Record<ActivityColumn, boolean>>

export interface ExportOptions {
  /** Per-column include toggles. A column absent from this record defaults to included. */
  columns?: ColumnToggles
  /** The block range the rows were read over, stamped into the disclosure block. */
  range?: { fromBlock: number; toBlock: number; complete: boolean }
  /** Line ending. CRLF by default — RFC 4180, and what a spreadsheet on Windows expects. */
  newline?: '\r\n' | '\n'
  /**
   * Decimals per token, for the `tokenDecimals` column. Sourced from the same verified map the
   * balance model uses, so an unverified token stays blank rather than being guessed at.
   */
  decimals?: Readonly<Record<string, number>>
}

/** The columns actually selected, in canonical order. */
export function selectedColumns(toggles: ColumnToggles = {}): ActivityColumn[] {
  return ACTIVITY_COLUMNS.filter((c) => toggles[c] !== false)
}

/**
 * Escapes one cell for RFC 4180, and defuses it as a spreadsheet formula.
 *
 * TWO SEPARATE JOBS, and the second is the one that gets left out. RFC 4180 says a field
 * containing a comma, a quote or a newline is wrapped in quotes with inner quotes doubled —
 * that keeps the file parseable. It does nothing about a cell beginning `=`, `+`, `-`, `@`,
 * or a leading tab or carriage return, which Excel, LibreOffice and Sheets all evaluate as a
 * formula on open. Nothing this exporter emits today begins with one of those characters, and
 * that is exactly why the guard belongs here rather than in a caller's head: the day a token
 * symbol or a memo joins the column list, the file this product hands an accountant should not
 * become the way something executes on their machine.
 *
 * The mitigation is a leading apostrophe, which every major spreadsheet reads as "this is
 * text". It changes the cell's value, so it is applied ONLY to cells that would otherwise be
 * interpreted — an ordinary hex address or integer passes through untouched.
 */
export function csvCell(value: string): string {
  const defused = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[",\r\n]/.test(defused) ? `"${defused.replace(/"/g, '""')}"` : defused
}

/**
 * The disclosure block, as CSV comment lines above the header row.
 *
 * IN THE FILE, not beside it. The screen that offered the export is gone by the time this is
 * opened, forwarded or attached to an email, and the sentence about what the Account Key can
 * do is most needed exactly then. Each line is a single quoted cell so a spreadsheet renders
 * it as text in column A rather than mangling it across columns.
 */
export function disclosureBlock(range?: ExportOptions['range']): string[] {
  const lines = [
    EXPORT_FILE_SCOPE,
    EXPORT_KEY_DISCLOSURE,
    EXPORT_IN_BROWSER,
    EXPORT_FEE_ONCE_PER_TRANSACTION,
    EXPORT_PREAMBLE_NOTE,
  ]
  if (range) {
    lines.push(exportRangeLine(range.fromBlock, range.toBlock))
    if (!range.complete) lines.push(EXPORT_RANGE_INCOMPLETE)
  }
  return lines
}

/** What a built export is: the text, and the parts of it a caller may want separately. */
export interface ActivityExport {
  /**
   * The whole statement — disclosure block, header row, then one row per entry.
   *
   * This is the file a person opens. It leads with prose because the sentence about what the
   * Account Key can do is most needed exactly when the screen that offered the export is gone.
   */
  csv: string
  /**
   * The same rows with NO preamble: header on line 1, data from line 2.
   *
   * Because the two audiences want incompatible things from one file. A person needs the
   * disclosure at the top; `pandas.read_csv`, R, and every "first row is the header" importer
   * need the header at the top, and quietly take `EXPORT_FILE_SCOPE` as their column name if
   * they do not get it. Rather than pick a winner or ask the user to delete four lines by
   * hand, both are returned and the statement says which is which.
   */
  data: string
  /** The disclosure lines alone, for rendering the same sentences on the export screen. */
  disclosure: string[]
  columns: ActivityColumn[]
  rowCount: number
}

/**
 * Builds the export.
 *
 * Takes the rows already filtered — Personal versus Global is the caller's selection, and
 * re-deciding it here would give the export a second opinion about what "yours" means.
 */
export function buildActivityExport(
  entries: readonly ActivityEntry[],
  options: ExportOptions = {},
): ActivityExport {
  const newline = options.newline ?? '\r\n'
  const columns = selectedColumns(options.columns)
  const disclosure = disclosureBlock(options.range)
  const decimals = { ...KNOWN_TOKEN_DECIMALS, ...(options.decimals ?? {}) }

  // The first row of each transaction carries its fee; the rest leave both fee cells blank.
  // "First" is by arrival order in the list the caller handed over, which is the order the
  // rows are printed in — so the fee sits on the topmost row of its group, where a reader
  // scanning the file meets it.
  const feeCarrier = new Map<string, string>()
  for (const entry of entries) {
    if (!feeCarrier.has(entry.transactionHash)) feeCarrier.set(entry.transactionHash, entry.id)
  }

  const rowFor = (entry: ActivityEntry): RowContext => ({
    carriesFee: feeCarrier.get(entry.transactionHash) === entry.id,
    tokenDecimals: entry.token === null ? null : lookupDecimals(decimals, entry.token),
  })

  const header = columns.map((c) => csvCell(COLUMN_HEADERS[c])).join(',')
  const rows = entries.map((entry) => {
    const row = rowFor(entry)
    return columns.map((c) => csvCell(COLUMN_VALUES[c](entry, row))).join(',')
  })

  const data = [header, ...rows].join(newline) + newline
  const csv = [...disclosure.map((line) => csvCell(line)), header, ...rows].join(newline) + newline

  return { csv, data, disclosure, columns, rowCount: entries.length }
}

/**
 * A filename for the export, block-stamped rather than clock-stamped.
 *
 * The block height is the thing this file is actually true as of; a wall-clock timestamp would
 * be the moment somebody clicked a button, which is not a fact about the data. Two exports of
 * the same range therefore collide by name on purpose — they are the same statement.
 */
export function activityExportFilename(toBlock: number): string {
  return `passbook-activity-block-${toBlock}.csv`
}
