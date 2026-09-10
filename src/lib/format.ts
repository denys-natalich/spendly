import type { Currency } from '../types'

const SYMBOL: Record<Currency, string> = { EUR: '€', USD: '$', UAH: '₴' }

export function symbolOf(currency: Currency): string {
  return SYMBOL[currency]
}

export function money(amount: number, currency: Currency, opts: { decimals?: boolean } = {}): string {
  const decimals = opts.decimals ?? true
  const n = amount.toLocaleString('en-GB', {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  })
  return `${SYMBOL[currency]}${n}`
}

/** Compact form for chart axes: €1.2k, €340. */
export function moneyShort(amount: number, currency: Currency): string {
  const abs = Math.abs(amount)
  if (abs >= 1000) return `${SYMBOL[currency]}${(amount / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`
  return `${SYMBOL[currency]}${Math.round(amount)}`
}

export function today(): string {
  return toISODate(new Date())
}

export function toISODate(d: Date): string {
  // Local calendar date — toISOString() would shift across the UTC boundary.
  const m = `${d.getMonth() + 1}`.padStart(2, '0')
  const day = `${d.getDate()}`.padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function monthLabel(key: string, opts: { long?: boolean } = {}): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', {
    month: opts.long ? 'long' : 'short',
    year: opts.long ? 'numeric' : '2-digit',
  })
}

export function dayLabel(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const now = new Date()
  const diff = Math.round((+new Date(now.getFullYear(), now.getMonth(), now.getDate()) - +date) / 86_400_000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return date.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  })
}

export function addMonths(key: string, delta: number): string {
  const [y, m] = key.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}`
}
