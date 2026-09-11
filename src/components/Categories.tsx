import { useEffect, useMemo, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { ICON_KEYS, assignColorSlot, iconFor, slotColor } from '../lib/icons'
import { toast } from '../lib/toast'
import type { Category } from '../types'
import { Button, Card, Field, Sheet, inputClass } from './ui'

export function Categories() {
  const { categories } = useStore()
  const [editing, setEditing] = useState<Category | null>(null)
  const [creating, setCreating] = useState(false)

  // Shown in the sheet before the category exists, so the colour it is about to
  // be given is visible while naming it rather than a surprise afterwards.
  const nextSlot = useMemo(
    () => assignColorSlot(categories.map((c) => c.color_slot)),
    [categories],
  )

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
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {c.name}
                {c.is_archived && <span className="ml-2 text-xs font-normal text-ink-3">archived</span>}
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
        nextSlot={nextSlot}
        onClose={() => { setCreating(false); setEditing(null) }}
      />
    </div>
  )
}

function CategorySheet({ open, category, nextSlot, onClose }: {
  open: boolean
  category: Category | null
  nextSlot: number
  onClose: () => void
}) {
  const { addCategory, updateCategory, deleteCategory } = useStore()
  const [name, setName] = useState('')
  const [icon, setIcon] = useState('tag')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!open) return
    setName(category?.name ?? '')
    setIcon(category?.icon ?? 'tag')
    setBusy(false)
    setError(null)
    setConfirmDelete(false)
  }, [open, category])

  const trimmed = name.trim()

  async function run(fn: () => Promise<void>, done: string) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      toast(done)
      onClose()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong.'
      setError(message.includes('duplicate') ? 'You already have a category with that name.' : message)
      setBusy(false)
    }
  }

  const Preview = iconFor(icon)
  const color = slotColor(category?.color_slot ?? nextSlot)

  return (
    <Sheet open={open} title={category ? 'Edit category' : 'New category'} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
            style={{ background: `color-mix(in oklab, ${color} 16%, transparent)` }}
          >
            <Preview size={22} style={{ color }} />
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
                  <Icon size={17} style={icon === key ? { color } : undefined} />
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
                  ? updateCategory(category.id, { name: trimmed, icon })
                  : addCategory({ name: trimmed, icon }),
                category ? 'Category updated' : 'Category created',
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
                onClick={() =>
                  run(
                    () => updateCategory(category.id, { is_archived: !category.is_archived }),
                    category.is_archived ? 'Category restored' : 'Category archived',
                  )
                }
              >
                {category.is_archived ? 'Unarchive' : 'Archive'}
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() =>
                  confirmDelete ? run(() => deleteCategory(category.id), 'Category deleted') : setConfirmDelete(true)
                }
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
