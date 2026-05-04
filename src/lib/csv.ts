import type { Session, Sighting } from "./types";

// eBird Record Format columns (PRD §5.7)
const HEADERS = [
  "Common Name",
  "Genus",
  "Species",
  "Number",
  "Species Comments",
  "Location Name",
  "Latitude",
  "Longitude",
  "Date",
  "Start Time",
  "State",
  "Country",
  "Protocol",
  "Number of Observers",
  "Duration",
  "All observations reported?",
  "Effort Distance",
  "Effort Area",
  "Submission Comments"
];

function csvEscape(v: string | number | null | undefined): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function fmtDate(d: Date): string {
  // MM/DD/YYYY
  return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}/${d.getFullYear()}`;
}

function fmtTime(d: Date): string {
  // HH:MM (24h)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function splitScientific(sci: string): { genus: string; species: string } {
  const parts = sci.trim().split(/\s+/);
  return { genus: parts[0] ?? "", species: parts.slice(1).join(" ") };
}

export type ExportOpts = {
  locationName?: string;
  state?: string;
  country?: string;
  observers?: number;
  protocol?: "stationary" | "casual" | "traveling";
};

export function buildEbirdCsv(
  session: Session,
  sightings: Sighting[],
  opts: ExportOpts = {}
): string {
  const start = new Date(session.started_at);
  const end = session.ended_at ? new Date(session.ended_at) : new Date();
  const durationMin = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / 60000)
  );
  const protocol = opts.protocol ?? "stationary";
  const locationName = opts.locationName ?? "Backyard";
  const state = opts.state ?? "";
  const country = opts.country ?? "US";
  const observers = opts.observers ?? 1;

  const rows: string[] = [];
  rows.push(HEADERS.map(csvEscape).join(","));

  for (const s of sightings) {
    if (s.count <= 0) continue;
    const { genus, species } = splitScientific(s.scientific_name);
    rows.push(
      [
        s.common_name,
        genus,
        species,
        s.count,
        "",
        locationName,
        session.lat ?? "",
        session.lng ?? "",
        fmtDate(start),
        fmtTime(start),
        state,
        country,
        protocol,
        observers,
        durationMin,
        "Y",
        "",
        "",
        ""
      ]
        .map(csvEscape)
        .join(",")
    );
  }
  return rows.join("\n");
}

export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
