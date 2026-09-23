import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { fetchAllPages, supabase, isConfigured } from './lib/supabase'
import { localAll, localClearUser, localDelete, localPut, localPutMany, localReplaceUser } from './lib/db'
import { cachedIdentity, forgetIdentity, rememberIdentity, type Identity } from './lib/identity'
import {
  applyPending, flush, onSyncPatch, offlineRate, queueDelete, queueUpsert,
  queueUpsertMany, startSync, syncState, toAmountEur, unlinkQueued,
} from './lib/sync'
import { backfillRates, ensureRatesFor, loadCachedRates, loadLocalRates, nearestKnown } from './lib/fx'
import { makeConverter, type Convert } from './lib/convert'
import { getAvatarUrl, removeAvatar, uploadAvatar } from './lib/avatar'
import { newId } from './lib/ids'
import { NEW_CATEGORY_ICONS, targetCategoryName, type MonefyRow } from './lib/monefy'
import { useTravel, type TravelStore } from './lib/useTravel'
import { useDebts, type DebtStore } from './lib/useDebts'
import { today } from './lib/format'
import { assignColorSlot, recolourCollisions } from './lib/icons'
import { BASE_CURRENCY, CURRENCIES } from './types'
import type { Category, Currency, DayRates, Expense, ExpenseDraft } from './types'

interface Store extends TravelStore, DebtStore {
  session: Session | null
  /** Who the app is for. Survives a cold start with no connection. */
  identity: Identity | null
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
  avatarUrl: string | null
  setAvatar: (file: File) => Promise<void>
  clearAvatar: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  setPassword: (password: string) => Promise<void>
  signOut: () => Promise<void>
  addExpense: (draft: ExpenseDraft) => Promise<void>
  updateExpense: (id: string, draft: ExpenseDraft) => Promise<void>
  deleteExpense: (id: string) => Promise<void>
  addCategory: (input: Pick<Category, 'name' | 'icon'>) => Promise<void>
  updateCategory: (id: string, patch: Partial<Pick<Category, 'name' | 'icon' | 'is_archived'>>) => Promise<void>
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
  const amount = numeric(row.amount)
  const rate = numeric(row.rate_to_eur) || 1
  return {
    ...(row as unknown as Expense),
    amount,
    rate_to_eur: rate,
    // A row read back from the server carries the generated column; one taken
    // from the outbox never does, because it is generated and cannot be sent.
    amount_eur: row.amount_eur === undefined ? toAmountEur(amount, rate) : numeric(row.amount_eur),
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [offlineIdentity, setOfflineIdentity] = useState<Identity | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [rates, setRates] = useState<Map<string, DayRates>>(new Map())
  const [displayCurrency, setDisplayCurrencyState] = useState<Currency>(readDisplayCurrency)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)

  // Mutations resolve rates against the freshest map without re-creating every
  // callback on each rate fetch. Mirrored in an effect rather than during render;
  // the initial load assigns it directly so it is never behind on first use.
  const ratesRef = useRef(rates)
  useEffect(() => { ratesRef.current = rates }, [rates])

  useEffect(() => { startSync() }, [])

  useEffect(() => {
    if (!isConfigured) {
      setAuthLoading(false)
      return
    }

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) rememberIdentity(identityOf(data.session))
      // No session and no network means the token could not be refreshed, not
      // that the account is gone: fall back to the account this device knows.
      else if (!navigator.onLine) setOfflineIdentity(cachedIdentity())
      setAuthLoading(false)
    }, () => {
      setOfflineIdentity(cachedIdentity())
      setAuthLoading(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (next) {
        rememberIdentity(identityOf(next))
        setOfflineIdentity(null)
        // A token that came back is the first chance to drain the queue.
        void flush()
      }
      setAuthLoading(false)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const identity = session ? identityOf(session) : offlineIdentity
  const userId = identity?.id ?? null

  /*
   * The remembered account is a stand-in for a session, not a substitute for
   * one. The moment there is a connection again it has to prove itself: either
   * the token refreshes, or the person signs in, because queued changes need a
   * real token to go anywhere. Their data stays on the device either way.
   */
  useEffect(() => {
    if (!offlineIdentity) return
    const recheck = async () => {
      try {
        const { data } = await supabase.auth.getSession()
        if (!data.session) setOfflineIdentity(null)
      } catch {
        /* Still nothing answering; keep working locally. */
      }
    }
    window.addEventListener('online', recheck)
    return () => window.removeEventListener('online', recheck)
  }, [offlineIdentity])

  /*
   * Loading is local first, network second.
   *
   * The screen is built from IndexedDB, which is always there and always
   * instant; the server is then asked for anything this device missed and the
   * two are reconciled. With no connection step two is simply skipped, and the
   * app behaves exactly as it does with one — which is the whole point.
   */
  useEffect(() => {
    if (!userId) {
      setCategories([])
      setExpenses([])
      setAvatarUrl(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    ;(async () => {
      const mine = <T extends { user_id: string }>(rows: T[]) => rows.filter((r) => r.user_id === userId)
      // Whether the device had anything to show before the server was asked.
      let cachedAnything = false

      try {
        const [cached, cachedExpenses, cachedRates] = await Promise.all([
          localAll<Category>('categories'),
          localAll<Record<string, unknown>>('expenses'),
          loadLocalRates(),
        ])
        if (cancelled) return
        const map = new Map(cachedRates.map((r) => [r.day, r]))
        const localCategories = mine(cached)
        const localExpenses = mine(cachedExpenses.map(hydrateExpense))
        cachedAnything = localCategories.length > 0 || localExpenses.length > 0
        setCategories(localCategories.sort(byCategoryOrder))
        setExpenses(sortExpenses(localExpenses))
        setRates(map)
        ratesRef.current = map
      } catch {
        /* No cache yet, or storage is unavailable — the server pull covers it. */
      } finally {
        if (!cancelled) setLoading(false)
      }

      // Absent avatar simply resolves to null, so no error handling is needed.
      void getAvatarUrl(userId).then((url) => { if (!cancelled) setAvatarUrl(url) })

      if (!navigator.onLine || !session) return

      try {
        // Anything queued goes up first, so the rows coming back already
        // include it and the refresh cannot undo an unsent change.
        await flush()

        const [cats, exps, serverRates] = await Promise.all([
          supabase.from('categories').select('*').order('sort_order').order('name'),
          // Paged: a bulk import puts more rows here than one response can carry.
          // `id` breaks ties so a row can't shift between pages and be missed —
          // imported rows share a created_at down to the millisecond.
          fetchAllPages<Record<string, unknown>>((from, to) =>
            supabase
              .from('expenses')
              .select('*')
              .order('spent_on', { ascending: false })
              .order('created_at', { ascending: false })
              .order('id')
              .range(from, to),
          ),
          loadCachedRates(),
        ])
        if (cats.error) throw cats.error
        if (cancelled) return

        const map = new Map(serverRates.map((r) => [r.day, r]))
        const starter = cats.data?.length ? null : await seedDefaultCategories(userId)
        const loaded = await applyPending<Category>(
          'categories', userId, (starter ?? cats.data ?? []) as Category[], (p) => p as unknown as Category,
        )
        const ledger = await applyPending<Expense>(
          'expenses', userId, exps.map(hydrateExpense), hydrateExpense,
        )

        setCategories(loaded.sort(byCategoryOrder))
        setExpenses(sortExpenses(ledger))
        setRates(map)
        ratesRef.current = map
        void localReplaceUser('categories', userId, loaded)
        void localReplaceUser('expenses', userId, ledger)

        // Keep today's rate warm so the entry form always converts live.
        const fresh = await ensureRatesFor(today(), map)
        if (!cancelled && fresh) setRates(new Map(map))

        // Settle any colour clash left by the days colours were picked by hand.
        // One update per clash rather than an upsert, which would have to
        // resend every not-null column to change a number; a failure is left
        // unreported on purpose, since a repeated hue is not worth failing a
        // load the user needs their data from.
        const fixes = recolourCollisions(loaded)
        if (fixes.length > 0) {
          await Promise.all(
            fixes.map((f) =>
              supabase.from('categories').update({ color_slot: f.color_slot }).eq('id', f.id),
            ),
          )
          if (!cancelled) {
            const byId = new Map(fixes.map((f) => [f.id, f.color_slot]))
            setCategories((prev) =>
              prev.map((c) => (byId.has(c.id) ? { ...c, color_slot: byId.get(c.id)! } : c)),
            )
          }
        }
      } catch (e) {
        // A failed refresh is only an error if there was nothing cached to show;
        // otherwise the app is simply working from what it already has.
        if (!cancelled && !cachedAnything) {
          setError(e instanceof Error ? e.message : 'Could not load your data.')
        }
      }
    })()

    return () => { cancelled = true }
    // `session` is read to decide whether a server refresh is possible; the
    // local load is keyed on the account alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, session])

  /*
   * Rates the sync resolved after the fact. An expense entered on a plane gets
   * the nearest cached day; when the real one is fetched the row is corrected
   * here so the number on screen matches what was stored.
   */
  useEffect(() => onSyncPatch((patch) => {
    if (patch.kind === 'rates') {
      const map = new Map(patch.days.map((d) => [d.day, d]))
      setRates(map)
      ratesRef.current = map
      return
    }
    if (patch.table === 'expenses') {
      setExpenses((prev) => prev.map((e) => (e.id === patch.id ? { ...e, ...patch.patch } as Expense : e)))
    }
  }), [])

  /**
   * The rate to store on a row, and whether it is the real one for that day.
   *
   * Takes anything with a currency and a day: a personal draft or a travel one.
   * Offline the nearest cached day is used and the row is flagged, so the sync
   * can put the right rate on it once the day becomes reachable.
   */
  const resolveRate = useCallback(async (of: { currency: Currency; spent_on: string }) => {
    if (of.currency === 'EUR') return { rate: 1, exact: true }
    const map = ratesRef.current
    if (navigator.onLine) {
      const before = map.size
      await ensureRatesFor(of.spent_on, map)
      if (map.size !== before) setRates(new Map(map))
    }
    return offlineRate(of.currency, of.spent_on, map)
  }, [])

  // Trips keep their own state and their own tables; the rate cache is the one
  // thing they borrow, so travel spending converts like everything else.
  const travel = useTravel(userId, Boolean(session), resolveRate)
  const debt = useDebts(userId, Boolean(session))

  const addExpense = useCallback(async (draft: ExpenseDraft) => {
    if (!userId) return
    const { rate, exact } = await resolveRate(draft)
    const row: Expense = {
      id: newId(),
      user_id: userId,
      category_id: draft.category_id,
      amount: draft.amount,
      currency: draft.currency,
      rate_to_eur: rate,
      amount_eur: toAmountEur(draft.amount, rate),
      spent_on: draft.spent_on,
      note: draft.note,
      created_at: new Date().toISOString(),
    }
    setExpenses((prev) => sortExpenses([row, ...prev]))
    await localPut('expenses', row)
    await queueUpsert('expenses', row, { ratePending: !exact })
  }, [userId, resolveRate])

  const updateExpense = useCallback(async (id: string, draft: ExpenseDraft) => {
    const current = expenses.find((e) => e.id === id)
    if (!current) return
    const { rate, exact } = await resolveRate(draft)
    const row: Expense = {
      ...current,
      ...draft,
      rate_to_eur: rate,
      amount_eur: toAmountEur(draft.amount, rate),
    }
    setExpenses((prev) => sortExpenses(prev.map((e) => (e.id === id ? row : e))))
    await localPut('expenses', row)
    await queueUpsert('expenses', row, { ratePending: !exact })
  }, [expenses, resolveRate])

  const deleteExpense = useCallback(async (id: string) => {
    if (!userId) return
    setExpenses((prev) => prev.filter((e) => e.id !== id))
    await localDelete('expenses', id)
    await queueDelete('expenses', userId, id)
  }, [userId])

  const addCategory = useCallback<Store['addCategory']>(async (input) => {
    if (!userId) return
    const row: Category = {
      id: newId(),
      user_id: userId,
      name: input.name,
      icon: input.icon,
      color_slot: assignColorSlot(categories.map((c) => c.color_slot)),
      sort_order: categories.reduce((max, c) => Math.max(max, c.sort_order), 0) + 10,
      is_archived: false,
      created_at: new Date().toISOString(),
    }
    setCategories((prev) => [...prev, row].sort(byCategoryOrder))
    await localPut('categories', row)
    await queueUpsert('categories', row)
  }, [userId, categories])

  const updateCategory = useCallback<Store['updateCategory']>(async (id, patch) => {
    const current = categories.find((c) => c.id === id)
    if (!current) return
    const row = { ...current, ...patch }
    setCategories((prev) => prev.map((c) => (c.id === id ? row : c)).sort(byCategoryOrder))
    await localPut('categories', row)
    await queueUpsert('categories', row)
  }, [categories])

  const deleteCategory = useCallback(async (id: string) => {
    if (!userId) return
    setCategories((prev) => prev.filter((c) => c.id !== id))
    // The FK is ON DELETE SET NULL, so surviving expenses become uncategorised.
    // Anything still queued has to lose the reference too, or it would be sent
    // afterwards pointing at a category that no longer exists.
    const orphaned = expenses.filter((e) => e.category_id === id).map((e) => ({ ...e, category_id: null }))
    setExpenses((prev) => prev.map((e) => (e.category_id === id ? { ...e, category_id: null } : e)))
    await localDelete('categories', id)
    await localPutMany('expenses', orphaned)
    await unlinkQueued('expenses', 'category_id', id)
    await queueDelete('categories', userId, id)
  }, [userId, expenses])

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
   *   rates      — one request per day not already cached, a few at a time
   *   categories — create whatever the file references and the account lacks
   *   expenses   — written locally, then queued for the server
   *
   * Duplicate detection counts occurrences rather than matching on content
   * alone: two identical ₴10 bus fares on the same day are two real expenses,
   * so only the excess over what is already stored gets skipped.
   *
   * An import started with no connection works the same way and simply queues
   * more: the rate phase finds nothing, every row takes the nearest known rate,
   * and the sync corrects them all when the network returns.
   */
  const importExpenses = useCallback<Store['importExpenses']>(async (rows, onProgress) => {
    if (!userId || rows.length === 0) {
      return { inserted: 0, skippedAsDuplicate: 0, categoriesCreated: [], ratesCached: 0 }
    }

    onProgress({ phase: 'rates', done: 0, total: 1 })
    const rateMap = ratesRef.current
    const ratesCached = navigator.onLine
      ? await backfillRates(
        rows.map((r) => r.spent_on),
        rateMap,
        (done, total) => onProgress({ phase: 'rates', done, total }),
      )
      : 0
    setRates(new Map(rateMap))

    // --- categories -------------------------------------------------------
    onProgress({ phase: 'categories', done: 0, total: 1 })
    const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]))
    const wanted = [...new Set(rows.map((r) => targetCategoryName(r.category)))]
    const missing = wanted.filter((n) => !byName.has(n.toLowerCase()))
    const created: string[] = []

    if (missing.length > 0) {
      const taken = categories.map((c) => c.color_slot)
      let order = categories.reduce((max, c) => Math.max(max, c.sort_order), 0)
      const now = new Date().toISOString()

      const fresh = missing.map((name) => {
        const slot = assignColorSlot(taken)
        taken.push(slot)
        order += 10
        return {
          id: newId(),
          user_id: userId,
          name,
          icon: NEW_CATEGORY_ICONS[name] ?? 'tag',
          color_slot: slot,
          sort_order: order,
          is_archived: false,
          created_at: now,
        } satisfies Category
      })

      for (const c of fresh) {
        byName.set(c.name.toLowerCase(), c)
        created.push(c.name)
      }
      setCategories((prev) => [...prev, ...fresh].sort(byCategoryOrder))
      await localPutMany('categories', fresh)
      await queueUpsertMany('categories', fresh)
    }
    onProgress({ phase: 'categories', done: 1, total: 1 })

    // --- skip what is already stored --------------------------------------
    const seen = new Map<string, number>()
    for (const e of expenses) {
      const k = fingerprint(e.spent_on, e.category_id, e.amount, e.currency, e.note)
      seen.set(k, (seen.get(k) ?? 0) + 1)
    }

    const pending: Expense[] = []
    const ratePending: Expense[] = []
    let skippedAsDuplicate = 0
    const createdAt = new Date().toISOString()

    for (const r of rows) {
      const cat = byName.get(targetCategoryName(r.category).toLowerCase())
      const key = fingerprint(r.spent_on, cat?.id ?? null, r.amount, r.currency, r.note)
      const remaining = seen.get(key) ?? 0
      if (remaining > 0) {
        seen.set(key, remaining - 1)
        skippedAsDuplicate++
        continue
      }
      const { rate, exact } = offlineRate(r.currency, r.spent_on, rateMap)
      const row: Expense = {
        id: newId(),
        user_id: userId,
        category_id: cat?.id ?? null,
        amount: r.amount,
        currency: r.currency,
        rate_to_eur: rate,
        amount_eur: toAmountEur(r.amount, rate),
        spent_on: r.spent_on,
        note: r.note,
        created_at: createdAt,
      }
      ;(exact ? pending : ratePending).push(row)
    }

    const inserted = [...pending, ...ratePending]
    setExpenses((prev) => sortExpenses([...inserted, ...prev]))
    await localPutMany('expenses', inserted)
    await queueUpsertMany('expenses', pending)
    await queueUpsertMany('expenses', ratePending, { ratePending: true })
    onProgress({ phase: 'expenses', done: inserted.length, total: inserted.length })

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

  /*
   * Sign-out sends whatever is queued first. If something is still waiting —
   * no connection, most likely — the local copy stays on the device so the
   * same account picks it up on the next sign-in; there is nowhere else for it
   * to go. With nothing left to send, the cache is cleared, because a signed-out
   * device holding a full expense history is nobody's expectation.
   */
  const signOut = useCallback(async () => {
    const id = userId
    if (navigator.onLine) await flush()
    if (id && syncState().pending === 0) await localClearUser(id)
    forgetIdentity()
    setOfflineIdentity(null)
    await supabase.auth.signOut()
  }, [userId])

  const latestRates = useMemo(() => nearestKnown(today(), rates), [rates])

  const setAvatar = useCallback(async (file: File) => {
    if (!userId) return
    setAvatarUrl(await uploadAvatar(userId, file))
  }, [userId])

  const clearAvatar = useCallback(async () => {
    if (!userId) return
    await removeAvatar(userId)
    setAvatarUrl(null)
  }, [userId])

  const setDisplayCurrency = useCallback((c: Currency) => {
    setDisplayCurrencyState(c)
    try { localStorage.setItem(DISPLAY_KEY, c) } catch { /* private mode — session only */ }
  }, [])

  const convert = useMemo(() => makeConverter(displayCurrency, rates), [displayCurrency, rates])

  const value: Store = {
    session, identity, authLoading, loading, error, categories, expenses, rates, latestRates,
    displayCurrency, setDisplayCurrency, convert,
    avatarUrl, setAvatar, clearAvatar,
    signIn, setPassword, signOut, addExpense, updateExpense, deleteExpense,
    addCategory, updateCategory, deleteCategory, importExpenses,
    ...travel,
    ...debt,
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

function identityOf(session: Session): Identity {
  return { id: session.user.id, email: session.user.email ?? null }
}

const DEFAULT_CATEGORIES: Array<Pick<Category, 'name' | 'icon' | 'color_slot' | 'sort_order'>> = [
  { name: 'Groceries', icon: 'shopping-cart', color_slot: 3, sort_order: 10 },
  { name: 'Eating out', icon: 'utensils', color_slot: 2, sort_order: 20 },
  { name: 'Transport', icon: 'bus', color_slot: 1, sort_order: 30 },
  { name: 'Housing', icon: 'house', color_slot: 7, sort_order: 40 },
  { name: 'Utilities', icon: 'plug', color_slot: 4, sort_order: 50 },
  { name: 'Health', icon: 'heart-pulse', color_slot: 6, sort_order: 60 },
  { name: 'Subscriptions', icon: 'repeat', color_slot: 5, sort_order: 70 },
  { name: 'Other', icon: 'tag', color_slot: 8, sort_order: 999 },
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
