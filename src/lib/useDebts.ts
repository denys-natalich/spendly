import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { localAll, localDelete, localDeleteMany, localPut, localReplaceUser } from './db'
import { applyPending, dropQueuedFor, flush, queueDelete, queueUpsert } from './sync'
import { newId } from './ids'
import type { Debt, DebtDraft, DebtEntry, DebtEntryDraft } from '../types'

/**
 * Everything the Debts tab reads and writes.
 *
 * Its own store for the same reason as travel: a debt lives in its own tables
 * and never reaches a personal total. Local first as well — every change lands
 * on the device at once and reaches the server through the outbox.
 */
export interface DebtStore {
  debts: Debt[]
  /** Every entry under every debt, most recent first. */
  debtEntries: DebtEntry[]
  debtsLoading: boolean
  debtsError: string | null
  createDebt: (draft: DebtDraft) => Promise<Debt>
  updateDebt: (id: string, draft: DebtDraft) => Promise<void>
  deleteDebt: (id: string) => Promise<void>
  addDebtEntry: (debtId: string, draft: DebtEntryDraft) => Promise<void>
  updateDebtEntry: (id: string, draft: DebtEntryDraft) => Promise<void>
  deleteDebtEntry: (id: string) => Promise<void>
}

function hydrateDebt(row: Record<string, unknown>): Debt {
  const { id, user_id, name, created_at } = row as unknown as Debt
  return { id, user_id, name, created_at }
}

function hydrateEntry(row: Record<string, unknown>): DebtEntry {
  return { ...(row as unknown as DebtEntry), amount: Number(row.amount ?? 0) }
}

export function useDebts(userId: string | null, canSync: boolean): DebtStore {
  const [debts, setDebts] = useState<Debt[]>([])
  const [debtEntries, setDebtEntries] = useState<DebtEntry[]>([])
  const [debtsLoading, setDebtsLoading] = useState(false)
  const [debtsError, setDebtsError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setDebts([])
      setDebtEntries([])
      return
    }

    let cancelled = false
    setDebtsLoading(true)
    setDebtsError(null)

    ;(async () => {
      const mine = <T extends { user_id: string }>(rows: T[]) => rows.filter((r) => r.user_id === userId)
      let cachedAnything = false

      try {
        const [d, e] = await Promise.all([
          localAll<Record<string, unknown>>('debts'),
          localAll<Record<string, unknown>>('debt_entries'),
        ])
        if (cancelled) return
        const localDebts = mine(d.map(hydrateDebt))
        cachedAnything = localDebts.length > 0
        setDebts(localDebts.sort(byNewest))
        setDebtEntries(sortEntries(mine(e.map(hydrateEntry))))
      } catch {
        /* Nothing cached yet — the server pull below covers it. */
      } finally {
        if (!cancelled) setDebtsLoading(false)
      }

      if (!navigator.onLine || !canSync) return

      try {
        await flush()
        const [d, e] = await Promise.all([
          supabase.from('debts').select('*').order('created_at', { ascending: false }),
          supabase.from('debt_entries').select('*').order('happened_on', { ascending: false }),
        ])
        if (d.error) throw d.error
        if (e.error) throw e.error
        if (cancelled) return

        const freshDebts = await applyPending<Debt>(
          'debts', userId, (d.data ?? []).map(hydrateDebt), hydrateDebt,
        )
        const freshEntries = await applyPending<DebtEntry>(
          'debt_entries', userId, (e.data ?? []).map(hydrateEntry), hydrateEntry,
        )

        setDebts(freshDebts.sort(byNewest))
        setDebtEntries(sortEntries(freshEntries))
        void localReplaceUser('debts', userId, freshDebts)
        void localReplaceUser('debt_entries', userId, freshEntries)
      } catch (err) {
        if (!cancelled && !cachedAnything) {
          setDebtsError(err instanceof Error ? err.message : 'Could not load your debts.')
        }
      }
    })()

    return () => { cancelled = true }
  }, [userId, canSync])

  const createDebt = useCallback<DebtStore['createDebt']>(async (draft) => {
    if (!userId) throw new Error('Not signed in.')
    const debt: Debt = { id: newId(), user_id: userId, ...draft, created_at: new Date().toISOString() }
    setDebts((prev) => [debt, ...prev])
    await localPut('debts', debt)
    await queueUpsert('debts', debt)
    return debt
  }, [userId])

  const updateDebt = useCallback<DebtStore['updateDebt']>(async (id, draft) => {
    const current = debts.find((d) => d.id === id)
    if (!current) return
    const debt: Debt = { ...current, ...draft }
    setDebts((prev) => prev.map((d) => (d.id === id ? debt : d)))
    await localPut('debts', debt)
    await queueUpsert('debts', debt)
  }, [debts])

  const deleteDebt = useCallback<DebtStore['deleteDebt']>(async (id) => {
    if (!userId) return
    const rows = debtEntries.filter((r) => r.debt_id === id).map((r) => r.id)

    // Entries go with it in the database (ON DELETE CASCADE); drop them from
    // the queue too, or an unsent one would be refused by the foreign key.
    setDebts((prev) => prev.filter((d) => d.id !== id))
    setDebtEntries((prev) => prev.filter((r) => r.debt_id !== id))
    await localDelete('debts', id)
    await localDeleteMany('debt_entries', rows)
    await dropQueuedFor('debt_entries', 'debt_id', id)
    await queueDelete('debts', userId, id)
  }, [userId, debtEntries])

  const addDebtEntry = useCallback<DebtStore['addDebtEntry']>(async (debtId, draft) => {
    if (!userId) return
    const row: DebtEntry = {
      id: newId(),
      user_id: userId,
      debt_id: debtId,
      ...draft,
      created_at: new Date().toISOString(),
    }
    setDebtEntries((prev) => sortEntries([row, ...prev]))
    await localPut('debt_entries', row)
    await queueUpsert('debt_entries', row)
  }, [userId])

  const updateDebtEntry = useCallback<DebtStore['updateDebtEntry']>(async (id, draft) => {
    const current = debtEntries.find((r) => r.id === id)
    if (!current) return
    const row: DebtEntry = { ...current, ...draft }
    setDebtEntries((prev) => sortEntries(prev.map((r) => (r.id === id ? row : r))))
    await localPut('debt_entries', row)
    await queueUpsert('debt_entries', row)
  }, [debtEntries])

  const deleteDebtEntry = useCallback<DebtStore['deleteDebtEntry']>(async (id) => {
    if (!userId) return
    setDebtEntries((prev) => prev.filter((r) => r.id !== id))
    await localDelete('debt_entries', id)
    await queueDelete('debt_entries', userId, id)
  }, [userId])

  return {
    debts, debtEntries, debtsLoading, debtsError,
    createDebt, updateDebt, deleteDebt,
    addDebtEntry, updateDebtEntry, deleteDebtEntry,
  }
}

function byNewest(a: Debt, b: Debt): number {
  return b.created_at.localeCompare(a.created_at)
}

/** Newest first; on the same day, the one entered last on top. */
function sortEntries(list: DebtEntry[]): DebtEntry[] {
  return [...list].sort((a, b) =>
    a.happened_on === b.happened_on
      ? b.created_at.localeCompare(a.created_at)
      : b.happened_on.localeCompare(a.happened_on),
  )
}
