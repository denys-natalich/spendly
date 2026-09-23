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
  -- Which share link this came in through; null for the owner's own rows.
  -- See "Shareable trips" at the end of this file.
  created_via  uuid,
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

-- ---------------------------------------------------------------------------
-- Shareable trips.
--
-- A link holder is not a Spendly user and never becomes one. Everything they
-- can do goes through the four functions below, which run as the trip's owner
-- (`security definer`) and take the link's token as their only credential.
-- Row level security is never relaxed for them: the `anon` role cannot read or
-- write a single row of any table directly. It can call these functions, and
-- each one resolves the token to exactly one trip before it touches anything.
--
-- A link allows reading that one trip, adding expenses to it, adding a person
-- to it, and editing or deleting the expenses added through the same link.
-- Nothing else — not another trip, not the owner's personal expenses, not
-- renaming or deleting the trip itself.
--
-- Only a SHA-256 of the token is stored. The token itself lives in the URL
-- fragment, which browsers never send to a server.
-- ---------------------------------------------------------------------------

create table if not exists public.trip_shares (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references public.trips (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  -- Lowercase hex of sha256(token). The check keeps a raw token from ever
  -- being written here by mistake.
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index if not exists trip_shares_trip_idx on public.trip_shares (trip_id, created_at desc);

-- Declared on the table above without the reference, because that table is
-- created first. `on delete set null` so revoking a link keeps its spending.
alter table public.trip_expenses
  add column if not exists created_via uuid references public.trip_shares (id) on delete set null;

do $$ begin
  alter table public.trip_expenses
    add constraint trip_expenses_created_via_fkey
    foreign key (created_via) references public.trip_shares (id) on delete set null;
exception when duplicate_object then null;
end $$;

alter table public.trip_shares enable row level security;

drop policy if exists "own trip shares" on public.trip_shares;
create policy "own trip shares" on public.trip_shares
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A trip nobody can add to any more is better than one that grows without
-- bound if a link ends up somewhere public.
create or replace function public.share_expense_cap() returns integer
  language sql immutable as $$ select 5000 $$;

-- ---------------------------------------------------------------------------
-- share_trip — everything the link's holder may see.
--
-- The owner's `user_id` is stripped: it identifies their account and the guest
-- has no use for it. Rates come along because a guest cannot read `fx_rates`
-- (that table is readable by signed-in users only) and without them the trip
-- could not be shown in euro.
-- ---------------------------------------------------------------------------
create or replace function public.share_trip(share_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_share public.trip_shares;
  v_from  date;
begin
  select * into v_share from public.trip_shares
   where token_hash = encode(digest(share_token, 'sha256'), 'hex')
     and revoked_at is null;
  if not found then
    raise exception 'This link is no longer active.' using errcode = 'P0002';
  end if;

  select min(spent_on) into v_from from public.trip_expenses where trip_id = v_share.trip_id;

  return jsonb_build_object(
    'share_id', v_share.id,
    'trip', (select to_jsonb(t) - 'user_id' from public.trips t where t.id = v_share.trip_id),
    'travellers', coalesce((
      select jsonb_agg(to_jsonb(p) - 'user_id' order by p.created_at)
        from public.travellers p where p.trip_id = v_share.trip_id), '[]'::jsonb),
    'expenses', coalesce((
      select jsonb_agg(to_jsonb(e) - 'user_id' order by e.spent_on desc, e.created_at desc)
        from public.trip_expenses e where e.trip_id = v_share.trip_id), '[]'::jsonb),
    'rates', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.day)
        from public.fx_rates r where r.day >= coalesce(v_from, current_date - 30)), '[]'::jsonb)
  );
end
$$;

-- ---------------------------------------------------------------------------
-- share_save_expense — add one, or correct one this link added.
--
-- The whole row arrives as jsonb, which keeps the argument list stable and the
-- parameter names from colliding with the columns they are written to. The id
-- comes from the sender so that an expense entered with no connection has an
-- identity before it is ever sent, and so that replaying the same queued change
-- twice updates one row instead of making two.
-- ---------------------------------------------------------------------------
create or replace function public.share_save_expense(share_token text, expense jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_share     public.trip_shares;
  v_id        uuid := coalesce(nullif(expense->>'id', '')::uuid, gen_random_uuid());
  v_traveller uuid := nullif(expense->>'traveller_id', '')::uuid;
  v_amount    numeric := (expense->>'amount')::numeric;
  v_currency  text := expense->>'currency';
  v_day       date := coalesce(nullif(expense->>'spent_on', '')::date, current_date);
  v_note      text := nullif(expense->>'note', '');
  v_rate      numeric := nullif(expense->>'rate_to_eur', '')::numeric;
  v_existing  public.trip_expenses;
  v_saved     public.trip_expenses;
begin
  select * into v_share from public.trip_shares
   where token_hash = encode(digest(share_token, 'sha256'), 'hex')
     and revoked_at is null;
  if not found then
    raise exception 'This link is no longer active.' using errcode = 'P0002';
  end if;

  if v_traveller is not null and not exists (
    select 1 from public.travellers where id = v_traveller and trip_id = v_share.trip_id
  ) then
    raise exception 'That person is not on this trip.';
  end if;

  -- A rate the sender could not resolve — entered with no connection, most
  -- likely — is filled in here from the day itself, or the nearest day before
  -- it, exactly as the app would have done with a connection.
  if v_rate is null or v_rate <= 0 then
    select case v_currency when 'USD' then r.usd when 'UAH' then r.uah else 1 end
      into v_rate
      from public.fx_rates r
     where r.day <= v_day
     order by r.day desc
     limit 1;
    v_rate := coalesce(v_rate, 1);
  end if;

  select * into v_existing from public.trip_expenses where id = v_id;

  if found then
    -- Only what came in through this same link, so one guest cannot rewrite
    -- the owner's rows or another guest's.
    if v_existing.created_via is distinct from v_share.id then
      raise exception 'That expense was not added from this link.' using errcode = '42501';
    end if;
    update public.trip_expenses
       set traveller_id = v_traveller,
           amount       = v_amount,
           currency     = v_currency,
           rate_to_eur  = v_rate,
           spent_on     = v_day,
           note         = v_note
     where id = v_id
    returning * into v_saved;
  else
    if (select count(*) from public.trip_expenses where trip_id = v_share.trip_id)
       >= public.share_expense_cap() then
      raise exception 'This trip has reached its limit of shared entries.';
    end if;
    insert into public.trip_expenses
      (id, user_id, trip_id, traveller_id, amount, currency, rate_to_eur, spent_on, note, created_via)
    values
      (v_id, v_share.user_id, v_share.trip_id, v_traveller, v_amount, v_currency, v_rate, v_day, v_note, v_share.id)
    returning * into v_saved;
  end if;

  return to_jsonb(v_saved) - 'user_id';
end
$$;

-- ---------------------------------------------------------------------------
-- share_delete_expense — remove one this link added.
-- ---------------------------------------------------------------------------
create or replace function public.share_delete_expense(share_token text, expense_id uuid)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_share public.trip_shares;
begin
  select * into v_share from public.trip_shares
   where token_hash = encode(digest(share_token, 'sha256'), 'hex')
     and revoked_at is null;
  if not found then
    raise exception 'This link is no longer active.' using errcode = 'P0002';
  end if;

  -- Silent when there is nothing to delete: a queued deletion replayed twice
  -- must not fail the second time.
  delete from public.trip_expenses
   where id = expense_id
     and trip_id = v_share.trip_id
     and created_via = v_share.id;
end
$$;

-- ---------------------------------------------------------------------------
-- share_add_traveller — put yourself on the trip you were sent.
--
-- Returns the existing person when the name is already there, so two people
-- typing the same name get the same row rather than an error.
-- ---------------------------------------------------------------------------
create or replace function public.share_add_traveller(share_token text, traveller_name text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_share public.trip_shares;
  v_name  text := trim(traveller_name);
  v_row   public.travellers;
begin
  select * into v_share from public.trip_shares
   where token_hash = encode(digest(share_token, 'sha256'), 'hex')
     and revoked_at is null;
  if not found then
    raise exception 'This link is no longer active.' using errcode = 'P0002';
  end if;

  if v_name is null or v_name = '' then
    raise exception 'A name is needed.';
  end if;

  select * into v_row from public.travellers
   where trip_id = v_share.trip_id and lower(name) = lower(v_name);

  if not found then
    if (select count(*) from public.travellers where trip_id = v_share.trip_id) >= 50 then
      raise exception 'This trip has reached its limit of people.';
    end if;
    insert into public.travellers (trip_id, user_id, name)
    values (v_share.trip_id, v_share.user_id, v_name)
    returning * into v_row;
  end if;

  return to_jsonb(v_row) - 'user_id';
end
$$;

-- The link is the credential, so these are callable without a session. Every
-- other route into the data stays closed to `anon`.
revoke all on function public.share_trip(text) from public;
revoke all on function public.share_save_expense(text, jsonb) from public;
revoke all on function public.share_delete_expense(text, uuid) from public;
revoke all on function public.share_add_traveller(text, text) from public;

grant execute on function public.share_trip(text) to anon, authenticated;
grant execute on function public.share_save_expense(text, jsonb) to anon, authenticated;
grant execute on function public.share_delete_expense(text, uuid) to anon, authenticated;
grant execute on function public.share_add_traveller(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Debts — a named amount owed, and the instalments that pay it down.
-- Same statements as 2026-09-debts.sql; see there for the reasoning.
-- ---------------------------------------------------------------------------
create table if not exists public.debts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  name       text not null check (char_length(trim(name)) between 1 and 60),
  amount     numeric(14, 2) not null check (amount > 0),
  currency   text not null default 'EUR' check (currency in ('EUR', 'USD', 'UAH')),
  created_at timestamptz not null default now()
);

create index if not exists debts_user_idx on public.debts (user_id, created_at desc);

-- Instalments are in the debt's own currency — a loan in hryvnia is repaid in
-- hryvnia — so there is no rate to snapshot. What is left is the debt's amount
-- minus their sum, worked out by the app rather than stored.
create table if not exists public.debt_installments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  debt_id     uuid not null references public.debts (id) on delete cascade,
  amount      numeric(14, 2) not null check (amount > 0),
  description text check (char_length(description) <= 200),
  paid_on     date not null default current_date,
  created_at  timestamptz not null default now()
);

create index if not exists debt_installments_debt_idx on public.debt_installments (debt_id, paid_on desc);
create index if not exists debt_installments_user_idx on public.debt_installments (user_id);

alter table public.debts             enable row level security;
alter table public.debt_installments enable row level security;

drop policy if exists "own debts" on public.debts;
create policy "own debts" on public.debts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "own debt installments" on public.debt_installments;
create policy "own debt installments" on public.debt_installments
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
