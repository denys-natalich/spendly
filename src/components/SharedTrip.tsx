import { useEffect, useMemo, useState } from 'react'
import { Inbox, Link2Off, Plane, Plus, UserRound } from 'lucide-react'
import { useSharedTrip } from '../lib/useSharedTrip'
import { recallMe, rememberMe, type SharedExpense } from '../lib/share'
import { startSync } from '../lib/sync'
import { UNASSIGNED, byTraveller, groupByDay, total } from '../lib/analytics'
import { makeConverter } from '../lib/convert'
import { dayLabel, money } from '../lib/format'
import { UNCATEGORISED_COLOR, slotColor } from '../lib/icons'
import { toast } from '../lib/toast'
import { BASE_CURRENCY, CURRENCIES, type Currency } from '../types'
import { SyncPill } from './SyncStatus'
import { Toaster } from './Toaster'
import { TravellerBadge } from './TravellerBadge'
import { TripExpenseSheet } from './TripExpenseSheet'
import { Button, Card, EmptyState, Segmented, SectionTitle, Sheet, Spinner, inputClass } from './ui'

/**
 * A trip opened from a share link, by someone with no account.
 *
 * Its own screen rather than a mode of the app: there is no session here, no
 * personal ledger behind it and nothing else to navigate to. What it does
 * share with the app is everything that decides what a number means — the same
 * converter, the same even-split reading, the same expense sheet, and the same
 * queue, so a link holder with no signal is in exactly the same position as
 * the owner with no signal.
 */
export function SharedTrip({ token }: { token: string }) {
  const trip = useSharedTrip(token)
  const [displayCurrency, setDisplayCurrency] = useState<Currency>(BASE_CURRENCY)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<SharedExpense | null>(null)
  const [me, setMe] = useState<string | null>(() => recallMe(token))
  const [askingWho, setAskingWho] = useState(false)

  useEffect(() => { startSync() }, [])

  // Ask once, when the trip is known and this device has no answer on file.
  useEffect(() => {
    if (!trip.trip || trip.travellers.length === 0) return
    const known = me && trip.travellers.some((p) => p.id === me)
    if (!known) setAskingWho(true)
  }, [trip.trip, trip.travellers, me])

  const convert = useMemo(() => makeConverter(displayCurrency, trip.rates), [displayCurrency, trip.rates])
  const spent = useMemo(() => total(trip.expenses, convert), [trip.expenses, convert])
  const perPerson = useMemo(
    () => byTraveller(trip.expenses, trip.travellers, convert),
    [trip.expenses, trip.travellers, convert],
  )
  const days = useMemo(() => groupByDay(trip.expenses, convert), [trip.expenses, convert])
  const colours = useMemo(
    () => new Map(trip.travellers.map((t, i) => [t.id, slotColor(i + 1)])),
    [trip.travellers],
  )
  const names = useMemo(() => new Map(trip.travellers.map((t) => [t.id, t.name])), [trip.travellers])

  function chooseMe(id: string) {
    setMe(id)
    rememberMe(token, id)
    setAskingWho(false)
  }

  if (trip.gone) {
    return (
      <Closed
        title="This link is no longer active"
        body="Whoever shared the trip has switched the link off. Ask them for a new one — nothing you
              added has been lost."
      />
    )
  }

  if (trip.loading && !trip.trip) {
    return <div className="min-h-dvh"><Spinner label="Opening the trip" /></div>
  }

  if (!trip.trip) {
    return (
      <Closed
        title="That trip could not be opened"
        body={trip.error ?? 'Check the link, or ask for it again.'}
      />
    )
  }

  const mine = (e: SharedExpense) => e.created_via !== null && e.created_via === trip.shareId

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-bg/85 px-5 py-3 backdrop-blur">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-in">
          <Plane size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{trip.trip.name}</span>
          <span className="block text-xs text-ink-3">Shared trip</span>
        </span>
        <SyncPill />
      </header>

      <main className="mx-auto w-full max-w-2xl space-y-5 px-4 pt-4 pb-28 md:px-8 md:pt-8">
        {trip.error && (
          <Card className="border-danger/40 p-4 text-sm text-danger">{trip.error}</Card>
        )}

        <Card className="p-5">
          <div className="text-center">
            <div className="tnum text-4xl font-semibold tracking-tight">
              {money(spent, displayCurrency)}
            </div>
            <p className="mt-1.5 text-sm text-ink-3">
              {trip.expenses.length} {trip.expenses.length === 1 ? 'expense' : 'expenses'} ·{' '}
              {trip.travellers.length} {trip.travellers.length === 1 ? 'traveller' : 'travellers'}
            </p>
            <div className="mt-3 flex justify-center">
              <Segmented<Currency>
                compact
                ariaLabel="Display currency"
                value={displayCurrency}
                onChange={setDisplayCurrency}
                options={CURRENCIES.map((c) => ({ value: c, label: c }))}
              />
            </div>
          </div>

          <div className="mt-5 space-y-1 border-t border-line pt-4">
            {perPerson.map((p) => (
              <div key={p.key} className="flex items-center gap-3 px-1 py-1.5">
                <TravellerBadge
                  name={p.name}
                  color={p.key === UNASSIGNED ? UNCATEGORISED_COLOR : colours.get(p.key) ?? p.color}
                  size={32}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {p.name}
                    {p.key === me && <span className="ml-1.5 text-xs font-normal text-ink-3">you</span>}
                  </span>
                  <span className="tnum block text-xs text-ink-3">
                    {p.count === 0 ? 'Paid for nothing yet' : `${p.count} ${p.count === 1 ? 'expense' : 'expenses'}`}
                  </span>
                </span>
                <span className="text-right">
                  <span className="tnum block text-sm font-semibold">{money(p.paid, displayCurrency)}</span>
                  <span className="tnum block text-xs">
                    {p.key === UNASSIGNED ? (
                      <span className="text-ink-3">no share</span>
                    ) : Math.abs(p.balance) < 0.005 ? (
                      <span className="text-ink-3">settled</span>
                    ) : p.balance > 0 ? (
                      <span className="text-good">gets back {money(Math.abs(p.balance), displayCurrency)}</span>
                    ) : (
                      <span className="text-danger">owes {money(Math.abs(p.balance), displayCurrency)}</span>
                    )}
                  </span>
                </span>
              </div>
            ))}
          </div>

          {trip.travellers.length > 1 && trip.expenses.length > 0 && (
            <p className="mt-3 border-t border-line pt-3 text-center text-xs text-ink-3">
              Split evenly, that is {money(spent / trip.travellers.length, displayCurrency)} each.
            </p>
          )}
        </Card>

        <button
          type="button"
          onClick={() => setAskingWho(true)}
          className="flex w-full items-center gap-2 rounded-xl border border-line px-3.5 py-2.5 text-left
                     text-sm text-ink-2 transition-colors hover:bg-raised"
        >
          <UserRound size={15} className="shrink-0 text-ink-3" />
          <span className="min-w-0 flex-1 truncate">
            {me && names.get(me) ? <>You are <span className="font-medium text-ink">{names.get(me)}</span></> : 'Tell the trip who you are'}
          </span>
          <span className="shrink-0 text-xs text-accent">change</span>
        </button>

        <section>
          <SectionTitle>Expenses</SectionTitle>
          {trip.expenses.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Inbox size={32} />}
                title="Nothing logged yet"
                body="Add what you paid for. Everyone with the link sees the same list."
                action={
                  <button
                    type="button"
                    onClick={() => { setEditing(null); setSheetOpen(true) }}
                    className="text-sm font-medium text-accent hover:underline"
                  >
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
                      const editable = mine(e)
                      const Row = editable ? 'button' : 'div'
                      return (
                        <Row
                          key={e.id}
                          {...(editable
                            ? {
                              type: 'button' as const,
                              onClick: () => { setEditing(e); setSheetOpen(true) },
                              className:
                                'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised',
                            }
                            : { className: 'flex w-full items-center gap-3 px-4 py-3 text-left' })}
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
                        </Row>
                      )
                    })}
                  </Card>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 px-1 text-xs leading-relaxed text-ink-3">
            Only what you added through this link can be edited here. Everything you add goes into
            this trip in the organiser's Moneta, and works with no connection — it is sent when
            there is one.
          </p>
        </section>
      </main>

      <button
        type="button"
        onClick={() => { setEditing(null); setSheetOpen(true) }}
        aria-label="Add expense"
        className="fixed right-5 bottom-[calc(1.25rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14
                   items-center justify-center rounded-full bg-accent text-accent-in shadow-lg
                   transition-transform active:scale-95"
      >
        <Plus size={24} />
      </button>

      <Toaster />

      <TripExpenseSheet
        open={sheetOpen}
        tripName={trip.trip.name}
        travellers={trip.travellers}
        expense={editing}
        rates={trip.rates}
        defaultTravellerId={me}
        onSave={(draft, id) => (id ? trip.updateExpense(id, draft) : trip.addExpense(draft))}
        onDelete={editing && mine(editing) ? trip.deleteExpense : undefined}
        onClose={() => setSheetOpen(false)}
      />

      <WhoAreYou
        open={askingWho}
        travellers={trip.travellers}
        selected={me}
        onPick={chooseMe}
        onAdd={async (name) => {
          const person = await trip.addTraveller(name)
          chooseMe(person.id)
          toast(`Added ${person.name} to the trip`)
        }}
        onClose={() => setAskingWho(false)}
      />
    </div>
  )
}

/**
 * Which of the people on the trip this device belongs to.
 *
 * Asked rather than assumed, because the whole point of a shared trip is which
 * person paid. The answer stays on the device; it is a convenience, not a
 * login, and picking someone else's name grants nothing the link didn't.
 */
function WhoAreYou({ open, travellers, selected, onPick, onAdd, onClose }: {
  open: boolean
  travellers: Array<{ id: string; name: string }>
  selected: string | null
  onPick: (id: string) => void
  onAdd: (name: string) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) { setName(''); setError(null); setBusy(false) }
  }, [open])

  async function add() {
    const trimmed = name.trim()
    if (!trimmed) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(trimmed)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add you to the trip.')
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title="Who are you?" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          Expenses you add will be recorded as paid by this person. Only this device remembers the
          answer, and you can change it whenever you like.
        </p>

        <div className="space-y-1.5">
          {travellers.map((t, i) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onPick(t.id)}
              className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm
                          transition-colors ${
                            selected === t.id ? 'border-accent bg-raised font-medium' : 'border-line hover:bg-raised'
                          }`}
            >
              <TravellerBadge name={t.name} color={slotColor(i + 1)} size={28} />
              {t.name}
            </button>
          ))}
        </div>

        <div className="border-t border-line pt-4">
          <span className="mb-1.5 block text-xs font-medium text-ink-2">Not on the list?</span>
          <div className="flex items-center gap-2">
            <input
              value={name}
              maxLength={40}
              placeholder="Your name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void add() }}
              aria-label="Your name"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <Button busy={busy} disabled={!name.trim()} onClick={() => void add()}>Join</Button>
          </div>
          {error && <p className="mt-2 text-sm text-danger">{error}</p>}
        </div>
      </div>
    </Sheet>
  )
}

function Closed({ title, body }: { title: string; body: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <Card className="w-full max-w-sm p-7 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-raised text-ink-3">
          <Link2Off size={22} />
        </span>
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{body}</p>
      </Card>
    </main>
  )
}
