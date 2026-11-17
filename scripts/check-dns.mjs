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

async function resolve(name, type) {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(
    name
  )}&type=${type}&do=1`;
  const response = await fetch(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`DNS HTTP ${response.status}`);
  return response.json();
}

try {
  const [ds, a, ns] = await Promise.all([
    resolve(domain, "DS"),
    resolve(domain, "A"),
    resolve(domain, "NS"),
  ]);

  const dsRecords = Array.isArray(ds.Answer) ? ds.Answer.length : 0;
  const nameservers = Array.isArray(ns.Answer)
    ? ns.Answer.filter((entry) => entry.type === 2).map((entry) =>
        String(entry.data || "").replace(/\.$/, "")
      )
    : [];
  const validated = Boolean(a.AD);

  console.log(`Dominio: ${domain}`);
  console.log(`Nameservers: ${nameservers.join(", ") || "sin respuesta"}`);
  console.log(`Registros DS: ${dsRecords}`);
  console.log(`Validación DNSSEC (AD): ${validated ? "sí" : "no"}`);

  if (dsRecords === 0) {
    console.warn(
      "DNSSEC pendiente: falta el registro DS en el registrador (Cloudflare)."
    );
  } else if (!validated) {
    console.error(
      "DNSSEC mal configurado: hay DS pero el resolutor no valida la respuesta."
    );
    process.exitCode = 1;
  } else {
    console.log("DNSSEC activo y validado.");
  }
} catch (error) {
  console.error(`No se pudo comprobar DNSSEC: ${error.message}`);
  process.exitCode = 1;
}
