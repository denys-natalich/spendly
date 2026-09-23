-- ---------------------------------------------------------------------------
-- Adds the Debts section: a named debt with the amount owed, and the
-- instalments recorded against it, each of which brings what is left down.
--
-- Run this in Supabase → SQL Editor on an existing project before deploying the
-- build with the Debts tab. New projects get all of it from schema.sql, which
-- carries the same statements. Safe to re-run.
--
-- Nothing here touches `expenses` or the travel tables: a debt is tracked on
-- its own and never moves a personal total.
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
