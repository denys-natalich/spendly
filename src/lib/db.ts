/*
 * The on-device copy of everything the app shows.
 *
 * Supabase is still the record of truth, but it is not reachable on a train,
 * in a basement, or abroad with the data roaming off — which is exactly when
 * expenses get entered. So every row the app reads is mirrored into IndexedDB
 * and every screen is built from that mirror; the network only refreshes it.
 *
 * IndexedDB rather than localStorage because years of expenses are megabytes,
 * and localStorage is a synchronous string store with a ~5 MB ceiling.
 *
 * Nothing here throws. A browser with storage disabled (private mode on some
 * WebViews, a blocked origin) simply gets an app that works exactly as it did
 * before this file existed: online-only. Losing the cache is recoverable, a
 * crash on the way to the expense list is not.
 */

const DB_NAME = 'spendly'
const DB_VERSION = 2

export type LocalStore =
  | 'categories'
  | 'expenses'
  | 'trips'
  | 'travellers'
  | 'trip_expenses'
  | 'fx_rates'
  | 'shared_trips'
  | 'outbox'
  | 'meta'

const SCHEMA: Record<LocalStore, IDBObjectStoreParameters> = {
  categories: { keyPath: 'id' },
  expenses: { keyPath: 'id' },
  trips: { keyPath: 'id' },
  travellers: { keyPath: 'id' },
  trip_expenses: { keyPath: 'id' },
  fx_rates: { keyPath: 'day' },
  // One record per share link opened on this device: the whole trip as it was
  // last seen. Kept apart from the account's own stores above — a link holder
  // is not the owner, and their copy must never mix with an owner's.
  shared_trips: { keyPath: 'token' },
  // The queue of local changes waiting for a connection. `seq` is assigned by
  // IndexedDB and is the order they will be replayed in.
  outbox: { keyPath: 'seq', autoIncrement: true },
  meta: { keyPath: 'key' },
}

/** The stores that hold rows belonging to one signed-in user. */
export const USER_STORES = ['categories', 'expenses', 'trips', 'travellers', 'trip_expenses'] as const

let opening: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (opening) return opening
  opening = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let request: IDBOpenDBRequest
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null)
    }
    request.onupgradeneeded = () => {
      const db = request.result
      for (const [name, options] of Object.entries(SCHEMA)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, options)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return opening
}

/** True once the cache is usable — the app degrades to online-only if not. */
export async function localAvailable(): Promise<boolean> {
  return (await openDb()) !== null
}

function asPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/**
 * Runs `work` against one store inside a single transaction.
 *
 * The callback must issue its requests synchronously — awaiting anything else
 * mid-transaction lets the browser auto-close it — so it returns the requests
 * and the transaction is awaited as a whole.
 */
async function inStore<T>(
  name: LocalStore,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => Promise<T>,
  fallback: T,
): Promise<T> {
  const db = await openDb()
  if (!db) return fallback
  try {
    const tx = db.transaction(name, mode)
    const result = work(tx.objectStore(name))
    const settled = await result
    if (mode !== 'readonly') {
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve()
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    }
    return settled
  } catch {
    return fallback
  }
}

export async function localAll<T>(name: LocalStore): Promise<T[]> {
  return inStore(name, 'readonly', (s) => asPromise(s.getAll() as IDBRequest<T[]>), [] as T[])
}

export async function localGet<T>(name: LocalStore, key: IDBValidKey): Promise<T | null> {
  return inStore(name, 'readonly', async (s) => (await asPromise(s.get(key))) ?? null, null)
}

export async function localPut(name: LocalStore, value: unknown): Promise<void> {
  await inStore(name, 'readwrite', async (s) => { s.put(value) }, undefined)
}

export async function localPutMany(name: LocalStore, values: readonly unknown[]): Promise<void> {
  if (values.length === 0) return
  await inStore(name, 'readwrite', async (s) => { for (const v of values) s.put(v) }, undefined)
}

export async function localDelete(name: LocalStore, key: IDBValidKey): Promise<void> {
  await inStore(name, 'readwrite', async (s) => { s.delete(key) }, undefined)
}

export async function localDeleteMany(name: LocalStore, keys: readonly IDBValidKey[]): Promise<void> {
  if (keys.length === 0) return
  await inStore(name, 'readwrite', async (s) => { for (const k of keys) s.delete(k) }, undefined)
}

/**
 * Makes the cached rows for one user match what the server just returned,
 * leaving any other account's rows on the device alone.
 */
export async function localReplaceUser<T extends { id: string; user_id: string }>(
  name: LocalStore,
  userId: string,
  rows: readonly T[],
): Promise<void> {
  const existing = await localAll<{ id: string; user_id: string }>(name)
  const keep = new Set(rows.map((r) => r.id))
  const stale = existing.filter((r) => r.user_id === userId && !keep.has(r.id)).map((r) => r.id)
  await localDeleteMany(name, stale)
  await localPutMany(name, rows)
}

/** Everything one account has on this device. Used when signing out cleanly. */
export async function localClearUser(userId: string): Promise<void> {
  for (const name of USER_STORES) {
    const rows = await localAll<{ id: string; user_id: string }>(name)
    await localDeleteMany(name, rows.filter((r) => r.user_id === userId).map((r) => r.id))
  }
  await localDelete('meta', `avatar:${userId}`)
}
