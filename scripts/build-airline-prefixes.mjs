/**
 * Builds public/airline-flight-prefixes.json from OpenFlights airlines.dat for callsign lookups.
 * - icaoPrefixes: ICAO airline designator → official name (3 letters, Active airlines)
 * - iataPrefixes: IATA airline code → official name (2 letters); skips ambiguous duplicates
 *
 * Run: node scripts/build-airline-prefixes.mjs
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "airline-flight-prefixes.json");

const AIRLINES_URL =
  "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat";

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

function clean(s) {
  return (s ?? "").replace(/^"|"$/g, "").trim();
}

async function main() {
  const res = await fetch(AIRLINES_URL);
  if (!res.ok) throw new Error(`airlines.dat HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.split(/\r?\n/).filter(Boolean);

  /** @type {Record<string, string>} */
  const icaoPrefixes = {};
  /** @type {Record<string, string>} */
  const iataFirstSeen = {};
  /** @type {Record<string, string[]>} */
  const iataAmbiguous = {};

  for (const line of lines) {
    const f = parseCsvLine(line).map((x) => clean(x));
    if (f.length < 8) continue;

    const name = f[1];
    const alias = f[2];
    const iataRaw = (f[3] ?? "").toUpperCase();
    const icaoRaw = (f[4] ?? "").toUpperCase();
    const active = (f[7] ?? "").toUpperCase();
    const displayName =
      alias && alias !== "-" && alias.toLowerCase() !== "\\n"
        ? name
        : name.replace(/^"|"$/g, "");

    if (active !== "Y" || displayName.includes("Private flight")) continue;

    if (/^[A-Z0-9]{3}$/.test(icaoRaw)) {
      const prev = icaoPrefixes[icaoRaw];
      if (!prev || displayName.length < prev.length) icaoPrefixes[icaoRaw] = displayName;
    }

    if (/^[A-Z]{2}$/.test(iataRaw) && /^[A-Z0-9]{3}$/.test(icaoRaw)) {
      const existing = iataFirstSeen[iataRaw];
      if (!existing) {
        iataFirstSeen[iataRaw] = displayName;
      } else if (existing !== displayName) {
        if (!iataAmbiguous[iataRaw]) iataAmbiguous[iataRaw] = [existing];
        iataAmbiguous[iataRaw].push(displayName);
      }
    }
  }

  const iataPrefixes = {};
  for (const [code, nm] of Object.entries(iataFirstSeen)) {
    if (iataAmbiguous[code]) continue;
    iataPrefixes[code] = nm;
  }

  writeFileSync(OUT, JSON.stringify({ icaoPrefixes, iataPrefixes }));
  console.log(
    `Wrote ${Object.keys(icaoPrefixes).length} ICAO prefixes, ${Object.keys(iataPrefixes).length} IATA (unambiguous)`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
