# Spendly

A multi-currency expense tracker, installable as a PWA. Log spending in **EUR, USD or UAH**;
totals are held in **euro** using the official rate from the day the expense happened, and can be
read back in any of the three currencies from a switch on the overview.

- **Overview** — monthly total, month-over-month change, spend per day, a category donut with a
  ranked breakdown, and a 12-month trend. A €/$/₴ switch restates every figure on the screen.
- **Expenses** — day-grouped list with search and category filter; tap any row to edit or delete.
- **Categories** — eight to start with; add your own with an icon and a colour.
- **Settings** — password, app lock, Monefy import, theme (system / light / dark), today's rates, account.

Stack: React 19 + Vite + Tailwind v4, Recharts, Supabase (Postgres + password auth), `vite-plugin-pwa`.

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

### 4. Create your account

Sign-in is **email + password**, with no email sent at any point. Under
**Authentication → Users → Add user**, create yourself an account with a password, and tick
*Auto Confirm User* so it doesn't wait on an email that will never arrive.

Every emailed sign-in flow breaks somewhere here, which is why there isn't one:

- Magic links get pre-fetched by mail scanners, which spends the single-use token before you click
  it — the `otp_expired` error.
- On iOS a link always opens in the browser, never in an installed home-screen app. Those have
  separate storage, so the installed app could never end up signed in.
- Supabase only allows editing the email template once custom SMTP is configured, so a 6-digit code
  can't be put into the message either.

A password is typed inside the app, on the device that needs the session, with nothing in between.

If your account already exists without a password — created by magic link before the switch — sign
in on a device that still has a live session and use **Settings → Password → Set a password**.

### 5. Close the door

Once your account exists, turn off **Authentication → Sign In / Providers → Email → Allow new users
to sign up**. Anyone can read the publishable key out of the deployed bundle; without this they can
register against your project and burn its quota. Row level security keeps their data separate from
yours either way.

### 6. Run it

```bash
npm install
npm run dev
```

Open the URL it prints and sign in. The first sign-in creates a starter set of categories
automatically.

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
> from inside the installed app, not before installing. iOS Keychain will offer to save the password
> and autofill it there. Installing also escapes Safari's seven-day storage eviction, which is why
> it keeps you signed in and a bookmark doesn't.

---

## Reading totals in another currency

The switch on the overview changes the currency every total, chart and axis is drawn in. Storage is
unaffected — amounts are always held as entered, plus a euro figure derived from the day's rate.

Conversion uses the rate from the day the money was spent, not today's. Hryvnia spending from 2021
therefore reads as the hryvnia actually paid, rather than what that euro amount would buy after the
currency moved. An expense already in the currency being displayed shows its stored amount
untouched, since the euro figure is rounded to two decimals and a round trip would drift by a
kopiyka.

## App lock

Optional, per device, set up in **Settings → App lock**. Once on, the app covers itself whenever it
leaves the foreground and needs Face ID to come back.

There is deliberately **no PIN**. WebAuthn is asked for `userVerification: 'required'`, so when
biometrics fail the device offers its own passcode — a second secret of our own would only add a
weaker path to the same door. A platform credential is registered on the device, and unlocking
requires the browser to produce an assertion, which it will not do without a successful check. The
signature isn't verified server-side, because there's no server-side secret behind the gate.

**What it is and isn't.** It's a privacy curtain: it stops someone holding your unlocked phone from
reading your finances. It does not encrypt the Supabase session, so an attacker with developer tools
on an unlocked device could get past it. On iOS, where an installed web app has neither an address
bar nor an inspector, that's a high bar.

---

## Importing from Monefy

**Settings → Import** takes a Monefy CSV export. It parses the file, shows you what it found and how
each Monefy category maps onto yours, and writes nothing until you confirm.

Three things it handles that a naive importer wouldn't:

- **Historical rates.** Rather than one API call per day, it pulls the whole daily series from NBU's
  range endpoint — two requests for five years — and caches every day in `fx_rates`. Each imported
  expense then converts at the rate from the day it happened, not today's.
- **Duplicates, by count.** Two identical ₴10 bus fares on the same day are two real expenses, so
  matching on content alone would wrongly drop one. It compares how many times each
  (date, category, amount, note) appears in the file against how many are already stored, and
  inserts only the excess. Re-running an import is therefore safe.
- **Missing categories.** Names that match an existing category are reused; the rest are created,
  spread across the least-used palette slots so the donut stays readable.

Monefy's header repeats the word `currency` twice, so fields are read by position, not by name.
Income rows and currencies other than EUR/USD/UAH are skipped and reported rather than guessed at.

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
    lock.ts            WebAuthn platform credential, device-local
    convert.ts         restates expenses in the display currency
    useAppLock.ts      locks on leaving the foreground
  components/
    Overview.tsx  Expenses.tsx  Categories.tsx  Settings.tsx
    Login.tsx  LockScreen.tsx  LockSettings.tsx  PasswordSettings.tsx
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
