import { useCallback, useEffect, useState } from 'react'
import { fetchAllPages, supabase } from './supabase'
import type { Currency, Trip, TripExpense, TripExpenseDraft, Traveller } from '../types'

/**
 * Everything the Travel tab reads and writes.
 *
 * Deliberately its own store rather than more fields on the main one: travel
 * money is never mixed into a personal total, and keeping the two apart in the
 * client mirrors the tables keeping them apart in the database. The only thing
 * shared is the exchange rate, which the caller hands in — a trip in hryvnia
 * should convert exactly like an expense in hryvnia.
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

/** The rate lookup lives in the main store, which owns the day-rate cache. */
export type ResolveRate = (of: { currency: Currency; spent_on: string }) => Promise<number>

const numeric = (v: unknown) => Number(v ?? 0)

function hydrate(row: Record<string, unknown>): TripExpense {
  return {
    ...(row as unknown as TripExpense),
    amount: numeric(row.amount),
    rate_to_eur: numeric(row.rate_to_eur),
    amount_eur: numeric(row.amount_eur),
  }
}

export function useTravel(userId: string | null, resolveRate: ResolveRate): TravelStore {
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
      try {
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
        setTrips((t.data ?? []) as Trip[])
        setTravellers((p.data ?? []) as Traveller[])
        setTripExpenses(e.map(hydrate))
      } catch (err) {
        if (!cancelled) setTravelError(err instanceof Error ? err.message : 'Could not load your trips.')
      } finally {
        if (!cancelled) setTravelLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [userId])

  /*
   * A trip is created with its people in one go, because a trip with nobody on
   * it cannot record who paid. The travellers are inserted as a second
   * statement — there is no nested insert over PostgREST — and a failure there
   * takes the empty trip back out rather than leaving a half-made one behind.
   */
  const createTrip = useCallback<TravelStore['createTrip']>(async (name, travellerNames) => {
    if (!userId) throw new Error('Not signed in.')
    const { data, error } = await supabase
      .from('trips')
      .insert({ user_id: userId, name })
      .select()
      .single()
    if (error) throw error
    const trip = data as Trip

    const names = dedupe(travellerNames)
    if (names.length > 0) {
      const { data: people, error: peopleError } = await supabase
        .from('travellers')
        .insert(names.map((n) => ({ trip_id: trip.id, user_id: userId, name: n })))
        .select()
      if (peopleError) {
        await supabase.from('trips').delete().eq('id', trip.id)
        throw peopleError
      }
      setTravellers((prev) => [...prev, ...((people ?? []) as Traveller[])])
    }

    setTrips((prev) => [trip, ...prev])
    return trip
  }, [userId])

  const renameTrip = useCallback<TravelStore['renameTrip']>(async (id, name) => {
    const { data, error } = await supabase.from('trips').update({ name }).eq('id', id).select().single()
    if (error) throw error
    setTrips((prev) => prev.map((t) => (t.id === id ? (data as Trip) : t)))
  }, [])

  const deleteTrip = useCallback<TravelStore['deleteTrip']>(async (id) => {
    const { error } = await supabase.from('trips').delete().eq('id', id)
    if (error) throw error
    // Travellers and expenses go with it in the database (ON DELETE CASCADE);
    // drop them here too so nothing lingers until the next load.
    setTrips((prev) => prev.filter((t) => t.id !== id))
    setTravellers((prev) => prev.filter((p) => p.trip_id !== id))
    setTripExpenses((prev) => prev.filter((e) => e.trip_id !== id))
  }, [])

  const addTraveller = useCallback<TravelStore['addTraveller']>(async (tripId, name) => {
    if (!userId) return
    const { data, error } = await supabase
      .from('travellers')
      .insert({ trip_id: tripId, user_id: userId, name })
      .select()
      .single()
    if (error) throw error
    setTravellers((prev) => [...prev, data as Traveller])
  }, [userId])

  const renameTraveller = useCallback<TravelStore['renameTraveller']>(async (id, name) => {
    const { data, error } = await supabase.from('travellers').update({ name }).eq('id', id).select().single()
    if (error) throw error
    setTravellers((prev) => prev.map((p) => (p.id === id ? (data as Traveller) : p)))
  }, [])

  const removeTraveller = useCallback<TravelStore['removeTraveller']>(async (id) => {
    const { error } = await supabase.from('travellers').delete().eq('id', id)
    if (error) throw error
    setTravellers((prev) => prev.filter((p) => p.id !== id))
    // The FK is ON DELETE SET NULL: what they paid stays in the trip total.
    setTripExpenses((prev) => prev.map((e) => (e.traveller_id === id ? { ...e, traveller_id: null } : e)))
  }, [])

  const addTripExpense = useCallback<TravelStore['addTripExpense']>(async (tripId, draft) => {
    if (!userId) return
    const rate = await resolveRate(draft)
    const { data, error } = await supabase
      .from('trip_expenses')
      .insert({ ...draft, trip_id: tripId, user_id: userId, rate_to_eur: rate })
      .select()
      .single()
    if (error) throw error
    setTripExpenses((prev) => sortTripExpenses([hydrate(data), ...prev]))
  }, [userId, resolveRate])

  const updateTripExpense = useCallback<TravelStore['updateTripExpense']>(async (id, draft) => {
    const rate = await resolveRate(draft)
    const { data, error } = await supabase
      .from('trip_expenses')
      .update({ ...draft, rate_to_eur: rate })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    setTripExpenses((prev) => sortTripExpenses(prev.map((e) => (e.id === id ? hydrate(data) : e))))
  }, [resolveRate])

  const deleteTripExpense = useCallback<TravelStore['deleteTripExpense']>(async (id) => {
    const { error } = await supabase.from('trip_expenses').delete().eq('id', id)
    if (error) throw error
    setTripExpenses((prev) => prev.filter((e) => e.id !== id))
  }, [])

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

function sortTripExpenses(list: TripExpense[]): TripExpense[] {
  return [...list].sort((a, b) =>
    a.spent_on === b.spent_on ? b.created_at.localeCompare(a.created_at) : b.spent_on.localeCompare(a.spent_on),
  )
}
