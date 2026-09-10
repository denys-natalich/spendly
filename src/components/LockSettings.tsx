import { useCallback, useEffect, useState } from 'react'
import { ScanFace, ShieldCheck } from 'lucide-react'
import {
  PIN_LENGTH, biometricSupported, disableLock, dropBiometric, enrollBiometric,
  hasBiometric, markLockPromptSeen, setPin as storePin,
} from '../lib/lock'
import { useStore } from '../store'
import { Button, Card, DigitInput, SectionTitle, Sheet } from './ui'

/** Shared by the Settings section and the one-time prompt after first sign-in. */
export function LockSetupSheet({ open, onClose, onEnabled }: {
  open: boolean
  onClose: () => void
  onEnabled: () => void
}) {
  const { session } = useStore()
  const [stage, setStage] = useState<'choose' | 'confirm' | 'face'>('choose')
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [faceAvailable, setFaceAvailable] = useState(false)

  useEffect(() => {
    if (!open) return
    setStage('choose')
    setFirst('')
    setSecond('')
    setError(null)
    setBusy(false)
    void biometricSupported().then(setFaceAvailable)
  }, [open])

  const onFirstComplete = useCallback((v: string) => {
    setFirst(v)
    setStage('confirm')
  }, [])

  const onSecondComplete = useCallback(async (v: string) => {
    if (v !== first) {
      setError('Those PINs do not match.')
      setSecond('')
      setFirst('')
      setStage('choose')
      return
    }
    setBusy(true)
    await storePin(v)
    markLockPromptSeen()
    setBusy(false)
    onEnabled()
    // Face ID is optional; the PIN alone is already a working lock.
    if (faceAvailable) setStage('face')
    else onClose()
  }, [first, faceAvailable, onEnabled, onClose])

  async function addFace() {
    setBusy(true)
    const ok = await enrollBiometric(session?.user.email ?? 'Spendly')
    setBusy(false)
    if (!ok) setError('Face ID setup was cancelled or is unavailable. Your PIN still works.')
    else onClose()
  }

  return (
    <Sheet open={open} title="App lock" onClose={onClose}>
      {stage === 'face' ? (
        <div className="space-y-4 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-raised text-ink-2">
            <ScanFace size={22} />
          </span>
          <p className="text-sm text-ink-2">
            PIN set. Add Face ID so you can unlock with a glance — your PIN stays as the fallback.
          </p>
          {error && <p className="text-sm text-danger">{error}</p>}
          <Button onClick={addFace} busy={busy} className="w-full">
            <ScanFace size={17} /> Turn on Face ID
          </Button>
          <button type="button" onClick={onClose} className="text-sm text-ink-3 hover:text-ink-2">
            Not now
          </button>
        </div>
      ) : (
        <div className="space-y-4 text-center">
          <p className="text-sm text-ink-2">
            {stage === 'choose'
              ? `Choose a ${PIN_LENGTH}-digit PIN. You'll need it whenever you come back to the app.`
              : 'Enter it once more to confirm.'}
          </p>
          <DigitInput
            secret
            autoFocus
            key={stage}
            length={PIN_LENGTH}
            label={stage === 'choose' ? 'New PIN' : 'Confirm PIN'}
            value={stage === 'choose' ? first : second}
            onChange={(v) => {
              setError(null)
              if (stage === 'choose') setFirst(v)
              else setSecond(v)
            }}
            onComplete={stage === 'choose' ? onFirstComplete : onSecondComplete}
          />
          {busy && <p className="text-xs text-ink-3">Saving…</p>}
          {error && <p className="text-sm text-danger">{error}</p>}
          <p className="text-xs leading-relaxed text-ink-3">
            The PIN is stored on this device only, as a salted hash — never sent anywhere. Forgetting
            it means signing in by email again, which is harmless.
          </p>
        </div>
      )}
    </Sheet>
  )
}

export function LockSettings({ enabled, onEnable, onDisable }: {
  enabled: boolean
  onEnable: () => void
  onDisable: () => void
}) {
  const { session } = useStore()
  const [sheet, setSheet] = useState(false)
  const [face, setFace] = useState(hasBiometric)
  const [faceAvailable, setFaceAvailable] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => { void biometricSupported().then(setFaceAvailable) }, [])

  async function toggleFace() {
    setBusy(true)
    if (face) {
      dropBiometric()
      setFace(false)
    } else if (await enrollBiometric(session?.user.email ?? 'Spendly')) {
      setFace(true)
    }
    setBusy(false)
  }

  return (
    <section>
      <SectionTitle>App lock</SectionTitle>
      <Card className="divide-y divide-line">
        {enabled ? (
          <>
            <div className="flex items-center gap-3 p-4">
              <ShieldCheck size={18} className="shrink-0 text-good" />
              <span className="flex-1 text-sm">
                Locked with a {PIN_LENGTH}-digit PIN
                {face && ' and Face ID'}
              </span>
            </div>
            {faceAvailable && (
              <div className="flex items-center justify-between gap-3 p-4">
                <span className="text-sm text-ink-2">Face ID</span>
                <Button variant="subtle" busy={busy} onClick={toggleFace}>
                  {face ? 'Remove' : 'Turn on'}
                </Button>
              </div>
            )}
            <div className="flex gap-2 p-4">
              <Button variant="subtle" className="flex-1" onClick={() => setSheet(true)}>
                Change PIN
              </Button>
              <Button
                variant="danger"
                className="flex-1"
                onClick={() => { disableLock(); setFace(false); onDisable() }}
              >
                Turn off
              </Button>
            </div>
          </>
        ) : (
          <div className="space-y-3 p-4">
            <p className="text-sm text-ink-2">
              Require Face ID or a PIN every time you come back to the app.
            </p>
            <Button className="w-full" onClick={() => setSheet(true)}>
              Turn on app lock
            </Button>
          </div>
        )}
      </Card>

      <LockSetupSheet
        open={sheet}
        onClose={() => { setSheet(false); setFace(hasBiometric()) }}
        onEnabled={onEnable}
      />
    </section>
  )
}
