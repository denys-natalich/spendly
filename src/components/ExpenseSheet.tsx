import { useEffect, useMemo, useRef, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { iconFor, slotColor } from '../lib/icons'
import { money, symbolOf, today } from '../lib/format'
import { nearestKnown, rateToEur } from '../lib/fx'
import { BASE_CURRENCY, CURRENCIES, type Currency, type Expense } from '../types'
import { Button, Segmented, Sheet, inputClass } from './ui'

export function ExpenseSheet({ open, expense, onClose }: {
  open: boolean
  expense: Expense | null
  onClose: () => void
}) {
  const { categories, expenses, rates, addExpense, updateExpense, deleteExpense } = useStore()

  /*
   * Ordered by how often each category is actually used, so the two or three
   * that account for most entries sit under the thumb without scrolling. Ties
   * and never-used categories fall back to the manual sort order.
   */
  const active = useMemo(() => {
    const uses = new Map<string, number>()
    for (const e of expenses) {
      if (e.category_id) uses.set(e.category_id, (uses.get(e.category_id) ?? 0) + 1)
    }
    return categories
      .filter((c) => !c.is_archived)
      .sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || a.sort_order - b.sort_order)
  }, [categories, expenses])

  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>(BASE_CURRENCY)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [spentOn, setSpentOn] = useState(today())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  // Re-seed the fields each time the sheet opens rather than on every render,
  // so typing is never clobbered by a parent update.
  useEffect(() => {
    if (!open) return
    setError(null)
    setBusy(false)
    setAmount(expense ? String(expense.amount) : '')
    setCurrency(expense?.currency ?? BASE_CURRENCY)
    setCategoryId(expense?.category_id ?? active[0]?.id ?? null)
    setSpentOn(expense?.spent_on ?? today())
    setNote(expense?.note ?? '')
  }, [open, expense, active])

  // When editing, the chosen category may sit far along the scroller.
  useEffect(() => {
    if (!open) return
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [open, categoryId])

  const parsed = Number(amount.replace(',', '.'))
  const valid = Number.isFinite(parsed) && parsed > 0

  const dayRates = rates.get(spentOn) ?? nearestKnown(spentOn, rates)
  const rate = rateToEur(currency, dayRates)
  const eurValue = valid ? parsed / rate : 0

  async function save() {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const draft = {
        category_id: categoryId,
        amount: Number(parsed.toFixed(2)),
        currency,
        spent_on: spentOn,
        note: note.trim() || null,
      }
      if (expense) await updateExpense(expense.id, draft)
      else await addExpense(draft)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the expense.')
      setBusy(false)
    }
  }

  async function remove() {
    if (!expense) return
    setBusy(true)
    try {
      await deleteExpense(expense.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the expense.')
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={expense ? 'Edit expense' : 'New expense'} onClose={onClose}>
      <div className="space-y-3.5">
        {/* Amount and currency share a row — with the keyboard up there is only
            about 500px of screen, and every stacked block costs a scroll. */}
        <div className="flex items-end gap-3">
          <span className="pb-2 text-xl text-ink-3">{symbolOf(currency)}</span>
          <input
            autoFocus={!expense}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Amount"
            className="tnum min-w-0 flex-1 border-b border-line bg-transparent pb-1.5 text-3xl font-semibold
                       placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <div className="shrink-0 pb-1">
            <Segmented
              compact
              ariaLabel="Currency"
              value={currency}
              onChange={setCurrency}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </div>
        </div>

        {currency !== BASE_CURRENCY && (
          <p className="tnum -mt-1 text-right text-xs text-ink-3">
            = {money(eurValue, BASE_CURRENCY)} · 1 {BASE_CURRENCY} = {rate.toFixed(2)} {currency}
          </p>
        )}

        {/* One scrolling row instead of a wrapping grid: fifteen categories wrap
            to four rows, which is most of the space the keyboard leaves. */}
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 py-0.5">
          {active.map((c) => {
            const Icon = iconFor(c.icon)
            const selected = categoryId === c.id
            return (
              <button
                key={c.id}
                ref={selected ? selectedRef : undefined}
                type="button"
                onClick={() => setCategoryId(c.id)}
                aria-pressed={selected}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-sm
                            transition-colors ${
                              selected
                                ? 'border-transparent bg-raised font-medium text-ink'
                                : 'border-line text-ink-2'
                            }`}
                style={selected ? { boxShadow: `inset 0 0 0 1.5px ${slotColor(c.color_slot)}` } : undefined}
              >
                <Icon size={15} style={{ color: slotColor(c.color_slot) }} />
                {c.name}
              </button>
            )
          })}
        </div>

        <div className="flex gap-2">
          <input
            type="text"
            value={note}
            maxLength={200}
            placeholder="Note"
            onChange={(e) => setNote(e.target.value)}
            aria-label="Note"
            className={`${inputClass} min-w-0 flex-1`}
          />
          <input
            type="date"
            value={spentOn}
            max={today()}
            onChange={(e) => setSpentOn(e.target.value || today())}
            aria-label="Date"
            className={`${inputClass} w-36 shrink-0`}
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-2">
          <Button onClick={save} busy={busy} disabled={!valid} className="flex-1">
            {expense ? 'Save changes' : 'Add expense'}
          </Button>
          {expense && (
            <Button variant="danger" onClick={remove} aria-label="Delete expense">
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
