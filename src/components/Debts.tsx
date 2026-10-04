import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ChevronRight, HandCoins, Inbox, Minus, Pencil, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { dayLabel, money, symbolOf, today } from '../lib/format'
import { toast } from '../lib/toast'
import { BASE_CURRENCY, CURRENCIES, type Currency, type Debt, type DebtDirection, type DebtEntry } from '../types'
import { Button, Card, EmptyState, Field, SectionTitle, Segmented, Sheet, Spinner, inputClass } from './ui'

/* Stable empty list, so a debt with nothing recorded doesn't get a new array every render. */
const NO_ENTRIES: DebtEntry[] = []

function parseAmount(raw: string): number {
  return Number(raw.replace(',', '.'))
}

function groupByDebt(rows: DebtEntry[]): Map<string, DebtEntry[]> {
  const map = new Map<string, DebtEntry[]>()
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
function balancesOf(entries: DebtEntry[]): Balance[] {
  return CURRENCIES.flatMap((currency) => {
    const sum = (direction: DebtDirection) => entries
      .filter((e) => e.currency === currency && e.direction === direction)
      .reduce((total, e) => total + e.amount, 0)
    const owed = sum('plus')
    const paid = sum('minus')
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
  const { debts, debtEntries, debtsLoading, debtsError } = useStore()
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null)

  const byDebt = useMemo(() => groupByDebt(debtEntries), [debtEntries])

  // Gone once deleted, which drops back to the list on its own.
  const open = debts.find((d) => d.id === openId) ?? null

  return (
    <>
      {debtsError && <Card className="mb-4 border-danger/40 p-4 text-sm text-danger">{debtsError}</Card>}

      {open ? (
        <DebtDetail
          debt={open}
          entries={byDebt.get(open.id) ?? NO_ENTRIES}
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
                const entries = byDebt.get(d.id) ?? NO_ENTRIES
                const payments = entries.filter((e) => e.direction === 'minus').length
                const balances = balancesOf(entries)
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
                        {payments} {payments === 1 ? 'instalment' : 'instalments'}
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

/** One debt: what is left in each currency, and everything recorded against it. */
function DebtDetail({ debt, entries, onBack, onEdit }: {
  debt: Debt
  entries: DebtEntry[]
  onBack: () => void
  onEdit: () => void
}) {
  // The direction a new entry starts in; null while the sheet is closed.
  const [adding, setAdding] = useState<DebtDirection | null>(null)
  const [editing, setEditing] = useState<DebtEntry | null>(null)

  const balances = useMemo(() => balancesOf(entries), [entries])
  const owesAnything = balances.some((b) => !isSettled(b))

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
          <Button variant={owesAnything ? 'subtle' : 'primary'} className="flex-1" onClick={() => setAdding('plus')}>
            <Plus size={16} /> Add amount
          </Button>
          {owesAnything && (
            <Button className="flex-1" onClick={() => setAdding('minus')}>
              <Minus size={16} /> Instalment
            </Button>
          )}
        </div>
      </Card>

      <section>
        <SectionTitle>History</SectionTitle>
        {entries.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Inbox size={32} />}
              title="Nothing recorded yet"
              body="Amounts owed and instalments paid show up here. Every instalment is taken off what is left."
            />
          </Card>
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {entries.map((e) => (
              <button
                key={e.id}
                type="button"
                onClick={() => setEditing(e)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {e.description || (e.direction === 'plus' ? 'Amount owed' : 'Instalment')}
                  </span>
                  <span className="block text-xs text-ink-3">{dayLabel(e.happened_on)}</span>
                </span>
                <span className={`tnum shrink-0 text-sm font-semibold ${e.direction === 'minus' ? 'text-good' : ''}`}>
                  {e.direction === 'plus' ? '+' : '−'}{money(e.amount, e.currency)}
                </span>
              </button>
            ))}
          </Card>
        )}
      </section>

      <EntrySheet
        debt={adding || editing ? debt : null}
        row={editing}
        direction={adding ?? 'plus'}
        entries={entries}
        onClose={() => { setAdding(null); setEditing(null) }}
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

/**
 * Add an entry under a debt — money owed (+) or an instalment paying it down
 * (−) — or edit / remove one. The direction can be switched on the sheet, so a
 * payment entered as a loan by mistake is one tap to fix.
 */
function EntrySheet({ debt, row, direction: initial, entries, onClose }: {
  debt: Debt | null
  row: DebtEntry | null
  /** The direction a new entry starts in. */
  direction: DebtDirection
  /** Everything under this debt, including the row being edited. */
  entries: DebtEntry[]
  onClose: () => void
}) {
  const { addDebtEntry, updateDebtEntry, deleteDebtEntry } = useStore()
  const [direction, setDirection] = useState<DebtDirection>('plus')
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>(BASE_CURRENCY)
  const [description, setDescription] = useState('')
  const [day, setDay] = useState(today())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = debt !== null
  // Balances as they would be without the row being edited.
  const others = useMemo(() => balancesOf(row ? entries.filter((e) => e.id !== row.id) : entries), [entries, row])

  useEffect(() => {
    if (!open) return
    // A new amount starts in the currency last used; a new instalment in the first one still owed.
    const start = initial === 'minus'
      ? others.find((b) => !isSettled(b))?.currency
      : entries.find((e) => e.direction === 'plus')?.currency
    setDirection(row?.direction ?? initial)
    setAmount(row ? String(row.amount) : '')
    setCurrency(row?.currency ?? start ?? others[0]?.currency ?? BASE_CURRENCY)
    setDescription(row?.description ?? '')
    setDay(row?.happened_on ?? today())
    setBusy(false)
    setError(null)
    // Only on opening — the balances move as soon as this entry is saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, row, initial])

  if (!debt) return null

  const parsed = parseAmount(amount)
  const valid = Number.isFinite(parsed) && parsed > 0
  const balance = others.find((b) => b.currency === currency)
  // A payment can only go to a currency something is owed in; a loan to any.
  const owedIn = others.filter((b) => b.owed > 0).map((b) => b.currency)
  const choices = direction === 'minus' && owedIn.length > 0
    ? CURRENCIES.filter((c) => owedIn.includes(c) || c === currency)
    : CURRENCIES

  async function save() {
    if (!debt || !valid) return
    setBusy(true)
    setError(null)
    const draft = {
      direction,
      amount: Number(parsed.toFixed(2)),
      currency,
      description: description.trim() || null,
      happened_on: day,
    }
    const noun = direction === 'plus' ? 'Amount' : 'Instalment'
    try {
      if (row) await updateDebtEntry(row.id, draft)
      else await addDebtEntry(debt.id, draft)
      toast(row ? `${noun} updated` : direction === 'plus' ? 'Amount added' : 'Instalment recorded')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not save the ${noun.toLowerCase()}.`)
      setBusy(false)
    }
  }

  async function remove() {
    if (!row) return
    setBusy(true)
    try {
      await deleteDebtEntry(row.id)
      toast(row.direction === 'plus' ? 'Amount deleted' : 'Instalment deleted')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the entry.')
      setBusy(false)
    }
  }

  const left = balance?.left ?? 0
  const after = direction === 'plus' ? left + (valid ? parsed : 0) : left - (valid ? parsed : 0)

  return (
    <Sheet open={open} title={`${row ? 'Edit entry' : 'New entry'} · ${debt.name}`} onClose={onClose}>
      <div className="space-y-3.5">
        <Segmented
          ariaLabel="Direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: 'plus', label: <span className="inline-flex items-center gap-1"><Plus size={14} /> Amount owed</span> },
            { value: 'minus', label: <span className="inline-flex items-center gap-1"><Minus size={14} /> Instalment</span> },
          ]}
        />

        <div className="flex items-end gap-3">
          <AmountInput
            autoFocus={!row}
            value={amount}
            onChange={setAmount}
            currency={currency}
            label={direction === 'plus' ? 'Amount owed' : 'Instalment amount'}
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
            : `${money(Math.max(0, after), currency)} left after this`}
        </p>

        <DetailsFields
          description={description}
          onDescription={setDescription}
          placeholder={direction === 'plus'
            ? 'Description — lent for rent, phone on credit'
            : 'Description — September payment, bank transfer'}
          day={day}
          onDay={setDay}
        />

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-2">
          <Button onClick={save} busy={busy} disabled={!valid} className="flex-1">
            {row ? 'Save changes' : direction === 'plus' ? 'Add amount' : 'Record instalment'}
          </Button>
          {row && (
            <Button variant="danger" onClick={remove} aria-label="Delete entry">
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
