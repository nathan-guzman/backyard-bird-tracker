# Backyard Bird Tracker — Product Requirements Document

**Version:** 1.0
**Status:** Draft for v1 build
**Last updated:** April 30, 2026

---

## 1. Overview

A mobile-first PWA for logging backyard bird sightings using the simplest possible UI: tap to count, no session ceremony, no notes. The app produces eBird-compatible CSV files that the user manually uploads to their eBird account.

The core insight driving the design is that eBird's "highest simultaneous count" rule means the app is fundamentally a per-species counter, not a per-tap event log. This dramatically simplifies the data model and the interaction.

## 2. Goals & Non-Goals

### Goals
- Make logging a backyard bird sighting take no more than one tap.
- Eliminate the need to "start" or "end" a session manually.
- Produce valid eBird-importable CSV files for each completed session.
- Support cross-device use via authenticated accounts.
- Feel like a native app on a phone (installable PWA, big tap targets, offline-tolerant).

### Non-Goals (v1)
- No automatic submission to eBird — terms of service preclude this, and CSV import is the supported path.
- No social/sharing features.
- No bird identification help (no photo recognition, no audio ID).
- No native iOS/Android apps.
- No commercial use or monetization (eBird API terms forbid it without written permission).

## 3. Target User

The primary user is a casual-to-intermediate birder who watches their yard regularly and wants frictionless logging. The user is comfortable with eBird's web import flow. The app is multi-user from day one — anyone can sign up and track their own location.

## 4. Core User Flows

### 4.1 First-time setup
1. User signs up (email + password via Supabase Auth).
2. App requests geolocation permission.
3. App detects user's location and pre-loads a species list from the eBird API based on recent observations in their region.
4. User is dropped onto the main logging screen.

### 4.2 Logging a sighting (the primary flow)
1. User opens the app while watching their yard.
2. Main screen shows a grid/list of species buttons, each with a current count.
3. User sees 3 cardinals at the feeder → taps the cardinal button until count reads 3.
4. Later, user sees 4 cardinals at once → taps cardinal up to 4 (per eBird's "highest simultaneous count" rule).
5. User sees a new species not on the list → taps "Add species," searches, adds it.
6. User walks away. After 30 minutes of no taps, the session is silently finalized.

### 4.3 Reviewing and exporting
1. User opens the app and sees a "Pending sessions" indicator.
2. User taps in, reviews the session (date, location, duration, species + counts).
3. User can edit counts, delete the session, or export as CSV.
4. Export downloads a file in eBird Record Format ready to upload at https://ebird.org/import.

## 5. Functional Requirements

### 5.1 Authentication
- Email + password auth via Supabase Auth.
- Each user has isolated data (Row-Level Security policies in Supabase).
- Persistent sessions — user shouldn't need to log in repeatedly on the same device.

### 5.2 Species list management
- On first launch (and refreshable on demand), fetch recent observations from the eBird API for the user's region (county or lat/lng radius).
- Aggregate species across last 14–30 days, ranked by frequency.
- Display common species prominently; provide search/add for less common ones.
- The species button list is local to the user, but seeded from API data.
- Provide a "search and add" flow backed by the eBird taxonomy endpoint for any species not in the curated list.

### 5.3 "Seen here before" visual differentiation
- For each species button, query the user's own past sightings at this location (within ~1km radius).
- Visually mark species the user has logged here before (e.g., a small dot, different background, or icon).
- Species the user has never recorded at this location should look visually distinct from "lifers for this yard."
- This is meant to make the app feel personalized and reward repeat use.

### 5.4 The counter interaction
- Each species shows: name and current count.
- A single tap on the species row increments the count by 1.
- A small minus button (or long-press) decrements the count.
- When count is 0, the row is in a "neutral" visual state; once count > 0, it's clearly "active" for this session.
- Tap targets must be at least 44×44 pt for thumb-friendly use.

### 5.5 Session detection and lifecycle
- A "session" begins implicitly with the first tap when no active session exists.
- Session metadata captured: start time (first tap), location (GPS at session start), and an end time set at session finalization.
- Session ends silently when no tap has occurred for 30 minutes.
- The user is NOT notified when a session ends (per user preference).
- Finalized sessions accumulate in a "Pending review" list.
- Once finalized, a session's counts are frozen and a new tap starts a fresh session.

### 5.6 Location handling
- Each session captures GPS coordinates at session start.
- If geolocation is denied or unavailable, prompt user to enable it; allow a manual fallback (enter coordinates or pick on a map) but mark it clearly.
- Coordinates are stored per session, not per user — supports tracking from multiple yards/locations.

### 5.7 CSV export (eBird Record Format)
- Export individual sessions or batches as CSV.
- CSV must conform to the eBird Record Format expected at https://ebird.org/import. Required columns:
  - Common Name
  - Genus
  - Species
  - Number
  - Species Comments (leave blank)
  - Location Name (default to "Backyard" or user-set name)
  - Latitude
  - Longitude
  - Date (MM/DD/YYYY)
  - Start Time (HH:MM)
  - State (derived from coordinates or user-set)
  - Country
  - Protocol (use "casual" or "stationary")
  - Number of Observers (default 1)
  - Duration (minutes)
  - All observations reported? (Y/N — default Y)
  - Effort Distance (blank for stationary)
  - Effort Area (blank)
  - Submission Comments (blank)
- Export should trigger a file download in the browser.

### 5.8 Past sessions view
- List view of all finalized sessions with date, location, duration, total species count, and total individual count.
- Tapping a session shows the full breakdown.
- Filtering by date range (nice to have for v1).

### 5.9 Lifetime stats per location
- For the user's primary location (or any location), show:
  - Total species ever recorded there.
  - Most common species (by total count).
  - First and last seen date per species.
- Reachable from a "stats" tab.

## 6. Technical Requirements

### 6.1 Stack
- **Frontend:** React + Vite (or Next.js if SSR is desired — Vite is simpler for a pure SPA/PWA).
- **Styling:** Tailwind CSS.
- **PWA:** Service worker, web app manifest, installable on iOS and Android home screens.
- **Backend:** Supabase (Postgres + Auth + Row-Level Security).
- **External API:** eBird API v2.0 (https://api.ebird.org/v2/).
- **Hosting:** Vercel or Netlify (whichever the user prefers).

### 6.2 Data model (Supabase tables)
- `users` (handled by Supabase Auth)
- `locations` — id, user_id, name, lat, lng, created_at
- `sessions` — id, user_id, location_id, started_at, ended_at, finalized boolean, exported_at nullable
- `sightings` — id, session_id, species_code, common_name, scientific_name, count
- `user_species_lists` — id, user_id, location_id, species_code, common_name, scientific_name, display_order, custom_added boolean

All tables protected by Row-Level Security so users can only see/modify their own data.

### 6.3 eBird API integration
- API key stored as environment variable; never exposed to client.
- API calls proxied through Supabase Edge Functions (or a thin serverless layer) to keep the key server-side.
- Endpoints used:
  - `GET /v2/data/obs/{regionCode}/recent` — for seeding species list
  - `GET /v2/ref/taxonomy/ebird` — for species search/add
  - `GET /v2/ref/region/list/subnational2/{country}-{state}` — for resolving region from lat/lng if needed
- Cache eBird responses aggressively (24 hours is fine — backyard species lists don't change quickly).

### 6.4 Offline behavior
- App shell cached via service worker.
- Tap actions written to IndexedDB or localStorage if offline, then synced to Supabase when connection returns.
- Read-side: last-known species list cached so app is usable without network.

### 6.5 Session detection logic
- A timer (or background interval) checks: "has it been 30 minutes since the last tap on an active session?" — if yes, finalize.
- This needs to handle the user closing the app: when the app reopens, check if the last tap on the still-active session was >30 min ago and finalize on load.

## 7. UI / UX Notes

- **Single primary screen:** the species counter list. Everything else is a secondary view reachable via a small nav.
- **Default sort:** species the user has seen at this location before, in order of historical frequency, then everything else by regional frequency.
- **Visual differentiation:** species seen here before get a subtle accent (colored dot, slightly different background, or a small icon). This is the "personalized over time" payoff.
- **Counter affordance:** big tap area on the species row, small "−" button on the right. Count number is large and centered or right-aligned.
- **Active session indicator:** subtle banner or dot showing "session in progress, started 12 min ago" — informational, not interactive.
- **Pending sessions:** badge/indicator if there are finalized sessions awaiting review/export.

## 8. v1 Scope vs. Later

### v1 (build now)
- Auth, location capture, species list seeding from eBird API.
- Single primary counter screen with tap-to-increment.
- Auto session detection and finalization at 30 min inactivity.
- Pending sessions list and review/edit screen.
- CSV export in eBird Record Format.
- "Seen here before" visual differentiation.
- PWA installability.

### Could be deferred if v1 gets too big
- Past sessions list (becomes "later" but data is still being captured).
- Lifetime stats per location.
- Multi-location support beyond GPS-per-session.
- Offline tap queueing (could ship as "online-only" v1 and add offline in v1.1).

### Future / nice to have
- Photo attachments per sighting.
- Charts/visualizations of yard activity over time.
- Notifications when an unusual species is being reported nearby.
- Optional integration with eBird's checklist comments field.

## 9. Open Questions

- Should the app default the eBird "Protocol" field to "stationary" (more accurate for backyard) or "casual" (more flexible)? Stationary is probably right but requires duration to be accurate.
- How to handle a session that spans midnight — split into two checklists, or keep as one? eBird convention is to split, but it's an edge case.
- Should "seen here before" use a strict location match (same lat/lng ± 50m) or a looser radius (~1km)? Strict feels more accurate; loose is more forgiving for GPS drift.

## 10. Success Criteria

- Logging a session of 5 species takes under 30 seconds of active interaction.
- A finalized session's exported CSV uploads successfully to eBird with no manual edits.
- The user can use the app on phone and laptop with the same account and see their data sync.
- After 2 weeks of regular use, the species list visibly reflects the user's local patterns (their commonly-seen birds float to the top).

## 11. References

- eBird API v2 docs: https://documenter.getpostman.com/view/664302/S1ENwy59
- eBird API Terms of Use: https://www.birds.cornell.edu/home/ebird-api-terms-of-use/
- eBird CSV import: https://ebird.org/import
- eBird Record Format spec: https://support.ebird.org/en/support/solutions/articles/48000838205-upload-spreadsheet-data-to-ebird
- Supabase: https://supabase.com
