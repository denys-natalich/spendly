import { useState, type FormEvent } from 'react'
import { Eye, EyeOff, Wallet } from 'lucide-react'
import { useStore } from '../store'
import { Button, Card, inputClass } from './ui'

export function Login() {
  const { signIn } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
      // The auth listener swaps this screen out on success.
    } catch (err) {
      setError(message(err))
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

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email"
            required
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            aria-label="Email address"
            className={`${inputClass} w-full`}
          />
          <div className="relative">
            <input
              type={reveal ? 'text' : 'password'}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              aria-label="Password"
              className={`${inputClass} w-full pr-11`}
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              aria-label={reveal ? 'Hide password' : 'Show password'}
              className="absolute top-1/2 right-2 -translate-y-1/2 rounded-lg p-2 text-ink-3 hover:text-ink-2"
            >
              {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>

          <Button type="submit" busy={busy} className="w-full">
            Sign in
          </Button>

          {error && <p className="text-sm text-danger">{error}</p>}

          <p className="text-center text-xs leading-relaxed text-ink-3">
            One account, yours. Forgotten password? Reset it from the Supabase
            dashboard for this project.
          </p>
        </form>
      </Card>
    </main>
  )
}

function message(err: unknown): string {
  const raw = err instanceof Error ? err.message : ''
  if (/invalid login credentials/i.test(raw)) {
    return "That email and password don't match an account. If this account was created without a password, sign in on a device where you're already signed in and set one in Settings."
  }
  if (/email not confirmed/i.test(raw)) return 'This account still needs its email confirmed.'
  if (/rate limit|too many/i.test(raw)) return 'Too many attempts. Wait a minute and try again.'
  return raw || 'Something went wrong. Try again.'
}
