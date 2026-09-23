import { useEffect, useMemo, useState } from 'react'
import { HandCoins, Pencil, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { dayLabel, money, symbolOf, today } from '../lib/format'
import { toast } from '../lib/toast'
import { BASE_CURRENCY, CURRENCIES, type Currency, type Debt, type DebtInstallment } from '../types'
import { Button, Card, EmptyState, Field, Segmented, Sheet, Spinner, inputClass } from './ui'

/* Stable empty list, so a card with no payments doesn't get a new array every render. */
const NO_INSTALLMENTS: DebtInstallment[] = []

function parseAmount(raw: string): number {
  return Number(raw.replace(',', '.'))
}

function sumOf(rows: DebtInstallment[]): number {
  return rows.reduce((sum, r) => sum + r.amount, 0)
}

export function Debts() {
  const { debts, installments, debtsLoading, debtsError } = useStore()
  const [creating, setCreating] = useState(false)
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null)
  // Which debt the instalment sheet is for, and the row being edited, if any.
  const [payingDebt, setPayingDebt] = useState<Debt | null>(null)
  const [editingRow, setEditingRow] = useState<DebtInstallment | null>(null)

  const byDebt = useMemo(() => {
    const map = new Map<string, DebtInstallment[]>()
    for (const row of installments) {
      const list = map.get(row.debt_id)
      if (list) list.push(row)
      else map.set(row.debt_id, [row])
    }
    return map
  }, [installments])

  const payingRows = (payingDebt && byDebt.get(payingDebt.id)) || NO_INSTALLMENTS

  return (
    <>
      {debtsError && <Card className="mb-4 border-danger/40 p-4 text-sm text-danger">{debtsError}</Card>}

      {debtsLoading ? (
        <Spinner label="Loading your debts" />
      ) : (
        <div className="space-y-4">
          <Button onClick={() => setCreating(true)} className="w-full">
            <Plus size={16} /> New debt
          </Button>

          {debts.length === 0 ? (
            <Card>
              <EmptyState
                icon={<HandCoins size={32} />}
                title="No debts yet"
                body="Add what you owe, then record each instalment as you pay it — the balance goes down with every one. Debts are kept out of your monthly totals."
                action={
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    Add a debt
                  </button>
                }
              />
            </Card>
          ) : (
            debts.map((d) => (
              <DebtCard
                key={d.id}
                debt={d}
                rows={byDebt.get(d.id) ?? NO_INSTALLMENTS}
                onEdit={() => setEditingDebt(d)}
                onPay={() => { setEditingRow(null); setPayingDebt(d) }}
                onEditRow={(row) => { setEditingRow(row); setPayingDebt(d) }}
              />
            ))
          )}
        </div>
      )}

      <DebtSheet
        open={creating || editingDebt !== null}
        debt={editingDebt}
        paid={editingDebt ? sumOf(byDebt.get(editingDebt.id) ?? NO_INSTALLMENTS) : 0}
        onClose={() => { setCreating(false); setEditingDebt(null) }}
      />

      <InstallmentSheet
        debt={payingDebt}
        row={editingRow}
        // What is left before this payment — excluding the row being edited.
        remaining={payingDebt ? payingDebt.amount - sumOf(payingRows) + (editingRow?.amount ?? 0) : 0}
        onClose={() => { setPayingDebt(null); setEditingRow(null) }}
      />
    </>
  )
}

function DebtCard({ debt, rows, onEdit, onPay, onEditRow }: {
  debt: Debt
  rows: DebtInstallment[]
  onEdit: () => void
  onPay: () => void
  onEditRow: (row: DebtInstallment) => void
}) {
  const paid = sumOf(rows)
  const left = debt.amount - paid
  const settled = left < 0.005
  const share = Math.min(1, paid / debt.amount)

  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-3 px-4 pt-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold">{debt.name}</h3>
          <div className="tnum mt-1 text-2xl font-semibold tracking-tight">
            {settled ? 'Paid off' : money(left, debt.currency)}
          </div>
          <p className="tnum mt-0.5 text-xs text-ink-3">
            {settled
              ? left < -0.005
                ? `Overpaid by ${money(-left, debt.currency)} · ${money(debt.amount, debt.currency)} owed`
                : `${money(debt.amount, debt.currency)} repaid`
              : `left of ${money(debt.amount, debt.currency)} · ${money(paid, debt.currency)} paid`}
          </p>
        </div>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${debt.name}`}
          className="-mt-1 -mr-1 rounded-lg p-2 text-ink-3 hover:bg-raised hover:text-ink"
        >
          <Pencil size={15} />
        </button>
      </div>

      <div
        className="mx-4 mt-3 h-1.5 overflow-hidden rounded-full bg-raised"
        role="progressbar"
        aria-label={`${debt.name} repaid`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${share * 100}%` }} />
      </div>

      {!settled && (
        <div className="px-4 pt-3">
          <Button variant="subtle" className="w-full" onClick={onPay}>
            <Plus size={16} /> Record instalment
          </Button>
        </div>
      )}

      {rows.length > 0 ? (
        <ul className="mt-3 divide-y divide-line border-t border-line">
          {rows.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onEditRow(r)}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-raised"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{r.description || 'Instalment'}</span>
                  <span className="block text-xs text-ink-3">{dayLabel(r.paid_on)}</span>
                </span>
                <span className="tnum shrink-0 text-sm font-semibold text-good">
                  −{money(r.amount, debt.currency)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 pt-2.5 pb-4 text-center text-xs text-ink-3">No instalments recorded yet.</p>
      )}
    </Card>
  )
}

/** A big amount field with the currency symbol in front, as on the expense sheet. */
function AmountInput({ value, onChange, currency, autoFocus, label }: {
  value: string
  onChange: (v: string) => void
  currency: Currency
  autoFocus?: boolean
  label: string
}) {
  return (
    <div className="flex min-w-0 flex-1 items-end gap-3">
      <span className="pb-2 text-xl text-ink-3">{symbolOf(currency)}</span>
      <input
        autoFocus={autoFocus}
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className="tnum min-w-0 flex-1 border-b border-line bg-transparent pb-1.5 text-3xl font-semibold
                   placeholder:text-ink-3 focus:border-accent focus:outline-none"
      />
    </div>
  )
}

/** Create or edit a debt: its name, how much is owed, and in what currency. */
function DebtSheet({ open, debt, paid, onClose }: {
  open: boolean
  debt: Debt | null
  /** Already recorded against this debt, to explain what a lower total means. */
  paid: number
  onClose: () => void
}) {
  const { createDebt, updateDebt, deleteDebt } = useStore()
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>(BASE_CURRENCY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(debt?.name ?? '')
    setAmount(debt ? String(debt.amount) : '')
    setCurrency(debt?.currency ?? BASE_CURRENCY)
    setBusy(false)
    setError(null)
    setConfirmDelete(false)
  }, [open, debt])

  const trimmedName = name.trim()
  const parsed = parseAmount(amount)
  const valid = trimmedName.length > 0 && Number.isFinite(parsed) && parsed > 0

  async function save() {
    if (!valid) return
    setBusy(true)
    setError(null)
    const draft = { name: trimmedName, amount: Number(parsed.toFixed(2)), currency }
    try {
      if (debt) await updateDebt(debt.id, draft)
      else await createDebt(draft)
      toast(debt ? 'Debt updated' : 'Debt added')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the debt.')
      setBusy(false)
    }
  }

  async function remove() {
    if (!debt) return
    setBusy(true)
    try {
      await deleteDebt(debt.id)
      toast('Debt deleted')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the debt.')
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={debt ? 'Edit debt' : 'New debt'} onClose={onClose}>
      <div className="space-y-5">
        <Field label="Name">
          <input
            autoFocus={!debt}
            value={name}
            maxLength={60}
            placeholder="Car loan, iPhone, Mom"
            onChange={(e) => setName(e.target.value)}
            aria-label="Debt name"
            className={`${inputClass} w-full`}
          />
        </Field>

        <div>
          <span className="mb-1.5 block text-xs font-medium text-ink-2">Total owed</span>
          <div className="flex items-end gap-3">
            <AmountInput value={amount} onChange={setAmount} currency={currency} label="Total owed" />
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
          {debt && paid > 0 && (
            <p className="tnum mt-2 text-xs text-ink-3">
              {money(paid, currency)} already paid — it will be taken off the new total.
            </p>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="space-y-2">
          <Button className="w-full" busy={busy} disabled={!valid} onClick={save}>
            {debt ? 'Save changes' : 'Add debt'}
          </Button>
          {debt && (
            <Button
              variant="danger"
              className="w-full"
              onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}
            >
              <Trash2 size={16} />
              {confirmDelete ? 'Tap again to delete it and its instalments' : 'Delete debt'}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}

/** Record a payment towards a debt, or edit / remove one already recorded. */
function InstallmentSheet({ debt, row, remaining, onClose }: {
  debt: Debt | null
  row: DebtInstallment | null
  /** Left on the debt before this payment. */
  remaining: number
  onClose: () => void
}) {
  const { addInstallment, updateInstallment, deleteInstallment } = useStore()
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [paidOn, setPaidOn] = useState(today())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = debt !== null

  useEffect(() => {
    if (!open) return
    setAmount(row ? String(row.amount) : '')
    setDescription(row?.description ?? '')
    setPaidOn(row?.paid_on ?? today())
    setBusy(false)
    setError(null)
  }, [open, row])

  if (!debt) return null

  const parsed = parseAmount(amount)
  const valid = Number.isFinite(parsed) && parsed > 0
  const after = remaining - (valid ? parsed : 0)

  async function save() {
    if (!debt || !valid) return
    setBusy(true)
    setError(null)
    const draft = {
      amount: Number(parsed.toFixed(2)),
      description: description.trim() || null,
      paid_on: paidOn,
    }
    try {
      if (row) await updateInstallment(row.id, draft)
      else await addInstallment(debt.id, draft)
      toast(row ? 'Instalment updated' : 'Instalment recorded')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the instalment.')
      setBusy(false)
    }
  }

  async function remove() {
    if (!row) return
    setBusy(true)
    try {
      await deleteInstallment(row.id)
      toast('Instalment deleted')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the instalment.')
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={row ? 'Edit instalment' : `Instalment · ${debt.name}`} onClose={onClose}>
      <div className="space-y-3.5">
        <AmountInput
          autoFocus={!row}
          value={amount}
          onChange={setAmount}
          currency={debt.currency}
          label="Instalment amount"
        />

        <p className="tnum -mt-1 text-right text-xs text-ink-3">
          {after < -0.005
            ? `${money(-after, debt.currency)} more than is left`
            : `Leaves ${money(Math.max(0, after), debt.currency)} of ${money(debt.amount, debt.currency)}`}
        </p>

        <input
          type="text"
          value={description}
          maxLength={200}
          placeholder="Description — September payment, bank transfer"
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Description"
          className={`${inputClass} w-full`}
        />

        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3.5 py-2">
          <span className="text-sm text-ink-2">Date</span>
          <input
            type="date"
            value={paidOn}
            max={today()}
            onChange={(e) => setPaidOn(e.target.value || today())}
            aria-label="Date"
            className="tnum bg-transparent text-right text-sm pointer-coarse:text-base text-ink focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-2">
          <Button onClick={save} busy={busy} disabled={!valid} className="flex-1">
            {row ? 'Save changes' : 'Record instalment'}
          </Button>
          {row && (
            <Button variant="danger" onClick={remove} aria-label="Delete instalment">
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
