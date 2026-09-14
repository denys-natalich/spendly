import { useStore } from '../store'
import { initialsFor } from '../lib/avatar'

export function Avatar({ size = 32, className = '' }: { size?: number; className?: string }) {
  const { identity, avatarUrl } = useStore()
  const initials = initialsFor(identity?.email ?? undefined)

  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full
                  bg-raised text-ink-2 select-none ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" width={size} height={size} className="h-full w-full object-cover" />
      ) : (
        <span className="font-semibold">{initials}</span>
      )}
    </span>
  )
}
