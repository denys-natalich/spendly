import { useEffect, useMemo, useState } from 'react'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { COLOR_SLOTS, ICON_KEYS, iconFor, slotColor } from '../lib/icons'
import { money } from '../lib/format'
import { total } from '../lib/analytics'
import type { Category } from '../types'
import { Button, Card, Field, Sheet, inputClass } from './ui'

export function Categories() {
  const { categories, expenses, convert, displayCurrency } = useStore()
  const [editing, setEditing] = useState<Category | null>(null)
  const [creating, setCreating] = useState(false)

  const spendByCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of categories) {
      map.set(c.id, total(expenses.filter((e) => e.category_id === c.id), convert))
    }
    return map
  }, [categories, expenses, convert])

  // Default new categories to the least-used hue so the donut stays readable.
  const suggestedSlot = useMemo(() => {
    const used = new Map<number, number>(COLOR_SLOTS.map((s) => [s, 0]))
    for (const c of categories) used.set(c.color_slot, (used.get(c.color_slot) ?? 0) + 1)
    return [...used.entries()].sort((a, b) => a[1] - b[1])[0][0]
  }, [categories])

  return (
    <div className="space-y-4">
      <Button onClick={() => setCreating(true)} className="w-full">
        <Plus size={16} /> New category
      </Button>

      <Card className="divide-y divide-line overflow-hidden">
        {categories.map((c) => {
          const Icon = iconFor(c.icon)
          const color = slotColor(c.color_slot)
          return (
            <div key={c.id} className="flex items-center gap-3 px-4 py-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                style={{ background: `color-mix(in oklab, ${color} 16%, transparent)` }}
              >
                <Icon size={17} style={{ color }} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {c.name}
                  {c.is_archived && <span className="ml-2 text-xs font-normal text-ink-3">archived</span>}
                </span>
                <span className="tnum block text-xs text-ink-3">
                  {money(spendByCategory.get(c.id) ?? 0, displayCurrency)} all time
                </span>
              </span>
              <button
                type="button"
                onClick={() => setEditing(c)}
                aria-label={`Edit ${c.name}`}
                className="rounded-lg p-2 text-ink-3 hover:bg-raised hover:text-ink"
              >
                <Pencil size={16} />
              </button>
            </div>
          )
        })}
      </Card>

      <p className="px-1 text-xs text-ink-3">
        Archiving keeps a category out of the entry form while leaving its history in your charts.
        Deleting it makes its expenses uncategorised — the amounts are never lost.
      </p>

      <CategorySheet
        open={creating || editing !== null}
        category={editing}
        suggestedSlot={suggestedSlot}
        onClose={() => { setCreating(false); setEditing(null) }}
      />
    </div>
  )
}

function CategorySheet({ open, category, suggestedSlot, onClose }: {
  open: boolean
  category: Category | null
  suggestedSlot: number
  onClose: () => void
}) {
  const { addCategory, updateCategory, deleteCategory } = useStore()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('tag')
  const [slot, setSlot] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(category?.name ?? '')
    setIcon(category?.icon ?? 'tag')
    setSlot(category?.color_slot ?? suggestedSlot)
    setBusy(false)
    setError(null)
    setConfirmDelete(false)
  }, [open, category, suggestedSlot])

  const trimmed = name.trim()

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onClose()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong.'
      setError(message.includes('duplicate') ? 'You already have a category with that name.' : message)
      setBusy(false)
    }
  }

  const Preview = iconFor(icon)

  return (
    <Sheet open={open} title={category ? 'Edit category' : 'New category'} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
            style={{ background: `color-mix(in oklab, ${slotColor(slot)} 16%, transparent)` }}
          >
            <Preview size={22} style={{ color: slotColor(slot) }} />
          </span>
          <input
            autoFocus
            value={name}
            maxLength={40}
            placeholder="Category name"
            onChange={(e) => setName(e.target.value)}
            aria-label="Category name"
            className={`${inputClass} w-full`}
          />
        </div>

        <Field label="Colour">
          <div className="flex flex-wrap gap-2">
            {COLOR_SLOTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSlot(s)}
                aria-label={`Colour ${s}`}
                aria-pressed={slot === s}
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ background: slotColor(s) }}
              >
                {slot === s && <Check size={16} color="#fff" strokeWidth={3} />}
              </button>
            ))}
          </div>
        </Field>

        <Field label="Icon">
          <div className="grid max-h-44 grid-cols-8 gap-1 overflow-y-auto rounded-xl border border-line p-2">
            {ICON_KEYS.map((key) => {
              const Icon = iconFor(key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setIcon(key)}
                  aria-label={key}
                  aria-pressed={icon === key}
                  className={`flex aspect-square items-center justify-center rounded-lg ${
                    icon === key ? 'bg-raised text-ink' : 'text-ink-3 hover:bg-raised'
                  }`}
                >
                  <Icon size={17} style={icon === key ? { color: slotColor(slot) } : undefined} />
                </button>
              )
            })}
          </div>
        </Field>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="space-y-2">
          <Button
            className="w-full"
            busy={busy}
            disabled={!trimmed}
            onClick={() =>
              run(() =>
                category
                  ? updateCategory(category.id, { name: trimmed, icon, color_slot: slot })
                  : addCategory({ name: trimmed, icon, color_slot: slot }),
              )
            }
          >
            {category ? 'Save changes' : 'Create category'}
          </Button>

          {category && (
            <div className="flex gap-2">
              <Button
                variant="subtle"
                className="flex-1"
                onClick={() => run(() => updateCategory(category.id, { is_archived: !category.is_archived }))}
              >
                {category.is_archived ? 'Unarchive' : 'Archive'}
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => (confirmDelete ? run(() => deleteCategory(category.id)) : setConfirmDelete(true))}
              >
                <Trash2 size={16} />
                {confirmDelete ? 'Tap again to confirm' : 'Delete'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  )
}
