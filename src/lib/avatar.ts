import { supabase } from './supabase'
import { localDelete, localGet, localPut } from './db'

const BUCKET = 'avatars'
const SIZE = 256
const SIGNED_URL_TTL = 60 * 60 // seconds

function pathFor(userId: string): string {
  return `${userId}/avatar.jpg`
}

/**
 * Centre-crops to a square and scales to 256px before upload.
 *
 * A phone photo is several megabytes; an avatar rendered at 36 CSS pixels needs
 * none of that. Doing it client-side keeps uploads at ~20 KB and means the app
 * never holds a full-resolution copy of someone's photo library.
 */
async function toSquareJpeg(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  const edge = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - edge) / 2
  const sy = (bitmap.height - edge) / 2

  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Could not process that image.')
  ctx.drawImage(bitmap, sx, sy, edge, edge, 0, 0, SIZE, SIZE)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.85),
  )
  if (!blob) throw new Error('Could not process that image.')
  return blob
}

export async function uploadAvatar(userId: string, file: File): Promise<string> {
  let blob: Blob
  try {
    blob = await toSquareJpeg(file)
  } catch {
    // Mostly HEIC on a browser that can't decode it.
    throw new Error("That image couldn't be read. Try a JPEG or PNG.")
  }

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(pathFor(userId), blob, { contentType: 'image/jpeg', upsert: true })
  if (error) throw error

  const url = await getAvatarUrl(userId)
  if (!url) throw new Error('Uploaded, but the image could not be loaded back.')
  return url
}

/**
 * Signed rather than public: the bucket is private, so the URL is short-lived.
 *
 * Short-lived is also why the picture is kept on the device as well — a signed
 * URL cannot be minted without a connection, and an avatar that vanishes the
 * moment the signal does looks like a bug rather than a network state.
 */
export async function getAvatarUrl(userId: string): Promise<string | null> {
  if (!navigator.onLine) return cachedAvatar(userId)
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(pathFor(userId), SIGNED_URL_TTL)
  if (error || !data) return cachedAvatar(userId)
  // Defeat the browser cache after a replacement, which reuses the same path.
  const url = `${data.signedUrl}&v=${Date.now()}`
  void cacheAvatar(userId, url)
  return url
}

export async function removeAvatar(userId: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).remove([pathFor(userId)])
  if (error) throw error
  await localDelete('meta', `avatar:${userId}`)
}

/** Kept as a data URL: an object URL would not survive a reload, and this is ~20 KB. */
async function cacheAvatar(userId: string, url: string): Promise<void> {
  try {
    const res = await fetch(url)
    if (!res.ok) return
    const blob = await res.blob()
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    await localPut('meta', { key: `avatar:${userId}`, dataUrl })
  } catch {
    /* The monogram is a perfectly good fallback. */
  }
}

async function cachedAvatar(userId: string): Promise<string | null> {
  const row = await localGet<{ dataUrl: string }>('meta', `avatar:${userId}`)
  return row?.dataUrl ?? null
}

/** Fallback monogram when there's no photo. */
export function initialsFor(email: string | undefined): string {
  const name = (email ?? '').split('@')[0]
  const parts = name.split(/[._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
