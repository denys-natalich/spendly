import { useState } from 'react'
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { money, moneyShort, monthLabel } from '../lib/format'
import { BASE_CURRENCY } from '../types'

export interface Slice {
  key: string
  name: string
  value: number
  color: string
}

const AXIS_TICK = { fill: 'var(--c-ink-3)', fontSize: 11 }

function TooltipBox({ label, value, color, share }: {
  label: string
  value: number
  color?: string
  share?: number
}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs shadow-lg">
      <div className="flex items-center gap-2">
        {color && <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} />}
        <span className="text-ink-2">{label}</span>
      </div>
      <div className="tnum mt-1 text-sm font-semibold text-ink">
        {money(value, BASE_CURRENCY)}
        {share !== undefined && <span className="ml-1.5 font-normal text-ink-3">{share.toFixed(0)}%</span>}
      </div>
    </div>
  )
}

/**
 * Part-to-whole at a glance. Capped at six named slices plus "Other" — past
 * that, adjacent hues stop being distinguishable and the ranked list below the
 * chart is what people actually read.
 */
export function CategoryDonut({ slices, total }: { slices: Slice[]; total: number }) {
  const [active, setActive] = useState<number | null>(null)

  return (
    <div className="relative h-56">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="64%"
            outerRadius="94%"
            /* A 2px surface-coloured gap keeps neighbouring hues from touching. */
            paddingAngle={1.5}
            stroke="var(--c-surface)"
            strokeWidth={2}
            isAnimationActive={false}
            onMouseEnter={(_, i) => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            {slices.map((s, i) => (
              <Cell
                key={s.key}
                fill={s.color}
                opacity={active === null || active === i ? 1 : 0.35}
                style={{ transition: 'opacity 120ms' }}
              />
            ))}
          </Pie>
          <Tooltip
            content={({ active: on, payload }) => {
              if (!on || !payload?.length) return null
              const s = payload[0].payload as Slice
              return <TooltipBox label={s.name} value={s.value} color={s.color} share={total ? (s.value / total) * 100 : 0} />
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Hero number lives in the hole: the donut answers "how is it split", this
          answers "how much". */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-ink-3">{active === null ? 'Total' : slices[active].name}</span>
        <span className="tnum text-2xl font-semibold text-ink">
          {money(active === null ? total : slices[active].value, BASE_CURRENCY, { decimals: false })}
        </span>
      </div>
    </div>
  )
}

export interface TrendPoint {
  key: string
  value: number
}

/** One series, so no legend — the section title names it. */
export function MonthlyTrend({ points, highlight }: { points: TrendPoint[]; highlight?: string }) {
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
            tickFormatter={(v: number) => moneyShort(v, BASE_CURRENCY)}
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
              return <TooltipBox label={monthLabel(p.key, { long: true })} value={p.value} color="var(--series-1)" />
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
