# Moneta

A multi-currency money management app — expenses, trips and debts — installable as a PWA. Log spending in **EUR, USD or UAH**;
totals are held in **euro** using the official rate from the day the expense happened, and can be
read back in any of the three currencies from a switch on the overview.

- **Overview** — monthly total, month-over-month change, spend per day, a ranked category
  breakdown, and a 12-month trend. A €/$/₴ switch restates every figure on the screen, and
  tapping a category opens its expenses for the month being viewed.
- **Expenses** — day-grouped list with search, category filter and a date range (last 7 or 30 days,
  a specific month, a custom range, or all time). Amounts lead with the reporting currency; what was
  actually paid sits underneath. Tap any row to edit or delete. A switch beside the ranges regroups
  the same filtered expenses by category — total, count and share each — and tapping a category
  drills back into its expenses for that range.
- **Travel** — trips with the people on them, and expenses recorded against whoever paid. A trip
  shows what it cost, what each person put in, and — if it were split evenly — who is owed and who
  owes. Travel money is held in its own tables, so it never reaches the overview, the categories or
  the trend. A trip can be **shared by link**, so the rest of the group can add what they spent
  without an account of their own.
- **Debts** — a named amount owed, and the instalments recorded against it; each one brings what is
  left down. Held in its own tables, so repayments never reach your expense totals.
- **Categories** — eight to start with; add your own with an icon. The colour is the app's to give.
- **Settings** — profile photo, password, app lock, Monefy import, theme, today's rates, sync, account.

**Everything above works with no internet.** Expenses are written to the device first and sent to
the server whenever there is a connection — see [Working offline](#working-offline).

Stack: React 19 + Vite + Tailwind v4, Recharts, Supabase (Postgres + password auth), `vite-plugin-pwa`,
IndexedDB for the local copy.

---

## Setup

### 1. Create the Supabase project

1. Sign up at [supabase.com](https://supabase.com) and create a new project (free tier is plenty).
   Pick a region close to you — `eu-central` if you're in Europe.
2. Wait for it to finish provisioning (~2 minutes).

### 2. Create the tables

Open **SQL Editor → New query**, paste the entire contents of [`supabase/schema.sql`](supabase/schema.sql),
and run it. It creates nine tables (`categories`, `expenses`, `fx_rates`, and `trips`, `travellers`,
`trip_expenses`, `trip_shares` for the Travel section, `debts`, `debt_installments` for Debts), turns on row level security, adds policies so
you can only ever read and write your own rows, and defines the four functions a shared trip's link
holder goes through.

Safe to re-run — every statement is guarded. **Upgrading an existing project:**

| Your project predates | Run |
| --- | --- |
| the Travel section | [`supabase/2026-09-travel.sql`](supabase/2026-09-travel.sql) |
| shared trips | [`supabase/2026-09-trip-sharing.sql`](supabase/2026-09-trip-sharing.sql) |
| the Debts section | [`supabase/2026-09-debts.sql`](supabase/2026-09-debts.sql) |

Each adds only what is new and touches nothing that already holds data.

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

### 5. Enable avatars (optional)

Run [`supabase/avatars.sql`](supabase/avatars.sql) in the SQL editor. It creates a **private**
storage bucket and scopes it to `<user-uuid>/avatar.jpg`, so each account can only reach its own
file. Skip this and the app just shows initials instead of a photo — nothing else breaks.

### 6. Close the door

Once your account exists, turn off **Authentication → Sign In / Providers → Email → Allow new users
to sign up**. Anyone can read the publishable key out of the deployed bundle; without this they can
register against your project and burn its quota. Row level security keeps their data separate from
yours either way.

### 7. Run it

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
runs full-screen with its own icon and works with no connection at all — reading, adding, editing
and deleting alike. A service worker keeps the app shell cached and the data lives on the device;
anything entered offline syncs when the network comes back. See
[Working offline](#working-offline).

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

## Entering an expense

The add sheet is built to fit above the software keyboard on a small phone — amount, category, note,
date and the save button all reachable without a scroll, on roughly the 500px an iPhone 12 leaves.

Two things make that fit. Amount and currency share a row, and the categories are one horizontally
scrolling strip rather than a wrapping grid: fifteen chips wrap to four rows, which is most of the
space available. The strip is **ordered by how often each category is used**, so the handful that
account for most entries sit under the thumb.

iOS does not shrink the layout viewport when the keyboard opens — `100dvh` still reports the whole
screen — so a bottom-anchored sheet ends up behind it. `lib/useViewportBox.ts` reads
`window.visualViewport`, which is the only thing that reports the truth, and the sheet is sized to
that instead.

## Avatars

Tap the circle in the top-right (mobile) or beside the wordmark (desktop) to jump to Settings, where
a photo can be set. Photos are centre-cropped and scaled to 256px in the browser before upload, so a
multi-megabyte phone picture becomes roughly 20 KB and the app never handles a full-resolution copy.

The bucket is **private**. A face is personal, so it's served through a short-lived signed URL rather
than a public path that anyone who learned the UUID could fetch. Storage policies key on the first
path segment, which is the owner's user id.

Without a photo, the app renders initials derived from the email address.

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

## Travel

A trip is a name and the people on it. Every expense inside it records **who paid**, in place of the
category a personal expense carries — which is the whole reason a trip is worth tracking separately.
Travellers are just names: nobody else needs the app, or an account.

**Travel spending never touches your own numbers.** It lives in `trips`, `travellers` and
`trip_expenses`, not behind a flag on `expenses`, so the monthly total, the category breakdown, the
trend and the Monefy import cannot see it even by accident. Money fronted for four people is not
your spending, and one forgotten `where` clause would have made it look like it was.

Everything else works as it does elsewhere: amounts in EUR, USD or UAH, converted at the rate of the
day they were spent, and read back in whichever currency the overview is set to.

Under the trip total, each traveller shows what they paid and where an even split leaves them —
`gets back` when they fronted more than their share, `owes` when they fronted less. The split is a
reading of the same numbers, not a second thing to keep up to date; nothing about it is stored.

Removing someone from a trip keeps what they paid: those expenses stay in the total and show as
*Unassigned*, because losing who paid is recoverable and losing the amount is not. Deleting a whole
trip does delete its expenses, and says so before it does.

### Sharing a trip

A trip is shared spending, so the people on it are the ones who know what was spent. **Share** on a
trip makes a link; anyone who opens it sees the trip and can add what they paid for, and it lands in
your account as though you had typed it in yourself.

They need no account and never make one. What the link allows is deliberately small:

| A link holder can | A link holder cannot |
| --- | --- |
| see that one trip — its expenses, who paid, the even split | see any other trip, or a single personal expense |
| add expenses to it | rename or delete the trip, or remove anybody |
| edit and delete **the expenses they added through that link** | touch your rows, or another link holder's |
| add themselves to the trip by name | reach any table directly — `anon` has no grant on one |

Everything a link holder does goes through four `security definer` functions that take the token as
their only credential and resolve it to exactly one trip before touching anything. Row level
security is never loosened for them; see the comments in
[`supabase/2026-09-trip-sharing.sql`](supabase/2026-09-trip-sharing.sql).

The token is treated like the credential it is. It is 32 random bytes; only its SHA-256 is stored,
so the database never holds anything that opens the link; and it rides in the URL **fragment**,
which browsers do not send to servers — so it stays out of request logs and out of `Referer`
headers on the way to the app. Because only the hash is stored, the link cannot be shown again on a
device that did not create it: the phone that made it keeps a copy so it can be copied again, and
anywhere else the trip offers to replace it instead. **Switch this link off** revokes it for
everyone at once and keeps every expense that came in through it.

Opening a shared trip works with no connection, exactly as the rest of the app does — the same
local copy, the same queue. One thing needs a connection: adding yourself to the trip as a new
person, because a traveller invented offline would have an id only that phone knows about, and the
expenses pointing at it would have nowhere to land. And a rate a link holder cannot look up (they
have no access to the rate table) is filled in by the database as it writes the row, from the day
the money was actually spent.

---

## Working offline

The app is built to be used with no connection at all — a plane, a basement, a border crossing with
data roaming off — because that is exactly where expenses get entered and exactly where they are
most easily forgotten.

**Everything is local first.** Every screen is built from a copy of your data in IndexedDB, and
every change — a new expense, an edit, a deletion, a whole trip, even a Monefy import — is written
there and to a queue, without waiting for a request. There is no request to fail, so nothing is lost
when the tab is closed mid-flight and nothing has to be retried by hand. The queue is drained
whenever there is a connection: on reconnect, on returning to the app, and on a slow timer.

The header shows a quiet badge when there is something to say — `Offline · 3 to sync`, `Syncing…` —
and nothing at all when everything is up to date. Settings → Sync has the full account and a
**Sync now** button.

What this means in practice:

- **Opening the app with no connection works**, including a cold start after the phone was
  restarted. The shell is precached by the service worker, and the account is remembered separately
  from the Supabase session — an access token cannot be refreshed offline, and that must not look
  like being signed out when every expense is sitting right there on the device. As soon as there is
  a connection again the session has to prove itself: it refreshes, or you are asked for your
  password. Your data stays either way, and syncs once you are back in.
- **Rates are corrected afterwards.** A hryvnia expense entered offline can only be converted at
  the nearest day already cached. The row keeps that rate so the totals read sensibly meanwhile, and
  the real day is fetched and written onto the row the moment the network returns — before it is
  sent, so the server never stores the guess.
- **Signing out sends what is queued first.** If it cannot — no connection — the local copy stays on
  the device and goes up the next time you sign in. With nothing left to send, the cache is cleared.

Every queued change is an upsert of the whole row or a delete of its id, both idempotent, so a
replay interrupted halfway and started again lands in the same place. Row ids are minted on the
device (`crypto.randomUUID`), which is what lets an expense exist, be edited and be deleted before
the server has ever heard of it. Two devices editing the same row while one is offline resolve
last-writer-wins.

Storage is a per-account slice of IndexedDB. It is not encrypted — no browser storage is — so on a
shared device, turn on the app lock.

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
  spread across the least-used palette slots so category colours stay distinct.

Monefy's header repeats the word `currency` twice, so fields are read by position, not by name.
Income rows and currencies other than EUR/USD/UAH are skipped and reported rather than guessed at.

---

## A note on PostgREST row limits

Supabase caps every API response at a server-side row limit — 1000 by default. A client-side
`.limit(5000)` does **not** raise it: the response is silently truncated, with no error and no
indication that anything is missing. After importing five years of history that showed up as the
app appearing to lose everything older than its newest thousand rows.

Anything that can exceed the cap therefore pages through `.range()` — see `fetchAllPages` in
`lib/supabase.ts`. Paged queries order by `id` last, so rows sharing a `spent_on` and `created_at`
(as bulk-imported rows do, to the millisecond) can't shift between pages and be skipped.

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
  types.ts             Currency, Category, Expense, Trip, Traveller, BASE_CURRENCY
  lib/
    supabase.ts        client (falls back to a setup screen if unconfigured)
    db.ts              IndexedDB: the on-device copy of everything shown
    sync.ts            the outbox — queued changes, replayed when there is a connection
    identity.ts        the remembered account, so an offline start is not a sign-out
    ids.ts             device-minted row ids
    share.ts           share links: tokens, the join route, the four link-holder calls
    useSharedTrip.ts   a trip seen through a link — its own store, no account
    fx.ts              NBU fetch, rate cache (server + device), EUR conversion
    analytics.ts       month/category/trend selectors
    format.ts          money, date and month formatting
    icons.ts           category icon set + validated colour palette slots
    theme.ts           system / light / dark preference
    lock.ts            WebAuthn platform credential, device-local
    avatar.ts          crop/scale, private-bucket upload, signed URL
    convert.ts         restates expenses in the display currency
    useTravel.ts       trips, travellers and trip expenses — their own store
    useDebts.ts        debts and the instalments paid against them — their own store
    useAppLock.ts      locks on leaving the foreground
  components/
    Overview.tsx  Expenses.tsx  Categories.tsx  Settings.tsx
    Login.tsx  LockScreen.tsx  LockSettings.tsx  PasswordSettings.tsx
    ExpenseSheet.tsx   add / edit / delete an expense
    Travel.tsx         trip list + the create / edit trip sheet
    Debts.tsx          debts with what is left, recorded instalments, and their sheets
    TripDetail.tsx     one trip: total, who paid what, its expenses
    TripExpenseSheet.tsx  add / edit / delete a trip expense, for owner and guest alike
    ShareTrip.tsx      the owner's side of a link: make it, copy it, switch it off
    SharedTrip.tsx     the whole app a link holder gets
    TravellerBadge.tsx a traveller's monogram in their trip colour
    SyncStatus.tsx     the offline / queued badge, and the Sync section in Settings
    charts.tsx         monthly trend (Recharts)
    ui.tsx             Card, Button, Field, Sheet, Segmented, …
supabase/schema.sql    tables, RLS policies
supabase/avatars.sql   private avatar bucket + storage policies
supabase/2026-09-travel.sql  travel tables, for a project created before them
supabase/2026-09-trip-sharing.sql  share links + the functions a link holder calls
supabase/2026-09-debts.sql   debt tables, for a project created before them
```

### Chart colours

`--series-1` … `--series-16` in `src/index.css` are a fixed, validated categorical palette: the slot
order is what keeps adjacent hues distinguishable for colourblind readers, so **don't reorder or
cycle it**. Categories store a slot index, so a category keeps its colour no matter how a chart is
filtered or sorted. Both light and dark steps were checked for CVD separation and contrast.

Slots 1–8 are eight hues. Slots 9–16 are those same hues at the far end of the lightness band,
because sixteen separate hues do not exist inside one band — a pair shares a hue and differs in
weight, which reads as two colours where two neighbouring hues would have read as one. The order of
the second eight was solved for rather than inherited (all 8! orderings scored on their worst
adjacent pair, in both themes at once). Measured on the adjacent pairlist: worst CVD ΔE 7.2 light /
8.4 dark, worst normal-vision ΔE 19.6 light / 19.3 dark. The light figure sits in the 6–8 band that
is legal only alongside a second channel — here every category carries its icon and its name in the
ranked list beside the chart, so colour never identifies anything on its own.

Slots are assigned, never chosen: `assignColorSlot` hands out the first colour no other category
holds, so up to sixteen categories are each their own, and `recolourCollisions` moves any category
that shares a colour with an older one — the repair runs once per load and is a no-op afterwards.
Past sixteen the least-used colour comes round again rather than a new one being invented.

## Possible next steps

Not built, in rough order of usefulness: monthly budgets per category, recurring expenses,
uneven trip splits (shares per person, or an expense that only some travellers were in on),
categories on trip expenses, CSV export/import, receipt photos (Supabase Storage), and
code-splitting the charts bundle.
