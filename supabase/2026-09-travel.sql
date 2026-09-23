-- ---------------------------------------------------------------------------
-- Adds the Travel section: trips, the people on them, and their expenses.
--
-- Run this in Supabase → SQL Editor on an existing project before deploying the
-- build with the Travel tab. New projects get all of it from schema.sql, which
-- carries the same statements. Safe to re-run.
--
-- Nothing here touches `expenses`, `categories` or `fx_rates`: travel spending
-- is stored separately so it can never move a personal total.
-- ---------------------------------------------------------------------------

create table if not exists public.trips (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create index if not exists trips_user_idx on public.trips (user_id, created_at desc);

-- Travellers are names, not accounts: the people on the trip do not need to
-- have Moneta, and the trip belongs to whoever recorded it.
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
