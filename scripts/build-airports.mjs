/**
 * Fetches OurAirports CSV and writes public/airports-icao.json:
 * ICAO → [lat, lon, displayName, iata] for airports with a 3-letter IATA code.
 * Run: node scripts/build-airports.mjs
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "airports-icao.json");
const SRC =
  "https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv";

function parseCsvLine(line) {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ",") {
      fields.push(cur);
      cur = "";
      continue;
    }
    cur += c;
  }
  fields.push(cur);
  return fields;
}

function pickIcao(cols, h) {
  const cands = [
    cols[h.icao_code],
    cols[h.gps_code],
    cols[h.ident]
  ];
  for (const raw of cands) {
    const t = (raw ?? "").trim().toUpperCase();
    if (/^[A-Z0-9]{4}$/.test(t)) return t;
  }
  return null;
}

async function main() {
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`Fetch airports.csv: HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("Empty CSV");

  const header = parseCsvLine(lines[0]).map((k) => k.replace(/^\uFEFF/, "").trim());
  const h = Object.fromEntries(header.map((name, i) => [name, i]));

  const out = {};

  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li]);
    if (cols.length < header.length) continue;

    const iataRaw = cols[h.iata_code] ?? "";
    const iata = iataRaw.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(iata)) continue;

    const icao = pickIcao(cols, h);
    if (!icao) continue;

    const lat = Number.parseFloat(cols[h.latitude_deg] ?? "");
    const lon = Number.parseFloat(cols[h.longitude_deg] ?? "");
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const fullName = (cols[h.name] ?? "").trim() || icao;
    const city = (cols[h.municipality] ?? "").trim();
    const displayName = city ? `${fullName} · ${city}` : fullName;

    if (!out[icao]) {
      out[icao] = [lat, lon, displayName, iata];
    }
  }

  writeFileSync(OUT, JSON.stringify(out));
  console.log(`Wrote ${Object.keys(out).length} airports to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
