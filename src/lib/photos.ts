const CACHE_PREFIX = "bbt-photo:";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function readCache(key: string): string | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t: number; v: string };
    if (Date.now() - parsed.t > CACHE_TTL_MS) return null;
    return parsed.v;
  } catch {
    return null;
  }
}

function writeCache(key: string, v: string): void {
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ t: Date.now(), v })
    );
  } catch {
    /* quota — ignore */
  }
}

type SpeciesInput = { species_code: string; scientific_name: string };

/**
 * Fetch bird thumbnail URLs from the Wikipedia `pageimages` API.
 * Looks up articles by scientific name (most reliable for birds).
 * Batches requests (50 titles per API call). Caches per species for 7 days.
 *
 * Returns a map of speciesCode → thumbnail URL.
 */
export async function fetchBirdPhotos(
  species: SpeciesInput[]
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};

  // Check cache first, collect uncached species
  const uncached: SpeciesInput[] = [];
  for (const sp of species) {
    const cached = readCache(sp.species_code);
    if (cached) {
      result[sp.species_code] = cached;
    } else {
      uncached.push(sp);
    }
  }

  if (uncached.length === 0) return result;

  // Build a map from normalized scientific name → species_code for lookup
  const nameToCode = new Map<string, string>();
  for (const sp of uncached) {
    nameToCode.set(sp.scientific_name.toLowerCase(), sp.species_code);
  }

  // Batch into groups of 50 (Wikipedia API limit)
  const BATCH = 50;
  for (let i = 0; i < uncached.length; i += BATCH) {
    const batch = uncached.slice(i, i + BATCH);
    const titles = batch.map(sp => sp.scientific_name).join("|");
    const url =
      `https://en.wikipedia.org/w/api.php?action=query` +
      `&titles=${encodeURIComponent(titles)}` +
      `&prop=pageimages&pithumbsize=300&format=json&origin=*&redirects=1`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const data = await resp.json();
      const pages = data?.query?.pages;
      if (!pages) continue;

      // Build reverse redirect map: redirected title → original scientific name
      // Wikipedia returns redirects as [{from: "Scientific name", to: "Common name"}]
      const redirectToOriginal = new Map<string, string>();
      if (data.query?.redirects) {
        for (const r of data.query.redirects as { from: string; to: string }[]) {
          redirectToOriginal.set(r.to.toLowerCase(), r.from.toLowerCase());
        }
      }

      for (const page of Object.values(pages) as any[]) {
        const thumb = page?.thumbnail?.source;
        if (!thumb) continue;
        const title = (page.title ?? "").toLowerCase();
        // Try direct match first, then check if this is a redirect target
        const originalName = redirectToOriginal.get(title) ?? title;
        const code = nameToCode.get(originalName);
        if (code) {
          result[code] = thumb;
          writeCache(code, thumb);
        }
      }
    } catch {
      // Network error for this batch — skip, photos are non-critical
    }
  }

  return result;
}
