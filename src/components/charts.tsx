import { useState } from 'react'
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { money, moneyShort, monthLabel } from '../lib/format'
import type { Currency } from '../types'

export interface Slice {
  key: string
  name: string
  value: number
  color: string
}

const AXIS_TICK = { fill: 'var(--c-ink-3)', fontSize: 11 }

function TooltipBox({ label, value, currency, color, share }: {
  label: string
  value: number
  currency: Currency
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
        {money(value, currency)}
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
export function CategoryDonut({ slices, total, currency }: {
  slices: Slice[]
  total: number
  currency: Currency
}) {
  const [active, setActive] = useState<number | null>(null)

  // Label only what there is room for: every slice is named in the ranked list
  // underneath, so labels stay selective rather than exhaustive.
  const labelled = (index: number) =>
    total > 0 && slices[index] !== undefined && slices[index].value / total >= LABEL_THRESHOLD

  return (
    <div className="relative h-72">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={slices}
            dataKey="value"
            nameKey="name"
            innerRadius="37%"
            outerRadius="55%"
            /* A 2px surface-coloured gap keeps neighbouring hues from touching. */
            paddingAngle={1.5}
            stroke="var(--c-surface)"
            strokeWidth={2}
            isAnimationActive={false}
            onMouseEnter={(_, i) => setActive(i)}
            onMouseLeave={() => setActive(null)}
            label={(props: SliceLabelProps) => renderLabel(props, slices, total, labelled)}
            labelLine={false}
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
              return (
                <TooltipBox
                  label={s.name}
                  value={s.value}
                  currency={currency}
                  color={s.color}
                  share={total ? (s.value / total) * 100 : 0}
                />
              )
            }}
          />
        </PieChart>
      </ResponsiveContainer>

      {/* Hero number lives in the hole: the donut answers "how is it split", this
          answers "how much". */}
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs text-ink-3">{active === null ? 'Total' : slices[active].name}</span>
        <span className="tnum text-2xl font-semibold text-ink">
          {money(active === null ? total : slices[active].value, currency, { decimals: false })}
        </span>
      </div>
    </div>
  )
}

/* 8% is ~29° of arc. Labels collide only between narrow neighbours — two thin
   slices point at nearly the same spot — so the threshold is really a minimum
   angular width, and anything below it is read from the ranked list instead. */
const LABEL_THRESHOLD = 0.08
const RAD = Math.PI / 180
const MAX_LABEL_CHARS = 11
/* Consecutive labels sit at alternating distances: adjacent thin slices point
   at nearly the same spot, and one ring of text would overlap itself. */
const LABEL_OFFSETS = [12, 38]

// Recharts hands these in as possibly-undefined and sometimes as strings.
interface SliceLabelProps {
  cx?: number | string
  cy?: number | string
  midAngle?: number
  outerRadius?: number | string
  index?: number
}

function renderLabel(
  props: SliceLabelProps,
  slices: Slice[],
  total: number,
  labelled: (i: number) => boolean,
) {
  const index = props.index ?? -1
  if (!labelled(index)) return <g key={index} />

  const slice = slices[index]
  const cx = Number(props.cx)
  const cy = Number(props.cy)
  const outerRadius = Number(props.outerRadius)
  const midAngle = props.midAngle ?? 0
  const cos = Math.cos(-midAngle * RAD)
  const sin = Math.sin(-midAngle * RAD)

  // Rank among labelled slices decides which ring this one sits on.
  let rank = 0
  for (let i = 0; i < index; i++) if (labelled(i)) rank++
  const offset = LABEL_OFFSETS[rank % LABEL_OFFSETS.length]

  const elbowX = cx + (outerRadius + offset) * cos
  const elbowY = cy + (outerRadius + offset) * sin
  const right = elbowX >= cx
  const textX = elbowX + (right ? 7 : -7)
  const name =
    slice.name.length > MAX_LABEL_CHARS ? `${slice.name.slice(0, MAX_LABEL_CHARS - 1)}…` : slice.name

  // Text wears ink tokens, never the series colour — the leader carries identity.
  return (
    <g key={slice.key}>
      <polyline
        points={`${cx + (outerRadius + 3) * cos},${cy + (outerRadius + 3) * sin} ${elbowX},${elbowY} ${textX},${elbowY}`}
        stroke={slice.color}
        strokeWidth={1.5}
        fill="none"
      />
      <text
        x={textX}
        y={elbowY - 3}
        textAnchor={right ? 'start' : 'end'}
        fill="var(--c-ink)"
        fontSize={11}
        fontWeight={600}
      >
        {name}
      </text>
      <text
        x={textX}
        y={elbowY + 10}
        textAnchor={right ? 'start' : 'end'}
        fill="var(--c-ink-3)"
        fontSize={11}
        className="tnum"
      >
        {Math.round((slice.value / total) * 100)}%
      </text>
    </g>
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
