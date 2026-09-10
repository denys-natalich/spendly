import { useRef, useState } from 'react'
import { CircleAlert, FileUp } from 'lucide-react'
import { useStore, type ImportProgress, type ImportResult } from '../store'
import { parseMonefy, summarise, type ImportSummary, type MonefyRow } from '../lib/monefy'
import { monthLabel } from '../lib/format'
import { Button, Card, SectionTitle } from './ui'

const PHASE_LABEL: Record<ImportProgress['phase'], string> = {
  rates: 'Fetching historical exchange rates…',
  categories: 'Creating categories…',
  expenses: 'Importing expenses',
}

export function ImportSettings() {
  const { importExpenses } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<MonefyRow[] | null>(null)
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [skipped, setSkipped] = useState<ReturnType<typeof parseMonefy>['skipped'] | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(file: File) {
    setError(null)
    setResult(null)
    try {
      const parsed = parseMonefy(await file.text())
      if (parsed.rows.length === 0) {
        setError("No expenses found in that file. Is it a Monefy CSV export?")
        return
      }
      setRows(parsed.rows)
      setSummary(summarise(parsed.rows))
      setSkipped(parsed.skipped)
    } catch {
      setError('Could not read that file.')
    }
  }

  async function run() {
    if (!rows) return
    setError(null)
    setProgress({ phase: 'rates', done: 0, total: 1 })
    try {
      const res = await importExpenses(rows, setProgress)
      setResult(res)
      reset()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The import failed partway through.')
    } finally {
      setProgress(null)
    }
  }

  function reset() {
    setRows(null)
    setSummary(null)
    setSkipped(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <section>
      <SectionTitle>Import</SectionTitle>
      <Card className="p-4">
        {progress ? (
          <div className="space-y-3 py-2">
            <p className="text-sm text-ink-2">{PHASE_LABEL[progress.phase]}</p>
            {progress.phase === 'expenses' && (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-raised">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
                  />
                </div>
                <p className="tnum text-xs text-ink-3">
                  {progress.done.toLocaleString('en-GB')} of {progress.total.toLocaleString('en-GB')}
                </p>
              </>
            )}
            <p className="text-xs text-ink-3">Keep this tab open until it finishes.</p>
          </div>
        ) : summary && rows ? (
          <div className="space-y-4">
            <div>
              <p className="text-sm">
                <span className="font-semibold">{summary.total.toLocaleString('en-GB')} expenses</span>
                {' '}from {monthLabel(summary.firstDay.slice(0, 7), { long: true })} to{' '}
                {monthLabel(summary.lastDay.slice(0, 7), { long: true })}
              </p>
              <p className="mt-0.5 text-xs text-ink-3">
                {summary.currencies.join(', ')} — converted to euro at each day's official rate.
              </p>
            </div>

            <ul className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line p-2">
              {summary.byCategory.map((c) => (
                <li key={c.name} className="flex items-center gap-2 px-1 py-1 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {c.name}
                    {c.target !== c.name && <span className="text-ink-3"> → {c.target}</span>}
                  </span>
                  <span className="tnum shrink-0 text-xs text-ink-3">{c.count}</span>
                </li>
              ))}
            </ul>

            {skipped && (skipped.income > 0 || skipped.malformed > 0 || skipped.unsupportedCurrency.length > 0) && (
              <p className="flex items-start gap-2 text-xs text-ink-3">
                <CircleAlert size={14} className="mt-0.5 shrink-0" />
                <span>
                  Skipping{' '}
                  {[
                    skipped.income > 0 && `${skipped.income} income rows`,
                    skipped.malformed > 0 && `${skipped.malformed} unreadable rows`,
                    skipped.unsupportedCurrency.length > 0 &&
                      `everything in ${skipped.unsupportedCurrency.join(', ')}`,
                  ].filter(Boolean).join(', ')}
                  . Spendly tracks expenses in EUR, USD and UAH only.
                </span>
              </p>
            )}

            {error && <p className="text-sm text-danger">{error}</p>}

            <div className="flex gap-2">
              <Button className="flex-1" onClick={run}>
                Import {summary.total.toLocaleString('en-GB')} expenses
              </Button>
              <Button variant="ghost" onClick={reset}>Cancel</Button>
            </div>
            <p className="text-xs leading-relaxed text-ink-3">
              Rows already in your account are detected and skipped, so running this twice
              won't double anything up.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {result && (
              <div className="rounded-xl bg-raised p-3 text-sm">
                <p className="font-medium">
                  Imported {result.inserted.toLocaleString('en-GB')} expenses.
                </p>
                <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                  {result.skippedAsDuplicate > 0 && (
                    <li>{result.skippedAsDuplicate.toLocaleString('en-GB')} were already there and were skipped.</li>
                  )}
                  {result.categoriesCreated.length > 0 && (
                    <li>Created {result.categoriesCreated.join(', ')}.</li>
                  )}
                  {result.ratesCached > 0 && (
                    <li>Cached {result.ratesCached.toLocaleString('en-GB')} days of exchange rates.</li>
                  )}
                </ul>
              </div>
            )}
            <p className="flex items-start gap-2.5 text-sm text-ink-2">
              <FileUp size={17} className="mt-0.5 shrink-0 text-ink-3" />
              <span>Bring in your history from a Monefy CSV export. Nothing is written until you confirm.</span>
            </p>
            {error && <p className="text-sm text-danger">{error}</p>}
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f) }}
              className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-xl file:border-0
                         file:bg-raised file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-ink
                         hover:file:bg-line"
            />
          </div>
        )}
      </Card>
    </section>
  )
}
