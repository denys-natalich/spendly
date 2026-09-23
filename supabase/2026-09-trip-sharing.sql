-- ---------------------------------------------------------------------------
-- Shareable trips.
--
-- A link holder is not a Moneta user and never becomes one. Everything they
-- can do goes through the four functions below, which run as the trip's owner
-- (`security definer`) and take the link's token as their only credential.
-- That is why row level security is never relaxed here: the `anon` role still
-- cannot read or write a single row of any table directly. It can call these
-- functions, and each one resolves the token to exactly one trip before it
-- touches anything.
--
-- What a link allows: reading that one trip, adding expenses to it, adding a
-- person to it, and editing or deleting the expenses added through the same
-- link. Nothing else — not another trip, not the owner's personal expenses,
-- not renaming or deleting the trip itself.
--
-- Only a SHA-256 of the token is stored. The token itself lives in the URL
-- fragment, which browsers never send to a server, so it stays out of request
-- logs on the way to the app.
--
-- Run this in Supabase → SQL Editor on an existing project. New projects get
-- the same statements from schema.sql. Safe to re-run.
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

-- Which link an expense came in through: null for the owner's own rows. It is
-- what lets a guest correct their own mistake without being able to touch
-- anybody else's. `on delete set null` so revoking a link keeps its spending.
alter table public.trip_expenses
  add column if not exists created_via uuid references public.trip_shares (id) on delete set null;

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
