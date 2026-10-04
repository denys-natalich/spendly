-- ---------------------------------------------------------------------------
-- A debt becomes a name, and what is owed is the sum of the amounts recorded
-- under it. Someone who borrows again gets a new amount rather than an edited
-- total, so the history says when each part was lent and what it was for.
--
-- Each amount carries its own currency, so one name can be owed in more than
-- one. An instalment now carries a currency too, and pays down the balance in
-- that currency only — there is still no rate, a hryvnia loan is repaid in
-- hryvnia.
--
-- Run this in Supabase → SQL Editor after 2026-09-debts.sql, and before
-- deploying the build that adds amounts. New projects get the same result
-- from schema.sql. Safe to re-run.
-- ---------------------------------------------------------------------------

begin;

create table if not exists public.debt_amounts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  debt_id     uuid not null references public.debts (id) on delete cascade,
  amount      numeric(14, 2) not null check (amount > 0),
  currency    text not null check (currency in ('EUR', 'USD', 'UAH')),
  description text check (char_length(description) <= 200),
  added_on    date not null default current_date,
  created_at  timestamptz not null default now()
);

create index if not exists debt_amounts_debt_idx on public.debt_amounts (debt_id, added_on desc);
create index if not exists debt_amounts_user_idx on public.debt_amounts (user_id);

alter table public.debt_amounts enable row level security;

drop policy if exists "own debt amounts" on public.debt_amounts;
create policy "own debt amounts" on public.debt_amounts
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Instalments take the currency of the debt they were recorded against.
alter table public.debt_installments
  add column if not exists currency text check (currency in ('EUR', 'USD', 'UAH'));

update public.debt_installments i
   set currency = coalesce(d.currency, 'EUR')
  from public.debts d
 where i.debt_id = d.id and i.currency is null;

alter table public.debt_installments alter column currency set not null;

-- The total on each existing debt becomes its first amount, dated the day the
-- debt was added. The debt's own columns are then emptied, which is what makes
-- this safe to re-run: a debt with no amount left on it is not copied again.
alter table public.debts alter column amount drop not null;
alter table public.debts alter column currency drop not null;
alter table public.debts alter column currency drop default;

insert into public.debt_amounts (user_id, debt_id, amount, currency, added_on, created_at)
select user_id, id, amount, currency, created_at::date, created_at
  from public.debts
 where amount is not null;

update public.debts set amount = null, currency = null where amount is not null;

commit;
