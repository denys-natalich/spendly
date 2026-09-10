# Spendly

A multi-currency expense tracker, installable as a PWA. Log spending in **EUR, USD or UAH**;
everything is reported in **euro** using the official rate from the day the expense happened.

- **Overview** — monthly total, month-over-month change, spend per day, a category donut with a
  ranked breakdown, and a 12-month trend.
- **Expenses** — day-grouped list with search and category filter; tap any row to edit or delete.
- **Categories** — eight to start with; add your own with an icon and a colour.
- **Settings** — app lock, theme (system / light / dark), today's rates, account.

Stack: React 19 + Vite + Tailwind v4, Recharts, Supabase (Postgres + magic-link auth), `vite-plugin-pwa`.

---

## Setup

### 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project (free tier is plenty).
   Pick a region close to you — `eu-central` if you're in Europe.
2. Wait for it to finish provisioning (~2 minutes).

### 2. Create the tables

Open **SQL Editor → New query**, paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql),
and run it. It creates three tables (`categories`, `expenses`, `fx_rates`), turns on row level
security, and adds policies so you can only ever read and write your own rows.

Safe to re-run — every statement is guarded.

### 3. Point the app at your project

In Supabase go to **Project Settings → API** and copy the *Project URL* and the *anon public* key.
Then, in the project root:

```bash
cp .env.example .env.local
```

and fill in:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-public-key
```

The anon key is safe to ship in a client bundle — row level security is what protects your data.

### 4. Switch the sign-in email to a code

Sign-in uses a **6-digit code**, not a magic link. Under **Authentication → Emails → Magic Link**,
replace the template body with something that includes `{{ .Token }}`:

```html
<h2>Your Spendly code</h2>
<p style="font-size:28px;letter-spacing:6px"><strong>{{ .Token }}</strong></p>
<p>It expires in an hour. If you didn't ask for it, ignore this email.</p>
```

Two reasons this beats a link. Mail providers pre-fetch links to scan them, which spends the
single-use token before you ever click it — the `otp_expired` error. And on iOS a link always opens
in the browser, never in an installed home-screen app, so the session would land in the wrong
storage and the installed app would stay signed out.

### 5. Allow the sign-in origins

Under **Authentication → URL Configuration**:

- **Site URL** → your production URL
- **Redirect URLs** → add `http://localhost:5173/**` for local development

Codes don't strictly need a redirect entry, but Supabase falls back to Site URL for anything
link-shaped, so it's worth setting correctly.

### 6. Run it

```bash
npm install
npm run dev
```

Open the URL it prints, enter your email, and type the code Supabase sends you. The first sign-in
creates a starter set of categories automatically.

---

## Deploying

```bash
npm run build     # outputs dist/
```

`dist/` is a static site — drop it on Vercel, Netlify, Cloudflare Pages or GitHub Pages. Set the two
`VITE_SUPABASE_*` variables in the host's environment settings, and add the deployed origin to
Supabase's redirect URLs.

### Installing on your phone

Open the deployed URL in Safari (iOS) or Chrome (Android) and choose **Add to Home Screen**. It then
runs full-screen with its own icon and works offline for browsing already-loaded data. A service
worker keeps the app shell cached; new expenses still need a connection.

> iOS only offers "Add to Home Screen" over HTTPS, so install from the deployed URL rather than
> `localhost`. An installed web app has its own storage, separate from Safari's — so sign in once
> from inside the installed app, not before installing. It also escapes Safari's seven-day storage
> eviction, which is why installing keeps you signed in and bookmarking doesn't.

---

## App lock

Optional, per device, set up in **Settings → App lock**. Once on, the app covers itself whenever it
leaves the foreground and needs Face ID (or a 4-digit PIN) to come back.

Face ID goes through WebAuthn: a platform credential is registered on the device, and unlocking
requires the browser to produce an assertion — which it will not do without a successful biometric
or device-passcode check. The signature isn't verified server-side, because there's no server-side
secret behind the gate.

**What it is and isn't.** It's a privacy curtain: it stops someone holding your unlocked phone from
reading your finances. It does not encrypt the Supabase session, so an attacker with developer tools
on an unlocked device could get past it. On iOS, where an installed web app has neither an address
bar nor an inspector, that's a high bar. The PIN is stored only as a PBKDF2-SHA256 hash with a random
salt, never transmitted. Forgetting it costs you a sign-out and one email code.

---

## How currency conversion works

Rates come from the [National Bank of Ukraine](https://bank.gov.ua) — official, free, no API key,
and published for every calendar day including weekends. It quotes UAH per unit, so the euro base is
derived: `USD per EUR = (UAH per EUR) / (UAH per USD)`. If NBU is unreachable, today's rate falls
back to `open.er-api.com`.

Two things make historical totals trustworthy:

1. Every day the app touches is written to the shared `fx_rates` table, so each date is fetched from
   the network at most once.
2. Each expense stores `rate_to_eur` — the rate on the day it was spent — and `amount_eur` is a
   generated column derived from it. Rates moving next month never rewrites last month's charts.

---

## Project layout

```
src/
  store.tsx            auth session + all data loading and mutations
  types.ts             Currency, Category, Expense, BASE_CURRENCY
  lib/
    supabase.ts        client (falls back to a setup screen if unconfigured)
    fx.ts              NBU fetch, rate cache, EUR conversion
    analytics.ts       month/category/trend selectors
    format.ts          money, date and month formatting
    icons.ts           category icon set + validated colour palette slots
    theme.ts           system / light / dark preference
  components/
    Overview.tsx  Expenses.tsx  Categories.tsx  Settings.tsx
    ExpenseSheet.tsx   add / edit / delete an expense
    charts.tsx         donut + monthly trend (Recharts)
    ui.tsx             Card, Button, Field, Sheet, Segmented, …
supabase/schema.sql    tables, RLS policies
```

### Chart colours

`--series-1` … `--series-7` in `src/index.css` are a fixed, validated categorical palette: the slot
order is what keeps adjacent hues distinguishable for colourblind readers, so **don't reorder or
cycle it**. Categories store a slot index, so a category keeps its colour no matter how a chart is
filtered or sorted. Both light and dark steps were checked for CVD separation and contrast.

## Possible next steps

Not built, in rough order of usefulness: monthly budgets per category, recurring expenses,
CSV export/import, receipt photos (Supabase Storage), and code-splitting the charts bundle.
