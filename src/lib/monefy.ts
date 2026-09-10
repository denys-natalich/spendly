import { CURRENCIES, type Currency } from '../types'

/*
 * Monefy CSV export.
 *
 * Header: date,account,category,amount,currency,converted amount,currency,description
 * Note the duplicated "currency" column, which is why fields are read by
 * position rather than by name. Dates are DD.MM.YYYY; expenses are negative.
 */

export interface MonefyRow {
  spent_on: string // YYYY-MM-DD
  category: string
  amount: number // positive
  currency: Currency
  note: string | null
}

export interface ParseResult {
  rows: MonefyRow[]
  skipped: { income: number; unsupportedCurrency: string[]; malformed: number }
}

/** Minimal RFC-4180 reader — descriptions contain commas and doubled quotes. */
function parseCsv(text: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  // Strip a UTF-8 BOM; Monefy writes one and it would poison the first header.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((f) => f !== '')) out.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f !== '')) out.push(row)
  return out
}

function toIsoDate(ddmmyyyy: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(ddmmyyyy.trim())
  if (!m) return null
  const [, d, mo, y] = m
  return `${y}-${mo}-${d}`
}

export function parseMonefy(text: string): ParseResult {
  const table = parseCsv(text)
  const rows: MonefyRow[] = []
  const skipped: ParseResult['skipped'] = { income: 0, unsupportedCurrency: [], malformed: 0 }
  const unsupported = new Set<string>()

  // Drop the header if present; a data row always starts with a date.
  const body = table.length && toIsoDate(table[0][0]) === null ? table.slice(1) : table

  for (const cells of body) {
    if (cells.length < 5) { skipped.malformed++; continue }
    const spent_on = toIsoDate(cells[0])
    const amount = Number(cells[3])
    const currency = cells[4].trim().toUpperCase()

    if (!spent_on || !Number.isFinite(amount) || amount === 0) { skipped.malformed++; continue }
    if (amount > 0) { skipped.income++; continue }
    if (!CURRENCIES.includes(currency as Currency)) { unsupported.add(currency); continue }

    const note = (cells[7] ?? '').trim()
    rows.push({
      spent_on,
      category: cells[2].trim() || 'Other',
      amount: Math.round(Math.abs(amount) * 100) / 100,
      currency: currency as Currency,
      note: note ? note.slice(0, 200) : null,
    })
  }

  skipped.unsupportedCurrency = [...unsupported]
  return { rows, skipped }
}

/**
 * Monefy names that mean the same thing as a Spendly starter category. Anything
 * not listed here keeps its own name and is created on import.
 */
export const CATEGORY_ALIASES: Record<string, string> = {
  Food: 'Groceries',
  House: 'Housing',
  'Healthy & Beauty': 'Health',
}

/** Icon and colour for categories the import has to create. */
export const NEW_CATEGORY_ICONS: Record<string, string> = {
  Entertainment: 'film',
  Presents: 'gift',
  Sports: 'dumbbell',
  Clothes: 'shirt',
  Charity: 'heart',
  Toiletry: 'spray-can',
  Education: 'graduation-cap',
}

export function targetCategoryName(monefyName: string): string {
  return CATEGORY_ALIASES[monefyName] ?? monefyName
}

export interface ImportSummary {
  total: number
  firstDay: string
  lastDay: string
  byCategory: Array<{ name: string; target: string; count: number; amount: number }>
  currencies: Currency[]
}

export function summarise(rows: MonefyRow[]): ImportSummary | null {
  if (rows.length === 0) return null
  const days = rows.map((r) => r.spent_on).sort()
  const totals = new Map<string, { count: number; amount: number }>()
  for (const r of rows) {
    const cur = totals.get(r.category) ?? { count: 0, amount: 0 }
    cur.count++
    cur.amount += r.amount
    totals.set(r.category, cur)
  }
  return {
    total: rows.length,
    firstDay: days[0],
    lastDay: days[days.length - 1],
    currencies: [...new Set(rows.map((r) => r.currency))],
    byCategory: [...totals.entries()]
      .map(([name, v]) => ({ name, target: targetCategoryName(name), ...v }))
      .sort((a, b) => b.count - a.count),
  }
}
