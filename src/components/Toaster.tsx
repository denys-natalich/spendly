import { CircleCheck } from 'lucide-react'
import { useToast } from '../lib/toast'

/**
 * Under the header on phones — the bottom is already taken by the tab bar and
 * the add button — and bottom-centre on desktop. The live region stays mounted
 * so screen readers announce each message as it arrives.
 */
export function Toaster() {
  const current = useToast()
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.25rem)] z-50
                 flex justify-center px-4 md:top-auto md:bottom-6"
    >
      {current && (
        <div
          key={current.id}
          className="flex items-center gap-2 rounded-full border border-line bg-surface px-4 py-2 text-sm
                     font-medium text-ink shadow-lg shadow-black/10 motion-safe:animate-[toast-in_160ms_ease-out]"
        >
          <CircleCheck size={16} className="shrink-0 text-good" />
          {current.message}
        </div>
      )}
    </div>
  )
}
