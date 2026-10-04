import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { localAll, localDelete, localDeleteMany, localPut, localReplaceUser } from './db'
import { applyPending, dropQueuedFor, flush, queueDelete, queueUpsert } from './sync'
import { newId } from './ids'
import type { Currency, Debt, DebtAmount, DebtAmountDraft, DebtDraft, DebtInstallment, DebtInstallmentDraft } from '../types'

/**
 * Everything the Debts tab reads and writes.
 *
 * Its own store for the same reason as travel: a debt lives in its own tables
 * and never reaches a personal total. Local first as well — every change lands
 * on the device at once and reaches the server through the outbox.
 */
export interface DebtStore {
  debts: Debt[]
  amounts: DebtAmount[]
  installments: DebtInstallment[]
  debtsLoading: boolean
  debtsError: string | null
  createDebt: (draft: DebtDraft) => Promise<Debt>
  updateDebt: (id: string, draft: DebtDraft) => Promise<void>
  deleteDebt: (id: string) => Promise<void>
  addAmount: (debtId: string, draft: DebtAmountDraft) => Promise<void>
  updateAmount: (id: string, draft: DebtAmountDraft) => Promise<void>
  deleteAmount: (id: string) => Promise<void>
  addInstallment: (debtId: string, draft: DebtInstallmentDraft) => Promise<void>
  updateInstallment: (id: string, draft: DebtInstallmentDraft) => Promise<void>
  deleteInstallment: (id: string) => Promise<void>
}

function hydrateDebt(row: Record<string, unknown>): Debt {
  const { id, user_id, name, created_at } = row as unknown as Debt
  return { id, user_id, name, created_at }
}

function hydrateAmount(row: Record<string, unknown>): DebtAmount {
  return { ...(row as unknown as DebtAmount), amount: Number(row.amount ?? 0) }
}

/**
 * Instalments cached before they carried a currency took their debt's, which
 * the debt row of that time still holds — `legacy` maps one to the other.
 */
function hydrateInstallment(row: Record<string, unknown>, legacy?: Map<string, Currency>): DebtInstallment {
  const currency = (row.currency as Currency | null | undefined) ?? legacy?.get(row.debt_id as string) ?? 'EUR'
  return { ...(row as unknown as DebtInstallment), amount: Number(row.amount ?? 0), currency }
}

const hydrateRow = (row: Record<string, unknown>) => hydrateInstallment(row)

export function useDebts(userId: string | null, canSync: boolean): DebtStore {
  const [debts, setDebts] = useState<Debt[]>([])
  const [amounts, setAmounts] = useState<DebtAmount[]>([])
  const [installments, setInstallments] = useState<DebtInstallment[]>([])
  const [debtsLoading, setDebtsLoading] = useState(false)
  const [debtsError, setDebtsError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) {
      setDebts([])
      setAmounts([])
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
        const [d, a, i] = await Promise.all([
          localAll<Record<string, unknown>>('debts'),
          localAll<Record<string, unknown>>('debt_amounts'),
          localAll<Record<string, unknown>>('debt_installments'),
        ])
        if (cancelled) return
        const legacy = new Map(d.filter((r) => r.currency).map((r) => [r.id as string, r.currency as Currency]))
        const localDebts = mine(d.map(hydrateDebt))
        cachedAnything = localDebts.length > 0
        setDebts(localDebts.sort(byNewest))
        setAmounts(sortAmounts(mine(a.map(hydrateAmount))))
        setInstallments(sortInstallments(mine(i.map((r) => hydrateInstallment(r, legacy)))))
      } catch {
        /* Nothing cached yet — the server pull below covers it. */
      } finally {
        if (!cancelled) setDebtsLoading(false)
      }

      if (!navigator.onLine || !canSync) return

      try {
        await flush()
        const [d, a, i] = await Promise.all([
          supabase.from('debts').select('*').order('created_at', { ascending: false }),
          supabase.from('debt_amounts').select('*').order('added_on', { ascending: false }),
          supabase.from('debt_installments').select('*').order('paid_on', { ascending: false }),
        ])
        if (d.error) throw d.error
        if (a.error) throw a.error
        if (i.error) throw i.error
        if (cancelled) return

        const freshDebts = await applyPending<Debt>(
          'debts', userId, (d.data ?? []).map(hydrateDebt), hydrateDebt,
        )
        const freshAmounts = await applyPending<DebtAmount>(
          'debt_amounts', userId, (a.data ?? []).map(hydrateAmount), hydrateAmount,
        )
        const freshRows = await applyPending<DebtInstallment>(
          'debt_installments', userId, (i.data ?? []).map(hydrateRow), hydrateRow,
        )

        setDebts(freshDebts.sort(byNewest))
        setAmounts(sortAmounts(freshAmounts))
        setInstallments(sortInstallments(freshRows))
        void localReplaceUser('debts', userId, freshDebts)
        void localReplaceUser('debt_amounts', userId, freshAmounts)
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
    const lent = amounts.filter((r) => r.debt_id === id).map((r) => r.id)
    const rows = installments.filter((r) => r.debt_id === id).map((r) => r.id)

    // Amounts and instalments go with it in the database (ON DELETE CASCADE);
    // drop them from the queue too, or an unsent one would be refused by the
    // foreign key.
    setDebts((prev) => prev.filter((d) => d.id !== id))
    setAmounts((prev) => prev.filter((r) => r.debt_id !== id))
    setInstallments((prev) => prev.filter((r) => r.debt_id !== id))
    await localDelete('debts', id)
    await localDeleteMany('debt_amounts', lent)
    await localDeleteMany('debt_installments', rows)
    await dropQueuedFor('debt_amounts', 'debt_id', id)
    await dropQueuedFor('debt_installments', 'debt_id', id)
    await queueDelete('debts', userId, id)
  }, [userId, amounts, installments])

  const addAmount = useCallback<DebtStore['addAmount']>(async (debtId, draft) => {
    if (!userId) return
    const row: DebtAmount = {
      id: newId(),
      user_id: userId,
      debt_id: debtId,
      ...draft,
      created_at: new Date().toISOString(),
    }
    setAmounts((prev) => sortAmounts([row, ...prev]))
    await localPut('debt_amounts', row)
    await queueUpsert('debt_amounts', row)
  }, [userId])

  const updateAmount = useCallback<DebtStore['updateAmount']>(async (id, draft) => {
    const current = amounts.find((r) => r.id === id)
    if (!current) return
    const row: DebtAmount = { ...current, ...draft }
    setAmounts((prev) => sortAmounts(prev.map((r) => (r.id === id ? row : r))))
    await localPut('debt_amounts', row)
    await queueUpsert('debt_amounts', row)
  }, [amounts])

  const deleteAmount = useCallback<DebtStore['deleteAmount']>(async (id) => {
    if (!userId) return
    setAmounts((prev) => prev.filter((r) => r.id !== id))
    await localDelete('debt_amounts', id)
    await queueDelete('debt_amounts', userId, id)
  }, [userId])

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
    debts, amounts, installments, debtsLoading, debtsError,
    createDebt, updateDebt, deleteDebt,
    addAmount, updateAmount, deleteAmount,
    addInstallment, updateInstallment, deleteInstallment,
  }
}

function byNewest(a: Debt, b: Debt): number {
  return b.created_at.localeCompare(a.created_at)
}

/** Most recently lent first. */
function sortAmounts(list: DebtAmount[]): DebtAmount[] {
  return [...list].sort((a, b) =>
    a.added_on === b.added_on ? b.created_at.localeCompare(a.created_at) : b.added_on.localeCompare(a.added_on),
  )
}

/** Most recent payment first. */
function sortInstallments(list: DebtInstallment[]): DebtInstallment[] {
  return [...list].sort((a, b) =>
    a.paid_on === b.paid_on ? b.created_at.localeCompare(a.created_at) : b.paid_on.localeCompare(a.paid_on),
  )
}
