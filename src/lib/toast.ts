import { useSyncExternalStore } from 'react'

/*
 * A single confirmation at a time: a new one replaces whatever is showing.
 * Module-level rather than context so a sheet can confirm the change it just
 * made and close in the same breath — the message outlives the component.
 */

export interface Toast {
  id: number
  message: string
}

const DURATION_MS = 2500

let current: Toast | null = null
let seq = 0
let timer: ReturnType<typeof setTimeout> | undefined
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}

export function toast(message: string) {
  current = { id: ++seq, message }
  emit()
  clearTimeout(timer)
  timer = setTimeout(() => {
    current = null
    emit()
  }, DURATION_MS)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useToast(): Toast | null {
  return useSyncExternalStore(subscribe, () => current)
}
