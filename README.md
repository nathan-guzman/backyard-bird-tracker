# Backyard Bird Tracker

Mobile-first PWA for logging backyard bird sightings with one tap. Generates eBird-importable CSV files. See `backyard-bird-tracker-PRD.md` for the full spec.

## Stack

- React 18 + Vite + TypeScript
- Tailwind CSS
- Supabase (Postgres + Auth + Row-Level Security + Edge Functions)
- eBird API v2 (proxied through an Edge Function so the API key stays server-side)
- vite-plugin-pwa (installable on iOS/Android home screens)

## Project layout

```
src/
  lib/         # supabase client, auth context, ebird client, csv, sessions, geo, types
  screens/     # AuthScreen, CounterScreen, PendingScreen, SessionDetailScreen, StatsScreen
  components/  # NavBar
supabase/
  migrations/0001_init.sql   # schema + RLS policies
  functions/ebird/           # Deno Edge Function proxying eBird API
```

## Setup

### 1. Install

```bash
npm install
```

### 2. Credentials you need

You need to give me **three** values. Here is exactly where to find each:

#### Supabase

1. Go to <https://supabase.com> → **New project**. Pick a name and a region close to you. Save the database password somewhere safe; you won't need it for the app, but Supabase needs it.
2. Once the project is provisioned, in the Supabase dashboard:
   - **Settings → API**
     - **Project URL** → this is your `VITE_SUPABASE_URL`
     - **Project API keys → `anon` `public`** → this is your `VITE_SUPABASE_ANON_KEY`
   - The `anon` key is safe to ship in the client bundle — Row-Level Security (set up by the migration) is what protects user data. Do **not** use the `service_role` key in the frontend.

#### eBird

3. Go to <https://ebird.org/api/keygen> while signed into your eBird account. Click **Request** to get a token. That string is your `EBIRD_API_KEY`. It is for your eBird Edge Function only — the browser never sees it.

### 3. Create `.env`

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. Leave `EBIRD_API_KEY` blank in `.env` — that one goes into Supabase secrets in step 5.

### 4. Apply the database schema

Two options:

**Option A — Supabase CLI** (recommended once you have it installed):

```bash
npx supabase login
npx supabase link --project-ref YOUR-PROJECT-REF
npx supabase db push
```

**Option B — paste into the SQL editor**:

1. Open `supabase/migrations/0001_init.sql`
2. Copy the contents
3. In the Supabase dashboard → **SQL Editor → New query** → paste → **Run**

Either way confirms tables `locations`, `sessions`, `sightings`, `user_species_lists` exist and have RLS enabled.

### 5. Deploy the eBird Edge Function

```bash
npx supabase secrets set EBIRD_API_KEY=your-ebird-token
npx supabase functions deploy ebird
```

This deploys the proxy in `supabase/functions/ebird/index.ts`. Calls from the app go through `supabase.functions.invoke('ebird?...')`, which automatically attaches the user's JWT — only signed-in users can call eBird through your function.

### 6. Auth settings

In Supabase dashboard → **Authentication → Providers**, make sure **Email** is enabled. For dev convenience you can disable email confirmations under **Authentication → Email** (otherwise sign-up requires confirming the email link before sign-in).

### 7. Run

```bash
npm run dev
```

Open <http://localhost:5173>. Sign up, allow geolocation, and on the Count tab type a region code (e.g. `US-CA-001` for Alameda County, CA) and press **Seed**. The eBird-derived recent-species list will populate the counter.

To find a region code:

- US counties: the format is `US-{STATE}-{FIPS}`, e.g. `US-NY-061` for New York County. eBird has a finder at <https://ebird.org/region/world>.
- Or use a state-level code like `US-CA` if you don't know your county.

## Using the app

- **Count tab.** Tap a species row to increment its count. Hit `−` to decrement. The first tap starts a session. After 30 minutes of no taps, the session silently finalizes and moves to the Pending tab. eBird's "highest simultaneous count" rule means you should tap up to the most you ever see at once during the session, not the running total.
- **Pending tab.** Each finalized session is listed. Open one to edit counts, set the location name / state / protocol, and **Export CSV**.
- **Stats tab.** Lifetime totals across all your finalized sessions.

## Importing into eBird

1. On a session detail page, fill in **Location name**, **State**, **Country** (and adjust **Protocol** — `stationary` is appropriate for backyard counts).
2. Click **Export CSV**. A file downloads.
3. Go to <https://ebird.org/import> and upload the CSV. eBird will turn it into checklists you can review and submit.

The CSV format follows eBird's [Record Format spec](https://support.ebird.org/en/support/solutions/articles/48000838205-upload-spreadsheet-data-to-ebird).

## Deploying

Any static host works (Vercel, Netlify, Cloudflare Pages). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as build-time env vars on the host. The Edge Function lives on Supabase, not your static host.

## Security notes

- Row-Level Security policies are defined in the migration. Every table restricts both reads and writes to `auth.uid() = user_id`.
- The eBird API token is set as a Supabase **secret** and read by the Edge Function via `Deno.env.get`. It never appears in client code.
- The Edge Function is JWT-protected by default, so anonymous traffic can't burn through your eBird quota.

## What's deferred (per PRD §8)

- Offline tap queueing: the app shell is cached, but writes currently require a connection.
- Multi-location support beyond one auto-captured GPS per session.
- Photo attachments, charts, rare-bird notifications.
