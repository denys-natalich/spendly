import { supabase } from './supabase'
import type { DayRates, Traveller, Trip, TripExpense } from '../types'

/*
 * Sharing a trip.
 *
 * A trip is shared spending, so the people on it are the ones who know what
 * was spent — and asking each of them to make an account, on an app that is
 * one person's ledger, is more than the occasion is worth. A link is the
 * smallest thing that works: whoever has it can see the trip and add to it,
 * and the expenses land in the owner's account as if they had typed them.
 *
 * The token is the credential, so it is treated like one. It is 32 random
 * bytes; only its SHA-256 reaches the database; and it rides in the URL
 * fragment, which browsers never put on the wire, so it stays out of request
 * logs between here and the app. Every read and write goes through a database
 * function that resolves the token to exactly one trip — see
 * `supabase/2026-09-trip-sharing.sql`.
 */

const JOIN_PREFIX = '#/join/'

/** A trip as a link holder sees it: the owner's account id is never sent. */
export type SharedTrip = Omit<Trip, 'user_id'>
export type SharedTraveller = Omit<Traveller, 'user_id'>
export interface SharedExpense extends Omit<TripExpense, 'user_id'> {
  /** The link this came in through. Only rows from this link can be changed. */
  created_via: string | null
}

export interface SharedTripSnapshot {
  share_id: string
  trip: SharedTrip
  travellers: SharedTraveller[]
  expenses: SharedExpense[]
  /** Sent along because a link holder cannot read `fx_rates` for themselves. */
  rates: DayRates[]
}

export interface TripShare {
  id: string
  trip_id: string
  created_at: string
  revoked_at: string | null
}

/** The token in the address bar, when the app was opened through a share link. */
export function joinToken(): string | null {
  if (typeof window === 'undefined') return null
  const hash = window.location.hash
  if (!hash.startsWith(JOIN_PREFIX)) return null
  const token = hash.slice(JOIN_PREFIX.length).trim()
  return /^[A-Za-z0-9_-]{22,128}$/.test(token) ? token : null
}

export function shareUrl(token: string): string {
  return `${window.location.origin}${import.meta.env.BASE_URL}${JOIN_PREFIX}${token}`
}

/** 32 random bytes, base64url — long enough that guessing one is not a strategy. */
export function newShareToken(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Lowercase hex, matching `encode(digest(token, 'sha256'), 'hex')` in Postgres. */
export async function tokenHash(token: string): Promise<string> {
  if (!crypto.subtle) throw new Error('This browser cannot create a secure link.')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/* --- what the owner does ------------------------------------------------- */

export async function activeShare(tripId: string): Promise<TripShare | null> {
  const { data, error } = await supabase
    .from('trip_shares')
    .select('id, trip_id, created_at, revoked_at')
    .eq('trip_id', tripId)
    .is('revoked_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
  if (error) throw error
  return (data?.[0] as TripShare) ?? null
}

/**
 * Makes a link. The token is returned once and never again — the database only
 * ever sees its hash — so it is also kept on this device, which is what lets
 * the same phone copy the link again tomorrow. From another device the owner
 * sees that a link is active and can replace it.
 */
export async function createShare(tripId: string, userId: string): Promise<{ share: TripShare; token: string }> {
  const token = newShareToken()
  const { data, error } = await supabase
    .from('trip_shares')
    .insert({ trip_id: tripId, user_id: userId, token_hash: await tokenHash(token) })
    .select('id, trip_id, created_at, revoked_at')
    .single()
  if (error) throw error
  const share = data as TripShare
  rememberShareToken(share.id, token)
  return { share, token }
}

export async function revokeShare(shareId: string): Promise<void> {
  const { error } = await supabase
    .from('trip_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', shareId)
  if (error) throw error
  forgetShareToken(shareId)
}

const TOKEN_KEY = 'spendly.shareTokens'

function readTokens(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_KEY) ?? '{}') as Record<string, string>
  } catch {
    return {}
  }
}

export function rememberShareToken(shareId: string, token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ ...readTokens(), [shareId]: token }))
  } catch {
    /* private mode — the link is still on screen right now */
  }
}

export function recallShareToken(shareId: string): string | null {
  return readTokens()[shareId] ?? null
}

export function forgetShareToken(shareId: string): void {
  try {
    const all = readTokens()
    delete all[shareId]
    localStorage.setItem(TOKEN_KEY, JSON.stringify(all))
  } catch {
    /* nothing to forget */
  }
}

/* --- what the link holder does ------------------------------------------- */

/** A link that was revoked, mistyped or truncated — distinct from being offline. */
export class ShareGoneError extends Error {}

function rpcFailed(error: { message: string; code?: string }): Error {
  if (/no longer active/i.test(error.message)) return new ShareGoneError(error.message)
  return new Error(error.message)
}

export async function fetchSharedTrip(token: string): Promise<SharedTripSnapshot> {
  const { data, error } = await supabase.rpc('share_trip', { share_token: token })
  if (error) throw rpcFailed(error)
  return data as SharedTripSnapshot
}

export async function saveSharedExpense(
  token: string,
  expense: Record<string, unknown>,
): Promise<SharedExpense> {
  const { data, error } = await supabase.rpc('share_save_expense', { share_token: token, expense })
  if (error) throw rpcFailed(error)
  return data as SharedExpense
}

export async function deleteSharedExpense(token: string, expenseId: string): Promise<void> {
  const { error } = await supabase.rpc('share_delete_expense', {
    share_token: token,
    expense_id: expenseId,
  })
  if (error) throw rpcFailed(error)
}

export async function addSharedTraveller(token: string, name: string): Promise<SharedTraveller> {
  const { data, error } = await supabase.rpc('share_add_traveller', {
    share_token: token,
    traveller_name: name,
  })
  if (error) throw rpcFailed(error)
  return data as SharedTraveller
}

/* Which person on the trip this device is. Per link, so two people sharing a
   laptop don't inherit each other's answer on a different trip. */
const ME_KEY = 'spendly.shareMe'

export function rememberMe(token: string, travellerId: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(ME_KEY) ?? '{}') as Record<string, string>
    localStorage.setItem(ME_KEY, JSON.stringify({ ...all, [token.slice(0, 12)]: travellerId }))
  } catch {
    /* the picker will simply ask again */
  }
}

export function recallMe(token: string): string | null {
  try {
    const all = JSON.parse(localStorage.getItem(ME_KEY) ?? '{}') as Record<string, string>
    return all[token.slice(0, 12)] ?? null
  } catch {
    return null
  }
}
