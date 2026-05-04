import { supabase } from "./supabase";
import type { UserSpecies } from "./types";
import { distMeters, type Coords } from "./geo";

export async function getUserSpecies(
  userId: string,
  locationId: string | null
): Promise<UserSpecies[]> {
  let q = supabase
    .from("user_species_lists")
    .select("*")
    .eq("user_id", userId)
    .order("display_order", { ascending: true });
  if (locationId) q = q.eq("location_id", locationId);
  else q = q.is("location_id", null);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as UserSpecies[];
}

/**
 * Insert a species row if it doesn't already exist for this user+location+species.
 *
 * The uniqueness constraint differs by whether location_id is null:
 *   - location_id IS NULL → partial unique index (user_id, species_code) where location_id is null
 *   - location_id NOT NULL → unique constraint (user_id, location_id, species_code)
 *
 * supabase-js upsert needs a single conflict target, so we do a pre-check
 * + insert. Race conditions surface as duplicate-key errors (`23505`)
 * which we swallow.
 */
export async function addUserSpecies(args: {
  userId: string;
  locationId: string | null;
  speciesCode: string;
  commonName: string;
  scientificName: string;
  customAdded: boolean;
  displayOrder: number;
}): Promise<void> {
  let q = supabase
    .from("user_species_lists")
    .select("id")
    .eq("user_id", args.userId)
    .eq("species_code", args.speciesCode);
  if (args.locationId) q = q.eq("location_id", args.locationId);
  else q = q.is("location_id", null);
  const { data: existing, error: readErr } = await q.maybeSingle();
  if (readErr) throw readErr;
  if (existing) return;

  const { error } = await supabase.from("user_species_lists").insert({
    user_id: args.userId,
    location_id: args.locationId,
    species_code: args.speciesCode,
    common_name: args.commonName,
    scientific_name: args.scientificName,
    custom_added: args.customAdded,
    display_order: args.displayOrder
  });
  if (error && error.code !== "23505") throw error;
}

/**
 * Batch-insert species rows, skipping any that already exist for this
 * user+location. Much faster than calling addUserSpecies in a loop.
 */
export async function batchAddUserSpecies(
  userId: string,
  locationId: string | null,
  rows: {
    speciesCode: string;
    commonName: string;
    scientificName: string;
    customAdded: boolean;
    displayOrder: number;
  }[]
): Promise<void> {
  if (rows.length === 0) return;

  // 1. Find which species already exist
  let q = supabase
    .from("user_species_lists")
    .select("species_code")
    .eq("user_id", userId);
  if (locationId) q = q.eq("location_id", locationId);
  else q = q.is("location_id", null);
  const { data: existing, error: readErr } = await q;
  if (readErr) throw readErr;

  const existingCodes = new Set((existing ?? []).map(r => r.species_code));
  const toInsert = rows
    .filter(r => !existingCodes.has(r.speciesCode))
    .map(r => ({
      user_id: userId,
      location_id: locationId,
      species_code: r.speciesCode,
      common_name: r.commonName,
      scientific_name: r.scientificName,
      custom_added: r.customAdded,
      display_order: r.displayOrder
    }));

  if (toInsert.length === 0) return;

  // 2. Batch insert in chunks of 500 (Supabase row limit)
  for (let i = 0; i < toInsert.length; i += 500) {
    const chunk = toInsert.slice(i, i + 500);
    const { error } = await supabase.from("user_species_lists").insert(chunk);
    if (error && error.code !== "23505") throw error;
  }
}

/**
 * "Seen here before" — return the set of species_codes the user has
 * recorded at sessions whose coords are within `radiusMeters` of `here`.
 */
export async function speciesSeenHereBefore(
  userId: string,
  here: Coords,
  radiusMeters = 1000
): Promise<Set<string>> {
  const { data: sessions, error } = await supabase
    .from("sessions")
    .select("id, lat, lng")
    .eq("user_id", userId)
    .eq("finalized", true)
    .not("lat", "is", null)
    .not("lng", "is", null);
  if (error) throw error;

  const nearbyIds = (sessions ?? [])
    .filter(s => {
      if (s.lat == null || s.lng == null) return false;
      return distMeters(here, { lat: s.lat, lng: s.lng }) <= radiusMeters;
    })
    .map(s => s.id);

  if (nearbyIds.length === 0) return new Set();

  const { data: sightings, error: sErr } = await supabase
    .from("sightings")
    .select("species_code, count")
    .in("session_id", nearbyIds)
    .gt("count", 0);
  if (sErr) throw sErr;

  return new Set((sightings ?? []).map(r => r.species_code));
}
