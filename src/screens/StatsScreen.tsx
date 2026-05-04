import { useEffect, useState } from "react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { fetchBirdPhotos } from "../lib/photos";

type SpeciesAgg = {
  species_code: string;
  common_name: string;
  scientific_name: string;
  totalCount: number;
  firstSeen: string;
  lastSeen: string;
};

export default function StatsScreen() {
  const { user } = useAuth();
  const [rows, setRows] = useState<SpeciesAgg[]>([]);
  const [totalSessions, setTotalSessions] = useState(0);
  const [loading, setLoading] = useState(true);
  const [photoMap, setPhotoMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    void (async () => {
      setLoading(true);
      const { count } = await supabase
        .from("sessions")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("finalized", true);
      setTotalSessions(count ?? 0);

      // Pull all sightings joined with their session start time.
      // For backyard scale, fine to do client-side aggregation.
      const { data } = await supabase
        .from("sightings")
        .select(
          "species_code, common_name, scientific_name, count, updated_at, session:session_id(started_at, finalized)"
        )
        .eq("user_id", user.id)
        .gt("count", 0);

        type Row = {
          species_code: string;
          common_name: string;
          scientific_name: string;
          count: number;
          updated_at: string;
          session:
            | { started_at: string; finalized: boolean }
            | { started_at: string; finalized: boolean }[]
            | null;
        };
        const map = new Map<string, SpeciesAgg>();
        for (const r of (data ?? []) as unknown as Row[]) {
          const sess = Array.isArray(r.session) ? r.session[0] : r.session;
          if (!sess?.finalized) continue;
          const key = r.species_code;
          const when = sess.started_at;
        const cur = map.get(key);
        if (cur) {
          cur.totalCount += r.count;
          if (when < cur.firstSeen) cur.firstSeen = when;
          if (when > cur.lastSeen) cur.lastSeen = when;
        } else {
          map.set(key, {
            species_code: r.species_code,
            common_name: r.common_name,
            scientific_name: r.scientific_name,
            totalCount: r.count,
            firstSeen: when,
            lastSeen: when
          });
        }
      }
      setRows(
        Array.from(map.values()).sort((a, b) => b.totalCount - a.totalCount)
      );
      setLoading(false);
    })();
  }, [user]);

  useEffect(() => {
    if (rows.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const photos = await fetchBirdPhotos(
          rows.map(r => ({ species_code: r.species_code, scientific_name: r.scientific_name }))
        );
        if (!cancelled) setPhotoMap(photos);
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [rows]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold text-brand-900 mb-3">
        Lifetime stats
      </h1>
      <div className="bg-white rounded-2xl border p-4 mb-4 grid grid-cols-2 gap-2 text-center">
        <div>
          <div className="text-3xl font-bold text-brand-700">{rows.length}</div>
          <div className="text-xs text-slate-500">Species recorded</div>
        </div>
        <div>
          <div className="text-3xl font-bold text-brand-700">
            {totalSessions}
          </div>
          <div className="text-xs text-slate-500">Sessions</div>
        </div>
      </div>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {!loading && rows.length === 0 && (
        <p className="text-sm text-slate-500">
          Once you finalize a session, stats appear here.
        </p>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {rows.map(r => {
          const photo = photoMap[r.species_code];
          const initials = r.common_name
            .split(/\s+/)
            .slice(0, 2)
            .map(w => w[0])
            .join("")
            .toUpperCase();
          return (
            <div
              key={r.species_code}
              className="relative aspect-square rounded-2xl overflow-hidden border-2 border-slate-200"
            >
              {photo ? (
                <img
                  src={photo}
                  alt={r.common_name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full bg-slate-100 flex items-center justify-center">
                  <span className="text-3xl font-bold text-slate-300">{initials}</span>
                </div>
              )}

              {/* Count badge — top right */}
              <div className="absolute top-1.5 right-1.5 bg-brand-600 text-white text-sm font-bold rounded-full min-w-8 h-8 grid place-items-center shadow px-1.5">
                {r.totalCount}
              </div>

              {/* Bottom overlay with name */}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 via-black/40 to-transparent px-2 pb-2 pt-6">
                <p className="text-white text-sm font-medium leading-tight drop-shadow truncate">
                  {r.common_name}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
