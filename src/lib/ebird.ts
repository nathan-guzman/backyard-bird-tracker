import { supabase } from "./supabase";
import type { EbirdRecentObs, TaxonomyMatch } from "./types";

// All eBird traffic goes through the Supabase Edge Function `ebird`.
// The browser never sees the eBird API token.

const FN_NAME = "ebird";

async function callFn<T>(params: Record<string, string>): Promise<T> {
  const search = new URLSearchParams(params).toString();
  // supabase-js attaches the user JWT automatically.
  const { data, error } = await supabase.functions.invoke(`${FN_NAME}?${search}`, {
    method: "GET"
  });
  if (error) throw error;
  return data as T;
}

const CACHE_PREFIX = "bbt-ebird-cache:";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h per PRD 6.3

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
 * For a coordinate pair we currently use a simple regionCode strategy:
 *   - The user supplies (or we infer) a country + subnational1 (state) hint.
 *   - We pull "recent" observations for that subnational1.
 * eBird supports finer subnational2 (county) regions; future work can use
 * a reverse-geocoder to resolve lat/lng → county. For v1 we expose a hook
 * for the user to override the regionCode in settings.
 */
export async function fetchRecentForRegion(
  regionCode: string,
  back = 14
): Promise<EbirdRecentObs[]> {
  const cacheKey = `recent:${regionCode}:${back}`;
  const cached = readCache<EbirdRecentObs[]>(cacheKey);
  if (cached) return cached;
  const data = await callFn<EbirdRecentObs[]>({
    op: "recent",
    regionCode,
    back: String(back)
  });
  writeCache(cacheKey, data);
  return data;
}

export async function searchTaxonomy(q: string): Promise<TaxonomyMatch[]> {
  if (!q.trim()) return [];
  const cacheKey = `tax:${q.toLowerCase()}`;
  const cached = readCache<TaxonomyMatch[]>(cacheKey);
  if (cached) return cached;
  const data = await callFn<TaxonomyMatch[]>({
    op: "taxonomy_search",
    q
  });
  writeCache(cacheKey, data);
  return data;
}

/**
 * Fetch every species ever recorded in a region via the eBird product
 * species list. Returns taxonomy-ordered entries with common/scientific names.
 * Cached 24h.
 */
export async function fetchAllRegionSpecies(
  regionCode: string
): Promise<TaxonomyMatch[]> {
  const cacheKey = `region_species:${regionCode}`;
  const cached = readCache<TaxonomyMatch[]>(cacheKey);
  if (cached) return cached;
  const data = await callFn<TaxonomyMatch[]>({
    op: "region_species",
    regionCode
  });
  writeCache(cacheKey, data);
  return data;
}

/**
 * Fetch real frequency data (proportion of checklists reporting each species)
 * from the eBird bar chart download. Returns { speciesCode: avgFrequency }
 * where frequency is 0–1 (e.g. 0.4 = reported on 40% of checklists).
 * Cached 24h.
 */
export async function fetchRegionFrequencies(
  regionCode: string
): Promise<Record<string, number>> {
  const cacheKey = `region_freq:${regionCode}`;
  const cached = readCache<Record<string, number>>(cacheKey);
  if (cached) return cached;
  const data = await callFn<Record<string, number>>({
    op: "region_frequencies",
    regionCode
  });
  writeCache(cacheKey, data);
  return data;
}

/**
 * Aggregate recent obs into a frequency-ranked species list.
 * eBird returns one row per checklist sighting, so frequency = row count.
 */
export function rankSpecies(obs: EbirdRecentObs[]): {
  speciesCode: string;
  comName: string;
  sciName: string;
  freq: number;
}[] {
  const map = new Map<
    string,
    { speciesCode: string; comName: string; sciName: string; freq: number }
  >();
  for (const o of obs) {
    const cur = map.get(o.speciesCode);
    if (cur) cur.freq += 1;
    else
      map.set(o.speciesCode, {
        speciesCode: o.speciesCode,
        comName: o.comName,
        sciName: o.sciName,
        freq: 1
      });
  }
  return Array.from(map.values()).sort((a, b) => b.freq - a.freq);
}
