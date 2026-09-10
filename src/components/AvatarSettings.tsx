import { useRef, useState } from 'react'
import { Camera, Trash2 } from 'lucide-react'
import { useStore } from '../store'
import { Avatar } from './Avatar'
import { Button } from './ui'

export function AvatarSettings() {
  const { session, avatarUrl, setAvatar, clearAvatar } = useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function pick(file: File) {
    setBusy(true)
    setError(null)
    try {
      await setAvatar(file)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not upload that photo.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function remove() {
    setBusy(true)
    setError(null)
    try {
      await clearAvatar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the photo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          aria-label={avatarUrl ? 'Change photo' : 'Add a photo'}
          className="group relative rounded-full focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-accent disabled:opacity-60"
        >
          <Avatar size={64} />
          <span
            className="absolute -right-0.5 -bottom-0.5 flex h-7 w-7 items-center justify-center rounded-full
                       border-2 border-surface bg-accent text-accent-in"
          >
            <Camera size={13} />
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{session?.user.email ?? '—'}</p>
          <div className="mt-1.5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="text-xs font-medium text-accent hover:underline disabled:opacity-50"
            >
              {busy ? 'Working…' : avatarUrl ? 'Change photo' : 'Add a photo'}
            </button>
            {avatarUrl && (
              <Button variant="danger" onClick={remove} busy={busy} className="!px-2 !py-1 !text-xs">
                <Trash2 size={13} /> Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void pick(f) }}
      />
    </div>
  )
}
