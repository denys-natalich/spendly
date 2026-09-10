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

/** Slots index the validated categorical palette; slot order is never cycled. */
export const COLOR_SLOTS = [1, 2, 3, 4, 5, 6, 7] as const

export function slotColor(slot: number): string {
  return `var(--series-${Math.min(Math.max(slot, 1), 7)})`
}

export const UNCATEGORISED_COLOR = 'var(--series-other)'
