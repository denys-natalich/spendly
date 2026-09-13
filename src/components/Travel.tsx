import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, Plane, Plus, Trash2, UserPlus, X } from 'lucide-react'
import { useStore } from '../store'
import { total } from '../lib/analytics'
import { money } from '../lib/format'
import { slotColor } from '../lib/icons'
import { TravellerBadge } from './TravellerBadge'
import { toast } from '../lib/toast'
import type { Traveller, Trip } from '../types'
import { TripDetail } from './TripDetail'
import { Button, Card, EmptyState, Field, Sheet, Spinner, inputClass } from './ui'

/* A stable empty list: passing a fresh `[]` would re-seed the sheet's fields on
   every render, which is the same thing as never letting anything be typed. */
const NO_TRAVELLERS: Traveller[] = []

export function Travel() {
  const { trips, travellers, tripExpenses, travelLoading, travelError, convert, displayCurrency } = useStore()
  const [openId, setOpenId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Trip | null>(null)

  const open = trips.find((t) => t.id === openId) ?? null

  // Totals per trip for the list, in one pass rather than a filter per row.
  const totals = useMemo(() => {
    const sums = new Map<string, number>()
    for (const e of tripExpenses) sums.set(e.trip_id, (sums.get(e.trip_id) ?? 0) + convert(e))
    return sums
  }, [tripExpenses, convert])

  const people = useMemo(() => {
    const byTrip = new Map<string, Traveller[]>()
    for (const p of travellers) {
      const list = byTrip.get(p.trip_id)
      if (list) list.push(p)
      else byTrip.set(p.trip_id, [p])
    }
    return byTrip
  }, [travellers])

  return (
    <>
      {travelError && <Card className="mb-4 border-danger/40 p-4 text-sm text-danger">{travelError}</Card>}

      {open ? (
        <TripDetail
          trip={open}
          travellers={people.get(open.id) ?? NO_TRAVELLERS}
          onBack={() => setOpenId(null)}
          onEditTrip={() => setEditing(open)}
        />
      ) : travelLoading ? (
        <Spinner label="Loading your trips" />
      ) : (
        <div className="space-y-4">
          <Button onClick={() => setCreating(true)} className="w-full">
            <Plus size={16} /> New trip
          </Button>

          {trips.length === 0 ? (
            <Card>
              <EmptyState
                icon={<Plane size={32} />}
                title="No trips yet"
                body="Create a trip, add the people on it, and log what each of them paid for. Travel spending is kept out of your monthly totals."
                action={
                  <button
                    type="button"
                    onClick={() => setCreating(true)}
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    Create a trip
                  </button>
                }
              />
            </Card>
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {trips.map((t) => {
                const names = people.get(t.id) ?? []
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setOpenId(t.id)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ background: 'color-mix(in oklab, var(--series-1) 16%, transparent)' }}
                    >
                      <Plane size={17} style={{ color: 'var(--series-1)' }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{t.name}</span>
                      <span className="block truncate text-xs text-ink-3">
                        {names.length === 0
                          ? 'No travellers yet'
                          : names.map((p) => p.name).join(', ')}
                      </span>
                    </span>
                    <span className="tnum shrink-0 text-sm font-semibold">
                      {money(totals.get(t.id) ?? 0, displayCurrency)}
                    </span>
                    <ChevronRight size={14} className="shrink-0 text-ink-3" />
                  </button>
                )
              })}
            </Card>
          )}

          <p className="px-1 text-xs text-ink-3">
            Trips are tracked on their own. Nothing recorded here reaches your overview, your
            categories or the monthly trend — {money(total(tripExpenses, convert), displayCurrency)}{' '}
            across {trips.length} {trips.length === 1 ? 'trip' : 'trips'} so far.
          </p>
        </div>
      )}

      <TripSheet
        open={creating || editing !== null}
        trip={editing}
        travellers={(editing && people.get(editing.id)) || NO_TRAVELLERS}
        onClose={() => { setCreating(false); setEditing(null) }}
        onCreated={(id) => setOpenId(id)}
        onDeleted={() => setOpenId(null)}
      />
    </>
  )
}

/** One row of the traveller editor: an existing person carries their id. */
interface NameRow {
  id: string | null
  name: string
}

/**
 * Creating and editing a trip use the same sheet, so the people on a trip are
 * edited the same way whether it exists yet or not. On save the rows are
 * diffed against what is stored: named rows without an id are added, missing
 * ids are removed, and a changed name is a rename rather than a delete and a
 * re-add — which would take that person's expenses off them.
 */
function TripSheet({ open, trip, travellers, onClose, onCreated, onDeleted }: {
  open: boolean
  trip: Trip | null
  travellers: Traveller[]
  onClose: () => void
  onCreated: (tripId: string) => void
  onDeleted: () => void
}) {
  const {
    tripExpenses, createTrip, renameTrip, deleteTrip, addTraveller, renameTraveller, removeTraveller,
  } = useStore()
  const [name, setName] = useState('')
  const [rows, setRows] = useState<NameRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(trip?.name ?? '')
    setRows(
      travellers.length > 0
        ? travellers.map((t) => ({ id: t.id, name: t.name }))
        : [{ id: null, name: '' }, { id: null, name: '' }],
    )
    setBusy(false)
    setError(null)
    setConfirmDelete(false)
    // Seeded when the sheet opens, not whenever `travellers` changes identity:
    // re-seeding mid-edit would throw away what is being typed.
  }, [open, trip, travellers])

  const trimmedName = name.trim()
  const named = rows.filter((r) => r.name.trim())
  const valid = trimmedName.length > 0 && named.length > 0

  /** Removing someone who has already paid for something is worth saying out loud. */
  const orphaned = useMemo(() => {
    const kept = new Set(rows.map((r) => r.id).filter(Boolean))
    const dropped = travellers.filter((t) => !kept.has(t.id))
    return dropped.filter((t) => tripExpenses.some((e) => e.traveller_id === t.id))
  }, [rows, travellers, tripExpenses])

  function setRow(index: number, value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, name: value } : r)))
  }

  async function save() {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      if (!trip) {
        const created = await createTrip(trimmedName, named.map((r) => r.name))
        onCreated(created.id)
      } else {
        if (trimmedName !== trip.name) await renameTrip(trip.id, trimmedName)

        const kept = new Map(named.filter((r) => r.id).map((r) => [r.id!, r.name.trim()]))
        for (const person of travellers) {
          const next = kept.get(person.id)
          if (next === undefined) await removeTraveller(person.id)
          else if (next !== person.name) await renameTraveller(person.id, next)
        }
        for (const row of named) {
          if (!row.id) await addTraveller(trip.id, row.name.trim())
        }
      }
      toast(trip ? 'Trip updated' : 'Trip created')
      onClose()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save the trip.'
      setError(message.includes('duplicate') ? 'Two travellers on a trip cannot share a name.' : message)
      setBusy(false)
    }
  }

  async function remove() {
    if (!trip) return
    setBusy(true)
    try {
      await deleteTrip(trip.id)
      toast('Trip deleted')
      onDeleted()
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the trip.')
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={trip ? 'Edit trip' : 'New trip'} onClose={onClose}>
      <div className="space-y-5">
        <Field label="Trip">
          <input
            autoFocus
            value={name}
            maxLength={60}
            placeholder="Lisbon, May"
            onChange={(e) => setName(e.target.value)}
            aria-label="Trip name"
            className={`${inputClass} w-full`}
          />
        </Field>

        <Field label="Travellers" hint="Just names — the people you are travelling with don't need an account.">
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={row.id ?? `new-${i}`} className="flex items-center gap-2">
                <TravellerBadge name={row.name} color={slotColor(i + 1)} size={32} />
                <input
                  value={row.name}
                  maxLength={40}
                  placeholder={`Traveller ${i + 1}`}
                  onChange={(e) => setRow(i, e.target.value)}
                  aria-label={`Traveller ${i + 1}`}
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <button
                  type="button"
                  onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))}
                  disabled={rows.length === 1}
                  aria-label={`Remove ${row.name.trim() || `traveller ${i + 1}`}`}
                  className="rounded-lg p-2 text-ink-3 hover:bg-raised hover:text-ink disabled:opacity-30"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setRows((prev) => [...prev, { id: null, name: '' }])}
              className="flex items-center gap-2 px-1 py-1 text-sm font-medium text-accent hover:underline"
            >
              <UserPlus size={15} /> Add traveller
            </button>
          </div>
        </Field>

        {orphaned.length > 0 && (
          <p className="text-xs text-ink-2">
            {orphaned.map((t) => t.name).join(', ')} already paid for something. Removing them keeps
            those expenses in the trip, marked as unassigned.
          </p>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="space-y-2">
          <Button className="w-full" busy={busy} disabled={!valid} onClick={save}>
            {trip ? 'Save changes' : 'Create trip'}
          </Button>
          {trip && (
            <Button
              variant="danger"
              className="w-full"
              onClick={() => (confirmDelete ? void remove() : setConfirmDelete(true))}
            >
              <Trash2 size={16} />
              {confirmDelete ? 'Tap again — this deletes its expenses' : 'Delete trip'}
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}
