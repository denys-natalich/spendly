-- ---------------------------------------------------------------------------
-- Widens the category palette to sixteen colours, so that up to sixteen
-- categories can each hold one of their own. Safe to re-run, and safe to run
-- whether or not the earlier eight-colour version was applied.
--
-- Run this in Supabase → SQL Editor BEFORE deploying the build that assigns
-- colours automatically: until it lands, any write above slot 7 is rejected.
-- ---------------------------------------------------------------------------

alter table public.categories drop constraint if exists categories_color_slot_check;

alter table public.categories
  add constraint categories_color_slot_check check (color_slot between 1 and 16);
