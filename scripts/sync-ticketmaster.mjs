// Actualiza eventos.json con la cartelera de conciertos de Ticketmaster México.
//
// Uso:
//   TICKETMASTER_API_KEY=tu_api_key node scripts/sync-ticketmaster.mjs
//
// Consigue una API key gratuita en https://developer.ticketmaster.com/
// La llave se usa solo en tu computadora o en un proceso de CI; no se publica
// en el navegador.

import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API_KEY = process.env.TICKETMASTER_API_KEY;
const API_URL = "https://app.ticketmaster.com/discovery/v2/events.json";
const SOURCE = "https://www.ticketmaster.com.mx/section/conciertos";
const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), "..", "eventos.json");
const MAX_PAGES = 10;

if (!API_KEY) {
  console.error(
    "Falta TICKETMASTER_API_KEY. Crea una API key en https://developer.ticketmaster.com/ y vuelve a ejecutar."
  );
  process.exit(1);
}

const junk =
  /(estacionamiento|ticket2ride|beat\s*lounge|boleto de evento|paquete|\bvip\b|club pass|comfort pass|\bgeneral\b|\bindividual\b|\babono\b|early entry|galeria|meet\s*&?\s*greet|fastlane|discapacidad|parking|lounge|simifest)/i;

function localDateAndTime(event) {
  const start = event?.dates?.start || {};
  const date = start.localDate || "";
  const time = start.localTime ? start.localTime.slice(0, 8) : "20:00:00";
  return { date, start: `${date}T${time}` };
}

function normalizeCity(city) {
  const value = String(city || "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  if (/^(México|Mexico|Ciudad de México|México CDMX), CDMX$/i.test(value)) {
    return "Ciudad de México";
  }
  if (/^Col\. Centro Monterrey, NL$/i.test(value)) return "Monterrey";
  return value
    .replace(
      /,\s*(CDMX|NL|JAL|QRO|GTO|PUE|YUC|BC|SON|CHIH|TAMPS|VER|OAX|GRO|MICH|SIN|COAH|HGO|TLAX|MOR|AGS|SLP|ZAC|NAY|COL|DGO|BCS|CAMP|CHIS|TAB|QR)$/i,
      ""
    )
    .replace(/^Tlajomulco de Zuñiga$/i, "Tlajomulco de Zúñiga")
    .trim();
}

function mapEvent(event) {
  const { date, start } = localDateAndTime(event);
  if (!date || !event.name) return null;

  const venue = event?._embedded?.venues?.[0] || {};
  const name = String(event.name).replace(/\s+/g, " ").trim();
  if (junk.test(name)) return null;

  return {
    id: event.id,
    name,
    start,
    venue: venue.name || "Por confirmar",
    city: normalizeCity(
      [venue.city?.name, venue.state?.stateCode].filter(Boolean).join(", ")
    ),
    url: event.url,
  };
}

async function fetchPage(page) {
  const params = new URLSearchParams({
    apikey: API_KEY,
    countryCode: "MX",
    classificationName: "Music",
    locale: "es-mx",
    sort: "date,asc",
    size: "200",
    page: String(page),
    startDateTime: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  });

  const response = await fetch(`${API_URL}?${params}`);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Ticketmaster respondió ${response.status}: ${body.slice(0, 300)}`);
  }
  return response.json();
}

async function main() {
  const events = [];
  const seen = new Set();

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const data = await fetchPage(page);
    const batch = data?._embedded?.events || [];
    if (!batch.length) break;

    for (const raw of batch) {
      const event = mapEvent(raw);
      if (!event?.url) continue;
      const key = `${event.name.toLowerCase()}|${event.start.slice(0, 10)}|${event.venue.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push(event);
    }

    const totalPages = data?.page?.totalPages || 1;
    if (page + 1 >= totalPages) break;

    // La API permite 5 solicitudes por segundo.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  events.sort((a, b) => a.start.localeCompare(b.start));

  const payload = {
    updated: new Date().toISOString(),
    source: SOURCE,
    events,
  };

  await writeFile(OUTPUT, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Guardados ${events.length} conciertos en ${OUTPUT}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
