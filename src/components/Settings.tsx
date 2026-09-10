import { useState } from 'react'
import { LogOut, Monitor, Moon, Sun } from 'lucide-react'
import { useStore } from '../store'
import { useTheme, type ThemeChoice } from '../lib/theme'
import { totalEur } from '../lib/analytics'
import { money } from '../lib/format'
import { BASE_CURRENCY } from '../types'
import { Button, Card, SectionTitle, Segmented } from './ui'

export function Settings() {
  const { session, signOut, expenses, categories, latestRates } = useStore()
  const [theme, setTheme] = useTheme()
  const [busy, setBusy] = useState(false)

  return (
    <div className="space-y-5">
      <section>
        <SectionTitle>Account</SectionTitle>
        <Card className="divide-y divide-line">
          <Row label="Signed in as" value={session?.user.email ?? '—'} />
          <Row label="Reporting currency" value={BASE_CURRENCY} />
          <div className="p-4">
            <Button
              variant="subtle"
              busy={busy}
              onClick={() => { setBusy(true); void signOut() }}
              className="w-full"
            >
              <LogOut size={16} /> Sign out
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>Appearance</SectionTitle>
        <Card className="flex items-center justify-between p-4">
          <span className="text-sm text-ink-2">Theme</span>
          <Segmented<ThemeChoice>
            ariaLabel="Theme"
            value={theme}
            onChange={setTheme}
            options={[
              { value: 'system', label: <Monitor size={15} /> },
              { value: 'light', label: <Sun size={15} /> },
              { value: 'dark', label: <Moon size={15} /> },
            ]}
          />
        </Card>
      </section>

      <section>
        <SectionTitle>Exchange rates</SectionTitle>
        <Card className="divide-y divide-line">
          <Row label="Source" value="National Bank of Ukraine, official daily rate" />
          <Row
            label={latestRates ? `Rate on ${latestRates.day}` : 'Latest rate'}
            value={
              latestRates
                ? `1 € = ${latestRates.usd.toFixed(4)} $ = ${latestRates.uah.toFixed(2)} ₴`
                : 'Not fetched yet'
            }
          />
        </Card>
        <p className="mt-2 px-1 text-xs leading-relaxed text-ink-3">
          Every total and chart is reported in euro. Each expense stores the rate from the day it
          happened, so past totals never shift when rates move later.
        </p>
      </section>

      <section>
        <SectionTitle>Your data</SectionTitle>
        <Card className="divide-y divide-line">
          <Row label="Expenses recorded" value={String(expenses.length)} />
          <Row label="Categories" value={String(categories.length)} />
          <Row label="Total tracked" value={money(totalEur(expenses), BASE_CURRENCY)} />
        </Card>
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 p-4">
      <span className="shrink-0 text-sm text-ink-2">{label}</span>
      <span className="text-right text-sm font-medium break-words">{value}</span>
    </div>
  )
}
