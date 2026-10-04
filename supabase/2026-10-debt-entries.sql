-- ---------------------------------------------------------------------------
-- A debt becomes a name, and everything recorded under it is one list of
-- entries: a "plus" adds to what is owed (money lent, the first time or
-- again), a "minus" pays it down (an instalment). One table rather than two,
-- so the history is a single query in the order it happened.
--
-- Each entry carries its own currency. Balances are kept per currency and
-- never converted — a hryvnia loan is repaid in hryvnia.
--
-- Run this in Supabase → SQL Editor after 2026-09-debts.sql, and before
-- deploying the build that reads debt_entries. It moves everything already
-- recorded across — each debt's total becomes its first "plus", each
-- instalment a "minus" — and then drops the old tables and columns. It works
-- whether or not the short-lived 2026-10-debt-amounts.sql was run first.
-- New projects get the end state from schema.sql. Safe to re-run.
-- ---------------------------------------------------------------------------

begin;

create table if not exists public.debt_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  debt_id     uuid not null references public.debts (id) on delete cascade,
  direction   text not null check (direction in ('plus', 'minus')),
  amount      numeric(14, 2) not null check (amount > 0),
  currency    text not null check (currency in ('EUR', 'USD', 'UAH')),
  description text check (char_length(description) <= 200),
  happened_on date not null default current_date,
  created_at  timestamptz not null default now()
);

create index if not exists debt_entries_debt_idx on public.debt_entries (debt_id, happened_on desc);
create index if not exists debt_entries_user_idx on public.debt_entries (user_id);

alter table public.debt_entries enable row level security;

drop policy if exists "own debt entries" on public.debt_entries;
create policy "own debt entries" on public.debt_entries
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Each branch runs only while its source still exists, so a second run finds
-- nothing left to copy.
do $$
begin
  -- Instalments first: they need the debt's own currency, which the step
  -- after empties. Ids are kept, so a re-run cannot copy one twice.
  if to_regclass('public.debt_installments') is not null then
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'debt_installments' and column_name = 'currency') then
      insert into public.debt_entries (id, user_id, debt_id, direction, amount, currency, description, happened_on, created_at)
      select i.id, i.user_id, i.debt_id, 'minus', i.amount, coalesce(i.currency, d.currency, 'EUR'),
             i.description, i.paid_on, i.created_at
        from public.debt_installments i
        join public.debts d on d.id = i.debt_id
      on conflict (id) do nothing;
    else
      insert into public.debt_entries (id, user_id, debt_id, direction, amount, currency, description, happened_on, created_at)
      select i.id, i.user_id, i.debt_id, 'minus', i.amount, coalesce(d.currency, 'EUR'),
             i.description, i.paid_on, i.created_at
        from public.debt_installments i
        join public.debts d on d.id = i.debt_id
      on conflict (id) do nothing;
    end if;
  end if;

  -- The total on each debt, dated the day the debt was added.
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'debts' and column_name = 'amount') then
    insert into public.debt_entries (user_id, debt_id, direction, amount, currency, happened_on, created_at)
    select user_id, id, 'plus', amount, coalesce(currency, 'EUR'), created_at::date, created_at
      from public.debts
     where amount is not null;
  end if;

  -- Amounts from 2026-10-debt-amounts.sql, if it was run.
  if to_regclass('public.debt_amounts') is not null then
    insert into public.debt_entries (id, user_id, debt_id, direction, amount, currency, description, happened_on, created_at)
    select id, user_id, debt_id, 'plus', amount, currency, description, added_on, created_at
      from public.debt_amounts
    on conflict (id) do nothing;
  end if;
end $$;

drop table if exists public.debt_installments;
drop table if exists public.debt_amounts;
alter table public.debts drop column if exists amount;
alter table public.debts drop column if exists currency;

commit;
