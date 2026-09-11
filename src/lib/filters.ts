import type { Expense } from '../types'
import { monthKey, monthLabel, today, toISODate } from './format'

export type DateRange =
  | { kind: 'all' }
  | { kind: 'last'; days: number }
  | { kind: 'month'; month: string } // YYYY-MM
  | { kind: 'custom'; from: string; to: string }

/** `'all'` means every category; `'none'` means the uncategorised ones. */
export type CategoryFilter = 'all' | 'none' | (string & {})

export interface ExpenseFilter {
  category: CategoryFilter
  range: DateRange
  query: string
}

/** Expenses tab: one row per expense grouped by day, or one row per category. */
export type ExpensesView = 'days' | 'categories'

export const DEFAULT_FILTER: ExpenseFilter = {
  category: 'all',
  range: { kind: 'last', days: 30 },
  query: '',
}

export function shiftDays(isoDate: string, delta: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return toISODate(new Date(y, m - 1, d + delta))
}

export function inRange(day: string, range: DateRange, now: string): boolean {
  switch (range.kind) {
    case 'all':
      return true
    case 'month':
      return monthKey(day) === range.month
    case 'last':
      // Inclusive of today, so "last 7 days" is today plus the previous six.
      return day >= shiftDays(now, -(range.days - 1)) && day <= now
    case 'custom':
      return (!range.from || day >= range.from) && (!range.to || day <= range.to)
  }
}

export function applyFilter(
  expenses: Expense[],
  filter: ExpenseFilter,
  categoryNames: Map<string, string>,
): Expense[] {
  const now = today()
  const q = filter.query.trim().toLowerCase()

  return expenses.filter((e) => {
    if (filter.category === 'none') {
      if (e.category_id !== null) return false
    } else if (filter.category !== 'all' && e.category_id !== filter.category) {
      return false
    }
    if (!inRange(e.spent_on, filter.range, now)) return false
    if (!q) return true
    const name = e.category_id ? (categoryNames.get(e.category_id) ?? '') : 'uncategorised'
    return `${e.note ?? ''} ${name}`.toLowerCase().includes(q)
  })
}

export function rangeLabel(range: DateRange): string {
  switch (range.kind) {
    case 'all':
      return 'All time'
    case 'last':
      return `Last ${range.days} days`
    case 'month':
      return monthLabel(range.month, { long: true })
    case 'custom':
      return range.from && range.to ? `${range.from} → ${range.to}` : 'Custom range'
  }
}
