#!/usr/bin/env node
/**
 * Comprueba el estado de DNSSEC de likehoodie.com sin credenciales.
 *
 * - Sin registro DS: avisa y termina en 0 (DNSSEC aún no está activado).
 * - Con DS pero sin validación (AD=false): falla, porque hay un error de
 *   configuración que puede dejar el dominio sin resolver.
 * - Si la consulta DNS falla: falla.
 *
 * Uso: node scripts/check-dns.mjs [dominio]
 */

const domain = process.argv[2] || "likehoodie.com";

async function resolve(name, type, base = "https://dns.google/resolve") {
  const url = `${base}?name=${encodeURIComponent(name)}&type=${type}&do=1`;
  const response = await fetch(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`DNS HTTP ${response.status}`);
  return response.json();
}

try {
  const [dsGoogle, dsCloudflare, aGoogle, aCloudflare, ns] = await Promise.all([
    resolve(domain, "DS").catch(() => null),
    resolve(domain, "DS", "https://1.1.1.1/dns-query").catch(() => null),
    resolve(domain, "A").catch(() => null),
    resolve(domain, "A", "https://1.1.1.1/dns-query").catch(() => null),
    resolve(domain, "NS").catch(() => null),
  ]);

  const dsAnswers = [
    ...(Array.isArray(dsGoogle?.Answer) ? dsGoogle.Answer : []),
    ...(Array.isArray(dsCloudflare?.Answer) ? dsCloudflare.Answer : []),
  ].filter((entry) => entry.type === 43);
  const dsRecords = new Set(
    dsAnswers.map((entry) => String(entry.data || "").trim().toLowerCase())
  ).size;
  const nameservers = Array.isArray(ns?.Answer)
    ? ns.Answer.filter((entry) => entry.type === 2).map((entry) =>
        String(entry.data || "").replace(/\.$/, "")
      )
    : [];
  // Distintos resolutores pueden tardar más en validar; basta con uno.
  const validated = Boolean(aGoogle?.AD || aCloudflare?.AD);
  const dsData = dsAnswers[0]?.data || "";

  console.log(`Dominio: ${domain}`);
  console.log(`Nameservers: ${nameservers.join(", ") || "sin respuesta"}`);
  console.log(`Registros DS: ${dsRecords}`);
  if (dsRecords) console.log(`DS: ${dsData}`);
  console.log(`Validación DNSSEC (AD): ${validated ? "sí" : "no"}`);

  if (dsRecords === 0) {
    console.warn(
      "DNSSEC pendiente: falta el registro DS en el registrador (Cloudflare)."
    );
    if (process.env.REQUIRE_DNSSEC === "1") process.exitCode = 1;
  } else if (!validated) {
    console.error(
      "DNSSEC mal configurado: hay DS pero ningún resolutor valida la respuesta."
    );
    process.exitCode = 1;
  } else {
    console.log("DNSSEC activo y validado.");
  }
} catch (error) {
  console.error(`No se pudo comprobar DNSSEC: ${error.message}`);
  process.exitCode = 1;
}
