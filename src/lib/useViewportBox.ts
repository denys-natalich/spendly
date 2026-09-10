import { useEffect, useState } from 'react'

interface Box {
  top: number
  height: number
}

/**
 * The area actually visible above the software keyboard.
 *
 * iOS does not shrink the layout viewport when the keyboard opens — `100dvh`
 * still reports the full screen — so a bottom-anchored sheet ends up underneath
 * it. `visualViewport` is the only thing that reports the truth, and it moves
 * on scroll as well as resize.
 */
export function useViewportBox(active: boolean): Box {
  const [box, setBox] = useState<Box>(() => ({
    top: 0,
    height: typeof window === 'undefined' ? 0 : window.innerHeight,
  }))

  useEffect(() => {
    if (!active) return
    const vv = window.visualViewport
    if (!vv) {
      setBox({ top: 0, height: window.innerHeight })
      return
    }
    const update = () => setBox({ top: vv.offsetTop, height: vv.height })
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [active])

  return box
}
