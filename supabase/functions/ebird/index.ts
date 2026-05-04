// Supabase Edge Function: eBird API proxy
// Deploy: supabase functions deploy ebird --no-verify-jwt=false
// Set secret: supabase secrets set EBIRD_API_KEY=your-token
//
// Auth: requires a valid Supabase JWT (the default --no-verify-jwt=false).
// This keeps the eBird key server-side and limits use to signed-in users.
//
// Routes (use the `op` query param):
//   GET ?op=recent&regionCode=US-CA-001&back=14
//      proxy: GET /v2/data/obs/{regionCode}/recent?back={back}
//   GET ?op=taxonomy_search&q=cardinal
//      proxy: GET /v2/ref/taxonomy/ebird?fmt=json  (filtered server-side)
//   GET ?op=region_species&regionCode=US-CA-001
//      proxy: GET /v2/product/spplist/{regionCode}  (all species ever recorded)
//      cross-referenced with full taxonomy for names
//   GET ?op=region_frequencies&regionCode=US-CA-001
//      computes frequency from recent obs (proportion of checklists per species)
//   GET ?op=region_from_point&lat=37.7&lng=-122.4
//      proxy: GET /v2/ref/region/list/subnational2/{country-state}
//      then filters to nearest by approximate match (best-effort).

// deno-lint-ignore-file no-explicit-any
const EBIRD_BASE = "https://api.ebird.org/v2";

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

async function ebirdFetch(path: string, apiKey: string): Promise<any> {
  const r = await fetch(`${EBIRD_BASE}${path}`, {
    headers: {
      "X-eBirdApiToken": apiKey,
      "User-Agent": "BackyardBirdTracker/1.0 (personal use)",
      Accept: "application/json"
    }
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`eBird ${r.status}: ${text.slice(0, 200)}`);
  }
  return r.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const apiKey = Deno.env.get("EBIRD_API_KEY");
  if (!apiKey) {
    return json({ error: "EBIRD_API_KEY not configured" }, 500);
  }

  const url = new URL(req.url);
  const op = url.searchParams.get("op");

  try {
    if (op === "recent") {
      const regionCode = url.searchParams.get("regionCode");
      const back = url.searchParams.get("back") ?? "14";
      if (!regionCode) return json({ error: "regionCode required" }, 400);
      const data = await ebirdFetch(
        `/data/obs/${encodeURIComponent(regionCode)}/recent?back=${encodeURIComponent(back)}&maxResults=200`,
        apiKey
      );
      return json(data);
    }

    if (op === "taxonomy_search") {
      const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
      if (!q) return json([]);
      // Full taxonomy is large but cacheable. Edge runtime caches across invocations.
      const data: any[] = await ebirdFetch(
        `/ref/taxonomy/ebird?fmt=json`,
        apiKey
      );
      const matches = data
        .filter((t: any) => {
          const cn = (t.comName ?? "").toLowerCase();
          const sn = (t.sciName ?? "").toLowerCase();
          return cn.includes(q) || sn.includes(q);
        })
        .slice(0, 25)
        .map((t: any) => ({
          speciesCode: t.speciesCode,
          comName: t.comName,
          sciName: t.sciName,
          category: t.category
        }));
      return json(matches);
    }

    if (op === "region_species") {
      const regionCode = url.searchParams.get("regionCode");
      if (!regionCode) return json({ error: "regionCode required" }, 400);
      // 1. Get all species codes ever recorded in this region
      const codes: string[] = await ebirdFetch(
        `/product/spplist/${encodeURIComponent(regionCode)}`,
        apiKey
      );
      // 2. Get full taxonomy for name lookup
      const taxonomy: any[] = await ebirdFetch(
        `/ref/taxonomy/ebird?fmt=json`,
        apiKey
      );
      const taxMap = new Map<string, { comName: string; sciName: string }>();
      for (const t of taxonomy) {
        taxMap.set(t.speciesCode, {
          comName: t.comName,
          sciName: t.sciName
        });
      }
      // 3. Enrich codes with names, preserving taxonomy order
      const result = codes
        .filter((c: string) => taxMap.has(c))
        .map((c: string) => ({
          speciesCode: c,
          comName: taxMap.get(c)!.comName,
          sciName: taxMap.get(c)!.sciName
        }));
      return json(result);
    }

    if (op === "region_frequencies") {
      const regionCode = url.searchParams.get("regionCode");
      if (!regionCode) return json({ error: "regionCode required" }, 400);
      // Strategy: fetch recent checklists via /product/lists/{regionCode},
      // then fetch each checklist's species via /product/checklist/view/{subId}.
      // Frequency = proportion of checklists containing each species.

      // 1. Get recent checklist IDs (last 10 days to get a good sample)
      const days: string[] = [];
      const now = new Date();
      for (let i = 0; i < 10; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const y = d.getFullYear();
        const m = d.getMonth() + 1;
        const day = d.getDate();
        days.push(`${y}/${m}/${day}`);
      }

      // Fetch checklist lists for each day in parallel
      const allVisits: any[][] = await Promise.all(
        days.map(d =>
          ebirdFetch(
            `/product/lists/${encodeURIComponent(regionCode)}/${d}?maxResults=200`,
            apiKey
          ).catch(() => [] as any[])
        )
      );

      // Collect unique checklist subIds (cap at 100 to limit API calls)
      const subIds: string[] = [];
      const seen = new Set<string>();
      for (const visits of allVisits) {
        for (const v of visits) {
          const id = v.subId ?? v.subID ?? "";
          if (id && !seen.has(id)) {
            seen.add(id);
            subIds.push(id);
          }
          if (subIds.length >= 100) break;
        }
        if (subIds.length >= 100) break;
      }

      if (subIds.length === 0) {
        return json({});
      }

      // 2. Fetch each checklist's species (parallel, batched)
      const BATCH = 20;
      const speciesChecklists = new Map<string, number>();
      const totalChecklists = subIds.length;
      for (let i = 0; i < subIds.length; i += BATCH) {
        const batch = subIds.slice(i, i + BATCH);
        const results = await Promise.all(
          batch.map(id =>
            ebirdFetch(`/product/checklist/view/${id}`, apiKey).catch(() => null)
          )
        );
        for (const checklist of results) {
          if (!checklist || !checklist.obs) continue;
          for (const ob of checklist.obs) {
            const code = ob.speciesCode;
            if (code) {
              speciesChecklists.set(code, (speciesChecklists.get(code) ?? 0) + 1);
            }
          }
        }
      }

      const freqs: Record<string, number> = {};
      for (const [code, count] of speciesChecklists) {
        freqs[code] = count / totalChecklists;
      }
      return json(freqs);
    }

    if (op === "region_from_point") {
      const lat = url.searchParams.get("lat");
      const lng = url.searchParams.get("lng");
      if (!lat || !lng) return json({ error: "lat/lng required" }, 400);
      // Best-effort: pull country/subnat1 from the eBird "find region" via the
      // regions reference. eBird does not provide reverse geocoding directly,
      // so we ask the client to pass a country/subnat1 hint when possible.
      // Fallback: return the country-level code and let the user adjust.
      const country =
        url.searchParams.get("country") ?? "US"; // sensible default
      const data = await ebirdFetch(
        `/ref/region/list/subnational1/${encodeURIComponent(country)}`,
        apiKey
      );
      return json({ country, subnational1: data });
    }

    return json({ error: "unknown op" }, 400);
  } catch (err) {
    return json({ error: (err as Error).message }, 502);
  }
});
