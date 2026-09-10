import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, Inbox, Search, X } from 'lucide-react'
import { useStore } from '../store'
import { groupByDay, total } from '../lib/analytics'
import { applyFilter, rangeLabel, type DateRange, type ExpenseFilter } from '../lib/filters'
import { addMonths, dayLabel, money, monthKey, monthLabel, today } from '../lib/format'
import { iconFor, slotColor, UNCATEGORISED_COLOR } from '../lib/icons'
import type { Expense } from '../types'
import { Card, EmptyState, inputClass } from './ui'

type Preset = 'last7' | 'last30' | 'month' | 'custom' | 'all'

const PRESETS: Array<{ id: Preset; label: string }> = [
  { id: 'last7', label: '7 days' },
  { id: 'last30', label: '30 days' },
  { id: 'month', label: 'Month' },
  { id: 'custom', label: 'Range' },
  { id: 'all', label: 'All time' },
]

function presetOf(range: DateRange): Preset {
  if (range.kind === 'all') return 'all'
  if (range.kind === 'month') return 'month'
  if (range.kind === 'custom') return 'custom'
  return range.days === 7 ? 'last7' : 'last30'
}

function rangeFor(preset: Preset, current: DateRange): DateRange {
  switch (preset) {
    case 'last7': return { kind: 'last', days: 7 }
    case 'last30': return { kind: 'last', days: 30 }
    case 'all': return { kind: 'all' }
    case 'month':
      return { kind: 'month', month: current.kind === 'month' ? current.month : monthKey(today()) }
    case 'custom':
      return current.kind === 'custom'
        ? current
        : { kind: 'custom', from: monthKey(today()) + '-01', to: today() }
  }
}

export function Expenses({ filter, onFilterChange, onEdit, onAdd }: {
  filter: ExpenseFilter
  onFilterChange: (f: ExpenseFilter) => void
  onEdit: (e: Expense) => void
  onAdd: () => void
}) {
  const { expenses, categories, convert, displayCurrency } = useStore()

  const catIndex = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories])
  const catNames = useMemo(
    () => new Map(categories.map((c) => [c.id, c.name])),
    [categories],
  )

  const filtered = useMemo(
    () => applyFilter(expenses, filter, catNames),
    [expenses, filter, catNames],
  )
  const days = useMemo(() => groupByDay(filtered, convert), [filtered, convert])
  const filteredTotal = useMemo(() => total(filtered, convert), [filtered, convert])

  const preset = presetOf(filter.range)
  const set = (patch: Partial<ExpenseFilter>) => onFilterChange({ ...filter, ...patch })

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={filter.query}
              onChange={(e) => set({ query: e.target.value })}
              placeholder="Search notes"
              aria-label="Search expenses"
              className={`${inputClass} w-full pl-9`}
            />
          </div>
          <select
            value={filter.category}
            onChange={(e) => set({ category: e.target.value })}
            aria-label="Filter by category"
            className={`${inputClass} w-36 shrink-0`}
          >
            <option value="all">All categories</option>
            <option value="none">Uncategorised</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        {/* Presets scroll rather than wrap, so the row height never jumps. */}
        <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => set({ range: rangeFor(p.id, filter.range) })}
              aria-pressed={preset === p.id}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                preset === p.id
                  ? 'border-transparent bg-accent text-accent-in'
                  : 'border-line text-ink-2 hover:bg-raised'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* A stepper rather than <input type="month">: the native control renders
            in the OS locale, which reads oddly inside an English interface. */}
        {filter.range.kind === 'month' && (
          <div className="flex items-center justify-between rounded-xl border border-line bg-raised px-2 py-1.5">
            <button
              type="button"
              onClick={() =>
                filter.range.kind === 'month' &&
                set({ range: { kind: 'month', month: addMonths(filter.range.month, -1) } })
              }
              aria-label="Previous month"
              className="rounded-lg p-1.5 text-ink-3 hover:bg-surface hover:text-ink"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium">{monthLabel(filter.range.month, { long: true })}</span>
            <button
              type="button"
              onClick={() =>
                filter.range.kind === 'month' &&
                set({ range: { kind: 'month', month: addMonths(filter.range.month, 1) } })
              }
              disabled={filter.range.month >= monthKey(today())}
              aria-label="Next month"
              className="rounded-lg p-1.5 text-ink-3 hover:bg-surface hover:text-ink
                         disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {filter.range.kind === 'custom' && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={filter.range.from}
              max={filter.range.to || today()}
              onChange={(e) =>
                filter.range.kind === 'custom' && set({ range: { ...filter.range, from: e.target.value } })
              }
              aria-label="From"
              className={`${inputClass} min-w-0 flex-1`}
            />
            <span className="text-xs text-ink-3">to</span>
            <input
              type="date"
              value={filter.range.to}
              min={filter.range.from}
              max={today()}
              onChange={(e) =>
                filter.range.kind === 'custom' && set({ range: { ...filter.range, to: e.target.value } })
              }
              aria-label="To"
              className={`${inputClass} min-w-0 flex-1`}
            />
          </div>
        )}

        <div className="flex items-baseline justify-between gap-3 px-1">
          <span className="truncate text-xs text-ink-3">
            {rangeLabel(filter.range)}
            {filter.category !== 'all' && (
              <>
                {' · '}
                {filter.category === 'none' ? 'Uncategorised' : catNames.get(filter.category) ?? '—'}
                <button
                  type="button"
                  onClick={() => set({ category: 'all' })}
                  aria-label="Clear category filter"
                  className="ml-1 inline-flex translate-y-0.5 text-ink-3 hover:text-ink"
                >
                  <X size={12} />
                </button>
              </>
            )}
          </span>
          <span className="tnum shrink-0 text-xs font-medium text-ink-2">
            {filtered.length} · {money(filteredTotal, displayCurrency)}
          </span>
        </div>
      </div>

      {days.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Inbox size={32} />}
            title={expenses.length === 0 ? 'No expenses yet' : 'Nothing in this range'}
            body={
              expenses.length === 0
                ? 'Log your first expense in any of EUR, USD or UAH — totals convert to euro automatically.'
                : 'Widen the dates, clear the category, or try a different search term.'
            }
            action={
              expenses.length === 0 ? (
                <button type="button" onClick={onAdd} className="text-sm font-medium text-accent hover:underline">
                  Add an expense
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => onFilterChange({ category: 'all', range: { kind: 'all' }, query: '' })}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  Clear all filters
                </button>
              )
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
                    {/* The reporting currency leads; what was actually paid sits
                        underneath, so a list of mixed currencies still adds up
                        visually to the day total above it. */}
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
          </section>
        ))
      )}
    </div>
  )
}
