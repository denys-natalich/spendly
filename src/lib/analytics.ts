import type { Category, Expense } from '../types'
import { addMonths, monthKey } from './format'
import { UNCATEGORISED_COLOR, slotColor } from './icons'
import type { Slice, TrendPoint } from '../components/charts'

/** Six named slices is the readable limit for a donut; the rest folds into Other. */
const MAX_SLICES = 6

export function expensesInMonth(expenses: Expense[], key: string): Expense[] {
  return expenses.filter((e) => monthKey(e.spent_on) === key)
}

export function totalEur(expenses: Expense[]): number {
  return expenses.reduce((sum, e) => sum + e.amount_eur, 0)
}

export interface CategoryTotal {
  key: string
  name: string
  color: string
  value: number
  count: number
}

/** Every category with spend, ranked. Colour follows the category, not the rank. */
export function byCategory(expenses: Expense[], categories: Category[]): CategoryTotal[] {
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
    row.value += e.amount_eur
    row.count += 1
    totals.set(key, row)
  }

  return [...totals.values()].sort((a, b) => b.value - a.value)
}

export function toSlices(totals: CategoryTotal[]): Slice[] {
  if (totals.length <= MAX_SLICES + 1) return totals.map(stripCount)
  const head = totals.slice(0, MAX_SLICES).map(stripCount)
  const rest = totals.slice(MAX_SLICES)
  return [
    ...head,
    {
      key: 'other',
      name: `+${rest.length} more`,
      value: rest.reduce((s, r) => s + r.value, 0),
      color: UNCATEGORISED_COLOR,
    },
  ]
}

function stripCount({ key, name, value, color }: CategoryTotal): Slice {
  return { key, name, value, color }
}

/** A contiguous run of months ending at `endKey`, zero-filled so gaps show. */
export function monthlyTrend(expenses: Expense[], endKey: string, months: number): TrendPoint[] {
  const sums = new Map<string, number>()
  for (const e of expenses) {
    const k = monthKey(e.spent_on)
    sums.set(k, (sums.get(k) ?? 0) + e.amount_eur)
  }
  return Array.from({ length: months }, (_, i) => {
    const key = addMonths(endKey, i - months + 1)
    return { key, value: Number((sums.get(key) ?? 0).toFixed(2)) }
  })
}

export function groupByDay(expenses: Expense[]): Array<{ day: string; items: Expense[]; total: number }> {
  const days = new Map<string, Expense[]>()
  for (const e of expenses) {
    const list = days.get(e.spent_on)
    if (list) list.push(e)
    else days.set(e.spent_on, [e])
  }
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([day, items]) => ({ day, items, total: totalEur(items) }))
}
