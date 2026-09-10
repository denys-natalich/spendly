import type { Expense } from '../types'

/** Below two characters nearly every note matches, which is not a suggestion. */
export const MIN_NOTE_QUERY = 2

const LIMIT = 4

/** Case- and accent-insensitive, so "cafe" still finds "Café". */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

interface NoteEntry {
  note: string
  key: string
  uses: number
}

/**
 * The distinct notes already used, with how often each one was. Built once per
 * change to the expense list rather than per keystroke: after an import there
 * are thousands of rows behind a handful of distinct shop names.
 */
export function collectNotes(expenses: Expense[]): NoteEntry[] {
  const seen = new Map<string, NoteEntry>()
  // Expenses arrive newest first, so the spelling kept is the most recent one.
  for (const e of expenses) {
    const note = e.note?.trim()
    if (!note) continue
    const key = fold(note)
    const prev = seen.get(key)
    if (prev) prev.uses += 1
    else seen.set(key, { note, key, uses: 1 })
  }
  return [...seen.values()]
}

/** True when `query` starts a word inside `key` — "doce" should find "Pingo Doce". */
function atWordStart(key: string, query: string): boolean {
  for (let i = key.indexOf(query); i > 0; i = key.indexOf(query, i + 1)) {
    if (!/[\p{L}\p{N}]/u.test(key[i - 1])) return true
  }
  return false
}

/**
 * Notes worth offering for what has been typed so far, best first: a match on
 * the opening of the note beats one mid-word, and among equals the note used
 * most often wins. A note identical to the query is dropped — there is nothing
 * left to complete.
 */
export function matchNotes(entries: NoteEntry[], query: string, limit = LIMIT): string[] {
  const q = fold(query.trim())
  if (q.length < MIN_NOTE_QUERY) return []

  return entries
    .filter((e) => e.key !== q && e.key.includes(q))
    .map((e) => ({ ...e, rank: e.key.startsWith(q) ? 0 : atWordStart(e.key, q) ? 1 : 2 }))
    .sort((a, b) => a.rank - b.rank || b.uses - a.uses || a.note.localeCompare(b.note))
    .slice(0, limit)
    .map((e) => e.note)
}
