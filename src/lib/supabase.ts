import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const isConfigured = Boolean(url && anonKey)

/* When the keys are missing we still want the app to mount so it can show the
   setup instructions instead of a blank screen, hence the placeholder URL. */
export const supabase = createClient(
  url || 'https://placeholder.supabase.co',
  anonKey || 'placeholder-anon-key',
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
)

/** PostgREST caps every response at a server-side row limit (1000 by default), which a
 *  client-side `.limit()` cannot raise — it silently truncates instead of erroring.
 *  Anything that can exceed that has to be paged. */
export const PAGE_SIZE = 1000

const MAX_PAGES = 50

export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < MAX_PAGES; i++) {
    const from = i * PAGE_SIZE
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
  return out
}
