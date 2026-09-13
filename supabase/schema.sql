-- ============================================================================
-- Spendly — schema, row level security and seed data.
-- Paste this whole file into the Supabase SQL editor and run it once.
-- Safe to re-run: everything is guarded with "if not exists" / "or replace".
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- categories
-- color_slot indexes into the app's validated categorical palette (1..16) so a
-- category keeps its colour no matter how a chart is filtered or sorted. The
-- app assigns it — one slot per category, never picked by hand.
-- ---------------------------------------------------------------------------
create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 40),
  icon        text not null default 'tag',
  color_slot  smallint not null default 1 check (color_slot between 1 and 16),
  sort_order  integer not null default 0,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, name)
);

create index if not exists categories_user_idx on public.categories (user_id, sort_order);

-- ---------------------------------------------------------------------------
-- expenses
-- rate_to_eur = units of `currency` per 1 EUR, snapshotted on the day of the
-- expense. Storing it makes historical totals stable even if rates move later,
-- and lets amount_eur be a generated column the charts can sum directly.
-- ---------------------------------------------------------------------------
create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  category_id uuid references public.categories (id) on delete set null,
  amount      numeric(14, 2) not null check (amount > 0),
  currency    text not null check (currency in ('EUR', 'USD', 'UAH')),
  rate_to_eur numeric(18, 8) not null default 1 check (rate_to_eur > 0),
  amount_eur  numeric(14, 2) generated always as (round(amount / rate_to_eur, 2)) stored,
  spent_on    date not null default current_date,
  note        text check (char_length(note) <= 200),
  created_at  timestamptz not null default now()
);

create index if not exists expenses_user_date_idx on public.expenses (user_id, spent_on desc);
create index if not exists expenses_category_idx on public.expenses (category_id);

-- ---------------------------------------------------------------------------
-- fx_rates — one row per calendar day, shared cache across all users.
-- Values are units per 1 EUR, sourced from the National Bank of Ukraine.
-- ---------------------------------------------------------------------------
create table if not exists public.fx_rates (
  day        date primary key,
  usd        numeric(18, 8) not null check (usd > 0),
  uah        numeric(18, 8) not null check (uah > 0),
  source     text not null default 'nbu',
  fetched_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.categories enable row level security;
alter table public.expenses   enable row level security;
alter table public.fx_rates   enable row level security;

drop policy if exists "own categories" on public.categories;
create policy "own categories" on public.categories
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own expenses" on public.expenses;
create policy "own expenses" on public.expenses
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Rates are public reference data: any signed-in user may read them, and may
-- add a day that is not cached yet, but nobody may rewrite or delete history.
drop policy if exists "read rates" on public.fx_rates;
create policy "read rates" on public.fx_rates
  for select to authenticated using (true);

drop policy if exists "cache rates" on public.fx_rates;
create policy "cache rates" on public.fx_rates
  for insert to authenticated with check (true);

-- Starter categories are created by the app on first sign-in, so there is no
-- trigger on auth.users to install here.

-- ---------------------------------------------------------------------------
-- Travel — trips, the people on them, and what each person paid for.
--
-- Kept apart from `expenses` on purpose. A trip is shared spending that is
-- mostly fronted for other people, so it must never reach the monthly total,
-- the category breakdown or the trend. Its own tables make that structural,
-- rather than a filter every future query has to remember.
--
-- Rates work exactly as they do for a personal expense: the rate of the day is
-- snapshotted on the row, and amount_eur is generated from it.
-- ---------------------------------------------------------------------------
create table if not exists public.trips (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create index if not exists trips_user_idx on public.trips (user_id, created_at desc);

-- Travellers are names, not accounts: the people on the trip do not need to
-- have Spendly, and the trip belongs to whoever recorded it.
create table if not exists public.travellers (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (trip_id, name)
);

create index if not exists travellers_trip_idx on public.travellers (trip_id, created_at);

-- traveller_id is nullable and survives the traveller being removed: losing who
-- paid is recoverable, losing the amount is not.
create table if not exists public.trip_expenses (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  trip_id      uuid not null references public.trips (id) on delete cascade,
  traveller_id uuid references public.travellers (id) on delete set null,
  amount       numeric(14, 2) not null check (amount > 0),
  currency     text not null check (currency in ('EUR', 'USD', 'UAH')),
  rate_to_eur  numeric(18, 8) not null default 1 check (rate_to_eur > 0),
  amount_eur   numeric(14, 2) generated always as (round(amount / rate_to_eur, 2)) stored,
  spent_on     date not null default current_date,
  note         text check (char_length(note) <= 200),
  created_at   timestamptz not null default now()
);

create index if not exists trip_expenses_trip_idx on public.trip_expenses (trip_id, spent_on desc);
create index if not exists trip_expenses_user_idx on public.trip_expenses (user_id);

alter table public.trips         enable row level security;
alter table public.travellers    enable row level security;
alter table public.trip_expenses enable row level security;

drop policy if exists "own trips" on public.trips;
create policy "own trips" on public.trips
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own travellers" on public.travellers;
create policy "own travellers" on public.travellers
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own trip expenses" on public.trip_expenses;
create policy "own trip expenses" on public.trip_expenses
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
