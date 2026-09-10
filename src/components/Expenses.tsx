import { useMemo, useState } from 'react'
import { Inbox, Search } from 'lucide-react'
import { useStore } from '../store'
import { groupByDay } from '../lib/analytics'
import { dayLabel, money } from '../lib/format'
import { iconFor, slotColor } from '../lib/icons'
import { UNCATEGORISED_COLOR } from '../lib/icons'
import type { Expense } from '../types'
import { Card, EmptyState, inputClass } from './ui'

export function Expenses({ onEdit, onAdd }: { onEdit: (e: Expense) => void; onAdd: () => void }) {
  const { expenses, categories, convert, displayCurrency } = useStore()
  const [query, setQuery] = useState('')
  const [categoryId, setCategoryId] = useState<string>('all')

  const catIndex = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return expenses.filter((e) => {
      if (categoryId !== 'all' && e.category_id !== categoryId) return false
      if (!q) return true
      const name = e.category_id ? (catIndex.get(e.category_id)?.name ?? '') : 'uncategorised'
      return `${e.note ?? ''} ${name}`.toLowerCase().includes(q)
    })
  }, [expenses, query, categoryId, catIndex])

  const days = useMemo(() => groupByDay(filtered, convert), [filtered, convert])

  return (
    <div className="space-y-4">
      {/* Filters sit in one row above the list. */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search notes"
            aria-label="Search expenses"
            className={`${inputClass} w-full pl-9`}
          />
        </div>
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          aria-label="Filter by category"
          className={`${inputClass} w-36 shrink-0`}
        >
          <option value="all">All</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {days.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox size={32} />}
            title={expenses.length === 0 ? 'No expenses yet' : 'Nothing matches'}
            body={
              expenses.length === 0
                ? 'Log your first expense in any of EUR, USD or UAH — totals convert to euro automatically.'
                : 'Try a different search term or category filter.'
            }
            action={
              expenses.length === 0 ? (
                <button type="button" onClick={onAdd} className="text-sm font-medium text-accent hover:underline">
                  Add an expense
                </button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        days.map((group) => (
          <section key={group.day}>
            <div className="mb-1.5 flex items-baseline justify-between px-1">
              <h3 className="text-xs font-semibold tracking-wide text-ink-2 uppercase">{dayLabel(group.day)}</h3>
              <span className="tnum text-xs text-ink-3">{money(group.total, displayCurrency)}</span>
            </div>
            <Card className="divide-y divide-line overflow-hidden">
              {group.items.map((e) => {
                const cat = e.category_id ? catIndex.get(e.category_id) : undefined
                const Icon = iconFor(cat?.icon)
                const color = cat ? slotColor(cat.color_slot) : UNCATEGORISED_COLOR
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => onEdit(e)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-raised"
                  >
                    <span
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                      style={{ background: `color-mix(in oklab, ${color} 16%, transparent)` }}
                    >
                      <Icon size={17} style={{ color }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{cat?.name ?? 'Uncategorised'}</span>
                      {e.note && <span className="block truncate text-xs text-ink-3">{e.note}</span>}
                    </span>
                    <span className="text-right">
                      <span className="tnum block text-sm font-semibold">
                        {money(e.amount, e.currency)}
                      </span>
                      {e.currency !== displayCurrency && (
                        <span className="tnum block text-xs text-ink-3">
                          {money(convert(e), displayCurrency)}
                        </span>
                      )}
                    </span>
                  </button>
                )
              })}
            </Card>
          </section>
        ))
      )}
    </div>
  )
}
