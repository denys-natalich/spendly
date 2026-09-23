import { useEffect, useState } from 'react'
import { Check, Copy, Link2, Share2, TriangleAlert } from 'lucide-react'
import { useStore } from '../store'
import {
  activeShare, createShare, recallShareToken, revokeShare, shareUrl, type TripShare,
} from '../lib/share'
import { toast } from '../lib/toast'
import type { Trip } from '../types'
import { Button, Sheet } from './ui'

/**
 * The owner's side of a shared trip.
 *
 * One live link per trip: a second one would be two things to keep track of
 * and revoke, for a trip that has one set of people on it. Replacing it is the
 * way to cut off whoever should no longer have it.
 */
export function ShareTrip({ open, trip, onClose }: {
  open: boolean
  trip: Trip
  onClose: () => void
}) {
  const { identity } = useStore()
  const [share, setShare] = useState<TripShare | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setCopied(false)
    activeShare(trip.id).then(
      (found) => {
        if (cancelled) return
        setShare(found)
        setToken(found ? recallShareToken(found.id) : null)
        setLoading(false)
      },
      (e: Error) => {
        if (cancelled) return
        setError(navigator.onLine ? e.message : 'Sharing a trip needs a connection.')
        setLoading(false)
      },
    )
    return () => { cancelled = true }
  }, [open, trip.id])

  async function create() {
    if (!identity) return
    setBusy(true)
    setError(null)
    try {
      const made = await createShare(trip.id, identity.id)
      setShare(made.share)
      setToken(made.token)
    } catch (e) {
      setError(navigator.onLine ? (e as Error).message : 'Making a link needs a connection.')
    } finally {
      setBusy(false)
    }
  }

  async function replace() {
    if (!share) return
    setBusy(true)
    setError(null)
    try {
      await revokeShare(share.id)
      setShare(null)
      setToken(null)
      await create()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  async function revoke() {
    if (!share) return
    setBusy(true)
    setError(null)
    try {
      await revokeShare(share.id)
      setShare(null)
      setToken(null)
      toast('Link switched off')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const url = token ? shareUrl(token) : null

  async function copy() {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Copying was blocked — select the link and copy it by hand.')
    }
  }

  async function sendTo() {
    if (!url) return
    try {
      await navigator.share({ title: trip.name, text: `Add what you spent on ${trip.name}`, url })
    } catch {
      /* The sheet was dismissed; nothing to report. */
    }
  }

  return (
    <Sheet open={open} title={`Share · ${trip.name}`} onClose={onClose}>
      <div className="space-y-4">
        {loading ? (
          <p className="py-4 text-center text-sm text-ink-3">Checking…</p>
        ) : url ? (
          <>
            <p className="text-sm text-ink-2">
              Anyone with this link can see the trip and add what they spent. They don't need an
              account, and they can't see anything else in your Moneta.
            </p>

            <div className="flex items-center gap-2">
              <input
                readOnly
                value={url}
                aria-label="Share link"
                onFocus={(e) => e.currentTarget.select()}
                className="min-w-0 flex-1 truncate rounded-xl border border-line bg-raised px-3.5 py-2.5
                           text-sm text-ink-2 focus:border-accent focus:outline-none"
              />
              <Button variant="subtle" onClick={() => void copy()} aria-label="Copy link">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </Button>
            </div>

            {typeof navigator.share === 'function' && (
              <Button className="w-full" onClick={() => void sendTo()}>
                <Share2 size={16} /> Send the link
              </Button>
            )}

            <div className="border-t border-line pt-3">
              <Button variant="danger" busy={busy} onClick={() => void revoke()} className="w-full">
                Switch this link off
              </Button>
              <p className="mt-2 text-xs leading-relaxed text-ink-3">
                Everything already added stays in the trip. The link stops working for everyone, so
                send a new one afterwards if some of the group still needs it.
              </p>
            </div>
          </>
        ) : share ? (
          /* The link is live, but this device didn't make it: only the hash is
             stored, so there is nothing here to show. Replacing it is honest
             about what that costs — the old one stops working. */
          <>
            <p className="flex items-start gap-2 text-sm text-ink-2">
              <TriangleAlert size={16} className="mt-0.5 shrink-0 text-ink-3" />
              <span>
                This trip already has a link, made on another device on{' '}
                {new Date(share.created_at).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'long',
                })}
                . Links are stored hashed, so it can't be shown again here.
              </span>
            </p>
            <Button className="w-full" busy={busy} onClick={() => void replace()}>
              <Link2 size={16} /> Make a new link
            </Button>
            <p className="text-xs leading-relaxed text-ink-3">
              The old one stops working when the new one is made.
            </p>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-2">
              Send the rest of the group a link so they can add what they paid for. They don't need
              an account — what they add lands in this trip, and nothing else in your Moneta is
              reachable through it.
            </p>
            <Button className="w-full" busy={busy} onClick={() => void create()}>
              <Link2 size={16} /> Create a link
            </Button>
          </>
        )}

        {error && <p className="text-sm text-danger">{error}</p>}
      </div>
    </Sheet>
  )
}
