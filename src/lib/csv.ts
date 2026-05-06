import type { Session, Sighting } from "./types";

/**
 * eBird Record Format (Extended) — no header row, no quotation marks.
 * Column order: A Common Name, B Genus, C Species, D Species Count,
 * E Species Comments, F Location Name, G Latitude, H Longitude,
 * I Observation Date, J Start Time, K State, L Country, M Protocol,
 * N Number of Observers, O Duration, P All Observations Reported?,
 * Q Distance Covered, R Area Covered, S Checklist Comments.
 *
 * See https://support.ebird.org/en/support/solutions/articles/48000907878
 */

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

const PROTOCOL_MAP: Record<string, string> = {
  stationary: "Stationary",
  casual: "Incidental",
  traveling: "Traveling"
};

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
  const protocol = PROTOCOL_MAP[opts.protocol ?? "stationary"] ?? "Stationary";
  const locationName = (opts.locationName ?? "Backyard").replace(/"/g, "");
  const state = opts.state ?? "";
  const country = opts.country ?? "US";
  const observers = opts.observers ?? 1;
  const lat = session.lat != null ? String(session.lat) : "";
  const lng = session.lng != null ? String(session.lng) : "";

  // eBird requires no header row — first row must be a bird observation.
  // eBird forbids quotation marks in the CSV.
  const rows: string[] = [];

  for (const s of sightings) {
    if (s.count <= 0) continue;
    const { genus, species } = splitScientific(s.scientific_name);
    const commonName = s.common_name.replace(/"/g, "");
    rows.push(
      [
        commonName,        // A - Common Name
        genus,             // B - Genus
        species,           // C - Species
        s.count,           // D - Species Count
        "",                // E - Species Comments
        locationName,      // F - Location Name
        lat,               // G - Latitude
        lng,               // H - Longitude
        fmtDate(start),    // I - Observation Date
        fmtTime(start),    // J - Start Time
        state,             // K - State
        country,           // L - Country
        protocol,          // M - Protocol
        observers,         // N - Number of Observers
        durationMin,       // O - Duration (minutes)
        "Y",               // P - All Observations Reported?
        "",                // Q - Distance Covered
        "",                // R - Area Covered
        ""                 // S - Checklist Comments
      ].join(",")
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
