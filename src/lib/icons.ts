import type { Category } from '../types'

import {
  Baby, BookOpen, Briefcase, Bus, Car, Coffee, CreditCard, Dumbbell, Film, Fuel,
  Gift, GraduationCap, Heart, HeartPulse, House, Music, PawPrint, PiggyBank, Pill,
  Plane, Plug, Repeat, Scissors, Shirt, ShoppingCart, Smartphone, SprayCan, Tag,
  Ticket, TrendingUp, Utensils, Wallet, Wifi, Wrench,
  type LucideIcon,
} from 'lucide-react'

/** The picker's full vocabulary; `categories.icon` stores one of these keys. */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  'shopping-cart': ShoppingCart, utensils: Utensils, coffee: Coffee, bus: Bus,
  car: Car, fuel: Fuel, plane: Plane, house: House, plug: Plug, wifi: Wifi,
  smartphone: Smartphone, 'heart-pulse': HeartPulse, pill: Pill, dumbbell: Dumbbell,
  shirt: Shirt, scissors: Scissors, gift: Gift, film: Film, music: Music,
  'book-open': BookOpen, 'graduation-cap': GraduationCap, baby: Baby,
  'paw-print': PawPrint, wrench: Wrench, briefcase: Briefcase, 'credit-card': CreditCard,
  'piggy-bank': PiggyBank, 'trending-up': TrendingUp, wallet: Wallet, repeat: Repeat,
  heart: Heart, ticket: Ticket, 'spray-can': SprayCan, tag: Tag,
}

export const ICON_KEYS = Object.keys(CATEGORY_ICONS)

export function iconFor(key: string | undefined): LucideIcon {
  return CATEGORY_ICONS[key ?? ''] ?? Tag
}

/**
 * Slots index the validated categorical palette; slot order is never cycled.
 * Eight is the whole palette, not a round number: a ninth categorical hue stops
 * being tellable from the eight already on screen, so the app hands these out
 * rather than growing them.
 */
export const COLOR_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const

export function slotColor(slot: number): string {
  return `var(--series-${Math.min(Math.max(slot, 1), COLOR_SLOTS.length)})`
}

/**
 * The colour a new category gets — the first slot no other category holds, so
 * every category is its own colour for as long as the palette lasts. Past eight
 * the least-used colour comes round again, always the same way for the same set
 * of categories.
 */
export function assignColorSlot(taken: Iterable<number>): number {
  const uses = new Map<number, number>(COLOR_SLOTS.map((s) => [s, 0]))
  for (const slot of taken) uses.set(slot, (uses.get(slot) ?? 0) + 1)
  return COLOR_SLOTS.reduce((best, s) => ((uses.get(s) ?? 0) < (uses.get(best) ?? 0) ? s : best))
}

export const UNCATEGORISED_COLOR = 'var(--series-other)'

/**
 * Colours are the app's to hand out, so two categories sharing one — from the
 * days the colour was picked by hand, or from an import that ran out of slots —
 * is a state to be corrected rather than preserved. The older category keeps
 * its colour and the newer one moves, and only while a free slot exists: past
 * eight categories the palette is genuinely out, and churning them every load
 * would be worse than the collision.
 */
export function recolourCollisions(categories: Category[]): Array<{ id: string; color_slot: number }> {
  const taken = new Set<number>()
  const fixes: Array<{ id: string; color_slot: number }> = []

  for (const c of categories) {
    const valid = (COLOR_SLOTS as readonly number[]).includes(c.color_slot)
    if (valid && !taken.has(c.color_slot)) {
      taken.add(c.color_slot)
      continue
    }
    const free = COLOR_SLOTS.find((s) => !taken.has(s))
    if (free === undefined) continue
    fixes.push({ id: c.id, color_slot: free })
    taken.add(free)
  }
  return fixes
}
