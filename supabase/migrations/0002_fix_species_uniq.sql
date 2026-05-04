-- Fix duplicate user_species_lists rows when location_id is NULL.
-- Postgres treats NULL != NULL, so the existing UNIQUE (user_id, location_id, species_code)
-- did NOT prevent duplicates when location_id was null. Every re-seed inserted dupes.

-- 1) Collapse existing duplicates: keep the row with the smallest display_order.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, location_id, species_code
      order by display_order asc, created_at asc
    ) as rn
  from public.user_species_lists
)
delete from public.user_species_lists u
using ranked r
where u.id = r.id and r.rn > 1;

-- 2) Add a partial unique index that fires when location_id IS NULL.
create unique index if not exists usl_unique_user_species_no_loc
  on public.user_species_lists (user_id, species_code)
  where location_id is null;
