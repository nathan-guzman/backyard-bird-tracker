-- Backyard Bird Tracker schema + Row Level Security
-- Run via: supabase db push  (or paste into the Supabase SQL editor)

-- ============================================================
-- locations
-- ============================================================
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Backyard',
  lat double precision not null,
  lng double precision not null,
  created_at timestamptz not null default now()
);
create index if not exists locations_user_id_idx on public.locations(user_id);

-- ============================================================
-- sessions
-- ============================================================
create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  lat double precision,
  lng double precision,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_tap_at timestamptz not null default now(),
  finalized boolean not null default false,
  exported_at timestamptz
);
create index if not exists sessions_user_id_idx on public.sessions(user_id);
create index if not exists sessions_user_finalized_idx
  on public.sessions(user_id, finalized);

-- ============================================================
-- sightings
-- ============================================================
create table if not exists public.sightings (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  species_code text not null,
  common_name text not null,
  scientific_name text not null default '',
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (session_id, species_code)
);
create index if not exists sightings_session_idx on public.sightings(session_id);
create index if not exists sightings_user_species_idx
  on public.sightings(user_id, species_code);

-- ============================================================
-- user_species_lists
-- per-user, per-location curated species buttons
-- ============================================================
create table if not exists public.user_species_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  location_id uuid references public.locations(id) on delete cascade,
  species_code text not null,
  common_name text not null,
  scientific_name text not null default '',
  display_order integer not null default 0,
  custom_added boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, location_id, species_code)
);
create index if not exists usl_user_loc_idx
  on public.user_species_lists(user_id, location_id);

-- ============================================================
-- Row Level Security
-- ============================================================
alter table public.locations enable row level security;
alter table public.sessions enable row level security;
alter table public.sightings enable row level security;
alter table public.user_species_lists enable row level security;

-- locations
drop policy if exists "locations_select_own" on public.locations;
create policy "locations_select_own" on public.locations
  for select using (auth.uid() = user_id);
drop policy if exists "locations_modify_own" on public.locations;
create policy "locations_modify_own" on public.locations
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- sessions
drop policy if exists "sessions_select_own" on public.sessions;
create policy "sessions_select_own" on public.sessions
  for select using (auth.uid() = user_id);
drop policy if exists "sessions_modify_own" on public.sessions;
create policy "sessions_modify_own" on public.sessions
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- sightings
drop policy if exists "sightings_select_own" on public.sightings;
create policy "sightings_select_own" on public.sightings
  for select using (auth.uid() = user_id);
drop policy if exists "sightings_modify_own" on public.sightings;
create policy "sightings_modify_own" on public.sightings
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- user_species_lists
drop policy if exists "usl_select_own" on public.user_species_lists;
create policy "usl_select_own" on public.user_species_lists
  for select using (auth.uid() = user_id);
drop policy if exists "usl_modify_own" on public.user_species_lists;
create policy "usl_modify_own" on public.user_species_lists
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
