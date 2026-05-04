import { supabase } from "./supabase";

const CACHE_PREFIX = "bbt-region-cache:";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type ResolvedRegion = {
  regionCode: string;
  country: string;
  state?: string;
  county?: string;
  source?: string;
};

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t: number; v: T };
    if (Date.now() - parsed.t > CACHE_TTL_MS) return null;
    return parsed.v;
  } catch {
    return null;
  }
}
function writeCache<T>(key: string, v: T): void {
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ t: Date.now(), v })
    );
  } catch {
    /* quota — ignore */
  }
}

/**
 * Reverse-geocode lat/lng to an eBird region code via the
 * `region-resolver` Supabase Edge Function. Cached 24h at ~1km granularity.
 */
export async function resolveRegionFromCoords(
  lat: number,
  lng: number
): Promise<ResolvedRegion> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}`;
  const cached = readCache<ResolvedRegion>(key);
  if (cached) return cached;
  const search = new URLSearchParams({
    lat: String(lat),
    lng: String(lng)
  }).toString();
  const { data, error } = await supabase.functions.invoke(
    `region-resolver?${search}`,
    { method: "GET" }
  );
  if (error) throw error;
  const result = data as ResolvedRegion;
  writeCache(key, result);
  return result;
}

export function regionLabel(r: ResolvedRegion): string {
  return [r.county, r.state].filter(Boolean).join(", ") || r.regionCode;
}
