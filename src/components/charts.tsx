import {
  Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { money, moneyShort, monthLabel } from '../lib/format'
import type { Currency } from '../types'

const AXIS_TICK = { fill: 'var(--c-ink-3)', fontSize: 11 }

function TooltipBox({ label, value, currency, color }: {
  label: string
  value: number
  currency: Currency
  color?: string
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="flex items-center gap-2">
        {color && <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />}
        <span className="text-ink-2">{label}</span>
      </div>
      <div className="tnum mt-1 text-sm font-semibold text-ink">
        {money(value, currency)}
      </div>
    </div>
  )
}

export interface TrendPoint {
  key: string
  value: number
}

/** One series, so no legend — the section title names it. */
export function MonthlyTrend({ points, highlight, currency }: {
  points: TrendPoint[]
  highlight?: string
  currency: Currency
}) {
  return (
    <div className="h-44">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap="28%">
          <XAxis
            dataKey="key"
            tickFormatter={(k: string) => monthLabel(k)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--c-line)' }}
          />
          <YAxis
            tickFormatter={(v: number) => moneyShort(v, currency)}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={false}
            width={52}
          />
          <Tooltip
            cursor={{ fill: 'var(--c-raised)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as TrendPoint
              return (
                <TooltipBox
                  label={monthLabel(p.key, { long: true })}
                  value={p.value}
                  currency={currency}
                  color="var(--series-1)"
                />
              )
            }}
          />
          <Bar dataKey="value" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {points.map((p) => (
              <Cell
                key={p.key}
                fill="var(--series-1)"
                opacity={highlight && p.key !== highlight ? 0.55 : 1}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
