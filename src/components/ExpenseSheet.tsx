import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { iconFor, slotColor } from '../lib/icons'
import { money, symbolOf, today } from '../lib/format'
import { nearestKnown, rateToEur } from '../lib/fx'
import { BASE_CURRENCY, CURRENCIES, type Currency, type Expense } from '../types'
import { Button, Field, Segmented, Sheet, inputClass } from './ui'

export function ExpenseSheet({ open, expense, onClose }: {
  open: boolean
  expense: Expense | null
  onClose: () => void
}) {
  const { categories, rates, addExpense, updateExpense, deleteExpense } = useStore()
  const active = useMemo(() => categories.filter((c) => !c.is_archived), [categories])

  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>(BASE_CURRENCY)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [spentOn, setSpentOn] = useState(today())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      <div className="space-y-5">
        <div>
          <div className="flex items-end gap-2">
            <span className="pb-3 text-2xl text-ink-3">{symbolOf(currency)}</span>
            <input
              autoFocus={!expense}
              inputMode="decimal"
              placeholder="0.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="Amount"
              className="tnum w-full border-b border-line bg-transparent pb-2 text-4xl font-semibold
                         placeholder:text-ink-3 focus:border-accent focus:outline-none"
            />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <Segmented
              ariaLabel="Currency"
              value={currency}
              onChange={setCurrency}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
            {currency !== BASE_CURRENCY && (
              <span className="tnum text-right text-xs text-ink-3">
                = {money(eurValue, BASE_CURRENCY)}
                <br />
                <span className="text-[11px]">1 {BASE_CURRENCY} = {rate.toFixed(2)} {currency}</span>
              </span>
            )}
          </div>
        </div>

        <Field label="Category">
          <div className="flex flex-wrap gap-2">
            {active.map((c) => {
              const Icon = iconFor(c.icon)
              const selected = categoryId === c.id
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  aria-pressed={selected}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                    selected ? 'border-transparent bg-raised font-medium text-ink' : 'border-line text-ink-2 hover:bg-raised'
                  }`}
                  style={selected ? { boxShadow: `inset 0 0 0 1.5px ${slotColor(c.color_slot)}` } : undefined}
                >
                  <Icon size={15} style={{ color: slotColor(c.color_slot) }} />
                  {c.name}
                </button>
              )
            })}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Date">
            <input
              type="date"
              value={spentOn}
              max={today()}
              onChange={(e) => setSpentOn(e.target.value || today())}
              className={`${inputClass} w-full`}
            />
          </Field>
          <Field label="Note">
            <input
              type="text"
              value={note}
              maxLength={200}
              placeholder="Optional"
              onChange={(e) => setNote(e.target.value)}
              className={`${inputClass} w-full`}
            />
          </Field>
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
