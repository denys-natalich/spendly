import { useMemo, useState } from 'react'
import { ArrowLeft, Inbox, Pencil, Plus, Share2 } from 'lucide-react'
import { useStore } from '../store'
import { UNASSIGNED, byTraveller, groupByDay, total } from '../lib/analytics'
import { dayLabel, money } from '../lib/format'
import { UNCATEGORISED_COLOR, slotColor } from '../lib/icons'
import type { Currency, Traveller, Trip, TripExpense } from '../types'
import { ShareTrip } from './ShareTrip'
import { TravellerBadge } from './TravellerBadge'
import { TripExpenseSheet } from './TripExpenseSheet'
import { Button, Card, EmptyState, SectionTitle } from './ui'

export function TripDetail({ trip, travellers, onBack, onEditTrip }: {
  trip: Trip
  travellers: Traveller[]
  onBack: () => void
  onEditTrip: () => void
}) {
  const { tripExpenses, rates, convert, displayCurrency, addTripExpense, updateTripExpense, deleteTripExpense } = useStore()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [editing, setEditing] = useState<TripExpense | null>(null)

  const expenses = useMemo(
    () => tripExpenses.filter((e) => e.trip_id === trip.id),
    [tripExpenses, trip.id],
  )
  const spent = useMemo(() => total(expenses, convert), [expenses, convert])
  const perPerson = useMemo(() => byTraveller(expenses, travellers, convert), [expenses, travellers, convert])
  const days = useMemo(() => groupByDay(expenses, convert), [expenses, convert])

  // Colour follows the traveller, not the row, so a person keeps theirs
  // wherever they appear — the breakdown, the chips in the sheet, the list.
  const colours = useMemo(
    () => new Map(travellers.map((t, i) => [t.id, slotColor(i + 1)])),
    [travellers],
  )
  const names = useMemo(() => new Map(travellers.map((t) => [t.id, t.name])), [travellers])

  function openNew() {
    setEditing(null)
    setSheetOpen(true)
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onBack}
          aria-label="All trips"
          className="rounded-lg p-2 text-ink-3 hover:bg-raised hover:text-ink"
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="min-w-0 flex-1 truncate text-base font-semibold">{trip.name}</h2>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          aria-label="Share trip"
          className="rounded-lg p-2 text-ink-3 hover:bg-raised hover:text-ink"
        >
          <Share2 size={16} />
        </button>
        <button
          type="button"
          onClick={onEditTrip}
          aria-label="Edit trip"
          className="rounded-lg p-2 text-ink-3 hover:bg-raised hover:text-ink"
        >
          <Pencil size={16} />
        </button>
        {/* Wrapped rather than given `hidden md:inline-flex`: the button's own
            display utility and that one are the same kind, so which wins would
            come down to stylesheet order. */}
        <span className="hidden md:block">
          <Button onClick={openNew}>
            <Plus size={16} /> Add expense
          </Button>
        </span>
      </div>

      <Card className="p-5">
        <div className="text-center">
          <div className="tnum text-4xl font-semibold tracking-tight">{money(spent, displayCurrency)}</div>
          <p className="mt-1.5 text-sm text-ink-3">
            {expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'} ·{' '}
            {travellers.length} {travellers.length === 1 ? 'traveller' : 'travellers'}
          </p>
        </div>

        {/* Who paid what, and — if the trip were split evenly — who is up or
            down on it. The split is a reading of the same numbers, not another
            place to enter them: nothing here is stored. */}
        <div className="mt-5 space-y-1 border-t border-line pt-4">
          {perPerson.map((p) => (
            <div key={p.key} className="flex items-center gap-3 px-1 py-1.5">
              <TravellerBadge
                name={p.name}
                color={p.key === UNASSIGNED ? UNCATEGORISED_COLOR : colours.get(p.key) ?? p.color}
                size={32}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="tnum block text-xs text-ink-3">
                  {p.count === 0
                    ? 'Paid for nothing yet'
                    : `${p.count} ${p.count === 1 ? 'expense' : 'expenses'}`}
                </span>
              </span>
              <span className="text-right">
                <span className="tnum block text-sm font-semibold">{money(p.paid, displayCurrency)}</span>
                <span className="tnum block text-xs">
                  <Balance amount={p.balance} unassigned={p.key === UNASSIGNED} currency={displayCurrency} />
                </span>
              </span>
            </div>
          ))}
        </div>

        {travellers.length > 1 && expenses.length > 0 && (
          <p className="mt-3 border-t border-line pt-3 text-center text-xs text-ink-3">
            Split evenly, that is {money(spent / travellers.length, displayCurrency)} each.
          </p>
        )}
      </Card>

      <section>
        <SectionTitle>Expenses</SectionTitle>
        {expenses.length === 0 ? (
          <Card>
            <EmptyState
              icon={<Inbox size={32} />}
              title="Nothing logged for this trip"
              body="Record what was spent and who paid for it. These amounts stay inside the trip."
              action={
                <button type="button" onClick={openNew} className="text-sm font-medium text-accent hover:underline">
                  Add the first one
                </button>
              }
            />
          </Card>
        ) : (
          <div className="space-y-4">
            {days.map((group) => (
              <div key={group.day}>
                <div className="mb-1.5 flex items-baseline justify-between px-1">
                  <h3 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">
                    {dayLabel(group.day)}
                  </h3>
                  <span className="tnum text-xs text-ink-3">{money(group.total, displayCurrency)}</span>
                </div>
                <Card className="divide-y divide-line overflow-hidden">
                  {group.items.map((e) => {
                    const who = e.traveller_id ? names.get(e.traveller_id) : undefined
                    const colour = e.traveller_id
                      ? colours.get(e.traveller_id) ?? UNCATEGORISED_COLOR
                      : UNCATEGORISED_COLOR
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => { setEditing(e); setSheetOpen(true) }}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
                      >
                        <TravellerBadge name={who ?? '?'} color={colour} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{who ?? 'Unassigned'}</span>
                          {e.note && <span className="block truncate text-xs text-ink-3">{e.note}</span>}
                        </span>
                        <span className="text-right">
                          <span className="tnum block text-sm font-semibold">
                            {money(convert(e), displayCurrency)}
                          </span>
                          {e.currency !== displayCurrency && (
                            <span className="tnum block text-xs text-ink-3">{money(e.amount, e.currency)}</span>
                          )}
                        </span>
                      </button>
                    )
                  })}
                </Card>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Same place as the FAB on the other tabs, which is hidden here: on a
          trip the thing to add is a trip expense, never a personal one. */}
      <button
        type="button"
        onClick={openNew}
        aria-label="Add trip expense"
        className="fixed right-5 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14
                   items-center justify-center rounded-full bg-accent text-accent-in shadow-lg
                   transition-transform active:scale-95 md:hidden"
      >
        <Plus size={24} />
      </button>

      <TripExpenseSheet
        open={sheetOpen}
        tripName={trip.name}
        travellers={travellers}
        expense={editing}
        rates={rates}
        onSave={(draft, id) => (id ? updateTripExpense(id, draft) : addTripExpense(trip.id, draft))}
        onDelete={deleteTripExpense}
        onClose={() => setSheetOpen(false)}
      />

      <ShareTrip open={shareOpen} trip={trip} onClose={() => setShareOpen(false)} />
    </div>
  )
}

/**
 * Even-split standing: what the trip owes this person, or what they owe it.
 * Rounds to the cent before deciding — a third of a euro leaves a remainder
 * that would otherwise read as a debt of nothing.
 */
function Balance({ amount, unassigned, currency }: {
  amount: number
  unassigned: boolean
  currency: Currency
}) {
  if (unassigned) return <span className="text-ink-3">no share</span>
  if (Math.abs(amount) < 0.005) return <span className="text-ink-3">settled</span>
  return amount > 0 ? (
    <span className="text-good">gets back {money(Math.abs(amount), currency)}</span>
  ) : (
    <span className="text-danger">owes {money(Math.abs(amount), currency)}</span>
  )
}
