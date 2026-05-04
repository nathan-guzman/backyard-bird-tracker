import { supabase } from "./supabase";
import type { Session, Sighting } from "./types";
import { getCurrentCoords } from "./geo";

export const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Returns the user's currently-active (non-finalized) session, if any.
 * Also auto-finalizes a stale session whose last_tap_at is >30min ago.
 */
export async function getOrFinalizeActive(userId: string): Promise<Session | null> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("finalized", false)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const last = new Date(data.last_tap_at).getTime();
  if (Date.now() - last >= SESSION_TIMEOUT_MS) {
    await finalizeSession(data.id, new Date(last + SESSION_TIMEOUT_MS));
    return null;
  }
  return data as Session;
}

export async function startSession(userId: string): Promise<Session> {
  let lat: number | null = null;
  let lng: number | null = null;
  try {
    const c = await getCurrentCoords();
    lat = c.lat;
    lng = c.lng;
  } catch {
    // Fall back to null; the user can edit on the review screen.
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("sessions")
    .insert({
      user_id: userId,
      lat,
      lng,
      started_at: now,
      last_tap_at: now,
      finalized: false
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Session;
}

export async function touchSession(sessionId: string): Promise<void> {
  await supabase
    .from("sessions")
    .update({ last_tap_at: new Date().toISOString() })
    .eq("id", sessionId);
}

export async function finalizeSession(
  sessionId: string,
  endedAt: Date = new Date()
): Promise<void> {
  await supabase
    .from("sessions")
    .update({ finalized: true, ended_at: endedAt.toISOString() })
    .eq("id", sessionId);
}

export async function listFinalizedSessions(userId: string): Promise<Session[]> {
  const { data, error } = await supabase
    .from("sessions")
    .select("*")
    .eq("user_id", userId)
    .eq("finalized", true)
    .order("started_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Session[];
}

export async function getSightingsForSession(
  sessionId: string
): Promise<Sighting[]> {
  const { data, error } = await supabase
    .from("sightings")
    .select("*")
    .eq("session_id", sessionId)
    .order("common_name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Sighting[];
}

/**
 * Increment a species count for the active session. Creates the row if
 * needed (per-species, not per-tap). Implements eBird's "highest simultaneous
 * count" by using `count` as the running max — but since users tap up, we
 * simply increment by 1. The review screen lets them adjust down.
 */
export async function bumpSpecies(args: {
  sessionId: string;
  userId: string;
  speciesCode: string;
  commonName: string;
  scientificName: string;
  delta: number;
}): Promise<Sighting> {
  const { sessionId, userId, speciesCode, commonName, scientificName, delta } =
    args;

  // Read current count
  const { data: existing, error: readErr } = await supabase
    .from("sightings")
    .select("*")
    .eq("session_id", sessionId)
    .eq("species_code", speciesCode)
    .maybeSingle();
  if (readErr) throw readErr;

  if (existing) {
    const newCount = Math.max(0, (existing.count ?? 0) + delta);
    const { data, error } = await supabase
      .from("sightings")
      .update({ count: newCount, updated_at: new Date().toISOString() })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as Sighting;
  }

  const initial = Math.max(0, delta);
  const { data, error } = await supabase
    .from("sightings")
    .insert({
      session_id: sessionId,
      user_id: userId,
      species_code: speciesCode,
      common_name: commonName,
      scientific_name: scientificName,
      count: initial
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Sighting;
}

export async function setSpeciesCount(args: {
  sightingId: string;
  count: number;
}): Promise<void> {
  const { sightingId, count } = args;
  await supabase
    .from("sightings")
    .update({
      count: Math.max(0, count),
      updated_at: new Date().toISOString()
    })
    .eq("id", sightingId);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await supabase.from("sessions").delete().eq("id", sessionId);
}

export async function markExported(sessionId: string): Promise<void> {
  await supabase
    .from("sessions")
    .update({ exported_at: new Date().toISOString() })
    .eq("id", sessionId);
}
