import { useEffect, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2, X } from 'lucide-react'
import { useViewportBox } from '../lib/useViewportBox'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-line bg-surface ${className}`}>{children}</div>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-ink-2 uppercase">{children}</h2>
      {action}
    </div>
  )
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'ghost' | 'danger' | 'subtle'
  busy?: boolean
}

export function Button({ variant = 'primary', busy, className = '', children, disabled, ...rest }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ' +
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-50 disabled:pointer-events-none'
  const styles = {
    primary: 'bg-accent text-accent-in hover:opacity-90',
    subtle: 'bg-raised text-ink hover:bg-line',
    ghost: 'text-ink-2 hover:bg-raised hover:text-ink',
    danger: 'text-danger hover:bg-danger/10',
  }[variant]
  return (
    <button className={`${base} ${styles} ${className}`} disabled={disabled || busy} {...rest}>
      {busy && <Loader2 size={16} className="animate-spin" />}
      {children}
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-ink-3">{hint}</span>}
    </label>
  )
}

/** Width is deliberately absent — set it at the call site. */
export const inputClass =
  'rounded-xl border border-line bg-raised px-3.5 py-2.5 text-sm pointer-coarse:text-base text-ink ' +
  'placeholder:text-ink-3 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30'

export function Segmented<T extends string>({
  value, options, onChange, ariaLabel, compact,
}: {
  value: T
  options: Array<{ value: T; label: ReactNode }>
  onChange: (v: T) => void
  ariaLabel: string
  compact?: boolean
}) {
  return (
    <div role="tablist" aria-label={ariaLabel} className="inline-flex rounded-xl bg-raised p-1">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={value === o.value}
          // Don't steal focus from a text field — on a phone that drops the keyboard.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onChange(o.value)}
          className={`rounded-lg font-medium transition-colors ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'} ${
            value === o.value ? 'bg-surface text-ink shadow-sm' : 'text-ink-3 hover:text-ink-2'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Bottom sheet on phones, centred dialog from `sm` up. */
export function Sheet({ open, title, onClose, children }: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const viewport = useViewportBox(open)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null
  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/45" onClick={onClose} aria-hidden />
      {/* Sized to the visual viewport so the sheet rests on top of the keyboard
          rather than behind it. */}
      <div
        className="pointer-events-none fixed inset-x-0 z-50 flex items-end justify-center sm:items-center"
        style={{ top: viewport.top, height: viewport.height }}
      >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="pointer-events-auto relative max-h-full w-full overflow-y-auto overscroll-contain
                   rounded-t-3xl border border-line bg-surface
                   pb-[env(safe-area-inset-bottom)] sm:max-w-md sm:rounded-3xl sm:pb-0"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-surface px-5 py-3">
          <h2 className="text-base font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-ink-3 hover:bg-raised hover:text-ink"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
      </div>
    </>
  )
}

export function EmptyState({ icon, title, body, action }: {
  icon: ReactNode
  title: string
  body: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
      <div className="text-ink-3">{icon}</div>
      <h3 className="text-base font-semibold">{title}</h3>
      <p className="max-w-xs text-sm text-ink-2">{body}</p>
      {action}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-ink-3">
      <Loader2 size={18} className="animate-spin" />
      {label}
    </div>
  )
}
