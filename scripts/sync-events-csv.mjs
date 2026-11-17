#!/usr/bin/env node
/**
 * Genera eventos.json desde un CSV editable.
 *
 * Fuente:
 *   EVENTS_CSV_URL=https://... node scripts/sync-events-csv.mjs
 *   o eventos.csv en la raíz del repo.
 *
 * Columnas: name,start,venue,city,url
 * `start` en formato ISO local: 2026-11-20T20:00:00
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT = join(root, "eventos.json");
const LOCAL_CSV = join(root, "eventos.csv");
const SOURCE_URL = String(process.env.EVENTS_CSV_URL || "").trim();

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((value) => value.trim() !== ""));
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase();
}

async function loadCsv() {
  if (SOURCE_URL) {
    const response = await fetch(SOURCE_URL, {
      headers: { "User-Agent": "like-hoodie-events/1.0" },
    });
    if (!response.ok) {
      throw new Error(`El CSV respondió ${response.status}`);
    }
    return { text: await response.text(), source: SOURCE_URL };
  }

  return {
    text: await readFile(LOCAL_CSV, "utf8"),
    source: "eventos.csv",
  };
}

async function main() {
  const { text, source } = await loadCsv();
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (rows.length < 2) throw new Error("El CSV está vacío.");

  const header = rows[0].map(normalizeHeader);
  const required = ["name", "start", "venue", "city", "url"];
  for (const column of required) {
    if (!header.includes(column)) {
      throw new Error(`Falta la columna "${column}" en el CSV.`);
    }
  }

  const indexOf = (name) => header.indexOf(name);
  const seen = new Set();
  const events = [];
  // La cartelera es de Ciudad MAcxico y el runner corre en UTC: sin fijar la
  // zona, un evento de esta noche se descarta a media tarde.
  const CDMX_OFFSET = "-06:00";
  const cdmxDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const today = new Date(`${cdmxDay}T00:00:00${CDMX_OFFSET}`);

  for (const row of rows.slice(1)) {
    const name = String(row[indexOf("name")] || "").replace(/\s+/g, " ").trim();
    const start = String(row[indexOf("start")] || "").trim();
    const venue = String(row[indexOf("venue")] || "").replace(/\s+/g, " ").trim();
    const city = String(row[indexOf("city")] || "").replace(/\s+/g, " ").trim();
    const url = String(row[indexOf("url")] || "").trim();

    const hasZone = /(Z|[+-]\d\d:\d\d)$/.test(start);
    const date = new Date(hasZone ? start : `${start}${CDMX_OFFSET}`);
    if (!name || !start || Number.isNaN(date.getTime())) continue;
    if (!/^https?:\/\//i.test(url)) continue;
    if (date < today) continue;

    const key = `${name.toLowerCase()}|${start.slice(0, 10)}|${venue.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({ name, start, venue, city, url });
  }

  events.sort((a, b) => a.start.localeCompare(b.start));
  if (!events.length) {
    throw new Error(
      "El CSV no tiene eventos futuros válidos. No se reescribe eventos.json."
    );
  }

  try {
    const current = JSON.parse(await readFile(OUTPUT, "utf8"));
    if (JSON.stringify(current.events) === JSON.stringify(events)) {
      console.log("Sin cambios en la cartelera.");
      return;
    }
  } catch (error) {
    /* primera ejecución o JSON inválido */
  }

  const payload = {
    updated: new Date().toISOString(),
    source,
    events,
  };
  await writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Guardados ${events.length} eventos desde ${source}.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
