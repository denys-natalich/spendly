import { useCallback, useEffect, useState } from 'react'
import { Lock, ScanFace } from 'lucide-react'
import { hasBiometric, unlockWithBiometric, verifyPin, PIN_LENGTH } from '../lib/lock'
import { useStore } from '../store'
import { Button, Card, DigitInput } from './ui'

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { signOut } = useStore()
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPin, setShowPin] = useState(!hasBiometric())

  const face = hasBiometric()

  const tryBiometric = useCallback(async () => {
    setBusy(true)
    setError(null)
    const ok = await unlockWithBiometric()
    setBusy(false)
    if (ok) onUnlock()
    else {
      setError('Face ID did not match. Use your PIN instead.')
      setShowPin(true)
    }
  }, [onUnlock])

  const submitPin = useCallback(async (value: string) => {
    setBusy(true)
    const ok = await verifyPin(value)
    setBusy(false)
    if (ok) onUnlock()
    else {
      setError('Wrong PIN.')
      setPin('')
    }
  }, [onUnlock])

  // Nothing behind the curtain should reach the screenshot the OS takes when
  // the app is backgrounded.
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  return (
    <main className="fixed inset-0 z-100 flex items-center justify-center bg-bg p-5">
      <Card className="w-full max-w-sm p-7 text-center">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-raised text-ink-2">
          <Lock size={22} />
        </span>
        <h1 className="text-lg font-semibold">Spendly is locked</h1>
        <p className="mt-1 mb-6 text-sm text-ink-2">Unlock to see your expenses.</p>

        {face && (
          <Button onClick={tryBiometric} busy={busy} className="mb-3 w-full">
            <ScanFace size={17} /> Unlock with Face ID
          </Button>
        )}

        {showPin ? (
          <div className="space-y-3">
            <DigitInput
              secret
              autoFocus={!face}
              length={PIN_LENGTH}
              label="PIN"
              value={pin}
              onChange={(v) => { setPin(v); setError(null) }}
              onComplete={submitPin}
            />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowPin(true)}
            className="text-sm text-ink-3 hover:text-ink-2"
          >
            Use PIN instead
          </button>
        )}

        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-6 text-xs text-ink-3 hover:text-ink-2"
        >
          Forgot PIN? Sign out and start over
        </button>
      </Card>
    </main>
  )
}
