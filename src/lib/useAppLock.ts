import { useCallback, useEffect, useState } from 'react'
import { isLockEnabled } from './lock'

/**
 * Locks whenever the app leaves the foreground, so returning to it always costs
 * one Face ID glance. Re-reads the stored config on demand because Settings can
 * turn the lock on or off while the app is running.
 */
export function useAppLock(signedIn: boolean) {
  const [enabled, setEnabled] = useState(isLockEnabled)
  const [locked, setLocked] = useState(isLockEnabled)

  const refresh = useCallback(() => setEnabled(isLockEnabled()), [])

  useEffect(() => {
    if (!signedIn || !enabled) return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setLocked(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [signedIn, enabled])

  // Signing out re-arms the lock for whoever signs in next on this device.
  useEffect(() => {
    if (!signedIn) setLocked(isLockEnabled())
  }, [signedIn])

  const unlock = useCallback(() => setLocked(false), [])

  // Turning the lock on from Settings shouldn't slam the door immediately.
  const enable = useCallback(() => {
    setEnabled(true)
    setLocked(false)
  }, [])

  const disable = useCallback(() => {
    setEnabled(false)
    setLocked(false)
  }, [])

  return { locked: enabled && locked, enabled, unlock, enable, disable, refresh }
}
