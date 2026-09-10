/*
 * Device-local app lock.
 *
 * This is a privacy curtain, not a vault. It stops someone holding your
 * unlocked phone from reading your finances; it does not encrypt the Supabase
 * session, so an attacker with developer tools on an unlocked device could get
 * past it. On iOS — where an installed web app has no address bar and no
 * inspector — that is a high bar, which is the trade this is built for.
 *
 * The Face ID path is WebAuthn: we register a platform credential and then
 * require a successful assertion to unlock. The signature is never checked
 * server-side, because there is no secret behind the gate to protect — the
 * point is that the browser will not produce an assertion at all without a
 * successful biometric or device-passcode check.
 */

const PIN_KEY = 'spendly.lock.pin'
const CRED_KEY = 'spendly.lock.credential'
const PROMPTED_KEY = 'spendly.lock.prompted'

const ITERATIONS = 210_000

export const PIN_LENGTH = 4

interface PinRecord {
  salt: string
  hash: string
  iterations: number
}

/* ---------- storage helpers (private browsing can throw on every access) ---- */

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* Private mode — the lock simply won't persist. */
  }
}

function remove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

/* ---------- base64url ------------------------------------------------------ */

function toB64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function fromB64(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  return Uint8Array.from(bin, (c) => c.charCodeAt(0))
}

/* ---------- PIN ------------------------------------------------------------ */

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  )
  return toB64(bits)
}

export function isLockEnabled(): boolean {
  return read(PIN_KEY) !== null
}

export async function setPin(pin: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(pin, salt, ITERATIONS)
  const record: PinRecord = { salt: toB64(salt.buffer as ArrayBuffer), hash, iterations: ITERATIONS }
  write(PIN_KEY, JSON.stringify(record))
}

export async function verifyPin(pin: string): Promise<boolean> {
  const raw = read(PIN_KEY)
  if (!raw) return false
  try {
    const record = JSON.parse(raw) as PinRecord
    const hash = await derive(pin, fromB64(record.salt), record.iterations)
    return hash === record.hash
  } catch {
    return false
  }
}

export function disableLock(): void {
  remove(PIN_KEY)
  remove(CRED_KEY)
}

/* ---------- Face ID / Touch ID via WebAuthn -------------------------------- */

export async function biometricSupported(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
  } catch {
    return false
  }
}

export function hasBiometric(): boolean {
  return read(CRED_KEY) !== null
}

export async function enrollBiometric(accountLabel: string): Promise<boolean> {
  try {
    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'Spendly', id: location.hostname },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: accountLabel,
          displayName: accountLabel,
        },
        // ES256 first, RS256 as the fallback every platform authenticator takes.
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null
    if (!credential) return false
    write(CRED_KEY, toB64(credential.rawId))
    return true
  } catch {
    return false
  }
}

export function dropBiometric(): void {
  remove(CRED_KEY)
}

export async function unlockWithBiometric(): Promise<boolean> {
  const id = read(CRED_KEY)
  if (!id) return false
  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: fromB64(id) as BufferSource }],
        userVerification: 'required',
        timeout: 60_000,
      },
    })
    return assertion !== null
  } catch {
    // Cancelled, failed, or the credential was removed from the device.
    return false
  }
}

/* ---------- first-run prompt ----------------------------------------------- */

export function lockPromptSeen(): boolean {
  return read(PROMPTED_KEY) === '1'
}

export function markLockPromptSeen(): void {
  write(PROMPTED_KEY, '1')
}
