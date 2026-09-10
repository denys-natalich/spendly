import { Card } from './ui'

/** Shown instead of a blank screen when the Supabase env vars are missing. */
export function Setup() {
  return (
    <main className="mx-auto max-w-xl p-6">
      <Card className="space-y-4 p-6 text-sm leading-relaxed">
        <h1 className="text-lg font-semibold">Connect Supabase to finish setup</h1>
        <p className="text-ink-2">
          Create a project at <span className="font-medium">supabase.com</span>, run{' '}
          <code className="rounded bg-raised px-1.5 py-0.5 text-xs">supabase/schema.sql</code> in its SQL editor,
          then create a <code className="rounded bg-raised px-1.5 py-0.5 text-xs">.env.local</code> file in the
          project root:
        </p>
        <pre className="overflow-x-auto rounded-xl bg-raised p-4 text-xs">
{`VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key`}
        </pre>
        <p className="text-ink-2">
          Both values are in the Supabase dashboard under <span className="font-medium">Project Settings → API</span>.
          Restart <code className="rounded bg-raised px-1.5 py-0.5 text-xs">npm run dev</code> afterwards.
        </p>
      </Card>
    </main>
  )
}
