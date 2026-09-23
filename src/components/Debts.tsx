import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronRight, HandCoins, Inbox, Pencil, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { dayLabel, money, symbolOf, today } from '../lib/format'
import { toast } from '../lib/toast'
import { BASE_CURRENCY, CURRENCIES, type Currency, type Debt, type DebtInstallment } from '../types'
import { Button, Card, EmptyState, Field, SectionTitle, Segmented, Sheet, Spinner, inputClass } from './ui'

/* Stable empty list, so a debt with no payments doesn't get a new array every render. */
const NO_INSTALLMENTS: DebtInstallment[] = []

function parseAmount(raw: string): number {
  return Number(raw.replace(',', '.'))
}

function sumOf(rows: DebtInstallment[]): number {
  return rows.reduce((sum, r) => sum + r.amount, 0)
}

/** Paid, left and the repaid share of one debt — the numbers every view of it shows. */
function standing(debt: Debt, rows: DebtInstallment[]) {
  const paid = sumOf(rows)
  const left = debt.amount - paid
  return { paid, left, settled: left < 0.005, share: Math.min(1, paid / debt.amount) }
}

export function Debts() {
  const { debts, installments, debtsLoading, debtsError } = useStore()
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null)

  const byDebt = useMemo(() => {
    const map = new Map<string, DebtInstallment[]>()
    for (const row of installments) {
      const list = map.get(row.debt_id)
      if (list) list.push(row)
      else map.set(row.debt_id, [row])
    }
    return map
  }, [installments])

  // Gone once deleted, which drops back to the list on its own.
  const open = debts.find((d) => d.id === openId) ?? null

  return (
    <>
      {debtsError && <Card className="mb-4 border-danger/40 p-4 text-sm text-danger">{debtsError}</Card>}

      {open ? (
        <DebtDetail
          debt={open}
          rows={byDebt.get(open.id) ?? NO_INSTALLMENTS}
          onBack={() => setOpenId(null)}
          onEdit={() => setEditingDebt(open)}
        />
      ) : debtsLoading ? (
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
            <Card className="divide-y divide-line overflow-hidden">
              {debts.map((d) => {
                const rows = byDebt.get(d.id) ?? NO_INSTALLMENTS
                const { left, settled, share } = standing(d, rows)
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setOpenId(d.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-medium">{d.name}</span>
                        <span className="tnum shrink-0 text-sm font-semibold">
                          {settled ? 'Paid off' : money(left, d.currency)}
                        </span>
                      </span>
                      <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-raised" aria-hidden>
                        <span className="block h-full rounded-full bg-accent" style={{ width: `${share * 100}%` }} />
                      </span>
                      <span className="tnum mt-1 block text-xs text-ink-3">
                        {rows.length} {rows.length === 1 ? 'instalment' : 'instalments'} · of{' '}
                        {money(d.amount, d.currency)}
                      </span>
                    </span>
                    <ChevronRight size={14} className="shrink-0 text-ink-3" />
                  </button>
                )
              })}
            </Card>
          )}
        </div>
      )}

      <DebtSheet
        open={creating || editingDebt !== null}
        debt={editingDebt}
        paid={editingDebt ? sumOf(byDebt.get(editingDebt.id) ?? NO_INSTALLMENTS) : 0}
        onClose={() => { setCreating(false); setEditingDebt(null) }}
        onCreated={(id) => setOpenId(id)}
      />
    </>
  )
}

/** One debt: what is left, and every instalment recorded against it. */
function DebtDetail({ debt, rows, onBack, onEdit }: {
  debt: Debt
  rows: DebtInstallment[]
  onBack: () => void
  onEdit: () => void
}) {
  const [paying, setPaying] = useState(false)
  const [editingRow, setEditingRow] = useState<DebtInstallment | null>(null)
  const { paid, left, settled, share } = standing(debt, rows)

  function openNew() {
    setEditingRow(null)
    setPaying(true)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="All debts"
          className="rounded-lg p-2 text-ink-3 hover:bg-raised hover:text-ink"
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{debt.name}</h2>
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit debt"
          className="rounded-lg p-2 text-ink-3 hover:bg-raised hover:text-ink"
        >
          <Pencil size={16} />
        </button>
      </div>

      <Card className="p-5">
        <div className="text-center">
          <div className="tnum text-4xl font-semibold tracking-tight">
            {settled ? 'Paid off' : money(left, debt.currency)}
          </div>
          <p className="tnum mt-1.5 text-sm text-ink-3">
            {settled
              ? left < -0.005
                ? `Overpaid by ${money(-left, debt.currency)} · ${money(debt.amount, debt.currency)} owed`
                : `${money(debt.amount, debt.currency)} repaid`
              : `left of ${money(debt.amount, debt.currency)} · ${money(paid, debt.currency)} paid`}
          </p>
        </div>
        <div
          className="mt-4 h-1.5 overflow-hidden rounded-full bg-raised"
          role="progressbar"
          aria-label={`${debt.name} repaid`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(share * 100)}
        >
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${share * 100}%` }} />
        </div>
        {!settled && (
          <Button className="mt-4 w-full" onClick={openNew}>
            <Plus size={16} /> Record instalment
          </Button>
        )}
      </Card>

      <section>
        <SectionTitle>Instalments</SectionTitle>
        {rows.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Inbox size={32} />}
              title="No instalments yet"
              body="Record each payment as you make it. Every one is taken off what is left."
            />
          </Card>
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {rows.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => { setEditingRow(r); setPaying(true) }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{r.description || 'Instalment'}</span>
                  <span className="block text-xs text-ink-3">{dayLabel(r.paid_on)}</span>
                </span>
                <span className="tnum shrink-0 text-sm font-semibold text-good">
                  −{money(r.amount, debt.currency)}
                </span>
              </button>
            ))}
          </Card>
        )}
      </section>

      <InstallmentSheet
        debt={paying ? debt : null}
        row={editingRow}
        // What is left before this payment — excluding the row being edited.
        remaining={left + (editingRow?.amount ?? 0)}
        onClose={() => { setPaying(false); setEditingRow(null) }}
      />
    </div>
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
function DebtSheet({ open, debt, paid, onClose, onCreated }: {
  open: boolean
  debt: Debt | null
  /** Already recorded against this debt, to explain what a lower total means. */
  paid: number
  onClose: () => void
  onCreated: (id: string) => void
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
      else onCreated((await createDebt(draft)).id)
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
