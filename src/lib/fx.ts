import { supabase } from './supabase'
import type { Currency, DayRates } from '../types'
import { toISODate } from './format'

/*
 * Rates are stored as "units of X per 1 EUR" for a given calendar day.
 *
 * Primary source is the National Bank of Ukraine: it is the authoritative rate
 * for UAH, is free, needs no key, sends `access-control-allow-origin: *`, and —
 * unlike the ECB feeds — publishes for weekends too. It quotes UAH per unit, so
 * the EUR base is derived: usd_per_eur = uah_per_eur / uah_per_usd.
 *
 * Every day the app touches gets written to the shared `fx_rates` table, so a
 * date is fetched from the network at most once ever, by whoever needs it first.
 */

const NBU = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange'
const FALLBACK = 'https://open.er-api.com/v6/latest/EUR'

function compact(isoDate: string): string {
  return isoDate.replaceAll('-', '')
}

async function fetchFromNbu(isoDate: string): Promise<DayRates | null> {
  const res = await fetch(`${NBU}?json&date=${compact(isoDate)}`)
  if (!res.ok) return null
  const rows: Array<{ cc: string; rate: number }> = await res.json()
  const uahPerUsd = rows.find((r) => r.cc === 'USD')?.rate
  const uahPerEur = rows.find((r) => r.cc === 'EUR')?.rate
  if (!uahPerUsd || !uahPerEur) return null
  return { day: isoDate, usd: uahPerEur / uahPerUsd, uah: uahPerEur }
}

/** Latest-only backup, used when NBU is unreachable and we need today's rate. */
async function fetchFromFallback(isoDate: string): Promise<DayRates | null> {
  const res = await fetch(FALLBACK)
  if (!res.ok) return null
  const data = await res.json()
  const usd = data?.rates?.USD
  const uah = data?.rates?.UAH
  if (!usd || !uah) return null
  return { day: isoDate, usd, uah }
}

export async function loadCachedRates(): Promise<DayRates[]> {
  const { data, error } = await supabase
    .from('fx_rates')
    .select('day, usd, uah')
    .order('day', { ascending: false })
    .limit(800)
  if (error) throw error
  return (data ?? []).map((r) => ({ day: r.day, usd: Number(r.usd), uah: Number(r.uah) }))
}

/**
 * Resolve rates for one day, fetching and caching if we have never seen it.
 * `known` is the in-memory cache; the caller merges the result back in.
 */
export async function ensureRatesFor(isoDate: string, known: Map<string, DayRates>): Promise<DayRates | null> {
  const hit = known.get(isoDate)
  if (hit) return hit

  let fetched: DayRates | null = null
  try {
    fetched = await fetchFromNbu(isoDate)
  } catch {
    fetched = null
  }
  if (!fetched && isoDate === toISODate(new Date())) {
    try {
      fetched = await fetchFromFallback(isoDate)
    } catch {
      fetched = null
    }
  }
  if (!fetched) return nearestKnown(isoDate, known)

  // Ignore write failures: a cache miss is recoverable, a crash is not.
  await supabase.from('fx_rates').insert({ day: fetched.day, usd: fetched.usd, uah: fetched.uah }).then(
    () => undefined,
    () => undefined,
  )
  known.set(fetched.day, fetched)
  return fetched
}

/** Closest day at or before the target, else the earliest day we have. */
export function nearestKnown(isoDate: string, known: Map<string, DayRates>): DayRates | null {
  if (known.size === 0) return null
  const days = [...known.keys()].sort()
  let best: string | null = null
  for (const d of days) {
    if (d <= isoDate) best = d
    else break
  }
  return known.get(best ?? days[0]) ?? null
}

/** Units of `currency` per 1 EUR on that day — the value stored on an expense. */
export function rateToEur(currency: Currency, rates: DayRates | null): number {
  if (currency === 'EUR') return 1
  if (!rates) return 1
  return currency === 'USD' ? rates.usd : rates.uah
}

/** Convert a base-currency (EUR) amount into `currency` for display. */
export function fromEur(amountEur: number, currency: Currency, rates: DayRates | null): number {
  return amountEur * rateToEur(currency, rates)
}
