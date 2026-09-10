# Spendly

A multi-currency expense tracker, installable as a PWA. Log spending in **EUR, USD or UAH**;
everything is reported in **euro** using the official rate from the day the expense happened.

- **Overview** — monthly total, month-over-month change, spend per day, a category donut with a
  ranked breakdown, and a 12-month trend.
- **Expenses** — day-grouped list with search and category filter; tap any row to edit or delete.
- **Categories** — eight to start with; add your own with an icon and a colour.
- **Settings** — theme (system / light / dark), today's rates, account.

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

### 4. Allow the sign-in redirect

Under **Authentication → URL Configuration**, add your dev and production origins to
*Redirect URLs* (e.g. `http://localhost:5173` and `https://your-app.vercel.app`).
Without this the magic link bounces.

### 5. Run it

```bash
npm install
npm run dev
```

Open the URL it prints, enter your email, and click the link Supabase sends you. The first sign-in
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
> `localhost`.

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
