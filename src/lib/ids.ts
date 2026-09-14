/**
 * Row ids are minted on the device, not by the database.
 *
 * An expense written with no connection still needs an identity the moment it
 * exists: the list renders it, an edit finds it again, and the sync that
 * happens hours later has to insert *that* row rather than a new one. A uuid
 * from here is the same shape the `uuid` primary keys already use, so a row
 * created offline is indistinguishable from one the server defaulted.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Older WebViews expose getRandomValues but not randomUUID.
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant 1
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
