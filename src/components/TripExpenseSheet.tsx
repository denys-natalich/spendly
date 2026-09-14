import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { slotColor } from '../lib/icons'
import { money, symbolOf, today } from '../lib/format'
import { nearestKnown, rateToEur } from '../lib/fx'
import { toast } from '../lib/toast'
import { BASE_CURRENCY, CURRENCIES, type Currency, type DayRates, type TripExpenseDraft } from '../types'
import { TravellerBadge } from './TravellerBadge'
import { Button, Segmented, Sheet, inputClass } from './ui'

/** All the sheet needs of a row, so a shared trip can hand it one too. */
export interface EditableTripExpense {
  id: string
  traveller_id: string | null
  amount: number
  currency: Currency
  spent_on: string
  note: string | null
}

/**
 * The travel twin of the expense sheet: same amount row, same currencies, same
 * rates — with who paid in place of the category, which is the whole point of
 * recording a trip separately.
 *
 * Saving and deleting arrive as props rather than being taken from the account
 * store, because the same sheet serves someone who has no account: a link
 * holder writes through the trip's share instead. The fields, the rate line
 * and the validation are then the same on both sides by construction.
 */
export function TripExpenseSheet({
  open, tripName, travellers, expense, rates, defaultTravellerId, onSave, onDelete, onClose,
}: {
  open: boolean
  tripName: string
  travellers: Array<{ id: string; name: string }>
  expense: EditableTripExpense | null
  rates: Map<string, DayRates>
  /** Who a new expense is attributed to before anyone touches the row of
   *  people — the person holding the phone, when that is known. */
  defaultTravellerId?: string | null
  onSave: (draft: TripExpenseDraft, id: string | null) => Promise<void>
  /** Absent when this row is not the viewer's to remove. */
  onDelete?: (id: string) => Promise<void>
  onClose: () => void
}) {
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>(BASE_CURRENCY)
  const [travellerId, setTravellerId] = useState<string | null>(null)
  const [spentOn, setSpentOn] = useState(today())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const colours = useMemo(
    () => new Map(travellers.map((t, i) => [t.id, slotColor(i + 1)])),
    [travellers],
  )

  // Re-seeded each time the sheet opens rather than on every render, so a
  // parent update can never clobber what is being typed.
  useEffect(() => {
    if (!open) return
    setError(null)
    setBusy(false)
    setAmount(expense ? String(expense.amount) : '')
    setCurrency(expense?.currency ?? BASE_CURRENCY)
    setTravellerId(expense ? expense.traveller_id : defaultTravellerId ?? travellers[0]?.id ?? null)
    setSpentOn(expense?.spent_on ?? today())
    setNote(expense?.note ?? '')
  }, [open, expense, travellers, defaultTravellerId])

  const parsed = Number(amount.replace(',', '.'))
  const valid = Number.isFinite(parsed) && parsed > 0 && travellerId !== null

  const dayRates = rates.get(spentOn) ?? nearestKnown(spentOn, rates)
  const rate = rateToEur(currency, dayRates)
  const eurValue = Number.isFinite(parsed) && parsed > 0 ? parsed / rate : 0

  async function save() {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const draft = {
        traveller_id: travellerId,
        amount: Number(parsed.toFixed(2)),
        currency,
        spent_on: spentOn,
        note: note.trim() || null,
      }
      await onSave(draft, expense?.id ?? null)
      toast(expense ? 'Expense updated' : 'Expense added')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the expense.')
      setBusy(false)
    }
  }

  async function remove() {
    if (!expense || !onDelete) return
    setBusy(true)
    try {
      await onDelete(expense.id)
      toast('Expense deleted')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the expense.')
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      title={expense ? 'Edit trip expense' : `New expense · ${tripName}`}
      onClose={onClose}
    >
      <div className="space-y-3.5">
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

        {/* Who paid. One scrolling row, like the categories on a personal
            expense, so a group of six still fits above the keyboard. */}
        <div>
          <span className="mb-1.5 block text-xs font-medium text-ink-2">Paid by</span>
          {travellers.length === 0 ? (
            <p className="text-sm text-ink-3">
              Add someone to this trip first — every expense records who paid for it.
            </p>
          ) : (
            <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 py-0.5">
              {travellers.map((t) => {
                const colour = colours.get(t.id)!
                const selected = travellerId === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    // Keep the keyboard up: the amount usually still has focus.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setTravellerId(t.id)}
                    aria-pressed={selected}
                    className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border py-1.5 pr-3.5 pl-1.5
                                text-sm transition-colors ${
                                  selected
                                    ? 'border-transparent bg-raised font-medium text-ink'
                                    : 'border-line text-ink-2'
                                }`}
                    style={selected ? { boxShadow: `inset 0 0 0 1.5px ${colour}` } : undefined}
                  >
                    <TravellerBadge name={t.name} color={colour} size={24} />
                    {t.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <input
          type="text"
          value={note}
          maxLength={200}
          placeholder="Note — dinner, taxi, tickets"
          onChange={(e) => setNote(e.target.value)}
          aria-label="Note"
          className={`${inputClass} w-full`}
        />

        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3.5 py-2">
          <span className="text-sm text-ink-2">Date</span>
          <input
            type="date"
            value={spentOn}
            max={today()}
            onChange={(e) => setSpentOn(e.target.value || today())}
            aria-label="Date"
            className="tnum bg-transparent text-right text-sm pointer-coarse:text-base text-ink focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-2">
          <Button onClick={save} busy={busy} disabled={!valid} className="flex-1">
            {expense ? 'Save changes' : 'Add expense'}
          </Button>
          {expense && onDelete && (
            <Button variant="danger" onClick={remove} aria-label="Delete expense">
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
