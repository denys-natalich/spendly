import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { localAll, localDelete, localDeleteMany, localPut, localReplaceUser } from './db'
import { applyPending, dropQueuedFor, flush, queueDelete, queueUpsert } from './sync'
import { newId } from './ids'
import type { Debt, DebtDraft, DebtInstallment, DebtInstallmentDraft } from '../types'

/**
 * Everything the Debts tab reads and writes.
 *
 * Its own store for the same reason as travel: a debt lives in its own tables
 * and never reaches a personal total. Local first as well — every change lands
 * on the device at once and reaches the server through the outbox.
 */
export interface DebtStore {
  debts: Debt[]
  installments: DebtInstallment[]
  debtsLoading: boolean
  debtsError: string | null
  createDebt: (draft: DebtDraft) => Promise<Debt>
  updateDebt: (id: string, draft: DebtDraft) => Promise<void>
  deleteDebt: (id: string) => Promise<void>
  addInstallment: (debtId: string, draft: DebtInstallmentDraft) => Promise<void>
  updateInstallment: (id: string, draft: DebtInstallmentDraft) => Promise<void>
  deleteInstallment: (id: string) => Promise<void>
}

function hydrateDebt(row: Record<string, unknown>): Debt {
  return { ...(row as unknown as Debt), amount: Number(row.amount ?? 0) }
}

function hydrateInstallment(row: Record<string, unknown>): DebtInstallment {
  return { ...(row as unknown as DebtInstallment), amount: Number(row.amount ?? 0) }
}

export function useDebts(userId: string | null, canSync: boolean): DebtStore {
  const [debts, setDebts] = useState<Debt[]>([])
  const [installments, setInstallments] = useState<DebtInstallment[]>([])
  const [debtsLoading, setDebtsLoading] = useState(false)
  const [debtsError, setDebtsError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setDebts([])
      setInstallments([])
      return
    }

    let cancelled = false
    setDebtsLoading(true)
    setDebtsError(null)

    ;(async () => {
      const mine = <T extends { user_id: string }>(rows: T[]) => rows.filter((r) => r.user_id === userId)
      let cachedAnything = false

      try {
        const [d, i] = await Promise.all([
          localAll<Record<string, unknown>>('debts'),
          localAll<Record<string, unknown>>('debt_installments'),
        ])
        if (cancelled) return
        const localDebts = mine(d.map(hydrateDebt))
        cachedAnything = localDebts.length > 0
        setDebts(localDebts.sort(byNewest))
        setInstallments(sortInstallments(mine(i.map(hydrateInstallment))))
      } catch {
        /* Nothing cached yet — the server pull below covers it. */
      } finally {
        if (!cancelled) setDebtsLoading(false)
      }

      if (!navigator.onLine || !canSync) return

      try {
        await flush()
        const [d, i] = await Promise.all([
          supabase.from('debts').select('*').order('created_at', { ascending: false }),
          supabase.from('debt_installments').select('*').order('paid_on', { ascending: false }),
        ])
        if (d.error) throw d.error
        if (i.error) throw i.error
        if (cancelled) return

        const freshDebts = await applyPending<Debt>(
          'debts', userId, (d.data ?? []).map(hydrateDebt), hydrateDebt,
        )
        const freshRows = await applyPending<DebtInstallment>(
          'debt_installments', userId, (i.data ?? []).map(hydrateInstallment), hydrateInstallment,
        )

        setDebts(freshDebts.sort(byNewest))
        setInstallments(sortInstallments(freshRows))
        void localReplaceUser('debts', userId, freshDebts)
        void localReplaceUser('debt_installments', userId, freshRows)
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
    const rows = installments.filter((r) => r.debt_id === id).map((r) => r.id)

    // Instalments go with it in the database (ON DELETE CASCADE); drop them
    // from the queue too, or an unsent one would be refused by the foreign key.
    setDebts((prev) => prev.filter((d) => d.id !== id))
    setInstallments((prev) => prev.filter((r) => r.debt_id !== id))
    await localDelete('debts', id)
    await localDeleteMany('debt_installments', rows)
    await dropQueuedFor('debt_installments', 'debt_id', id)
    await queueDelete('debts', userId, id)
  }, [userId, installments])

  const addInstallment = useCallback<DebtStore['addInstallment']>(async (debtId, draft) => {
    if (!userId) return
    const row: DebtInstallment = {
      id: newId(),
      user_id: userId,
      debt_id: debtId,
      ...draft,
      created_at: new Date().toISOString(),
    }
    setInstallments((prev) => sortInstallments([row, ...prev]))
    await localPut('debt_installments', row)
    await queueUpsert('debt_installments', row)
  }, [userId])

  const updateInstallment = useCallback<DebtStore['updateInstallment']>(async (id, draft) => {
    const current = installments.find((r) => r.id === id)
    if (!current) return
    const row: DebtInstallment = { ...current, ...draft }
    setInstallments((prev) => sortInstallments(prev.map((r) => (r.id === id ? row : r))))
    await localPut('debt_installments', row)
    await queueUpsert('debt_installments', row)
  }, [installments])

  const deleteInstallment = useCallback<DebtStore['deleteInstallment']>(async (id) => {
    if (!userId) return
    setInstallments((prev) => prev.filter((r) => r.id !== id))
    await localDelete('debt_installments', id)
    await queueDelete('debt_installments', userId, id)
  }, [userId])

  return {
    debts, installments, debtsLoading, debtsError,
    createDebt, updateDebt, deleteDebt,
    addInstallment, updateInstallment, deleteInstallment,
  }
}

function byNewest(a: Debt, b: Debt): number {
  return b.created_at.localeCompare(a.created_at)
}

/** Most recent payment first. */
function sortInstallments(list: DebtInstallment[]): DebtInstallment[] {
  return [...list].sort((a, b) =>
    a.paid_on === b.paid_on ? b.created_at.localeCompare(a.created_at) : b.paid_on.localeCompare(a.paid_on),
  )
}
