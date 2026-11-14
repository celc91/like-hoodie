#!/usr/bin/env node
/**
 * Smoke test sin navegador: comprueba que los archivos publicados conservan
 * las piezas críticas del editor, el checkout y la migración de pedidos.
 *
 * Uso: node scripts/smoke.mjs
 */

import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const checks = [];

function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}

const index = read("index.html");
const app = read("app.js");
const admin = read("admin.js");
const store = read("store-supabase.js");
const sql = read("supabase/fase1-pedidos-seguros.sql");

check("index: título", /<title>like hoodie/.test(index));
check("index: checkout", index.includes("data-checkout-form"));
check("index: teléfono obligatorio", /id="f-phone"[^>]*required/.test(index));
check("index: estado obligatorio", /id="f-state"[^>]*required/.test(index));
check("index: referencias", index.includes('name="addressRef"'));
check("index: recuperar borrador", index.includes("data-recover-draft"));
check("index: mockup WebP", index.includes("hoodie-front.webp"));
check("index: sin mockup PNG", !index.includes("hoodie-front.png"));

check("app: borrador", app.includes("DESIGN_DRAFT_KEY"));
check("app: inert", app.includes("refreshInertState"));
check("app: datos de envío", app.includes("addressRef"));
check("app: validación de teléfono", app.includes("Escribe un teléfono de 10 dígitos."));
check("admin: colores seguros", admin.includes("function safeHex"));
check("store: color de texto validado", store.includes("textColor"));

check("sql: precio de servidor", sql.includes("item_unit_price"));
check("sql: columnas de envío", sql.includes("address_ref") && sql.includes("state"));
check("sql: cupón en servidor", sql.includes("p_coupon"));
check("sql: revoca lectura de cupones", sql.includes("revoke select on public.coupons"));

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`${entry.ok ? "ok" : "FALLO"}  ${entry.name}`);
}
if (failed.length) {
  console.error(`\n${failed.length} comprobación(es) fallida(s).`);
  process.exit(1);
}
console.log(`\n${checks.length} comprobaciones correctas.`);
