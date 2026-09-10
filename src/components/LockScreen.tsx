import { useCallback, useEffect, useState } from 'react'
import { Lock, ScanFace } from 'lucide-react'
import { unlock as attemptUnlock } from '../lib/lock'
import { useStore } from '../store'
import { Button, Card } from './ui'

export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const { signOut } = useStore()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const tryUnlock = useCallback(async () => {
    setBusy(true)
    setFailed(false)
    const ok = await attemptUnlock()
    setBusy(false)
    if (ok) onUnlock()
    else setFailed(true)
  }, [onUnlock])

  // Nothing behind the curtain should be scrollable while it is up.
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

        <Button onClick={tryUnlock} busy={busy} className="w-full">
          <ScanFace size={17} /> Unlock
        </Button>

        {failed && (
          <p className="mt-3 text-sm text-danger">
            That didn't work. Try again, or sign out and start over.
          </p>
        )}

        <button
          type="button"
          onClick={() => void signOut()}
          className="mt-6 text-xs text-ink-3 hover:text-ink-2"
        >
          Sign out instead
        </button>
      </Card>
    </main>
  )
}
