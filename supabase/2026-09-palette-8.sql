-- ---------------------------------------------------------------------------
-- Widens the category palette from seven colours to eight, so that a default
-- set of eight categories can each hold one of their own. Safe to re-run.
--
-- Run this in Supabase → SQL Editor BEFORE deploying the build that assigns
-- colours automatically: until it lands, any write of slot 8 is rejected.
-- ---------------------------------------------------------------------------

alter table public.categories drop constraint if exists categories_color_slot_check;

alter table public.categories
  add constraint categories_color_slot_check check (color_slot between 1 and 8);
