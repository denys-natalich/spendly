import { initialOf } from '../lib/format'

/**
 * A traveller's monogram in their trip colour. Travellers are names rather than
 * accounts, so there is no photo to fall back from — the letter is the avatar.
 */
export function TravellerBadge({ name, color, size = 36 }: {
  name: string
  color: string
  size?: number
}) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-semibold"
      style={{
        width: size,
        height: size,
        fontSize: Math.round(size * 0.4),
        background: `color-mix(in oklab, ${color} 18%, transparent)`,
        color,
      }}
    >
      {initialOf(name)}
    </span>
  )
}
