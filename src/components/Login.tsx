import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Wallet } from 'lucide-react'
import { useStore } from '../store'
import { Button, Card, DigitInput, inputClass } from './ui'

const RESEND_SECONDS = 45

export function Login() {
  const { sendCode, verifyCode } = useStore()
  const [email, setEmail] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  async function request(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await sendCode(email.trim())
      setStep('code')
      setCode('')
      setCooldown(RESEND_SECONDS)
    } catch (err) {
      setError(message(err))
    } finally {
      setBusy(false)
    }
  }

  const submit = useCallback(async (value: string) => {
    setBusy(true)
    setError(null)
    try {
      await verifyCode(email.trim(), value)
      // On success the auth listener swaps this screen out; nothing to do here.
    } catch (err) {
      setError(message(err))
      setCode('')
      setBusy(false)
    }
  }, [email, verifyCode])

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
              {step === 'email'
                ? 'Track spending in €, $ and ₴ — everything reported in euro.'
                : <>We sent a 6-digit code to <span className="font-medium text-ink">{email}</span>.</>}
            </p>
          </div>
        </div>

        {step === 'email' ? (
          <form onSubmit={request} className="space-y-3">
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
              Send me a code
            </Button>
            {error && <p className="text-sm text-danger">{error}</p>}
            <p className="text-center text-xs text-ink-3">
              No password. We email you a one-time code.
            </p>
          </form>
        ) : (
          <div className="space-y-4">
            <DigitInput
              autoFocus
              label="6-digit code"
              value={code}
              onChange={setCode}
              onComplete={submit}
            />
            {error && <p className="text-center text-sm text-danger">{error}</p>}
            <Button onClick={() => submit(code)} busy={busy} disabled={code.length < 6} className="w-full">
              Sign in
            </Button>
            <div className="flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => { setStep('email'); setCode(''); setError(null) }}
                className="text-ink-3 hover:text-ink-2"
              >
                Wrong address?
              </button>
              <button
                type="button"
                onClick={() => request()}
                disabled={cooldown > 0 || busy}
                className="font-medium text-accent hover:underline disabled:text-ink-3 disabled:no-underline"
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </button>
            </div>
          </div>
        )}
      </Card>
    </main>
  )
}

function message(err: unknown): string {
  const raw = err instanceof Error ? err.message : ''
  if (/expired|invalid/i.test(raw)) return 'That code is wrong or has expired. Request a new one.'
  if (/rate limit|too many|after \d+ seconds/i.test(raw)) return 'Too many attempts. Wait a minute and try again.'
  if (/signups not allowed|not allowed for otp/i.test(raw)) return 'Sign-ups are closed for this app.'
  return raw || 'Something went wrong. Try again.'
}
