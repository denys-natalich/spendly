import { useEffect, useState } from 'react'
import { ScanFace, ShieldCheck } from 'lucide-react'
import { biometricSupported, disableLock, enrollBiometric, markLockPromptSeen } from '../lib/lock'
import { useStore } from '../store'
import { Button, Card, SectionTitle, Sheet } from './ui'

/** Offered once after the first sign-in on a device; also reachable from Settings. */
export function LockSetupSheet({ open, onClose, onEnabled }: {
  open: boolean
  onClose: () => void
  onEnabled: () => void
}) {
  const { session } = useStore()
  const [available, setAvailable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    setBusy(false)
    void biometricSupported().then(setAvailable)
  }, [open])

  async function turnOn() {
    setBusy(true)
    setError(null)
    const ok = await enrollBiometric(session?.user.email ?? 'Spendly')
    setBusy(false)
    markLockPromptSeen()
    if (ok) {
      onEnabled()
      onClose()
    } else {
      setError('That was cancelled, or this device turned it down. Nothing changed.')
    }
  }

  return (
    <Sheet open={open} title="App lock" onClose={() => { markLockPromptSeen(); onClose() }}>
      <div className="space-y-4 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-raised text-ink-2">
          <ScanFace size={22} />
        </span>

        {available === false ? (
          <p className="text-sm text-ink-2">
            This device has no Face ID, Touch ID or equivalent available to the browser, so the lock
            can't be turned on here. It will still work on your phone.
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-2">
              Require Face ID whenever you come back to Spendly, so your finances aren't readable by
              anyone holding your unlocked phone.
            </p>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button onClick={turnOn} busy={busy} disabled={available === null} className="w-full">
              <ScanFace size={17} /> Turn on Face ID
            </Button>
          </>
        )}

        <button
          type="button"
          onClick={() => { markLockPromptSeen(); onClose() }}
          className="text-sm text-ink-3 hover:text-ink-2"
        >
          Not now
        </button>

        <p className="text-xs leading-relaxed text-ink-3">
          If Face ID fails, your device offers its own passcode — that's why there's no separate PIN
          to remember here.
        </p>
      </div>
    </Sheet>
  )
}

export function LockSettings({ enabled, onEnable, onDisable }: {
  enabled: boolean
  onEnable: () => void
  onDisable: () => void
}) {
  const [sheet, setSheet] = useState(false)
  const [available, setAvailable] = useState<boolean | null>(null)

  useEffect(() => { void biometricSupported().then(setAvailable) }, [])

  return (
    <section>
      <SectionTitle>App lock</SectionTitle>
      <Card className="divide-y divide-line">
        {enabled ? (
          <>
            <div className="flex items-center gap-3 p-4">
              <ShieldCheck size={18} className="shrink-0 text-good" />
              <span className="flex-1 text-sm">Face ID required when you return to the app</span>
            </div>
            <div className="p-4">
              <Button
                variant="danger"
                className="w-full"
                onClick={() => { disableLock(); onDisable() }}
              >
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3 p-4">
            <p className="text-sm text-ink-2">
              {available === false
                ? "This device has no Face ID or Touch ID available to the browser, so the lock can't be turned on here."
                : 'Require Face ID every time you come back to the app.'}
            </p>
            <Button className="w-full" disabled={available === false} onClick={() => setSheet(true)}>
              Turn on app lock
            </Button>
          </div>
        )}
      </Card>

      <LockSetupSheet open={sheet} onClose={() => setSheet(false)} onEnabled={onEnable} />
    </section>
  )
}
