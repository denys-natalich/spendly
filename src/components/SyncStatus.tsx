import { useState } from 'react'
import { Check, CircleAlert, CloudOff, RefreshCw } from 'lucide-react'
import { flush, useSync } from '../lib/sync'
import { Button, Card, SectionTitle } from './ui'

/*
 * What the sync is doing, in one line.
 *
 * Deliberately quiet: when everything is up to date the pill renders nothing
 * at all. An app that is meant to be used with no connection should not nag
 * about not having one — it should only speak up when there is something the
 * person would want to know, which is that changes are waiting, going up, or
 * were refused.
 */

function describe(s: ReturnType<typeof useSync>): { label: string; tone: string; icon: typeof Check } | null {
  if (s.error) return { label: 'Sync problem', tone: 'text-danger', icon: CircleAlert }
  if (!s.online) {
    return {
      label: s.pending > 0 ? `Offline · ${s.pending} to sync` : 'Offline',
      tone: 'text-ink-2',
      icon: CloudOff,
    }
  }
  if (s.syncing) return { label: 'Syncing…', tone: 'text-ink-2', icon: RefreshCw }
  if (s.pending > 0) return { label: `${s.pending} to sync`, tone: 'text-ink-2', icon: RefreshCw }
  return null
}

/** The badge in the header and the desktop rail. */
export function SyncPill() {
  const sync = useSync()
  const status = describe(sync)
  if (!status) return null
  const Icon = status.icon
  return (
    <span
      role="status"
      className={`flex items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1
                  text-[11px] whitespace-nowrap ${status.tone}`}
    >
      <Icon size={12} className={sync.syncing ? 'animate-spin' : undefined} />
      {status.label}
    </span>
  )
}

/** The full account in Settings, where there is room to explain it. */
export function SyncSettings() {
  const sync = useSync()
  const [busy, setBusy] = useState(false)

  async function syncNow() {
    setBusy(true)
    try {
      await flush()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <SectionTitle>Sync</SectionTitle>
      <Card className="divide-y divide-line">
        <Row
          label="Status"
          value={sync.online ? (sync.syncing ? 'Syncing…' : 'Up to date with the server') : 'Offline — working from this device'}
        />
        <Row
          label="Waiting to sync"
          value={sync.pending === 0 ? 'Nothing' : `${sync.pending} ${sync.pending === 1 ? 'change' : 'changes'}`}
        />
        <Row label="Last synced" value={sync.lastSyncedAt ? whenLabel(sync.lastSyncedAt) : 'Not yet'} />
        {sync.error && (
          <p className="flex items-start gap-2 p-4 text-sm text-danger">
            <CircleAlert size={16} className="mt-0.5 shrink-0" />
            {sync.error}
          </p>
        )}
        <div className="p-4">
          <Button
            variant="subtle"
            busy={busy}
            disabled={!sync.online || sync.pending === 0}
            onClick={() => void syncNow()}
            className="w-full"
          >
            {sync.pending === 0 ? <Check size={16} /> : <RefreshCw size={16} />}
            {sync.pending === 0 ? 'Everything is synced' : 'Sync now'}
          </Button>
        </div>
      </Card>
      <p className="mt-2 px-1 text-xs leading-relaxed text-ink-3">
        Expenses are written to this device first, so the app works with no internet at all — on a
        plane, abroad, or underground. Anything entered offline is sent to the server the next time
        there is a connection, and a rate that could not be fetched at the time is corrected then too.
        Signing out sends what is waiting first, and keeps it on the device if it cannot.
      </p>
    </section>
  )
}

function whenLabel(iso: string): string {
  const then = new Date(iso)
  const minutes = Math.round((Date.now() - then.getTime()) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} h ago`
  return then.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <span className="text-sm text-ink-2">{label}</span>
      <span className="text-right text-sm font-medium">{value}</span>
    </div>
  )
}
