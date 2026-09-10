import { useState, type FormEvent } from 'react'
import { Wallet } from 'lucide-react'
import { useStore } from '../store'
import { Button, Card, inputClass } from './ui'

export function Login() {
  const { signIn } = useStore()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim())
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the link. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-5">
      <Card className="w-full max-w-sm p-7">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent text-accent-in">
            <Wallet size={22} />
          </span>
          <div>
            <h1 className="text-xl font-semibold">Spendly</h1>
            <p className="mt-1 text-sm text-ink-2">
              Track spending in €, $ and ₴ — everything reported in euro.
            </p>
          </div>
        </div>

        {sent ? (
          <div className="space-y-3 text-center">
            <p className="text-sm text-ink">
              Check <span className="font-medium">{email}</span> for a sign-in link.
            </p>
            <p className="text-xs text-ink-3">
              Open it on this device. The link expires in about an hour.
            </p>
            <button
              type="button"
              onClick={() => setSent(false)}
              className="text-sm font-medium text-accent hover:underline"
            >
              Use a different address
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-label="Email address"
              className={`${inputClass} w-full`}
            />
            <Button type="submit" busy={busy} className="w-full">
              Email me a sign-in link
            </Button>
            {error && <p className="text-sm text-danger">{error}</p>}
            <p className="text-center text-xs text-ink-3">
              No password. We email you a one-time link.
            </p>
          </form>
        )}
      </Card>
    </main>
  )
}
