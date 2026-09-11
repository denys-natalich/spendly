import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { iconFor, slotColor } from '../lib/icons'
import { money, symbolOf, today } from '../lib/format'
import { nearestKnown, rateToEur } from '../lib/fx'
import { collectNotes, matchNotes } from '../lib/notes'
import { toast } from '../lib/toast'
import { BASE_CURRENCY, CURRENCIES, type Currency, type Expense } from '../types'
import { Button, Segmented, Sheet, inputClass } from './ui'

export function ExpenseSheet({ open, expense, onClose }: {
  open: boolean
  expense: Expense | null
  onClose: () => void
}) {
  const { categories, expenses, rates, addExpense, updateExpense, deleteExpense } = useStore()

  /*
   * Ordered by how often each category is actually used, so the two or three
   * that account for most entries sit under the thumb without scrolling. Ties
   * and never-used categories fall back to the manual sort order.
   */
  const active = useMemo(() => {
    const uses = new Map<string, number>()
    for (const e of expenses) {
      if (e.category_id) uses.set(e.category_id, (uses.get(e.category_id) ?? 0) + 1)
    }
    return categories
      .filter((c) => !c.is_archived)
      .sort((a, b) => (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0) || a.sort_order - b.sort_order)
  }, [categories, expenses])

  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState<Currency>(BASE_CURRENCY)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [spentOn, setSpentOn] = useState(today())
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedRef = useRef<HTMLButtonElement>(null)

  /*
   * Note autocomplete. The suggestions only appear once the note has been typed
   * into — opening the sheet on an existing expense should not drop a list over
   * the fields below it.
   */
  const [typingNote, setTypingNote] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const knownNotes = useMemo(() => collectNotes(expenses), [expenses])
  const suggestions = useMemo(() => matchNotes(knownNotes, note), [knownNotes, note])
  const showSuggestions = typingNote && suggestions.length > 0
  const listRef = useRef<HTMLUListElement>(null)

  // The list hangs below the note, which on a phone is close to the keyboard —
  // scroll the sheet just enough to keep the whole list on screen.
  useEffect(() => {
    if (showSuggestions) listRef.current?.scrollIntoView({ block: 'nearest' })
  }, [showSuggestions, suggestions.length])

  function pickNote(value: string) {
    setNote(value)
    setTypingNote(false)
    setHighlight(-1)
  }

  function onNoteKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (!showSuggestions) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : suggestions.length
      setHighlight((h) => (h + 1 + step) % (suggestions.length + 1) - 1)
    } else if (e.key === 'Enter' && highlight >= 0) {
      e.preventDefault()
      pickNote(suggestions[highlight])
    } else if (e.key === 'Escape') {
      // Dismiss the list only; the sheet's own Escape handler sits on document.
      e.stopPropagation()
      setTypingNote(false)
      setHighlight(-1)
    }
  }

  // Re-seed the fields each time the sheet opens rather than on every render,
  // so typing is never clobbered by a parent update.
  useEffect(() => {
    if (!open) return
    setError(null)
    setBusy(false)
    setAmount(expense ? String(expense.amount) : '')
    setCurrency(expense?.currency ?? BASE_CURRENCY)
    setCategoryId(expense?.category_id ?? active[0]?.id ?? null)
    setSpentOn(expense?.spent_on ?? today())
    setNote(expense?.note ?? '')
    setTypingNote(false)
    setHighlight(-1)
  }, [open, expense, active])

  // When editing, the chosen category may sit far along the scroller.
  useEffect(() => {
    if (!open) return
    selectedRef.current?.scrollIntoView({ block: 'nearest', inline: 'center' })
  }, [open, categoryId])

  const parsed = Number(amount.replace(',', '.'))
  const valid = Number.isFinite(parsed) && parsed > 0

  const dayRates = rates.get(spentOn) ?? nearestKnown(spentOn, rates)
  const rate = rateToEur(currency, dayRates)
  const eurValue = valid ? parsed / rate : 0

  async function save() {
    if (!valid) return
    setBusy(true)
    setError(null)
    try {
      const draft = {
        category_id: categoryId,
        amount: Number(parsed.toFixed(2)),
        currency,
        spent_on: spentOn,
        note: note.trim() || null,
      }
      if (expense) await updateExpense(expense.id, draft)
      else await addExpense(draft)
      toast(expense ? 'Expense updated' : 'Expense added')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the expense.')
      setBusy(false)
    }
  }

  async function remove() {
    if (!expense) return
    setBusy(true)
    try {
      await deleteExpense(expense.id)
      toast('Expense deleted')
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the expense.')
      setBusy(false)
    }
  }

  return (
    <Sheet open={open} title={expense ? 'Edit expense' : 'New expense'} onClose={onClose}>
      <div className="space-y-3.5">
        {/* Amount and currency share a row — with the keyboard up there is only
            about 500px of screen, and every stacked block costs a scroll. */}
        <div className="flex items-end gap-3">
          <span className="pb-2 text-xl text-ink-3">{symbolOf(currency)}</span>
          <input
            autoFocus={!expense}
            inputMode="decimal"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Amount"
            className="tnum min-w-0 flex-1 border-b border-line bg-transparent pb-1.5 text-3xl font-semibold
                       placeholder:text-ink-3 focus:border-accent focus:outline-none"
          />
          <div className="shrink-0 pb-1">
            <Segmented
              compact
              ariaLabel="Currency"
              value={currency}
              onChange={setCurrency}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </div>
        </div>

        {currency !== BASE_CURRENCY && (
          <p className="tnum -mt-1 text-right text-xs text-ink-3">
            = {money(eurValue, BASE_CURRENCY)} · 1 {BASE_CURRENCY} = {rate.toFixed(2)} {currency}
          </p>
        )}

        {/* One scrolling row instead of a wrapping grid: fifteen categories wrap
            to four rows, which is most of the space the keyboard leaves. */}
        <div className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5 py-0.5">
          {active.map((c) => {
            const Icon = iconFor(c.icon)
            const selected = categoryId === c.id
            return (
              <button
                key={c.id}
                ref={selected ? selectedRef : undefined}
                type="button"
                // Keep focus (and the phone keyboard) on whichever field had it;
                // the row still scrolls, since that is driven by touch, not mouse.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setCategoryId(c.id)}
                aria-pressed={selected}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-2 text-sm
                            transition-colors ${
                              selected
                                ? 'border-transparent bg-raised font-medium text-ink'
                                : 'border-line text-ink-2'
                            }`}
                style={selected ? { boxShadow: `inset 0 0 0 1.5px ${slotColor(c.color_slot)}` } : undefined}
              >
                <Icon size={15} style={{ color: slotColor(c.color_slot) }} />
                {c.name}
              </button>
            )
          })}
        </div>

        {/* Notes repeat — the same handful of shops, week after week. Two typed
            letters bring the earlier spellings back rather than retyping one. */}
        <div className="relative">
          <input
            type="text"
            value={note}
            maxLength={200}
            placeholder="Note"
            onChange={(e) => {
              setNote(e.target.value)
              setTypingNote(true)
              setHighlight(-1)
            }}
            onKeyDown={onNoteKeyDown}
            onBlur={() => setTypingNote(false)}
            aria-label="Note"
            role="combobox"
            aria-expanded={showSuggestions}
            aria-controls="note-suggestions"
            aria-autocomplete="list"
            aria-activedescendant={highlight >= 0 ? `note-suggestion-${highlight}` : undefined}
            autoComplete="off"
            autoCorrect="off"
            className={`${inputClass} w-full`}
          />
          {showSuggestions && (
            <ul
              ref={listRef}
              id="note-suggestions"
              role="listbox"
              aria-label="Earlier notes"
              className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line
                         bg-surface shadow-lg shadow-black/10"
            >
              {suggestions.map((s, i) => (
                <li
                  key={s}
                  id={`note-suggestion-${i}`}
                  role="option"
                  aria-selected={i === highlight}
                  // Swallowing the press keeps focus in the input, so the blur
                  // that closes the list never fires before the click lands.
                  // cursor-pointer is what makes iOS emit these at all.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickNote(s)}
                  className={`cursor-pointer truncate px-3.5 py-2.5 text-sm pointer-coarse:text-base ${
                    i === highlight ? 'bg-raised text-ink' : 'text-ink-2'
                  }`}
                >
                  <Match text={s} query={note} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* The date is almost always today, so it gets a quiet row of its own
            rather than competing with the note for width. */}
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3.5 py-2">
          <span className="text-sm text-ink-2">Date</span>
          <input
            type="date"
            value={spentOn}
            max={today()}
            onChange={(e) => setSpentOn(e.target.value || today())}
            aria-label="Date"
            className="tnum bg-transparent text-right text-sm pointer-coarse:text-base text-ink focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}

        <div className="flex items-center gap-2">
          <Button onClick={save} busy={busy} disabled={!valid} className="flex-1">
            {expense ? 'Save changes' : 'Add expense'}
          </Button>
          {expense && (
            <Button variant="danger" onClick={remove} aria-label="Delete expense">
              <Trash2 size={16} />
            </Button>
          )}
        </div>
      </div>
    </Sheet>
  )
}

/**
 * Bolds the typed part of a suggestion so the rest reads as the completion.
 * An accent-only match ("cafe" against "Café") has no plain offset to mark, so
 * it renders unstyled rather than bolding the wrong characters.
 */
function Match({ text, query }: { text: string; query: string }) {
  const at = text.toLowerCase().indexOf(query.trim().toLowerCase())
  if (at < 0) return <>{text}</>
  const end = at + query.trim().length
  return (
    <>
      {text.slice(0, at)}
      <span className="font-semibold text-ink">{text.slice(at, end)}</span>
      {text.slice(end)}
    </>
  )
}
