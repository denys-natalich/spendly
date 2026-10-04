import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronRight, HandCoins, Inbox, Pencil, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { dayLabel, money, symbolOf, today } from '../lib/format'
import { toast } from '../lib/toast'
import { BASE_CURRENCY, CURRENCIES, type Currency, type Debt, type DebtAmount, type DebtInstallment } from '../types'
import { Button, Card, EmptyState, Field, SectionTitle, Segmented, Sheet, Spinner, inputClass } from './ui'

/* Stable empty lists, so a debt with nothing recorded doesn't get a new array every render. */
const NO_AMOUNTS: DebtAmount[] = []
const NO_INSTALLMENTS: DebtInstallment[] = []

function parseAmount(raw: string): number {
  return Number(raw.replace(',', '.'))
}

function groupByDebt<T extends { debt_id: string }>(rows: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>()
  for (const row of rows) {
    const list = map.get(row.debt_id)
    if (list) list.push(row)
    else map.set(row.debt_id, [row])
  }
  return map
}

/** Owed, paid and left in one currency. */
interface Balance {
  currency: Currency
  owed: number
  paid: number
  left: number
}

/**
 * Where a debt stands, one line per currency it has anything in. Currencies
 * are never added together — each is paid down on its own.
 */
function balancesOf(amounts: DebtAmount[], rows: DebtInstallment[]): Balance[] {
  return CURRENCIES.flatMap((currency) => {
    const owed = amounts.filter((a) => a.currency === currency).reduce((sum, a) => sum + a.amount, 0)
    const paid = rows.filter((r) => r.currency === currency).reduce((sum, r) => sum + r.amount, 0)
    return owed === 0 && paid === 0 ? [] : [{ currency, owed, paid, left: owed - paid }]
  })
}

function isSettled(b: Balance): boolean {
  return b.left < 0.005
}

function shareOf(b: Balance): number {
  return b.owed > 0 ? Math.min(1, b.paid / b.owed) : 1
}

/** One line for a debt as a whole: what is left, or why nothing is. */
function headline(balances: Balance[]): string {
  if (balances.length === 0) return 'Nothing owed yet'
  const open = balances.filter((b) => !isSettled(b))
  if (open.length === 0) return 'Paid off'
  return open.map((b) => money(b.left, b.currency)).join(' · ')
}

export function Debts() {
  const { debts, amounts, installments, debtsLoading, debtsError } = useStore()
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null)

  const amountsByDebt = useMemo(() => groupByDebt(amounts), [amounts])
  const rowsByDebt = useMemo(() => groupByDebt(installments), [installments])

  // Gone once deleted, which drops back to the list on its own.
  const open = debts.find((d) => d.id === openId) ?? null

  return (
    <>
      {debtsError && <Card className="mb-4 border-danger/40 p-4 text-sm text-danger">{debtsError}</Card>}

      {open ? (
        <DebtDetail
          debt={open}
          amounts={amountsByDebt.get(open.id) ?? NO_AMOUNTS}
          rows={rowsByDebt.get(open.id) ?? NO_INSTALLMENTS}
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
                body="Add a debt by name, then each amount owed and every instalment as it is paid — the balance goes down with every one. Debts are kept out of your monthly totals."
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
                const lent = amountsByDebt.get(d.id) ?? NO_AMOUNTS
                const rows = rowsByDebt.get(d.id) ?? NO_INSTALLMENTS
                const balances = balancesOf(lent, rows)
                // A bar only means something in one currency; across several it would add € to ₴.
                const single = balances.length === 1 ? balances[0] : null
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
                        <span className={`tnum shrink-0 text-sm font-semibold ${balances.length === 0 ? 'text-ink-3' : ''}`}>
                          {headline(balances)}
                        </span>
                      </span>
                      {single && (
                        <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-raised" aria-hidden>
                          <span className="block h-full rounded-full bg-accent" style={{ width: `${shareOf(single) * 100}%` }} />
                        </span>
                      )}
                      <span className="tnum mt-1 block text-xs text-ink-3">
                        {rows.length} {rows.length === 1 ? 'instalment' : 'instalments'}
                        {balances.some((b) => b.owed > 0) &&
                          ` · of ${balances.filter((b) => b.owed > 0).map((b) => money(b.owed, b.currency)).join(' + ')}`}
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
        onClose={() => { setCreating(false); setEditingDebt(null) }}
        onCreated={(id) => setOpenId(id)}
      />
    </>
  )
}

/** A line in a debt's history: money lent under it, or a payment towards it. */
type Entry =
  | { kind: 'amount'; day: string; row: DebtAmount }
  | { kind: 'instalment'; day: string; row: DebtInstallment }

/** One debt: what is left in each currency, and everything recorded against it. */
function DebtDetail({ debt, amounts, rows, onBack, onEdit }: {
  debt: Debt
  amounts: DebtAmount[]
  rows: DebtInstallment[]
  onBack: () => void
  onEdit: () => void
}) {
  const [lending, setLending] = useState(false)
  const [editingAmount, setEditingAmount] = useState<DebtAmount | null>(null)
  const [paying, setPaying] = useState(false)
  const [editingRow, setEditingRow] = useState<DebtInstallment | null>(null)

  const balances = useMemo(() => balancesOf(amounts, rows), [amounts, rows])
  const owesAnything = balances.some((b) => !isSettled(b))

  // Newest first; on the same day, the one entered last on top.
  const history = useMemo<Entry[]>(() => [
    ...amounts.map((row) => ({ kind: 'amount' as const, day: row.added_on, row })),
    ...rows.map((row) => ({ kind: 'instalment' as const, day: row.paid_on, row })),
  ].sort((a, b) => (a.day === b.day ? b.row.created_at.localeCompare(a.row.created_at) : b.day.localeCompare(a.day))),
  [amounts, rows])

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
        {balances.length === 0 ? (
          <div className="text-center">
            <div className="text-2xl font-semibold tracking-tight text-ink-3">Nothing owed yet</div>
            <p className="mt-1.5 text-sm text-ink-3">Add the amount owed to start tracking it.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {balances.map((b) => (
              <BalanceLine key={b.currency} name={debt.name} balance={b} large={balances.length === 1} />
            ))}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <Button
            variant={owesAnything ? 'subtle' : 'primary'}
            className="flex-1"
            onClick={() => { setEditingAmount(null); setLending(true) }}
          >
            <Plus size={16} /> Add amount
          </Button>
          {owesAnything && (
            <Button className="flex-1" onClick={() => { setEditingRow(null); setPaying(true) }}>
              <Plus size={16} /> Instalment
            </Button>
          )}
        </div>
      </Card>

      <section>
        <SectionTitle>History</SectionTitle>
        {history.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Inbox size={32} />}
              title="Nothing recorded yet"
              body="Amounts owed and instalments paid show up here. Every instalment is taken off what is left."
            />
          </Card>
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {history.map((e) => (
              <button
                key={e.row.id}
                type="button"
                onClick={() => {
                  if (e.kind === 'amount') { setEditingAmount(e.row); setLending(true) }
                  else { setEditingRow(e.row); setPaying(true) }
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {e.row.description || (e.kind === 'amount' ? 'Amount owed' : 'Instalment')}
                  </span>
                  <span className="block text-xs text-ink-3">{dayLabel(e.day)}</span>
                </span>
                {e.kind === 'amount' ? (
                  <span className="tnum shrink-0 text-sm font-semibold">+{money(e.row.amount, e.row.currency)}</span>
                ) : (
                  <span className="tnum shrink-0 text-sm font-semibold text-good">
                    −{money(e.row.amount, e.row.currency)}
                  </span>
                )}
              </button>
            ))}
          </Card>
        )}
      </section>

      <AmountSheet
        debt={lending ? debt : null}
        row={editingAmount}
        onClose={() => { setLending(false); setEditingAmount(null) }}
      />

      <InstallmentSheet
        debt={paying ? debt : null}
        row={editingRow}
        balances={balances}
        onClose={() => { setPaying(false); setEditingRow(null) }}
      />
    </div>
  )
}

/** What is left in one currency, with how much of it has been repaid. */
function BalanceLine({ name, balance: b, large }: { name: string; balance: Balance; large: boolean }) {
  const settled = isSettled(b)
  const share = shareOf(b)
  return (
    <div>
      <div className={large ? 'text-center' : 'flex items-baseline justify-between gap-3'}>
        <div className={`tnum font-semibold tracking-tight ${large ? 'text-4xl' : 'text-xl'}`}>
          {settled ? (large ? 'Paid off' : `${b.currency} paid off`) : money(b.left, b.currency)}
        </div>
        <p className={`tnum text-ink-3 ${large ? 'mt-1.5 text-sm' : 'text-xs'}`}>
          {settled
            ? b.left < -0.005
              ? `Overpaid by ${money(-b.left, b.currency)} · ${money(b.owed, b.currency)} owed`
              : `${money(b.owed, b.currency)} repaid`
            : `left of ${money(b.owed, b.currency)} · ${money(b.paid, b.currency)} paid`}
        </p>
      </div>
      <div
        className={`${large ? 'mt-4 h-1.5' : 'mt-2 h-1'} overflow-hidden rounded-full bg-raised`}
        role="progressbar"
        aria-label={`${name} repaid in ${b.currency}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
      >
        <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${share * 100}%` }} />
      </div>
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

/** The description and date fields both entry sheets share. */
function DetailsFields({ description, onDescription, placeholder, day, onDay }: {
  description: string
  onDescription: (v: string) => void
  placeholder: string
  day: string
  onDay: (v: string) => void
}) {
  return (
    <>
      <input
        type="text"
        value={description}
        maxLength={200}
        placeholder={placeholder}
        onChange={(e) => onDescription(e.target.value)}
        aria-label="Description"
        className={`${inputClass} w-full`}
      />

      <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3.5 py-2">
        <span className="text-sm text-ink-2">Date</span>
        <input
          type="date"
          value={day}
          max={today()}
          onChange={(e) => onDay(e.target.value || today())}
          aria-label="Date"
          className="tnum bg-transparent text-right text-sm pointer-coarse:text-base text-ink focus:outline-none"
        />
      </div>
    </>
  )
}

/** Create a debt or rename one. A debt is only a name; what is owed is added under it. */
function DebtSheet({ open, debt, onClose, onCreated }: {
  open: boolean
  debt: Debt | null
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { createDebt, updateDebt, deleteDebt } = useStore()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(debt?.name ?? '')
    setBusy(false)
    setError(null)
    setConfirmDelete(false)
  }, [open, debt])

  const trimmedName = name.trim()
  const valid = trimmedName.length > 0

  async function save() {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      if (debt) await updateDebt(debt.id, { name: trimmedName })
      else onCreated((await createDebt({ name: trimmedName })).id)
      toast(debt ? 'Debt renamed' : 'Debt added')
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
      <form
        className="space-y-5"
        onSubmit={(e) => { e.preventDefault(); void save() }}
      >
        <Field label="Name">
          <input
            autoFocus={!debt}
            value={name}
            maxLength={60}
            placeholder="Andriy, Mom, Car loan"
            onChange={(e) => setName(e.target.value)}
            aria-label="Debt name"
            className={`${inputClass} w-full`}
          />
        </Field>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="space-y-2">
          <Button type="submit" className="w-full" busy={busy} disabled={!valid}>
            {debt ? 'Save changes' : 'Add debt'}
          </Button>
          {debt && (
            <Button
              type="button"
              variant="danger"
              className="w-full"
              onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}
            >
              <Trash2 size={16} />
              {confirmDelete ? 'Tap again to delete it and everything recorded' : 'Delete debt'}
            </Button>
          )}
        </div>
      </form>
    </Sheet>
  )
}

/** Add money owed under a debt — the first amount or a later one — or edit / remove one. */
function AmountSheet({ debt, row, onClose }: {
  debt: Debt | null
  row: DebtAmount | null
  onClose: () => void
}) {
  const { amounts, addAmount, updateAmount, deleteAmount } = useStore()
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>(BASE_CURRENCY)
  const [description, setDescription] = useState('')
  const [addedOn, setAddedOn] = useState(today())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = debt !== null

  useEffect(() => {
    if (!open) return
    // A new amount starts in the currency last used for this debt.
    const last = amounts.find((a) => a.debt_id === debt?.id)
    setAmount(row ? String(row.amount) : '')
    setCurrency(row?.currency ?? last?.currency ?? BASE_CURRENCY)
    setDescription(row?.description ?? '')
    setAddedOn(row?.added_on ?? today())
    setBusy(false)
    setError(null)
    // Only on opening — not every time another amount changes underneath.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row])

  if (!debt) return null

  const parsed = parseAmount(amount)
  const valid = Number.isFinite(parsed) && parsed > 0

  async function save() {
    if (!debt || !valid) return
    setBusy(true)
    setError(null)
    const draft = {
      amount: Number(parsed.toFixed(2)),
      currency,
      description: description.trim() || null,
      added_on: addedOn,
    }
    try {
      if (row) await updateAmount(row.id, draft)
      else await addAmount(debt.id, draft)
      toast(row ? 'Amount updated' : 'Amount added')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the amount.')
      setBusy(false)
    }
  }

  async function remove() {
    if (!row) return
    setBusy(true)
    try {
      await deleteAmount(row.id)
      toast('Amount deleted')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the amount.')
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={row ? 'Edit amount' : `Amount · ${debt.name}`} onClose={onClose}>
      <div className="space-y-3.5">
        <div className="flex items-end gap-3">
          <AmountInput autoFocus={!row} value={amount} onChange={setAmount} currency={currency} label="Amount owed" />
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

        <DetailsFields
          description={description}
          onDescription={setDescription}
          placeholder="Description — lent for rent, phone on credit"
          day={addedOn}
          onDay={setAddedOn}
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-2">
          <Button onClick={save} busy={busy} disabled={!valid} className="flex-1">
            {row ? 'Save changes' : 'Add amount'}
          </Button>
          {row && (
            <Button variant="danger" onClick={remove} aria-label="Delete amount">
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}

/** Record a payment towards a debt, or edit / remove one already recorded. */
function InstallmentSheet({ debt, row, balances, onClose }: {
  debt: Debt | null
  row: DebtInstallment | null
  /** Where the debt stands now, including the row being edited. */
  balances: Balance[]
  onClose: () => void
}) {
  const { addInstallment, updateInstallment, deleteInstallment } = useStore()
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>(BASE_CURRENCY)
  const [description, setDescription] = useState('')
  const [paidOn, setPaidOn] = useState(today())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = debt !== null

  useEffect(() => {
    if (!open) return
    setAmount(row ? String(row.amount) : '')
    // A new payment goes to the first currency still owed.
    setCurrency(row?.currency ?? balances.find((b) => !isSettled(b))?.currency ?? balances[0]?.currency ?? BASE_CURRENCY)
    setDescription(row?.description ?? '')
    setPaidOn(row?.paid_on ?? today())
    setBusy(false)
    setError(null)
    // Only on opening — the balances move as soon as this payment is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row])

  if (!debt) return null

  const balance = balances.find((b) => b.currency === currency)
  const owed = balance?.owed ?? 0
  // What is left before this payment — excluding the row being edited.
  const remaining = (balance?.left ?? 0) + (row && row.currency === currency ? row.amount : 0)
  const parsed = parseAmount(amount)
  const valid = Number.isFinite(parsed) && parsed > 0
  const after = remaining - (valid ? parsed : 0)
  // Only the currencies something is owed in can be paid down.
  const choices = balances.map((b) => b.currency)

  async function save() {
    if (!debt || !valid) return
    setBusy(true)
    setError(null)
    const draft = {
      amount: Number(parsed.toFixed(2)),
      currency,
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
        <div className="flex items-end gap-3">
          <AmountInput
            autoFocus={!row}
            value={amount}
            onChange={setAmount}
            currency={currency}
            label="Instalment amount"
          />
          {choices.length > 1 && (
            <div className="shrink-0 pb-1">
              <Segmented
                compact
                ariaLabel="Currency"
                value={currency}
                onChange={setCurrency}
                options={choices.map((c) => ({ value: c, label: c }))}
              />
            </div>
          )}
        </div>

        <p className="tnum -mt-1 text-right text-xs text-ink-3">
          {after < -0.005
            ? `${money(-after, currency)} more than is left`
            : `Leaves ${money(Math.max(0, after), currency)} of ${money(owed, currency)}`}
        </p>

        <DetailsFields
          description={description}
          onDescription={setDescription}
          placeholder="Description — September payment, bank transfer"
          day={paidOn}
          onDay={setPaidOn}
        />

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
