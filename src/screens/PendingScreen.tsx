import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { listFinalizedSessions } from "../lib/sessions";
import type { Session } from "../lib/types";
import { supabase } from "../lib/supabase";

type Row = Session & {
  totalSpecies: number;
  totalBirds: number;
};

export default function PendingScreen() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      setLoading(true);
      const sessions = await listFinalizedSessions(user.id);
      const ids = sessions.map(s => s.id);
      const { data: sights } = ids.length
        ? await supabase
            .from("sightings")
            .select("session_id, count")
            .in("session_id", ids)
            .gt("count", 0)
        : { data: [] };
      const agg = new Map<string, { species: number; birds: number }>();
      for (const r of sights ?? []) {
        const cur = agg.get(r.session_id as string) ?? { species: 0, birds: 0 };
        cur.species += 1;
        cur.birds += r.count as number;
        agg.set(r.session_id as string, cur);
      }
      setRows(
        sessions.map(s => ({
          ...s,
          totalSpecies: agg.get(s.id)?.species ?? 0,
          totalBirds: agg.get(s.id)?.birds ?? 0
        }))
      );
      setLoading(false);
    })();
  }, [user]);

  return (
    <div className="max-w-xl mx-auto p-4">
      <h1 className="text-xl font-semibold text-brand-900 mb-3">Sessions</h1>
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && rows.length === 0 && (
        <p className="text-sm text-slate-500">
          No finalized sessions yet. Tap species on the Count tab to start one.
        </p>
      )}
      <ul className="space-y-2">
        {rows.map(r => {
          const start = new Date(r.started_at);
          const end = r.ended_at ? new Date(r.ended_at) : null;
          const mins = end
            ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
            : 0;
          return (
            <li key={r.id}>
              <Link
                to={`/sessions/${r.id}`}
                className="block bg-white border rounded-2xl p-4"
              >
                <div className="flex justify-between">
                  <div className="font-medium">
                    {start.toLocaleDateString()} ·{" "}
                    {start.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit"
                    })}
                  </div>
                  {r.exported_at ? (
                    <span className="text-xs text-slate-500">Exported</span>
                  ) : (
                    <span className="text-xs text-brand-700 font-medium">
                      Pending
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  {mins} min · {r.totalSpecies} species · {r.totalBirds} birds
                  {r.lat != null && r.lng != null && (
                    <>
                      {" "}
                      · {r.lat.toFixed(3)}, {r.lng.toFixed(3)}
                    </>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
