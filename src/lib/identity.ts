/*
 * Who this device belongs to, remembered separately from the Supabase session.
 *
 * Signing in needs the network, but *staying* signed in must not. Supabase
 * keeps the session in localStorage and refreshes the access token on a timer;
 * if the app is opened cold with no connection and the token has expired, that
 * refresh cannot happen and there is no session object to read a user id from.
 * Without one, an offline launch would show the sign-in screen — with the
 * expenses sitting right there in the local cache, unreachable.
 *
 * So the last signed-in account is written down here. It unlocks the local data
 * and lets new expenses be queued; it grants nothing on the server, where every
 * request still needs a live token and passes row level security. It is cleared
 * on an explicit sign-out.
 */

const KEY = 'spendly.identity'

export interface Identity {
  id: string
  email: string | null
}

export function rememberIdentity(identity: Identity): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(identity))
  } catch {
    /* private mode — this session only */
  }
}

export function cachedIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<Identity>
    return typeof parsed.id === 'string' ? { id: parsed.id, email: parsed.email ?? null } : null
  } catch {
    return null
  }
}

export function forgetIdentity(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* nothing to forget */
  }
}
