import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react'
import { useStore } from '../store'
import { byCategory, expensesInMonth, monthlyTrend, toSlices, total } from '../lib/analytics'
import { addMonths, money, monthKey, monthLabel, symbolOf, today } from '../lib/format'
import { CURRENCIES } from '../types'
import { CategoryDonut, MonthlyTrend } from './charts'
import { Card, EmptyState, SectionTitle, Segmented } from './ui'

const TREND_MONTHS = 12

export function Overview({ onAdd, onOpenCategory }: {
  onAdd: () => void
  onOpenCategory: (categoryKey: string, month: string) => void
}) {
  const { expenses, categories, latestRates, convert, displayCurrency, setDisplayCurrency } = useStore()
  const currentMonth = monthKey(today())
  const [month, setMonth] = useState(currentMonth)

  const monthExpenses = useMemo(() => expensesInMonth(expenses, month), [expenses, month])
  const prevExpenses = useMemo(() => expensesInMonth(expenses, addMonths(month, -1)), [expenses, month])

  const monthTotal = useMemo(() => total(monthExpenses, convert), [monthExpenses, convert])
  const prevTotal = useMemo(() => total(prevExpenses, convert), [prevExpenses, convert])
  const totals = useMemo(() => byCategory(monthExpenses, categories, convert), [monthExpenses, categories, convert])
  const slices = useMemo(() => toSlices(totals), [totals])
  const trend = useMemo(
    () => monthlyTrend(expenses, currentMonth, TREND_MONTHS, convert),
    [expenses, currentMonth, convert],
  )

  const daysElapsed = month === currentMonth ? new Date().getDate() : daysInMonth(month)
  const perDay = daysElapsed > 0 ? monthTotal / daysElapsed : 0
  const delta = prevTotal > 0 ? ((monthTotal - prevTotal) / prevTotal) * 100 : null

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setMonth(addMonths(month, -1))}
            aria-label="Previous month"
            className="rounded-lg p-1.5 text-ink-3 hover:bg-raised hover:text-ink"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="text-sm font-medium text-ink-2">{monthLabel(month, { long: true })}</span>
          <button
            type="button"
            onClick={() => setMonth(addMonths(month, 1))}
            disabled={month >= currentMonth}
            aria-label="Next month"
            className="rounded-lg p-1.5 text-ink-3 hover:bg-raised hover:text-ink disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="mt-4 text-center">
          <div className="tnum text-4xl font-semibold tracking-tight">
            {money(monthTotal, displayCurrency)}
          </div>
          <p className="mt-1.5 text-sm text-ink-3">
            {delta === null ? (
              'No spend recorded last month'
            ) : (
              <>
                <span className={delta > 0 ? 'text-danger' : 'text-good'}>
                  {delta > 0 ? '▲' : '▼'} {Math.abs(delta).toFixed(0)}%
                </span>{' '}
                vs {monthLabel(addMonths(month, -1), { long: true })}
              </>
            )}
          </p>
        </div>

        {/* Everything is stored in euro; this only changes how it reads. Each
            expense converts at the rate from the day it was spent. */}
        <div className="mt-4 flex justify-center">
          <Segmented
            ariaLabel="Display currency"
            value={displayCurrency}
            onChange={setDisplayCurrency}
            options={CURRENCIES.map((c) => ({
              value: c,
              label: (
                <span className="flex items-center gap-1.5">
                  <span className="text-base leading-none">{symbolOf(c)}</span>
                  <span className="text-xs">{c}</span>
                </span>
              ),
            }))}
          />
        </div>

        <dl className="mt-5 grid grid-cols-3 divide-x divide-line border-t border-line pt-4 text-center">
          <Stat label="Per day" value={money(perDay, displayCurrency, { decimals: false })} />
          <Stat label="Expenses" value={String(monthExpenses.length)} />
          <Stat label="Categories" value={String(totals.length)} />
        </dl>
      </Card>

      <section>
        <SectionTitle>Where it went</SectionTitle>
        <Card className="p-5">
          {monthTotal === 0 ? (
            <EmptyState
              icon={<Inbox size={32} />}
              title="Nothing logged yet"
              body={`No expenses recorded for ${monthLabel(month, { long: true })}.`}
              action={
                <button type="button" onClick={onAdd} className="text-sm font-medium text-accent hover:underline">
                  Add the first one
                </button>
              }
            />
          ) : (
            <div className="lg:flex lg:items-center lg:gap-6">
              <div className="lg:w-1/2 lg:shrink-0">
                <CategoryDonut slices={slices} total={monthTotal} currency={displayCurrency} />
              </div>
              {/* Doubles as the legend and the table view: every slice is named
                  and valued in ink, so identity never rests on colour alone. */}
              <ul className="mt-5 space-y-1 lg:mt-0 lg:flex-1">
                {totals.map((t) => (
                  <li key={t.key}>
                    <button
                      type="button"
                      onClick={() => onOpenCategory(t.key, month)}
                      className="flex w-full items-center gap-3 rounded-lg px-1 py-1.5 text-left
                                 transition-colors hover:bg-raised"
                    >
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: t.color }} />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">{t.name}</span>
                      <span className="tnum text-xs text-ink-3">{((t.value / monthTotal) * 100).toFixed(0)}%</span>
                      <span className="tnum w-24 text-right text-sm font-medium text-ink">
                        {money(t.value, displayCurrency)}
                      </span>
                      <ChevronRight size={14} className="shrink-0 text-ink-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </section>

      <section>
        <SectionTitle>Monthly spend, last {TREND_MONTHS} months</SectionTitle>
        <Card className="p-4 pt-5">
          <MonthlyTrend points={trend} highlight={month} currency={displayCurrency} />
        </Card>
      </section>

      {latestRates && (
        <p className="tnum px-1 pb-2 text-center text-xs text-ink-3">
          Rates on {latestRates.day}: 1 € = {latestRates.usd.toFixed(4)} $ = {latestRates.uah.toFixed(2)} ₴
        </p>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="tnum mt-0.5 text-base font-semibold">{value}</dd>
    </div>
  )
}

function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m, 0).getDate()
}
