import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../lib/auth";
import {
  bumpSpecies,
  finalizeSession,
  getOrFinalizeActive,
  getSightingsForSession,
  SESSION_TIMEOUT_MS,
  startSession,
  touchSession
} from "../lib/sessions";
import type { Session, Sighting, UserSpecies } from "../lib/types";
import {
  batchAddUserSpecies,
  getUserSpecies,
  speciesSeenHereBefore
} from "../lib/species";
import { fetchAllRegionSpecies, fetchRegionFrequencies } from "../lib/ebird";
import { fetchBirdPhotos } from "../lib/photos";
import { getCurrentCoords, type Coords } from "../lib/geo";
import { resolveRegionFromCoords, regionLabel, type ResolvedRegion } from "../lib/region";

const REGION_KEY = "bbt-region-code";

function loadRegionCode(): string {
  return localStorage.getItem(REGION_KEY) ?? "";
}

export default function CounterScreen() {
  const { user, signOut } = useAuth();
  const [session, setSession] = useState<Session | null>(null);
  const [sightings, setSightings] = useState<Record<string, Sighting>>({});
  const [species, setSpecies] = useState<UserSpecies[]>([]);
  const [seenBefore, setSeenBefore] = useState<Set<string>>(new Set());
  const [coords, setCoords] = useState<Coords | null>(null);
  const [seedingMsg, setSeedingMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [freqMap, setFreqMap] = useState<Record<string, number>>({});
  const [regionCode, setRegionCode] = useState(loadRegionCode());
  const [resolvedRegion, setResolvedRegion] = useState<ResolvedRegion | null>(null);
  const [detectingRegion, setDetectingRegion] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [photoMap, setPhotoMap] = useState<Record<string, string>>({});
  const [now, setNow] = useState(Date.now());
  const tickRef = useRef<number | null>(null);

  // tick clock so the "active session" indicator updates
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);

  // initial load
  useEffect(() => {
    if (!user) return;
    void (async () => {
      const active = await getOrFinalizeActive(user.id);
      setSession(active);
      if (active) {
        const sList = await getSightingsForSession(active.id);
        setSightings(Object.fromEntries(sList.map(s => [s.species_code, s])));
      }

      // Try GPS for "seen here before" + future sessions + region auto-detect
      let detectedRegionCode = regionCode;
      try {
        const c = await getCurrentCoords();
        setCoords(c);
        const seen = await speciesSeenHereBefore(user.id, c);
        setSeenBefore(seen);

        // Auto-detect region from GPS if no region code is saved
        if (!regionCode) {
          setDetectingRegion(true);
          try {
            const resolved = await resolveRegionFromCoords(c.lat, c.lng);
            setResolvedRegion(resolved);
            detectedRegionCode = resolved.regionCode;
            setRegionCode(detectedRegionCode);
            localStorage.setItem(REGION_KEY, detectedRegionCode);
          } finally {
            setDetectingRegion(false);
          }
        }
      } catch {
        /* ignore */
      }

      // Load species list
      const list = await getUserSpecies(user.id, null);
      setSpecies(list);

      // Seed from eBird if empty and we have a region code (manual or auto-detected)
      if (list.length === 0 && detectedRegionCode) {
        await seedFromEbird(detectedRegionCode);
      } else if (list.length === 0) {
        setSeedingMsg(
          "Set a region code (e.g. US-CA) to seed common species from eBird."
        );
      } else if (detectedRegionCode) {
        // Returning user: backfill any missing species and load frequency data.
        // addUserSpecies silently skips duplicates, so this is safe to re-run.
        await seedFromEbird(detectedRegionCode);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const seedFromEbird = useCallback(
    async (region: string) => {
      if (!user) return;
      setSeedingMsg("Loading all species for your region…");
      try {
        // Fetch all species ever recorded + real frequency data in parallel
        const [allSpecies, rawFreqs] = await Promise.all([
          fetchAllRegionSpecies(region),
          fetchRegionFrequencies(region)
        ]);

        // rawFreqs values are 0–1 (proportion of checklists), use directly
        setFreqMap(rawFreqs);

        // Sort all species: those with frequency first (by freq desc),
        // then the rest in taxonomy order
        const sorted = [...allSpecies].sort((a, b) => {
          const fa = rawFreqs[a.speciesCode] ?? 0;
          const fb = rawFreqs[b.speciesCode] ?? 0;
          if (fa !== fb) return fb - fa;
          return 0; // preserve taxonomy order for ties
        });

        // Batch-insert all species (skips duplicates automatically)
        await batchAddUserSpecies(
          user.id,
          null,
          sorted.map((r, i) => ({
            speciesCode: r.speciesCode,
            commonName: r.comName,
            scientificName: r.sciName,
            customAdded: false,
            displayOrder: i
          }))
        );
        const list = await getUserSpecies(user.id, null);
        setSpecies(list);
        setSeedingMsg(null);
      } catch (e) {
        setSeedingMsg(
          `Couldn't load eBird data: ${(e as Error).message}. You can still add species manually.`
        );
      }
    },
    [user]
  );

  // Load frequency data whenever regionCode becomes available or changes.
  // This is separate from seedFromEbird so frequency bars appear even if
  // GPS auto-detect fails or the user sets a region manually after load.
  useEffect(() => {
    if (!regionCode) return;
    let cancelled = false;
    void (async () => {
      try {
        const rawFreqs = await fetchRegionFrequencies(regionCode);
        if (!cancelled) setFreqMap(rawFreqs);
      } catch {
        /* ignore — frequency bars just won't show */
      }
    })();
    return () => { cancelled = true; };
  }, [regionCode]);

  // Fetch bird photos from Wikipedia when the species list loads/changes
  useEffect(() => {
    if (species.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const photos = await fetchBirdPhotos(species);
        if (!cancelled) setPhotoMap(photos);
      } catch {
        /* photos are non-critical */
      }
    })();
    return () => { cancelled = true; };
  }, [species]);

  // Idle finalizer — checks every 60s if the session has gone stale
  useEffect(() => {
    if (!session) return;
    if (tickRef.current) window.clearInterval(tickRef.current);
    tickRef.current = window.setInterval(async () => {
      const last = new Date(session.last_tap_at).getTime();
      if (Date.now() - last >= SESSION_TIMEOUT_MS) {
        await finalizeSession(session.id, new Date(last + SESSION_TIMEOUT_MS));
        setSession(null);
        setSightings({});
      }
    }, 60_000);
    return () => {
      if (tickRef.current) window.clearInterval(tickRef.current);
    };
  }, [session]);

  async function ensureSession(): Promise<Session> {
    if (session) return session;
    const fresh = await startSession(user!.id);
    setSession(fresh);
    return fresh;
  }

  async function tap(s: UserSpecies, delta: number) {
    if (!user) return;
    const sess = await ensureSession();
    const updated = await bumpSpecies({
      sessionId: sess.id,
      userId: user.id,
      speciesCode: s.species_code,
      commonName: s.common_name,
      scientificName: s.scientific_name,
      delta
    });
    setSightings(prev => ({ ...prev, [s.species_code]: updated }));
    await touchSession(sess.id);
    setSession({ ...sess, last_tap_at: new Date().toISOString() });
  }

  const sortedSpecies = useMemo(() => {
    // Filter by search query
    const q = searchQuery.toLowerCase();
    const filtered = q
      ? species.filter(
          s =>
            s.common_name.toLowerCase().includes(q) ||
            s.scientific_name.toLowerCase().includes(q)
        )
      : species;

    // Ordering: active in current session first, then seen here before,
    // then by frequency (most common first), then display_order as tiebreaker.
    return [...filtered].sort((a, b) => {
      const aActive = (sightings[a.species_code]?.count ?? 0) > 0 ? 1 : 0;
      const bActive = (sightings[b.species_code]?.count ?? 0) > 0 ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      const aSeen = seenBefore.has(a.species_code) ? 1 : 0;
      const bSeen = seenBefore.has(b.species_code) ? 1 : 0;
      if (aSeen !== bSeen) return bSeen - aSeen;
      const aFreq = freqMap[a.species_code] ?? 0;
      const bFreq = freqMap[b.species_code] ?? 0;
      if (aFreq !== bFreq) return bFreq - aFreq;
      return a.display_order - b.display_order;
    });
  }, [species, sightings, seenBefore, searchQuery, freqMap]);

  const sessionMins = session
    ? Math.max(0, Math.round((now - new Date(session.started_at).getTime()) / 60000))
    : 0;

  return (
    <div className="max-w-xl mx-auto">
      <header className="px-4 pt-4 pb-2 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-brand-900">Backyard</h1>
          {session ? (
            <p className="text-xs text-slate-500">
              Session active · {sessionMins} min
              {coords && (
                <>
                  {" "}
                  · {coords.lat.toFixed(3)}, {coords.lng.toFixed(3)}
                </>
              )}
            </p>
          ) : (
            <p className="text-xs text-slate-500">Tap any species to start a session</p>
          )}
        </div>
        <div className="relative">
          <button
            onClick={() => setShowSettings(s => !s)}
            className="text-lg text-slate-400 hover:text-slate-600 w-8 h-8 grid place-items-center"
            aria-label="Settings"
            title="Settings"
          >
            {"\u2699"}
          </button>

          {showSettings && (
            <>
              {/* backdrop */}
              <div
                className="fixed inset-0 z-20"
                onClick={() => setShowSettings(false)}
              />
              {/* popover */}
              <div className="absolute right-0 top-full mt-1 z-30 w-80 border rounded-xl p-3 bg-white shadow-lg space-y-3">
                <RegionSetter
                  regionCode={regionCode}
                  resolvedRegion={resolvedRegion}
                  detectingRegion={detectingRegion}
                  onChange={r => {
                    setRegionCode(r);
                    localStorage.setItem(REGION_KEY, r);
                    setResolvedRegion(null);
                  }}
                  onSeed={r => r && void seedFromEbird(r)}
                />
                <hr className="border-slate-100" />
                <button
                  onClick={() => void signOut()}
                  className="text-xs text-slate-500 underline"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {seedingMsg && (
        <div className="mx-4 my-2 text-sm text-amber-800 bg-amber-100 rounded-lg p-3">
          {seedingMsg}
        </div>
      )}

      <div className="px-4 py-2 sticky top-0 z-10 bg-white">
        <input
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search species…"
          className="w-full border rounded-lg px-3 py-2 text-sm"
        />
      </div>

      {Object.keys(freqMap).length > 0 && (
        <p className="mx-4 mb-1 text-xs text-slate-400">
          Percentages show how often each species appears on eBird checklists in your region over the last 10 days.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 px-2 py-2">
        {sortedSpecies.map(sp => {
          const count = sightings[sp.species_code]?.count ?? 0;
          const seen = seenBefore.has(sp.species_code);
          const active = count > 0;
          const freq = freqMap[sp.species_code] ?? 0;
          const pct = Math.round(freq * 100);
          const photo = photoMap[sp.species_code];
          const initials = sp.common_name
            .split(/\s+/)
            .slice(0, 2)
            .map(w => w[0])
            .join("")
            .toUpperCase();
          return (
            <div
              key={sp.id}
              className={`relative aspect-square rounded-2xl overflow-hidden border-2 ${
                active ? "border-brand-500" : "border-slate-200"
              }`}
            >
              {/* Photo background or placeholder */}
              <button
                onClick={() => void tap(sp, 1)}
                className="absolute inset-0 w-full h-full"
                aria-label={`Increment ${sp.common_name}`}
              >
                {photo ? (
                  <img
                    src={photo}
                    alt={sp.common_name}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <div className="w-full h-full bg-slate-100 flex items-center justify-center">
                    <span className="text-3xl font-bold text-slate-300">
                      {initials}
                    </span>
                  </div>
                )}
              </button>

              {/* Count badge — top right */}
              {count > 0 && (
                <div className="absolute top-1.5 right-1.5 bg-brand-600 text-white text-sm font-bold rounded-full w-8 h-8 grid place-items-center shadow">
                  {count}
                </div>
              )}

              {/* Seen-before dot — top left */}
              {seen && (
                <div
                  className="absolute top-2 left-2 w-2.5 h-2.5 rounded-full bg-brand-500 border border-white shadow"
                  title="Seen here before"
                />
              )}

              {/* Bottom overlay with name + frequency */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent px-2 pb-2 pt-6 pointer-events-none">
                <p className="text-white text-sm font-medium leading-tight drop-shadow truncate">
                  {sp.common_name}
                </p>
                {freq > 0 && (
                  <p className="text-white text-xs font-medium tabular-nums drop-shadow">
                    {pct}%
                  </p>
                )}
              </div>

              {/* Decrement button — bottom right, above overlay */}
              <button
                onClick={() => void tap(sp, -1)}
                className="absolute bottom-1.5 right-1.5 w-7 h-7 grid place-items-center rounded-full bg-black/40 text-white text-sm hover:bg-black/60"
                aria-label={`Decrement ${sp.common_name}`}
              >
                −
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}


function RegionSetter(props: {
  regionCode: string;
  resolvedRegion: ResolvedRegion | null;
  detectingRegion: boolean;
  onChange: (r: string) => void;
  onSeed: (regionCode: string) => void;
}) {
  const [val, setVal] = useState(props.regionCode);

  // Sync local input when region is auto-detected
  useEffect(() => {
    if (props.regionCode && !val) {
      setVal(props.regionCode);
    }
  }, [props.regionCode]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-1">
      <label className="text-xs text-slate-500">Region code</label>
      <div className="flex items-center gap-2 text-sm">
        <input
          value={val}
          onChange={e => setVal(e.target.value.toUpperCase().trim())}
          placeholder="e.g. US-CA-001"
          className="border rounded-lg px-2 py-1 flex-1"
        />
        <button
          onClick={() => {
            props.onChange(val);
            props.onSeed(val);
          }}
          className="px-3 py-1 rounded-lg bg-brand-600 text-white text-xs"
        >
          Update
        </button>
      </div>
      {props.detectingRegion && (
        <p className="text-xs text-slate-400">Detecting region from GPS…</p>
      )}
      {props.resolvedRegion && (
        <p className="text-xs text-slate-500">
          Auto-detected: {regionLabel(props.resolvedRegion)}
        </p>
      )}
    </div>
  );
}

