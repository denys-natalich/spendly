export const CURRENCIES = ['EUR', 'USD', 'UAH'] as const
export type Currency = (typeof CURRENCIES)[number]

/** Everything is reported in this currency; per-expense amounts convert into it. */
export const BASE_CURRENCY: Currency = 'EUR'

export interface Category {
  id: string
  user_id: string
  name: string
  icon: string
  color_slot: number
  sort_order: number
  is_archived: boolean
  created_at: string
}

export interface Expense {
  id: string
  user_id: string
  category_id: string | null
  amount: number
  currency: Currency
  rate_to_eur: number
  amount_eur: number
  spent_on: string // YYYY-MM-DD
  note: string | null
  created_at: string
}

export interface ExpenseDraft {
  category_id: string | null
  amount: number
  currency: Currency
  spent_on: string
  note: string | null
}

/** Units of each currency per 1 EUR on a given day. EUR is always 1. */
export interface DayRates {
  day: string
  usd: number
  uah: number
}
