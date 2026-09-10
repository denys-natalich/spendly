import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, isConfigured } from './lib/supabase'
import { backfillRates, ensureRatesFor, loadCachedRates, nearestKnown, rateToEur } from './lib/fx'
import { makeConverter, type Convert } from './lib/convert'
import { NEW_CATEGORY_ICONS, targetCategoryName, type MonefyRow } from './lib/monefy'
import { today } from './lib/format'
import { BASE_CURRENCY, CURRENCIES } from './types'
import type { Category, Currency, DayRates, Expense, ExpenseDraft } from './types'

interface Store {
  session: Session | null
  authLoading: boolean
  loading: boolean
  error: string | null
  categories: Category[]
  expenses: Expense[]
  rates: Map<string, DayRates>
  latestRates: DayRates | null
  /** Currency every total and chart is shown in. Storage is always EUR-based. */
  displayCurrency: Currency
  setDisplayCurrency: (c: Currency) => void
  convert: Convert
  signIn: (email: string, password: string) => Promise<void>
  setPassword: (password: string) => Promise<void>
  signOut: () => Promise<void>
  addExpense: (draft: ExpenseDraft) => Promise<void>
  updateExpense: (id: string, draft: ExpenseDraft) => Promise<void>
  deleteExpense: (id: string) => Promise<void>
  addCategory: (input: Pick<Category, 'name' | 'icon' | 'color_slot'>) => Promise<void>
  updateCategory: (id: string, patch: Partial<Pick<Category, 'name' | 'icon' | 'color_slot' | 'is_archived'>>) => Promise<void>
  deleteCategory: (id: string) => Promise<void>
  importExpenses: (rows: MonefyRow[], onProgress: (p: ImportProgress) => void) => Promise<ImportResult>
}

export interface ImportProgress {
  phase: 'rates' | 'categories' | 'expenses'
  done: number
  total: number
}

export interface ImportResult {
  inserted: number
  skippedAsDuplicate: number
  categoriesCreated: string[]
  ratesCached: number
}

const StoreContext = createContext<Store | null>(null)

const DISPLAY_KEY = 'spendly.displayCurrency'

function readDisplayCurrency(): Currency {
  try {
    const v = localStorage.getItem(DISPLAY_KEY)
    if (v && (CURRENCIES as readonly string[]).includes(v)) return v as Currency
  } catch {
    /* ignore */
  }
  return BASE_CURRENCY
}

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
  const [displayCurrency, setDisplayCurrencyState] = useState<Currency>(readDisplayCurrency)

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
   * Password rather than an emailed link or code, because every email-based
   * flow breaks somewhere here. Links get pre-fetched by mail scanners, which
   * spends the single-use token before the human clicks it. On iOS a link
   * always opens in the browser, never in an installed home-screen app, whose
   * storage is separate — so the installed app could never be signed in.
   * And Supabase only allows editing the email template with custom SMTP
   * configured, which rules out putting a code in the message at all.
   *
   * A password sidesteps the lot: it is typed inside the app, on the device
   * that needs the session, with no third party in the path.
   */
  /*
   * Bulk import. Three phases, each reported so a five-year file doesn't look
   * like a hang:
   *   rates      — one range request per currency, not one per day
   *   categories — create whatever the file references and the account lacks
   *   expenses   — batched inserts, skipping rows already present
   *
   * Duplicate detection counts occurrences rather than matching on content
   * alone: two identical ₴10 bus fares on the same day are two real expenses,
   * so only the excess over what is already stored gets skipped.
   */
  const importExpenses = useCallback<Store['importExpenses']>(async (rows, onProgress) => {
    if (!userId || rows.length === 0) {
      return { inserted: 0, skippedAsDuplicate: 0, categoriesCreated: [], ratesCached: 0 }
    }

    const days = rows.map((r) => r.spent_on).sort()
    onProgress({ phase: 'rates', done: 0, total: 1 })
    const rateMap = ratesRef.current
    const ratesCached = await backfillRates(days[0], days[days.length - 1], rateMap)
    setRates(new Map(rateMap))
    onProgress({ phase: 'rates', done: 1, total: 1 })

    // --- categories -------------------------------------------------------
    onProgress({ phase: 'categories', done: 0, total: 1 })
    const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]))
    const wanted = [...new Set(rows.map((r) => targetCategoryName(r.category)))]
    const missing = wanted.filter((n) => !byName.has(n.toLowerCase()))
    const created: string[] = []

    if (missing.length > 0) {
      const usage = new Map<number, number>()
      for (const c of categories) usage.set(c.color_slot, (usage.get(c.color_slot) ?? 0) + 1)
      let order = categories.reduce((max, c) => Math.max(max, c.sort_order), 0)

      const payload = missing.map((name) => {
        // Spread new categories over the least-used palette slots.
        let slot = 1
        let best = Infinity
        for (let i = 1; i <= 7; i++) {
          const n = usage.get(i) ?? 0
          if (n < best) { best = n; slot = i }
        }
        usage.set(slot, best + 1)
        order += 10
        return {
          user_id: userId,
          name,
          icon: NEW_CATEGORY_ICONS[name] ?? 'tag',
          color_slot: slot,
          sort_order: order,
        }
      })

      const { data, error: err } = await supabase.from('categories').insert(payload).select()
      if (err) throw err
      for (const c of (data ?? []) as Category[]) {
        byName.set(c.name.toLowerCase(), c)
        created.push(c.name)
      }
      setCategories((prev) => [...prev, ...((data ?? []) as Category[])].sort(byCategoryOrder))
    }
    onProgress({ phase: 'categories', done: 1, total: 1 })

    // --- skip what is already stored --------------------------------------
    const seen = new Map<string, number>()
    for (const e of expenses) {
      const k = fingerprint(e.spent_on, e.category_id, e.amount, e.currency, e.note)
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }

    const pending: Array<Record<string, unknown>> = []
    let skippedAsDuplicate = 0
    for (const r of rows) {
      const cat = byName.get(targetCategoryName(r.category).toLowerCase())
      const key = fingerprint(r.spent_on, cat?.id ?? null, r.amount, r.currency, r.note)
      const remaining = seen.get(key) ?? 0
      if (remaining > 0) {
        seen.set(key, remaining - 1)
        skippedAsDuplicate++
        continue
      }
      const day = rateMap.get(r.spent_on) ?? nearestKnown(r.spent_on, rateMap)
      pending.push({
        user_id: userId,
        category_id: cat?.id ?? null,
        amount: r.amount,
        currency: r.currency,
        rate_to_eur: rateToEur(r.currency, day),
        spent_on: r.spent_on,
        note: r.note,
      })
    }

    // --- insert -----------------------------------------------------------
    const BATCH = 400
    const inserted: Expense[] = []
    for (let i = 0; i < pending.length; i += BATCH) {
      const { data, error: err } = await supabase
        .from('expenses')
        .insert(pending.slice(i, i + BATCH))
        .select()
      if (err) throw err
      inserted.push(...(data ?? []).map(hydrateExpense))
      onProgress({ phase: 'expenses', done: Math.min(i + BATCH, pending.length), total: pending.length })
    }

    setExpenses((prev) => sortExpenses([...inserted, ...prev]))
    return { inserted: inserted.length, skippedAsDuplicate, categoriesCreated: created, ratesCached }
  }, [userId, categories, expenses])

  const signIn = useCallback(async (email: string, password: string) => {
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) throw err
  }, [])

  /** Lets an account created by magic link acquire a password from a live session. */
  const setPassword = useCallback(async (password: string) => {
    const { error: err } = await supabase.auth.updateUser({ password })
    if (err) throw err
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
  }, [])

  const latestRates = useMemo(() => nearestKnown(today(), rates), [rates])

  const setDisplayCurrency = useCallback((c: Currency) => {
    setDisplayCurrencyState(c)
    try { localStorage.setItem(DISPLAY_KEY, c) } catch { /* private mode — session only */ }
  }, [])

  const convert = useMemo(() => makeConverter(displayCurrency, rates), [displayCurrency, rates])

  const value: Store = {
    session, authLoading, loading, error, categories, expenses, rates, latestRates,
    displayCurrency, setDisplayCurrency, convert,
    signIn, setPassword, signOut, addExpense, updateExpense, deleteExpense,
    addCategory, updateCategory, deleteCategory, importExpenses,
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

/** Identity of one expense for duplicate detection. */
function fingerprint(
  day: string,
  categoryId: string | null,
  amount: number,
  currency: string,
  note: string | null,
): string {
  return [day, categoryId ?? '-', amount.toFixed(2), currency, note ?? ''].join('|')
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
