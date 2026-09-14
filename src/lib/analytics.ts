import type { Category, Convertible, Expense } from '../types'
import type { Convert } from './convert'
import { addMonths, monthKey } from './format'
import { UNCATEGORISED_COLOR, slotColor } from './icons'
import type { TrendPoint } from '../components/charts'

export function expensesInMonth(expenses: Expense[], key: string): Expense[] {
  return expenses.filter((e) => monthKey(e.spent_on) === key)
}

export function total(expenses: Convertible[], convert: Convert): number {
  return expenses.reduce((sum, e) => sum + convert(e), 0)
}

export interface CategoryTotal {
  key: string
  name: string
  color: string
  value: number
  count: number
}

/** Every category with spend, ranked. Colour follows the category, not the rank. */
export function byCategory(expenses: Expense[], categories: Category[], convert: Convert): CategoryTotal[] {
  const index = new Map(categories.map((c) => [c.id, c]))
  const totals = new Map<string, CategoryTotal>()

  for (const e of expenses) {
    const cat = e.category_id ? index.get(e.category_id) : undefined
    const key = cat?.id ?? 'uncategorised'
    const row = totals.get(key) ?? {
      key,
      name: cat?.name ?? 'Uncategorised',
      color: cat ? slotColor(cat.color_slot) : UNCATEGORISED_COLOR,
      value: 0,
      count: 0,
    }
    row.value += convert(e)
    row.count += 1
    totals.set(key, row)
  }

  return [...totals.values()].sort((a, b) => b.value - a.value)
}

/** A contiguous run of months ending at `endKey`, zero-filled so gaps show. */
export function monthlyTrend(
  expenses: Expense[],
  endKey: string,
  months: number,
  convert: Convert,
): TrendPoint[] {
  const sums = new Map<string, number>()
  for (const e of expenses) {
    const k = monthKey(e.spent_on)
    sums.set(k, (sums.get(k) ?? 0) + convert(e))
  }
  return Array.from({ length: months }, (_, i) => {
    const key = addMonths(endKey, i - months + 1)
    return { key, value: Number((sums.get(key) ?? 0).toFixed(2)) }
  })
}

/** Generic over the row type, so the travel list can reuse the day grouping. */
export function groupByDay<T extends Convertible>(
  expenses: T[],
  convert: Convert,
): Array<{ day: string; items: T[]; total: number }> {
  const days = new Map<string, T[]>()
  for (const e of expenses) {
    const list = days.get(e.spent_on)
    if (list) list.push(e)
    else days.set(e.spent_on, [e])
  }
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, items]) => ({ day, items, total: total(items, convert) }))
}

/** Stands in for a traveller who was removed after paying for something. */
export const UNASSIGNED = 'unassigned'

export interface TravellerTotal {
  key: string
  name: string
  color: string
  /** What this person actually put on the table, in the reporting currency. */
  paid: number
  count: number
  /** Their share if the trip is split evenly between everyone on it. */
  share: number
  /** paid − share: positive means the trip owes them, negative means they owe it. */
  balance: number
}

/**
 * Per-person totals for one trip, biggest payer first. Everyone on the trip is
 * listed, including those who have not paid for anything yet — a zero row is
 * how you see that someone owes their whole share.
 *
 * Expenses whose traveller was removed keep their money in the trip total and
 * collect under an "Unassigned" row, which carries no share of its own.
 */
export function byTraveller(
  expenses: ReadonlyArray<Convertible & { traveller_id: string | null }>,
  travellers: ReadonlyArray<{ id: string; name: string }>,
  convert: Convert,
): TravellerTotal[] {
  const rows = new Map<string, TravellerTotal>()
  travellers.forEach((t, i) => {
    rows.set(t.id, {
      key: t.id, name: t.name, color: slotColor(i + 1), paid: 0, count: 0, share: 0, balance: 0,
    })
  })

  let spent = 0
  for (const e of expenses) {
    const value = convert(e)
    spent += value
    const row = rows.get(e.traveller_id ?? UNASSIGNED) ?? {
      key: UNASSIGNED, name: 'Unassigned', color: UNCATEGORISED_COLOR, paid: 0, count: 0, share: 0, balance: 0,
    }
    row.paid += value
    row.count += 1
    rows.set(row.key, row)
  }

  const share = travellers.length > 0 ? spent / travellers.length : 0
  for (const row of rows.values()) {
    row.share = row.key === UNASSIGNED ? 0 : share
    row.balance = row.paid - row.share
  }

  return [...rows.values()].sort((a, b) => b.paid - a.paid || a.name.localeCompare(b.name))
}
