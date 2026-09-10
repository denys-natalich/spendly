import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isConfigured } from './lib/supabase'
import { ensureRatesFor, loadCachedRates, nearestKnown, rateToEur } from './lib/fx'
import { today } from './lib/format'
import type { Category, DayRates, Expense, ExpenseDraft } from './types'

interface Store {
  session: Session | null
  authLoading: boolean
  loading: boolean
  error: string | null
  categories: Category[]
  expenses: Expense[]
  rates: Map<string, DayRates>
  latestRates: DayRates | null
  sendCode: (email: string) => Promise<void>
  verifyCode: (email: string, code: string) => Promise<void>
  signOut: () => Promise<void>
  addExpense: (draft: ExpenseDraft) => Promise<void>
  updateExpense: (id: string, draft: ExpenseDraft) => Promise<void>
  deleteExpense: (id: string) => Promise<void>
  addCategory: (input: Pick<Category, 'name' | 'icon' | 'color_slot'>) => Promise<void>
  updateCategory: (id: string, patch: Partial<Pick<Category, 'name' | 'icon' | 'color_slot' | 'is_archived'>>) => Promise<void>
  deleteCategory: (id: string) => Promise<void>
}

const StoreContext = createContext<Store | null>(null)

const numeric = (v: unknown) => Number(v ?? 0)

function hydrateExpense(row: Record<string, unknown>): Expense {
  return {
    ...(row as unknown as Expense),
    amount: numeric(row.amount),
    rate_to_eur: numeric(row.rate_to_eur),
    amount_eur: numeric(row.amount_eur),
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [rates, setRates] = useState<Map<string, DayRates>>(new Map())

  // Mutations resolve rates against the freshest map without re-creating every
  // callback on each rate fetch. Mirrored in an effect rather than during render;
  // the initial load assigns it directly so it is never behind on first use.
  const ratesRef = useRef(rates)
  useEffect(() => { ratesRef.current = rates }, [rates])

  useEffect(() => {
    if (!isConfigured) {
      setAuthLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setAuthLoading(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const userId = session?.user.id ?? null

  useEffect(() => {
    if (!userId) {
      setCategories([])
      setExpenses([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      try {
        const [cats, exps, cachedRates] = await Promise.all([
          supabase.from('categories').select('*').order('sort_order').order('name'),
          supabase.from('expenses').select('*').order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(5000),
          loadCachedRates(),
        ])
        if (cats.error) throw cats.error
        if (exps.error) throw exps.error
        if (cancelled) return

        const map = new Map(cachedRates.map((r) => [r.day, r]))
        const starter = cats.data?.length ? null : await seedDefaultCategories(userId)
        setCategories((starter ?? cats.data) as Category[])
        setExpenses((exps.data ?? []).map(hydrateExpense))
        setRates(map)
        ratesRef.current = map

        // Keep today's rate warm so the entry form always converts live.
        const fresh = await ensureRatesFor(today(), map)
        if (!cancelled && fresh) setRates(new Map(map))
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [userId])

  const resolveRate = useCallback(async (draft: ExpenseDraft) => {
    if (draft.currency === 'EUR') return 1
    const map = ratesRef.current
    const before = map.size
    const day = await ensureRatesFor(draft.spent_on, map)
    if (map.size !== before) setRates(new Map(map))
    return rateToEur(draft.currency, day ?? nearestKnown(draft.spent_on, map))
  }, [])

  const addExpense = useCallback(async (draft: ExpenseDraft) => {
    if (!userId) return
    const rate = await resolveRate(draft)
    const { data, error: err } = await supabase
      .from('expenses')
      .insert({ ...draft, user_id: userId, rate_to_eur: rate })
      .select()
      .single()
    if (err) throw err
    setExpenses((prev) => sortExpenses([hydrateExpense(data), ...prev]))
  }, [userId, resolveRate])

  const updateExpense = useCallback(async (id: string, draft: ExpenseDraft) => {
    const rate = await resolveRate(draft)
    const { data, error: err } = await supabase
      .from('expenses')
      .update({ ...draft, rate_to_eur: rate })
      .eq('id', id)
      .select()
      .single()
    if (err) throw err
    setExpenses((prev) => sortExpenses(prev.map((e) => (e.id === id ? hydrateExpense(data) : e))))
  }, [resolveRate])

  const deleteExpense = useCallback(async (id: string) => {
    const { error: err } = await supabase.from('expenses').delete().eq('id', id)
    if (err) throw err
    setExpenses((prev) => prev.filter((e) => e.id !== id))
  }, [])

  const addCategory = useCallback(async (input: Pick<Category, 'name' | 'icon' | 'color_slot'>) => {
    if (!userId) return
    const nextOrder = categories.reduce((max, c) => Math.max(max, c.sort_order), 0) + 10
    const { data, error: err } = await supabase
      .from('categories')
      .insert({ ...input, user_id: userId, sort_order: nextOrder })
      .select()
      .single()
    if (err) throw err
    setCategories((prev) => [...prev, data as Category].sort(byCategoryOrder))
  }, [userId, categories])

  const updateCategory = useCallback<Store['updateCategory']>(async (id, patch) => {
    const { data, error: err } = await supabase.from('categories').update(patch).eq('id', id).select().single()
    if (err) throw err
    setCategories((prev) => prev.map((c) => (c.id === id ? (data as Category) : c)).sort(byCategoryOrder))
  }, [])

  const deleteCategory = useCallback(async (id: string) => {
    const { error: err } = await supabase.from('categories').delete().eq('id', id)
    if (err) throw err
    setCategories((prev) => prev.filter((c) => c.id !== id))
    // The FK is ON DELETE SET NULL, so surviving expenses become uncategorised.
    setExpenses((prev) => prev.map((e) => (e.category_id === id ? { ...e, category_id: null } : e)))
  }, [])

  /*
   * Six-digit code rather than a magic link. Two reasons: mail providers
   * pre-fetch links to scan them, which burns the single-use token before the
   * human clicks it; and on iOS a link always opens in the browser, never in an
   * installed home-screen app, so the session would land in the wrong storage.
   * Omitting emailRedirectTo is what makes Supabase send the token, not a URL.
   */
  const sendCode = useCallback(async (email: string) => {
    const { error: err } = await supabase.auth.signInWithOtp({ email })
    if (err) throw err
  }, [])

  const verifyCode = useCallback(async (email: string, code: string) => {
    const { error: err } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })
    if (err) throw err
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const latestRates = useMemo(() => nearestKnown(today(), rates), [rates])

  const value: Store = {
    session, authLoading, loading, error, categories, expenses, rates, latestRates,
    sendCode, verifyCode, signOut, addExpense, updateExpense, deleteExpense,
    addCategory, updateCategory, deleteCategory,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

const DEFAULT_CATEGORIES: Array<Pick<Category, 'name' | 'icon' | 'color_slot' | 'sort_order'>> = [
  { name: 'Groceries', icon: 'shopping-cart', color_slot: 3, sort_order: 10 },
  { name: 'Eating out', icon: 'utensils', color_slot: 2, sort_order: 20 },
  { name: 'Transport', icon: 'bus', color_slot: 1, sort_order: 30 },
  { name: 'Housing', icon: 'house', color_slot: 7, sort_order: 40 },
  { name: 'Utilities', icon: 'plug', color_slot: 4, sort_order: 50 },
  { name: 'Health', icon: 'heart-pulse', color_slot: 6, sort_order: 60 },
  { name: 'Subscriptions', icon: 'repeat', color_slot: 5, sort_order: 70 },
  { name: 'Other', icon: 'tag', color_slot: 1, sort_order: 999 },
]

/** Gives a brand-new account something to file expenses under. */
async function seedDefaultCategories(userId: string): Promise<Category[] | null> {
  const { data, error } = await supabase
    .from('categories')
    .insert(DEFAULT_CATEGORIES.map((c) => ({ ...c, user_id: userId })))
    .select()
  if (error) return null
  return data as Category[]
}

function sortExpenses(list: Expense[]): Expense[] {
  return [...list].sort((a, b) =>
    a.spent_on === b.spent_on ? b.created_at.localeCompare(a.created_at) : b.spent_on.localeCompare(a.spent_on),
  )
}

function byCategoryOrder(a: Category, b: Category): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name)
}

export function useStore(): Store {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>')
  return ctx
}
