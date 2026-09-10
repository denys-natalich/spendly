import { useCallback, useEffect, useState } from 'react'

export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'spendly.theme'

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'light' || v === 'dark' ? v : 'system'
  } catch {
    return 'system'
  }
}

function apply(choice: ThemeChoice) {
  const root = document.documentElement
  if (choice === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', choice)
}

export function initTheme() {
  apply(read())
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(read)

  useEffect(() => { apply(choice) }, [choice])

  const set = useCallback((c: ThemeChoice) => {
    setChoice(c)
    try { localStorage.setItem(KEY, c) } catch { /* private mode — session only */ }
  }, [])

  return [choice, set]
}
