import { useState, type FormEvent } from 'react'
import { Check, KeyRound } from 'lucide-react'
import { useStore } from '../store'
import { Button, Card, SectionTitle, inputClass } from './ui'

const MIN_LENGTH = 8

export function PasswordSettings() {
  const { setPassword } = useStore()
  const [open, setOpen] = useState(false)
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (next.length < MIN_LENGTH) {
      setError(`Use at least ${MIN_LENGTH} characters.`)
      return
    }
    if (next !== confirm) {
      setError('Those passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await setPassword(next)
      setSaved(true)
      setOpen(false)
      setNext('')
      setConfirm('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <SectionTitle>Password</SectionTitle>
      <Card className="p-4">
        {open ? (
          <form onSubmit={submit} className="space-y-3">
            {/* Hidden username field so password managers file the entry
                against the right account rather than offering to create a new one. */}
            <input type="text" autoComplete="username" className="hidden" tabIndex={-1} aria-hidden />
            <input
              type="password"
              autoFocus
              required
              autoComplete="new-password"
              value={next}
              onChange={(e) => { setNext(e.target.value); setError(null) }}
              placeholder="New password"
              aria-label="New password"
              className={`${inputClass} w-full`}
            />
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(null) }}
              placeholder="Repeat it"
              aria-label="Repeat new password"
              className={`${inputClass} w-full`}
            />
            {error && <p className="text-sm text-danger">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" busy={busy} className="flex-1">Save password</Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setOpen(false); setError(null); setNext(''); setConfirm('') }}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="flex items-start gap-2.5 text-sm text-ink-2">
              {saved ? <Check size={17} className="mt-0.5 shrink-0 text-good" />
                     : <KeyRound size={17} className="mt-0.5 shrink-0 text-ink-3" />}
              <span>
                {saved
                  ? 'Password updated. Use it to sign in on your other devices.'
                  : 'Set a password here, then use it to sign in on your phone — the same account and the same data.'}
              </span>
            </p>
            <Button variant="subtle" className="w-full" onClick={() => { setOpen(true); setSaved(false) }}>
              {saved ? 'Change it again' : 'Set a password'}
            </Button>
          </div>
        )}
      </Card>
    </section>
  )
}
