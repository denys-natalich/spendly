import { rateToEur } from './fx'
import type { Currency, DayRates, Expense } from '../types'

export type Convert = (e: Expense) => number

/**
 * Builds a function that restates any expense in `currency`.
 *
 * Conversion uses the rate from the day the money was spent, not today's — so
 * five-year-old hryvnia spending reads as the hryvnia actually paid, rather
 * than what that euro amount is worth after the currency moved.
 *
 * An expense already in the target currency returns its stored amount
 * untouched: `amount_eur` is rounded to two decimals, so converting out and
 * back would drift by a kopiyka or a cent.
 */
export function makeConverter(currency: Currency, rates: Map<string, DayRates>): Convert {
  if (currency === 'EUR') return (e) => (e.currency === 'EUR' ? e.amount : e.amount_eur)

  // Sorted once here rather than per lookup — a five-year import asks for a
  // thousand distinct days.
  const days = [...rates.keys()].sort()
  const perDay = new Map<string, number>()

  const rateFor = (day: string): number => {
    const hit = perDay.get(day)
    if (hit !== undefined) return hit
    let best: string | undefined
    for (const d of days) {
      if (d <= day) best = d
      else break
    }
    const resolved = rateToEur(currency, rates.get(best ?? days[0]) ?? null)
    perDay.set(day, resolved)
    return resolved
  }

  return (e) => (e.currency === currency ? e.amount : e.amount_eur * rateFor(e.spent_on))
}
