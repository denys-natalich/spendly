export const CURRENCIES = ['EUR', 'USD', 'UAH'] as const
export type Currency = (typeof CURRENCIES)[number]

/** Everything is reported in this currency; per-expense amounts convert into it. */
export const BASE_CURRENCY: Currency = 'EUR'

/**
 * The fields a conversion needs. Both an ordinary expense and a travel expense
 * satisfy it, so one converter restates either in the reporting currency.
 */
export interface Convertible {
  amount: number
  currency: Currency
  amount_eur: number
  spent_on: string
}

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

export interface Expense extends Convertible {
  id: string
  user_id: string
  category_id: string | null
  rate_to_eur: number
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

/*
 * Travel. A trip is a named pot with a handful of people in it, kept in its own
 * tables rather than as a flag on `expenses`: a trip is shared spending, mostly
 * fronted for other people, so it must never land in the monthly total or the
 * category breakdown. Separate tables make that structural instead of a filter
 * every future query has to remember.
 */
export interface Trip {
  id: string
  user_id: string
  name: string
  created_at: string
}

export interface Traveller {
  id: string
  trip_id: string
  user_id: string
  name: string
  created_at: string
}

/** Who paid is the point of a travel expense, so it carries a traveller, not a category. */
export interface TripExpense extends Convertible {
  id: string
  user_id: string
  trip_id: string
  traveller_id: string | null
  rate_to_eur: number
  spent_on: string // YYYY-MM-DD
  note: string | null
  created_at: string
}

export interface TripExpenseDraft {
  traveller_id: string | null
  amount: number
  currency: Currency
  spent_on: string
  note: string | null
}

/*
 * Debts. A debt is a name and the amount owed; each instalment recorded
 * against it is a payment that brings what is left down. Kept in its own
 * tables like travel: repaying a loan is not a spending category, and must not
 * move the monthly total.
 */
export interface Debt {
  id: string
  user_id: string
  name: string
  /** The total owed, in `currency`. */
  amount: number
  /** Every instalment is in this currency — a loan is repaid in what it was taken in. */
  currency: Currency
  created_at: string
}

export interface DebtDraft {
  name: string
  amount: number
  currency: Currency
}

/** One payment towards a debt. */
export interface DebtInstallment {
  id: string
  user_id: string
  debt_id: string
  amount: number
  description: string | null
  paid_on: string // YYYY-MM-DD
  created_at: string
}

export interface DebtInstallmentDraft {
  amount: number
  description: string | null
  paid_on: string
}

/** Units of each currency per 1 EUR on a given day. EUR is always 1. */
export interface DayRates {
  day: string
  usd: number
  uah: number
}
