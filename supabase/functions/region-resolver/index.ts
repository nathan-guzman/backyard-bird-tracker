// Reverse-geocode lat/lng → eBird region code.
//
// Strategy:
//   1. Call Nominatim (OpenStreetMap) reverse geocode to get country, state name,
//      county name.
//   2. Map state name → 2-letter USPS code.
//   3. Look up county FIPS from a bundled list (US only) or fall back to
//      eBird's subnational1 region (e.g. US-GA) for non-US or unmappable cases.
//
// Nominatim usage policy requires a real User-Agent and limits to ~1 req/s.
// We cache results in-memory across invocations for the function's lifetime.
//
// Returns: { regionCode: "US-GA-121", country, state, county, source }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" }
  });
}

// US state name → 2-letter code (and DC + territories eBird supports)
const STATE_CODES: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR",
  California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  "District of Columbia": "DC", Florida: "FL", Georgia: "GA",
  Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME",
  Maryland: "MD", Massachusetts: "MA", Michigan: "MI", Minnesota: "MN",
  Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE",
  Nevada: "NV", "New Hampshire": "NH", "New Jersey": "NJ",
  "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
  "North Dakota": "ND", Ohio: "OH", Oklahoma: "OK", Oregon: "OR",
  Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC",
  "South Dakota": "SD", Tennessee: "TN", Texas: "TX", Utah: "UT",
  Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY",
  "Puerto Rico": "PR", "U.S. Virgin Islands": "VI",
  Guam: "GU", "American Samoa": "AS", "Northern Mariana Islands": "MP"
};

type Cached = { regionCode: string; country: string; state?: string; county?: string };
const cache = new Map<string, Cached>();
function cacheKey(lat: number, lng: number): string {
  // ~1km granularity is plenty for region resolution
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

async function nominatimReverse(lat: number, lng: number) {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&zoom=10`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "BackyardBirdTracker/1.0 (personal, contact via app)",
      Accept: "application/json"
    }
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`Nominatim ${r.status}: ${t.slice(0, 150)}`);
  }
  return r.json();
}

// Census FIPS lookup via geocoder (free, no key). Returns county FIPS for US points.
async function censusFips(lat: number, lng: number): Promise<{ stateFips: string; countyFips: string } | null> {
  const url = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lng}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json`;
  const r = await fetch(url, {
    headers: {
      "User-Agent": "BackyardBirdTracker/1.0",
      Accept: "application/json"
    }
  });
  if (!r.ok) return null;
  const data = await r.json();
  const counties = data?.result?.geographies?.Counties;
  if (!counties || counties.length === 0) return null;
  const c = counties[0];
  return { stateFips: c.STATE, countyFips: c.COUNTY };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const latStr = url.searchParams.get("lat");
  const lngStr = url.searchParams.get("lng");
  if (!latStr || !lngStr) return json({ error: "lat/lng required" }, 400);
  const lat = Number(latStr);
  const lng = Number(lngStr);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return json({ error: "invalid lat/lng" }, 400);
  }

  const ck = cacheKey(lat, lng);
  const hit = cache.get(ck);
  if (hit) return json({ ...hit, source: "cache" });

  try {
    const nom = await nominatimReverse(lat, lng);
    const addr = nom.address ?? {};
    const cc = (addr.country_code ?? "").toUpperCase();

    // Non-US: fall back to country-level region code (eBird supports e.g. CA, MX, GB)
    if (cc !== "US") {
      const result: Cached = {
        regionCode: cc || "US",
        country: cc || "US",
        state: addr.state,
        county: addr.county
      };
      cache.set(ck, result);
      return json({ ...result, source: "nominatim-country" });
    }

    const stateName = addr.state as string | undefined;
    const stateCode = stateName ? STATE_CODES[stateName] : undefined;

    // Try Census for accurate county FIPS
    const fips = await censusFips(lat, lng);
    if (fips && stateCode) {
      const regionCode = `US-${stateCode}-${fips.countyFips}`;
      const result: Cached = {
        regionCode,
        country: "US",
        state: stateCode,
        county: addr.county
      };
      cache.set(ck, result);
      return json({ ...result, source: "census+nominatim" });
    }

    // Fallback: state-level
    if (stateCode) {
      const result: Cached = {
        regionCode: `US-${stateCode}`,
        country: "US",
        state: stateCode,
        county: addr.county
      };
      cache.set(ck, result);
      return json({ ...result, source: "nominatim-state" });
    }

    return json({ error: "unable to resolve region", nominatim: addr }, 502);
  } catch (err) {
    return json({ error: (err as Error).message }, 502);
  }
});
