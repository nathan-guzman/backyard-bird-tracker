import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
  deleteSession,
  getSightingsForSession,
  markExported,
  setSpeciesCount
} from "../lib/sessions";
import type { Session, Sighting } from "../lib/types";
import { buildEbirdCsv, downloadCsv, type ExportOpts } from "../lib/csv";
import { fetchBirdPhotos } from "../lib/photos";

const EXPORT_OPTS_KEY = "bbt-export-opts";

function loadExportOpts(): ExportOpts {
  try {
    return JSON.parse(localStorage.getItem(EXPORT_OPTS_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function saveExportOpts(o: ExportOpts) {
  localStorage.setItem(EXPORT_OPTS_KEY, JSON.stringify(o));
}

export default function SessionDetailScreen() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [sightings, setSightings] = useState<Sighting[]>([]);
  const [opts, setOpts] = useState<ExportOpts>(loadExportOpts());
  const [photoMap, setPhotoMap] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!id) return;
    void (async () => {
      const { data } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      setSession(data as Session);
      const s = await getSightingsForSession(id);
      setSightings(s);
    })();
  }, [id]);

  useEffect(() => {
    if (sightings.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const photos = await fetchBirdPhotos(
          sightings.map(s => ({ species_code: s.species_code, scientific_name: s.scientific_name }))
        );
        if (!cancelled) setPhotoMap(photos);
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [sightings]);

  if (!session) {
    return (
      <div className="p-4 text-slate-500 text-sm max-w-xl mx-auto">Loading…</div>
    );
  }

  const start = new Date(session.started_at);
  const end = session.ended_at ? new Date(session.ended_at) : null;
  const mins = end
    ? Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
    : 0;

  async function changeCount(s: Sighting, next: number) {
    await setSpeciesCount({ sightingId: s.id, count: next });
    setSightings(prev =>
      prev.map(p => (p.id === s.id ? { ...p, count: Math.max(0, next) } : p))
    );
  }

  async function doExport() {
    if (!session) return;
    const csv = buildEbirdCsv(
      session,
      sightings.filter(s => s.count > 0),
      opts
    );
    const fname = `ebird-${start.toISOString().slice(0, 10)}-${session.id.slice(0, 8)}.csv`;
    downloadCsv(fname, csv);
    await markExported(session.id);
    setSession({ ...session, exported_at: new Date().toISOString() });
  }

  async function doDelete() {
    if (!session) return;
    if (!confirm("Delete this session and all its sightings?")) return;
    await deleteSession(session.id);
    nav("/pending");
  }

  return (
    <div className="max-w-xl mx-auto p-4 space-y-4">
      <button
        onClick={() => nav(-1)}
        className="text-sm text-brand-700"
      >
        ← Back
      </button>

      <header className="bg-white rounded-2xl border p-4">
        <div className="text-sm text-slate-500">
          {start.toLocaleString()}
          {end && ` → ${end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
        </div>
        <div className="text-sm">
          {mins} min ·{" "}
          {session.lat != null && session.lng != null
            ? `${session.lat.toFixed(4)}, ${session.lng.toFixed(4)}`
            : "no GPS"}
        </div>
      </header>

      <section className="bg-white rounded-2xl border p-4">
        <h2 className="font-semibold mb-2">Counts</h2>
        {sightings.length === 0 && (
          <p className="text-sm text-slate-500">No sightings recorded.</p>
        )}
        <ul className="divide-y">
          {sightings.map(s => {
            const photo = photoMap[s.species_code];
            return (
            <li key={s.id} className="py-2 flex items-center gap-2">
              {photo ? (
                <img
                  src={photo}
                  alt={s.common_name}
                  className="w-10 h-10 rounded-lg object-cover flex-shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-slate-300">
                    {s.common_name.split(/\s+/).slice(0, 2).map(w => w[0]).join("").toUpperCase()}
                  </span>
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{s.common_name}</div>
                <div className="text-xs italic text-slate-500">
                  {s.scientific_name}
                </div>
              </div>
              <button
                className="w-9 h-9 rounded-full bg-slate-100"
                onClick={() => void changeCount(s, s.count - 1)}
              >
                −
              </button>
              <input
                type="number"
                min={0}
                value={s.count}
                onChange={e => void changeCount(s, Number(e.target.value))}
                className="w-14 text-center border rounded px-1 py-1 tabular-nums"
              />
              <button
                className="w-9 h-9 rounded-full bg-brand-100 text-brand-800"
                onClick={() => void changeCount(s, s.count + 1)}
              >
                +
              </button>
            </li>
          );
          })}
        </ul>
      </section>

      <section className="bg-white rounded-2xl border p-4 space-y-2">
        <h2 className="font-semibold">Export options</h2>
        <Field
          label="Location name"
          value={opts.locationName ?? ""}
          onChange={v => {
            const next = { ...opts, locationName: v };
            setOpts(next);
            saveExportOpts(next);
          }}
          placeholder="Backyard"
        />
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="State"
            value={opts.state ?? ""}
            onChange={v => {
              const next = { ...opts, state: v };
              setOpts(next);
              saveExportOpts(next);
            }}
            placeholder="CA"
          />
          <Field
            label="Country"
            value={opts.country ?? "US"}
            onChange={v => {
              const next = { ...opts, country: v };
              setOpts(next);
              saveExportOpts(next);
            }}
            placeholder="US"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Field
            label="Observers"
            value={String(opts.observers ?? 1)}
            onChange={v => {
              const next = { ...opts, observers: Number(v) || 1 };
              setOpts(next);
              saveExportOpts(next);
            }}
          />
          <div>
            <label className="block text-xs text-slate-500">Protocol</label>
            <select
              className="w-full border rounded-lg px-2 py-2"
              value={opts.protocol ?? "stationary"}
              onChange={e => {
                const next = {
                  ...opts,
                  protocol: e.target.value as ExportOpts["protocol"]
                };
                setOpts(next);
                saveExportOpts(next);
              }}
            >
              <option value="stationary">stationary</option>
              <option value="casual">casual</option>
              <option value="traveling">traveling</option>
            </select>
          </div>
        </div>
      </section>

      <div className="flex gap-2">
        <button
          onClick={() => void doExport()}
          className="flex-1 py-3 rounded-xl bg-brand-600 text-white font-medium"
        >
          Export CSV
        </button>
        <button
          onClick={() => void doDelete()}
          className="px-4 py-3 rounded-xl bg-red-50 text-red-700 border border-red-200"
        >
          Delete
        </button>
      </div>

      {session.exported_at && (
        <p className="text-xs text-slate-500 text-center">
          Last exported {new Date(session.exported_at).toLocaleString()}.
          Upload at <a href="https://ebird.org/import/upload.form?theme=ebird" target="_blank" rel="noopener noreferrer" className="underline">ebird.org/import</a>.
        </p>
      )}
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-500">{props.label}</label>
      <input
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        className="w-full border rounded-lg px-2 py-2"
      />
    </div>
  );
}
