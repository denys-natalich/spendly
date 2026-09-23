import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { localAll, localDelete, localGet, localPut, localPutMany } from './db'
import { backfillRates, loadLocalRates, rateToEur, nearestKnown } from './fx'
import { deleteSharedExpense, saveSharedExpense } from './share'
import type { Currency, DayRates } from '../types'

/*
 * The outbox: every change made on this device, in the order it was made,
 * waiting for a connection.
 *
 * Writes never go to the network directly. A new expense lands in React state,
 * in IndexedDB and in this queue — all three without awaiting a request — and
 * the queue is drained whenever the app has a connection. That is what makes
 * the app usable with no internet at all: there is no request to fail, so
 * nothing to retry by hand and nothing lost when the tab is closed mid-flight.
 *
 * Every queued change is an `upsert` of the whole row or a `delete` of its id,
 * both of which are idempotent. A replay interrupted halfway and started again
 * produces the same result, which matters far more here than a minimal payload:
 * the connection that dropped once will drop again.
 *
 * Two devices editing the same row while one of them is offline resolve
 * last-writer-wins — the replay overwrites. Rows are per-account and per-device
 * conflicts on the same expense are vanishingly rare compared to the everyday
 * case this exists for, which is one phone with no signal.
 */

export type SyncTable =
  | 'categories' | 'expenses' | 'trips' | 'travellers' | 'trip_expenses' | 'debts' | 'debt_installments'

export interface OutboxEntry {
  /** Assigned by IndexedDB; the replay order. */
  seq?: number
  /** The account this change belongs to. Absent on a change made through a link. */
  user_id?: string
  /**
   * Set when a share link's holder made the change. They have no account and
   * no session, so it goes up through the database functions the link allows
   * rather than through the table — but it waits in the same queue, and works
   * offline for exactly the same reasons.
   */
  share_token?: string
  table: SyncTable
  op: 'upsert' | 'delete'
  row_id: string
  /** The whole row, in the shape the table takes. Absent for a delete. */
  payload?: Record<string, unknown>
  /** The rate was guessed from a nearby day because the real one was offline. */
  rate_pending?: boolean
  queued_at: string
  attempts: number
}

/**
 * Columns that may be sent for each table.
 *
 * An allowlist rather than the row itself: `amount_eur` is a generated column,
 * and PostgREST rejects the whole statement if one is written to.
 */
const COLUMNS: Record<SyncTable, readonly string[]> = {
  categories: ['id', 'user_id', 'name', 'icon', 'color_slot', 'sort_order', 'is_archived', 'created_at'],
  expenses: ['id', 'user_id', 'category_id', 'amount', 'currency', 'rate_to_eur', 'spent_on', 'note', 'created_at'],
  trips: ['id', 'user_id', 'name', 'created_at'],
  travellers: ['id', 'trip_id', 'user_id', 'name', 'created_at'],
  trip_expenses: ['id', 'user_id', 'trip_id', 'traveller_id', 'amount', 'currency', 'rate_to_eur', 'spent_on', 'note', 'created_at'],
  debts: ['id', 'user_id', 'name', 'amount', 'currency', 'created_at'],
  debt_installments: ['id', 'user_id', 'debt_id', 'amount', 'description', 'paid_on', 'created_at'],
}

/** Rows per request when replaying a backlog, matching the import batch size. */
const BATCH = 400

/** The shape every synced table shares: an id to address it by, and an owner. */
export interface SyncRow {
  id: string
  user_id: string
}

/** A row the server keeps refusing is dropped rather than blocking the queue. */
const MAX_ATTEMPTS = 5

/** How often a queue with something in it retries while the app is open. */
const RETRY_MS = 60_000

const LAST_SYNCED_KEY = 'spendly.lastSyncedAt'

export interface SyncState {
  /** Both the browser's view and ours: a failed request marks us offline too. */
  online: boolean
  syncing: boolean
  /** Changes still waiting to reach the server. */
  pending: number
  lastSyncedAt: string | null
  /** Set when the server refused a change for good; cleared by the next success. */
  error: string | null
}

function readLastSynced(): string | null {
  try {
    return localStorage.getItem(LAST_SYNCED_KEY)
  } catch {
    return null
  }
}

let state: SyncState = {
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  lastSyncedAt: readLastSynced(),
  error: null,
}

const listeners = new Set<() => void>()

function setState(patch: Partial<SyncState>): void {
  state = { ...state, ...patch }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useSync(): SyncState {
  return useSyncExternalStore(subscribe, () => state)
}

export function syncState(): SyncState {
  return state
}

/*
 * What the replay changed, for the store to fold back into React state: a rate
 * re-resolved once the real day became reachable, or the fresh rates fetched
 * along the way.
 */
export type SyncPatch =
  | { kind: 'row'; table: SyncTable; id: string; patch: Record<string, unknown> }
  | { kind: 'rates'; days: DayRates[] }

const patchListeners = new Set<(patch: SyncPatch) => void>()

export function onSyncPatch(listener: (patch: SyncPatch) => void): () => void {
  patchListeners.add(listener)
  return () => { patchListeners.delete(listener) }
}

function emitPatch(patch: SyncPatch): void {
  for (const listener of patchListeners) listener(patch)
}

/** EUR value of an amount, matching the generated column's rounding exactly. */
export function toAmountEur(amount: number, rate: number): number {
  return Math.round((amount / rate) * 100) / 100
}

function toRemote(table: SyncTable, row: SyncRow): Record<string, unknown> {
  const source = row as unknown as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const column of COLUMNS[table]) {
    if (source[column] !== undefined) out[column] = source[column]
  }
  return out
}

async function outbox(): Promise<OutboxEntry[]> {
  const entries = await localAll<OutboxEntry>('outbox')
  return entries.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
}

async function refreshPending(): Promise<number> {
  const pending = (await outbox()).length
  if (pending !== state.pending) setState({ pending })
  return pending
}

/**
 * Queues a row.
 *
 * One entry per row, not one per keystroke: an expense created and then edited
 * twice while offline is a single upsert of its final state. The original
 * sequence number is kept so the row still replays after whatever it depends on
 * — a traveller after the trip it belongs to.
 */
export async function queueUpsert(
  table: SyncTable,
  row: SyncRow,
  opts: { ratePending?: boolean } = {},
): Promise<void> {
  await enqueueUpsert(table, row.id, toRemote(table, row), { user_id: row.user_id }, opts)
}

/** The same, for a link holder: the trip, not an account, says where it goes. */
export async function queueShareUpsert(
  shareToken: string,
  row: { id: string } & Record<string, unknown>,
  opts: { ratePending?: boolean } = {},
): Promise<void> {
  await enqueueUpsert('trip_expenses', row.id, toRemote('trip_expenses', row as unknown as SyncRow), { share_token: shareToken }, opts)
}

async function enqueueUpsert(
  table: SyncTable,
  rowId: string,
  payload: Record<string, unknown>,
  owner: { user_id?: string; share_token?: string },
  opts: { ratePending?: boolean },
): Promise<void> {
  const existing = (await outbox()).find((e) => e.table === table && e.row_id === rowId)
  const entry: OutboxEntry = {
    ...(existing?.seq !== undefined ? { seq: existing.seq } : {}),
    ...owner,
    table,
    op: 'upsert',
    row_id: rowId,
    payload,
    rate_pending: opts.ratePending ?? false,
    queued_at: new Date().toISOString(),
    attempts: 0,
  }
  await localPut('outbox', entry)
  await refreshPending()
  void flush()
}

/** The bulk path: one pass over the queue instead of one per row. */
export async function queueUpsertMany(
  table: SyncTable,
  rows: readonly SyncRow[],
  opts: { ratePending?: boolean } = {},
): Promise<void> {
  if (rows.length === 0) return
  const bySeq = new Map<string, number>()
  for (const entry of await outbox()) {
    if (entry.table === table) bySeq.set(entry.row_id, entry.seq!)
  }
  const queued_at = new Date().toISOString()
  await localPutMany(
    'outbox',
    rows.map((row) => ({
      ...(bySeq.has(row.id) ? { seq: bySeq.get(row.id) } : {}),
      user_id: row.user_id,
      table,
      op: 'upsert' as const,
      row_id: row.id,
      payload: toRemote(table, row),
      rate_pending: opts.ratePending ?? false,
      queued_at,
      attempts: 0,
    })),
  )
  await refreshPending()
  void flush()
}

/**
 * Queues a deletion, dropping whatever was queued for that row first.
 *
 * A row created and deleted before either reached the server never needs to:
 * the delete is still sent, because it costs one idempotent statement and
 * spares us having to know whether an earlier replay got the insert through.
 */
export async function queueDelete(table: SyncTable, userId: string, rowId: string): Promise<void> {
  await enqueueDelete(table, rowId, { user_id: userId })
}

export async function queueShareDelete(shareToken: string, rowId: string): Promise<void> {
  await enqueueDelete('trip_expenses', rowId, { share_token: shareToken })
}

async function enqueueDelete(
  table: SyncTable,
  rowId: string,
  owner: { user_id?: string; share_token?: string },
): Promise<void> {
  for (const entry of await outbox()) {
    if (entry.table === table && entry.row_id === rowId) await localDelete('outbox', entry.seq!)
  }
  await localPut('outbox', {
    ...owner,
    table,
    op: 'delete',
    row_id: rowId,
    queued_at: new Date().toISOString(),
    attempts: 0,
  } satisfies OutboxEntry)
  await refreshPending()
  void flush()
}

/**
 * Drops queued rows that point at something being deleted.
 *
 * The database cascades a deleted trip to its travellers and their spending,
 * but a traveller still sitting in the queue would be sent afterwards and be
 * refused by the foreign key. Same reasoning for a queued row whose category
 * or traveller is going away, except there the column is nullable and the
 * server would have set it to null itself.
 */
export async function dropQueuedFor(table: SyncTable, column: string, value: string): Promise<void> {
  for (const entry of await outbox()) {
    if (entry.table === table && entry.payload?.[column] === value) await localDelete('outbox', entry.seq!)
  }
  await refreshPending()
}

export async function unlinkQueued(table: SyncTable, column: string, value: string): Promise<void> {
  for (const entry of await outbox()) {
    if (entry.table === table && entry.payload?.[column] === value) {
      await localPut('outbox', { ...entry, payload: { ...entry.payload, [column]: null } })
    }
  }
}

/**
 * Replays the queue over rows just pulled from the server, so a refresh that
 * races an unsent change cannot make it disappear from the screen.
 */
export async function applyPending<T extends { id: string }>(
  table: SyncTable,
  userId: string,
  rows: T[],
  hydrate: (payload: Record<string, unknown>) => T,
): Promise<T[]> {
  return replay(rows, (await outbox()).filter((e) => e.table === table && e.user_id === userId), hydrate)
}

/** The same, over a trip snapshot fetched through a share link. */
export async function applyPendingShare<T extends { id: string }>(
  shareToken: string,
  rows: T[],
  hydrate: (payload: Record<string, unknown>) => T,
): Promise<T[]> {
  return replay(rows, (await outbox()).filter((e) => e.share_token === shareToken), hydrate)
}

function replay<T extends { id: string }>(
  rows: T[],
  entries: OutboxEntry[],
  hydrate: (payload: Record<string, unknown>) => T,
): T[] {
  if (entries.length === 0) return rows
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const entry of entries) {
    if (entry.op === 'delete') byId.delete(entry.row_id)
    else if (entry.payload) byId.set(entry.row_id, hydrate(entry.payload))
  }
  return [...byId.values()]
}

/** A dropped connection, as opposed to the server saying no. */
function isOffline(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? '')
  return /fetch|network|load failed|timeout|abort|connection/i.test(message)
}

let flushing: Promise<void> | null = null

/**
 * Pushes everything queued, oldest first.
 *
 * Stops at the first dropped connection and leaves the rest queued; a row the
 * server refuses outright is retried a few times, then dropped with the reason
 * kept so Settings can say what happened rather than retrying it forever.
 */
export function flush(): Promise<void> {
  if (flushing) return flushing
  flushing = runFlush().finally(() => { flushing = null })
  return flushing
}

async function runFlush(): Promise<void> {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    setState({ online: false })
    return
  }

  let userId: string | null = null
  try {
    const { data } = await supabase.auth.getSession()
    // No session means signed out, or a token that cannot be refreshed yet —
    // which stops the account's own changes, but not a link holder's: their
    // token is the credential, and they never had a session to lose.
    userId = data.session?.user.id ?? null
  } catch {
    setState({ online: false })
    return
  }

  const all = await outbox()
  const queue = all.filter((e) => (e.share_token ? true : userId !== null && e.user_id === userId))
  if (queue.length === 0) {
    setState({ online: true, pending: all.length })
    return
  }

  setState({ syncing: true })
  try {
    await resolvePendingRates(queue)

    let i = 0
    while (i < queue.length) {
      const entry = queue[i]

      if (entry.share_token) {
        if ((await pushShared(entry)) === 'offline') return void setState({ online: false })
        i++
        await refreshPending()
        continue
      }

      if (entry.op === 'delete') {
        const { error } = await supabase.from(entry.table).delete().eq('id', entry.row_id)
        if (error) {
          if (isOffline(error)) return void setState({ online: false })
          if (!(await penalise(entry, error.message))) { i++; continue }
        } else {
          await localDelete('outbox', entry.seq!)
        }
        i++
        continue
      }

      // Consecutive upserts into the same table go in one request — a five-year
      // import replays in a handful of round trips rather than thousands.
      const batch = [entry]
      while (
        batch.length < BATCH &&
        queue[i + batch.length]?.op === 'upsert' &&
        queue[i + batch.length]?.table === entry.table &&
        !queue[i + batch.length]?.share_token
      ) {
        batch.push(queue[i + batch.length])
      }

      const { error } = await supabase
        .from(entry.table)
        .upsert(batch.map((b) => b.payload!), { onConflict: 'id' })

      if (!error) {
        for (const done of batch) await localDelete('outbox', done.seq!)
        i += batch.length
      } else if (isOffline(error)) {
        return void setState({ online: false })
      } else if (batch.length > 1) {
        // One bad row must not hold up the rest: retry them one at a time.
        for (const single of batch) {
          const result = await supabase.from(single.table).upsert(single.payload!, { onConflict: 'id' })
          if (!result.error) await localDelete('outbox', single.seq!)
          else if (isOffline(result.error)) return void setState({ online: false })
          else await penalise(single, result.error.message)
        }
        i += batch.length
      } else {
        await penalise(entry, error.message)
        i++
      }
      await refreshPending()
    }

    const lastSyncedAt = new Date().toISOString()
    try { localStorage.setItem(LAST_SYNCED_KEY, lastSyncedAt) } catch { /* private mode */ }
    setState({ online: true, lastSyncedAt })
  } finally {
    setState({ syncing: false })
    await refreshPending()
  }
}

/**
 * One change made through a share link.
 *
 * A rate the sender could not resolve is left out of the payload rather than
 * sent as a guess: the database can read the rate table and a link holder
 * cannot, so it fills in the day's own rate as it writes the row.
 */
async function pushShared(entry: OutboxEntry): Promise<'done' | 'offline' | 'kept'> {
  try {
    if (entry.op === 'delete') {
      await deleteSharedExpense(entry.share_token!, entry.row_id)
    } else {
      const payload = { ...entry.payload }
      if (entry.rate_pending) delete payload.rate_to_eur
      await saveSharedExpense(entry.share_token!, payload)
    }
    await localDelete('outbox', entry.seq!)
    return 'done'
  } catch (e) {
    if (isOffline(e)) return 'offline'
    await penalise(entry, e instanceof Error ? e.message : 'That change was refused.')
    return 'kept'
  }
}

/** Returns true when the entry was dropped for good. */
async function penalise(entry: OutboxEntry, message: string): Promise<boolean> {
  const attempts = entry.attempts + 1
  if (attempts >= MAX_ATTEMPTS) {
    await localDelete('outbox', entry.seq!)
    setState({ error: `A change could not be saved to the server: ${message}` })
    return true
  }
  await localPut('outbox', { ...entry, attempts })
  return false
}

/**
 * Puts the real rate on rows that were entered with no connection.
 *
 * Offline, a hryvnia expense can only be converted at the nearest day already
 * cached, which after a week away is a week stale. The row keeps that rate so
 * the totals read sensibly in the meantime, and the day it actually needs is
 * fetched here, the moment there is a connection — before the row is sent, so
 * the server never stores the guess.
 */
async function resolvePendingRates(queue: OutboxEntry[]): Promise<void> {
  const waiting = queue.filter((e) => e.rate_pending && e.payload && !e.share_token)
  if (waiting.length === 0) return

  const known = new Map((await loadLocalRates()).map((r) => [r.day, r]))
  const before = known.size
  await backfillRates(waiting.map((e) => String(e.payload!.spent_on)), known)
  if (known.size === before) return // Still no reach; the guess stands for now.

  for (const entry of waiting) {
    const day = String(entry.payload!.spent_on)
    const exact = known.get(day)
    if (!exact) continue
    const currency = entry.payload!.currency as Currency
    const rate = rateToEur(currency, exact)
    entry.payload!.rate_to_eur = rate
    entry.rate_pending = false
    await localPut('outbox', entry)

    const amount = Number(entry.payload!.amount)
    const patch = { rate_to_eur: rate, amount_eur: toAmountEur(amount, rate) }
    const cached = await localGet<Record<string, unknown>>(entry.table, entry.row_id)
    if (cached) await localPut(entry.table, { ...cached, ...patch })
    emitPatch({ kind: 'row', table: entry.table, id: entry.row_id, patch })
  }
  emitPatch({ kind: 'rates', days: [...known.values()] })
}

/** The rate a row gets when it is entered: the day's, or the nearest we have. */
export function offlineRate(
  currency: Currency,
  spentOn: string,
  known: Map<string, DayRates>,
): { rate: number; exact: boolean } {
  if (currency === 'EUR') return { rate: 1, exact: true }
  const day = known.get(spentOn)
  if (day) return { rate: rateToEur(currency, day), exact: true }
  return { rate: rateToEur(currency, nearestKnown(spentOn, known)), exact: false }
}

let started = false

/**
 * Starts draining the queue: on reconnect, on returning to the app, and on a
 * slow timer for the case the browser thinks it is online but nothing answers.
 */
export function startSync(): void {
  if (started || typeof window === 'undefined') return
  started = true

  window.addEventListener('online', () => { setState({ online: true, error: null }); void flush() })
  window.addEventListener('offline', () => setState({ online: false }))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void flush() })
  setInterval(() => { if (state.pending > 0 || !state.online) void flush() }, RETRY_MS)

  void refreshPending()
  void flush()
}
