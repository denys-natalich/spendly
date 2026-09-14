import { useCallback, useEffect, useMemo, useState } from 'react'
import { localGet, localPut } from './db'
import { applyPendingShare, flush, offlineRate, queueShareDelete, queueShareUpsert, toAmountEur } from './sync'
import {
  addSharedTraveller, fetchSharedTrip, ShareGoneError,
  type SharedExpense, type SharedTraveller, type SharedTrip, type SharedTripSnapshot,
} from './share'
import { newId } from './ids'
import type { Currency, DayRates, TripExpenseDraft } from '../types'

/**
 * The trip behind a share link, for someone who has no account.
 *
 * Local first for the same reason the rest of the app is: a trip is where the
 * signal is worst and the spending is most easily forgotten. The snapshot that
 * came back last time is kept on the device and rendered immediately; new
 * entries go into the same queue as everything else and are sent through the
 * link's database functions when there is a connection.
 */

interface CachedSnapshot extends SharedTripSnapshot {
  token: string
  fetched_at: string
}

export interface SharedTripStore {
  loading: boolean
  /** The link is revoked or wrong — a dead end, not a dropped connection. */
  gone: boolean
  error: string | null
  trip: SharedTrip | null
  travellers: SharedTraveller[]
  expenses: SharedExpense[]
  rates: Map<string, DayRates>
  /** The share this device is using: only its own rows may be changed. */
  shareId: string | null
  addExpense: (draft: TripExpenseDraft) => Promise<void>
  updateExpense: (id: string, draft: TripExpenseDraft) => Promise<void>
  deleteExpense: (id: string) => Promise<void>
  addTraveller: (name: string) => Promise<SharedTraveller>
  refresh: () => Promise<void>
}

const numeric = (v: unknown) => Number(v ?? 0)

function hydrate(input: SharedExpense | Record<string, unknown>): SharedExpense {
  const row = input as Record<string, unknown>
  const amount = numeric(row.amount)
  const rate = numeric(row.rate_to_eur) || 1
  return {
    ...(row as unknown as SharedExpense),
    amount,
    rate_to_eur: rate,
    amount_eur: row.amount_eur === undefined ? toAmountEur(amount, rate) : numeric(row.amount_eur),
  }
}

export function useSharedTrip(token: string): SharedTripStore {
  const [snapshot, setSnapshot] = useState<CachedSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [gone, setGone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const merge = useCallback(async (next: SharedTripSnapshot) => {
    // Anything still queued goes back on top, so a refresh that races an
    // unsent entry cannot make it vanish from the screen.
    const expenses = await applyPendingShare(token, next.expenses.map(hydrate), hydrate)
    const cached: CachedSnapshot = { ...next, expenses, token, fetched_at: new Date().toISOString() }
    setSnapshot(cached)
    await localPut('shared_trips', cached)
  }, [token])

  const refresh = useCallback(async () => {
    if (!navigator.onLine) return
    try {
      await flush()
      await merge(await fetchSharedTrip(token))
      setGone(false)
      setError(null)
    } catch (e) {
      if (e instanceof ShareGoneError) setGone(true)
      else setError(e instanceof Error ? e.message : 'Could not open this trip.')
    }
  }, [token, merge])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const cached = await localGet<CachedSnapshot>('shared_trips', token)
      if (!cancelled && cached) {
        setSnapshot({ ...cached, expenses: cached.expenses.map(hydrate) })
        setLoading(false)
      }
      await refresh()
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
  }, [token, refresh])

  // Coming back to the app is the moment someone else's entries are worth
  // fetching — on a trip, several people are adding to the same list.
  useEffect(() => {
    const onFocus = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('online', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('online', onFocus)
    }
  }, [refresh])

  const rates = useMemo(
    () => new Map((snapshot?.rates ?? []).map((r) => [r.day, r])),
    [snapshot?.rates],
  )

  /** Writes the row locally and queues it. The rate works like everywhere else. */
  const put = useCallback(async (row: SharedExpense, exact: boolean) => {
    setSnapshot((prev) => {
      if (!prev) return prev
      const rest = prev.expenses.filter((e) => e.id !== row.id)
      const next = { ...prev, expenses: sortExpenses([row, ...rest]) }
      void localPut('shared_trips', next)
      return next
    })
    await queueShareUpsert(token, row as unknown as { id: string } & Record<string, unknown>, {
      ratePending: !exact,
    })
  }, [token])

  const addExpense = useCallback<SharedTripStore['addExpense']>(async (draft) => {
    if (!snapshot) return
    const { rate, exact } = offlineRate(draft.currency as Currency, draft.spent_on, rates)
    await put({
      id: newId(),
      trip_id: snapshot.trip.id,
      traveller_id: draft.traveller_id,
      amount: draft.amount,
      currency: draft.currency,
      rate_to_eur: rate,
      amount_eur: toAmountEur(draft.amount, rate),
      spent_on: draft.spent_on,
      note: draft.note,
      created_at: new Date().toISOString(),
      created_via: snapshot.share_id,
    }, exact)
  }, [snapshot, rates, put])

  const updateExpense = useCallback<SharedTripStore['updateExpense']>(async (id, draft) => {
    const current = snapshot?.expenses.find((e) => e.id === id)
    if (!current) return
    const { rate, exact } = offlineRate(draft.currency as Currency, draft.spent_on, rates)
    await put({
      ...current,
      ...draft,
      rate_to_eur: rate,
      amount_eur: toAmountEur(draft.amount, rate),
    }, exact)
  }, [snapshot, rates, put])

  const deleteExpense = useCallback<SharedTripStore['deleteExpense']>(async (id) => {
    setSnapshot((prev) => {
      if (!prev) return prev
      const next = { ...prev, expenses: prev.expenses.filter((e) => e.id !== id) }
      void localPut('shared_trips', next)
      return next
    })
    await queueShareDelete(token, id)
  }, [token])

  /*
   * Joining the trip needs a connection, unlike everything else here. A person
   * added offline would have an id this device invented, and the expenses
   * pointing at it would be refused when the real row came back with a
   * different one — so the row is made server-side, once, and only then
   * becomes something to record against.
   */
  const addTraveller = useCallback<SharedTripStore['addTraveller']>(async (name) => {
    if (!navigator.onLine) throw new Error('Adding yourself to the trip needs a connection.')
    const person = await addSharedTraveller(token, name)
    setSnapshot((prev) => {
      if (!prev) return prev
      if (prev.travellers.some((p) => p.id === person.id)) return prev
      const next = { ...prev, travellers: [...prev.travellers, person] }
      void localPut('shared_trips', next)
      return next
    })
    return person
  }, [token])

  return {
    loading,
    gone,
    error,
    trip: snapshot?.trip ?? null,
    travellers: snapshot?.travellers ?? [],
    expenses: snapshot?.expenses ?? [],
    rates,
    shareId: snapshot?.share_id ?? null,
    addExpense,
    updateExpense,
    deleteExpense,
    addTraveller,
    refresh,
  }
}

function sortExpenses(list: SharedExpense[]): SharedExpense[] {
  return [...list].sort((a, b) =>
    a.spent_on === b.spent_on ? b.created_at.localeCompare(a.created_at) : b.spent_on.localeCompare(a.spent_on),
  )
}
