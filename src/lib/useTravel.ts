import { useCallback, useEffect, useState } from 'react'
import { fetchAllPages, supabase } from './supabase'
import { localAll, localDelete, localDeleteMany, localPut, localPutMany, localReplaceUser } from './db'
import { applyPending, dropQueuedFor, flush, queueDelete, queueUpsert, toAmountEur, unlinkQueued } from './sync'
import { newId } from './ids'
import type { Currency, Trip, TripExpense, TripExpenseDraft, Traveller } from '../types'

/**
 * Everything the Travel tab reads and writes.
 *
 * Deliberately its own store rather than more fields on the main one: travel
 * money is never mixed into a personal total, and keeping the two apart in the
 * client mirrors the tables keeping them apart in the database. The only thing
 * shared is the exchange rate, which the caller hands in — a trip in hryvnia
 * should convert exactly like an expense in hryvnia.
 *
 * Reads and writes are local first, like the personal ledger: a trip is the
 * case most likely to be recorded with no connection at all, so every change
 * lands on the device immediately and goes to the server whenever it can.
 */
export interface TravelStore {
  trips: Trip[]
  travellers: Traveller[]
  tripExpenses: TripExpense[]
  travelLoading: boolean
  travelError: string | null
  createTrip: (name: string, travellerNames: string[]) => Promise<Trip>
  renameTrip: (id: string, name: string) => Promise<void>
  deleteTrip: (id: string) => Promise<void>
  addTraveller: (tripId: string, name: string) => Promise<void>
  renameTraveller: (id: string, name: string) => Promise<void>
  removeTraveller: (id: string) => Promise<void>
  addTripExpense: (tripId: string, draft: TripExpenseDraft) => Promise<void>
  updateTripExpense: (id: string, draft: TripExpenseDraft) => Promise<void>
  deleteTripExpense: (id: string) => Promise<void>
}

/**
 * The rate lookup lives in the main store, which owns the day-rate cache.
 * `exact` is false when the day itself was not reachable and the nearest
 * cached one stood in for it.
 */
export type ResolveRate = (
  of: { currency: Currency; spent_on: string },
) => Promise<{ rate: number; exact: boolean }>

const numeric = (v: unknown) => Number(v ?? 0)

function hydrate(row: Record<string, unknown>): TripExpense {
  const amount = numeric(row.amount)
  const rate = numeric(row.rate_to_eur) || 1
  return {
    ...(row as unknown as TripExpense),
    amount,
    rate_to_eur: rate,
    amount_eur: row.amount_eur === undefined ? toAmountEur(amount, rate) : numeric(row.amount_eur),
  }
}

export function useTravel(userId: string | null, canSync: boolean, resolveRate: ResolveRate): TravelStore {
  const [trips, setTrips] = useState<Trip[]>([])
  const [travellers, setTravellers] = useState<Traveller[]>([])
  const [tripExpenses, setTripExpenses] = useState<TripExpense[]>([])
  const [travelLoading, setTravelLoading] = useState(false)
  const [travelError, setTravelError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setTrips([])
      setTravellers([])
      setTripExpenses([])
      return
    }

    let cancelled = false
    setTravelLoading(true)
    setTravelError(null)

    ;(async () => {
      const mine = <T extends { user_id: string }>(rows: T[]) => rows.filter((r) => r.user_id === userId)
      // Whether the device had anything to show before the server was asked.
      let cachedAnything = false

      try {
        const [t, p, e] = await Promise.all([
          localAll<Trip>('trips'),
          localAll<Traveller>('travellers'),
          localAll<Record<string, unknown>>('trip_expenses'),
        ])
        if (cancelled) return
        const localTrips = mine(t)
        cachedAnything = localTrips.length > 0
        setTrips(localTrips.sort(byNewest))
        setTravellers(mine(p))
        setTripExpenses(sortTripExpenses(mine(e.map(hydrate))))
      } catch {
        /* Nothing cached yet — the server pull below covers it. */
      } finally {
        if (!cancelled) setTravelLoading(false)
      }

      if (!navigator.onLine || !canSync) return

      try {
        await flush()
        const [t, p, e] = await Promise.all([
          supabase.from('trips').select('*').order('created_at', { ascending: false }),
          supabase.from('travellers').select('*').order('created_at'),
          // Paged like personal expenses: a long trip with four people on it
          // can pass the server-side row cap on its own.
          fetchAllPages<Record<string, unknown>>((from, to) =>
            supabase
              .from('trip_expenses')
              .select('*')
              .order('spent_on', { ascending: false })
              .order('created_at', { ascending: false })
              .order('id')
              .range(from, to),
          ),
        ])
        if (t.error) throw t.error
        if (p.error) throw p.error
        if (cancelled) return

        const freshTrips = await applyPending<Trip>('trips', userId, (t.data ?? []) as Trip[], (r) => r as unknown as Trip)
        const freshPeople = await applyPending<Traveller>('travellers', userId, (p.data ?? []) as Traveller[], (r) => r as unknown as Traveller)
        const freshSpend = await applyPending<TripExpense>('trip_expenses', userId, e.map(hydrate), hydrate)

        setTrips(freshTrips.sort(byNewest))
        setTravellers(freshPeople)
        setTripExpenses(sortTripExpenses(freshSpend))
        void localReplaceUser('trips', userId, freshTrips)
        void localReplaceUser('travellers', userId, freshPeople)
        void localReplaceUser('trip_expenses', userId, freshSpend)
      } catch (err) {
        // Only worth reporting when there was nothing cached to fall back on.
        if (!cancelled && !cachedAnything) {
          setTravelError(err instanceof Error ? err.message : 'Could not load your trips.')
        }
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, canSync])

  /*
   * A trip is created with its people in one go, because a trip with nobody on
   * it cannot record who paid. Both go into the queue in that order, so the
   * replay inserts the trip before the travellers that reference it.
   */
  const createTrip = useCallback<TravelStore['createTrip']>(async (name, travellerNames) => {
    if (!userId) throw new Error('Not signed in.')
    const created_at = new Date().toISOString()
    const trip: Trip = { id: newId(), user_id: userId, name, created_at }

    const people: Traveller[] = dedupe(travellerNames).map((n) => ({
      id: newId(),
      trip_id: trip.id,
      user_id: userId,
      name: n,
      created_at,
    }))

    setTrips((prev) => [trip, ...prev])
    setTravellers((prev) => [...prev, ...people])
    await localPut('trips', trip)
    await localPutMany('travellers', people)
    await queueUpsert('trips', trip)
    for (const person of people) await queueUpsert('travellers', person)
    return trip
  }, [userId])

  const renameTrip = useCallback<TravelStore['renameTrip']>(async (id, name) => {
    const current = trips.find((t) => t.id === id)
    if (!current) return
    const row = { ...current, name }
    setTrips((prev) => prev.map((t) => (t.id === id ? row : t)))
    await localPut('trips', row)
    await queueUpsert('trips', row)
  }, [trips])

  const deleteTrip = useCallback<TravelStore['deleteTrip']>(async (id) => {
    if (!userId) return
    const people = travellers.filter((p) => p.trip_id === id).map((p) => p.id)
    const spending = tripExpenses.filter((e) => e.trip_id === id).map((e) => e.id)

    // Travellers and expenses go with it in the database (ON DELETE CASCADE);
    // drop them here and out of the queue too, or an unsent one would be
    // replayed afterwards and rejected by the foreign key.
    setTrips((prev) => prev.filter((t) => t.id !== id))
    setTravellers((prev) => prev.filter((p) => p.trip_id !== id))
    setTripExpenses((prev) => prev.filter((e) => e.trip_id !== id))
    await localDelete('trips', id)
    await localDeleteMany('travellers', people)
    await localDeleteMany('trip_expenses', spending)
    await dropQueuedFor('travellers', 'trip_id', id)
    await dropQueuedFor('trip_expenses', 'trip_id', id)
    await queueDelete('trips', userId, id)
  }, [userId, travellers, tripExpenses])

  const addTraveller = useCallback<TravelStore['addTraveller']>(async (tripId, name) => {
    if (!userId) return
    const row: Traveller = {
      id: newId(),
      trip_id: tripId,
      user_id: userId,
      name,
      created_at: new Date().toISOString(),
    }
    setTravellers((prev) => [...prev, row])
    await localPut('travellers', row)
    await queueUpsert('travellers', row)
  }, [userId])

  const renameTraveller = useCallback<TravelStore['renameTraveller']>(async (id, name) => {
    const current = travellers.find((p) => p.id === id)
    if (!current) return
    const row = { ...current, name }
    setTravellers((prev) => prev.map((p) => (p.id === id ? row : p)))
    await localPut('travellers', row)
    await queueUpsert('travellers', row)
  }, [travellers])

  const removeTraveller = useCallback<TravelStore['removeTraveller']>(async (id) => {
    if (!userId) return
    // The FK is ON DELETE SET NULL: what they paid stays in the trip total.
    const orphaned = tripExpenses.filter((e) => e.traveller_id === id).map((e) => ({ ...e, traveller_id: null }))
    setTravellers((prev) => prev.filter((p) => p.id !== id))
    setTripExpenses((prev) => prev.map((e) => (e.traveller_id === id ? { ...e, traveller_id: null } : e)))
    await localDelete('travellers', id)
    await localPutMany('trip_expenses', orphaned)
    await unlinkQueued('trip_expenses', 'traveller_id', id)
    await queueDelete('travellers', userId, id)
  }, [userId, tripExpenses])

  const addTripExpense = useCallback<TravelStore['addTripExpense']>(async (tripId, draft) => {
    if (!userId) return
    const { rate, exact } = await resolveRate(draft)
    const row: TripExpense = {
      id: newId(),
      user_id: userId,
      trip_id: tripId,
      traveller_id: draft.traveller_id,
      amount: draft.amount,
      currency: draft.currency,
      rate_to_eur: rate,
      amount_eur: toAmountEur(draft.amount, rate),
      spent_on: draft.spent_on,
      note: draft.note,
      created_at: new Date().toISOString(),
    }
    setTripExpenses((prev) => sortTripExpenses([row, ...prev]))
    await localPut('trip_expenses', row)
    await queueUpsert('trip_expenses', row, { ratePending: !exact })
  }, [userId, resolveRate])

  const updateTripExpense = useCallback<TravelStore['updateTripExpense']>(async (id, draft) => {
    const current = tripExpenses.find((e) => e.id === id)
    if (!current) return
    const { rate, exact } = await resolveRate(draft)
    const row: TripExpense = {
      ...current,
      ...draft,
      rate_to_eur: rate,
      amount_eur: toAmountEur(draft.amount, rate),
    }
    setTripExpenses((prev) => sortTripExpenses(prev.map((e) => (e.id === id ? row : e))))
    await localPut('trip_expenses', row)
    await queueUpsert('trip_expenses', row, { ratePending: !exact })
  }, [tripExpenses, resolveRate])

  const deleteTripExpense = useCallback<TravelStore['deleteTripExpense']>(async (id) => {
    if (!userId) return
    setTripExpenses((prev) => prev.filter((e) => e.id !== id))
    await localDelete('trip_expenses', id)
    await queueDelete('trip_expenses', userId, id)
  }, [userId])

  return {
    trips, travellers, tripExpenses, travelLoading, travelError,
    createTrip, renameTrip, deleteTrip,
    addTraveller, renameTraveller, removeTraveller,
    addTripExpense, updateTripExpense, deleteTripExpense,
  }
}

/** Trimmed, blank-free, and one row per name — the table's unique index would reject the rest. */
function dedupe(names: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

function byNewest(a: Trip, b: Trip): number {
  return b.created_at.localeCompare(a.created_at)
}

function sortTripExpenses(list: TripExpense[]): TripExpense[] {
  return [...list].sort((a, b) =>
    a.spent_on === b.spent_on ? b.created_at.localeCompare(a.created_at) : b.spent_on.localeCompare(a.spent_on),
  )
}
