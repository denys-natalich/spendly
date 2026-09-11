import { useEffect, useState } from 'react'
import { ChartPie, ListPlus, Plus, Settings as SettingsIcon, Tag, Wallet } from 'lucide-react'
import { isConfigured } from './lib/supabase'
import { useAppLock } from './lib/useAppLock'
import { lockPromptSeen, markLockPromptSeen } from './lib/lock'
import { useStore } from './store'
import { Categories } from './components/Categories'
import { Expenses } from './components/Expenses'
import { ExpenseSheet } from './components/ExpenseSheet'
import { Avatar } from './components/Avatar'
import { LockScreen } from './components/LockScreen'
import { LockSetupSheet } from './components/LockSettings'
import { Login } from './components/Login'
import { Overview } from './components/Overview'
import { Settings } from './components/Settings'
import { Setup } from './components/Setup'
import { Card, Spinner } from './components/ui'
import { DEFAULT_FILTER, type ExpenseFilter, type ExpensesView } from './lib/filters'
import type { Expense } from './types'

type Tab = 'overview' | 'expenses' | 'categories' | 'settings'

const TABS: Array<{ id: Tab; label: string; icon: typeof ChartPie }> = [
  { id: 'overview', label: 'Overview', icon: ChartPie },
  { id: 'expenses', label: 'Expenses', icon: ListPlus },
  { id: 'categories', label: 'Categories', icon: Tag },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
]

export default function App() {
  const { session, authLoading, loading, error } = useStore()
  const [tab, setTab] = useState<Tab>('overview')
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [filter, setFilter] = useState<ExpenseFilter>(DEFAULT_FILTER)
  const [expensesView, setExpensesView] = useState<ExpensesView>('days')
  const lock = useAppLock(Boolean(session))
  const [lockPrompt, setLockPrompt] = useState(false)

  // Offer the lock once, the first time this device has a signed-in session.
  useEffect(() => {
    if (session && !lock.enabled && !lockPromptSeen()) setLockPrompt(true)
  }, [session, lock.enabled])

  if (!isConfigured) return <Setup />
  if (authLoading) return <div className="min-h-dvh"><Spinner label="Checking your session" /></div>
  if (!session) return <Login />
  if (lock.locked) return <LockScreen onUnlock={lock.unlock} />

  function openNew() {
    setEditing(null)
    setSheetOpen(true)
  }

  function openEdit(e: Expense) {
    setEditing(e)
    setSheetOpen(true)
  }

  /** Overview → Expenses, scoped to one category in the month being viewed. */
  function openCategory(categoryKey: string, month: string) {
    setFilter({
      category: categoryKey === 'uncategorised' ? 'none' : categoryKey,
      range: { kind: 'month', month },
      query: '',
    })
    setExpensesView('days')
    setTab('expenses')
  }

  const current = TABS.find((t) => t.id === tab)!

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 border-r border-line bg-surface p-4 md:block">
        <div className="mb-6 flex items-center gap-2 px-2 pt-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-accent-in">
            <Wallet size={16} />
          </span>
          <span className="flex-1 font-semibold">Spendly</span>
          <button
            type="button"
            onClick={() => setTab('settings')}
            aria-label="Account settings"
            className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Avatar size={28} />
          </button>
        </div>
        <nav className="space-y-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? 'page' : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
                tab === id ? 'bg-raised font-medium text-ink' : 'text-ink-2 hover:bg-raised'
              }`}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <button
          type="button"
          onClick={openNew}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-accent px-3 py-2.5
                     text-sm font-medium text-accent-in transition-opacity hover:opacity-90"
        >
          <Plus size={16} /> Add expense
        </button>
      </aside>

      <div className="min-w-0 flex-1">
        {/* Mobile header */}
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-line
                           bg-bg/85 px-5 py-3 backdrop-blur md:hidden">
          <h1 className="text-base font-semibold">{current.label}</h1>
          <button
            type="button"
            onClick={() => setTab('settings')}
            aria-label="Account settings"
            className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <Avatar size={32} />
          </button>
        </header>

        <main className="mx-auto w-full max-w-2xl px-4 pt-4 pb-28 md:px-8 md:pt-8 md:pb-12 lg:max-w-4xl">
          {error && (
            <Card className="mb-4 border-danger/40 p-4 text-sm text-danger">{error}</Card>
          )}
          {loading ? (
            <Spinner label="Loading your expenses" />
          ) : (
            <>
              {tab === 'overview' && <Overview onAdd={openNew} onOpenCategory={openCategory} />}
              {tab === 'expenses' && (
                <Expenses
                  filter={filter}
                  onFilterChange={setFilter}
                  view={expensesView}
                  onViewChange={setExpensesView}
                  onEdit={openEdit}
                  onAdd={openNew}
                />
              )}
              {tab === 'categories' && <Categories />}
              {tab === 'settings' && (
                <Settings
                  lockEnabled={lock.enabled}
                  onEnableLock={lock.enable}
                  onDisableLock={lock.disable}
                />
              )}
            </>
          )}
        </main>
      </div>

      {/* Mobile FAB — sits above the tab bar and the home indicator. Only on the
          tabs where logging an expense is the primary action; Categories has its
          own primary button and Settings has none. */}
      {(tab === 'overview' || tab === 'expenses') && <button
        type="button"
        onClick={openNew}
        aria-label="Add expense"
        className="fixed right-5 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 flex h-14 w-14
                   items-center justify-center rounded-full bg-accent text-accent-in shadow-lg
                   transition-transform active:scale-95 md:hidden"
      >
        <Plus size={24} />
      </button>}

      {/* Mobile tab bar */}
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-line bg-surface/95
                   pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? 'page' : undefined}
            className={`flex flex-col items-center gap-1 py-2.5 text-[11px] transition-colors ${
              tab === id ? 'text-accent' : 'text-ink-3'
            }`}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </nav>

      <ExpenseSheet open={sheetOpen} expense={editing} onClose={() => setSheetOpen(false)} />

      <LockSetupSheet
        open={lockPrompt}
        onClose={() => { markLockPromptSeen(); setLockPrompt(false) }}
        onEnabled={lock.enable}
      />
    </div>
  )
}
