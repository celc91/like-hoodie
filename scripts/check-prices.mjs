#!/usr/bin/env node
/**
 * Comprueba que los precios del cliente y del servidor sigan alineados.
 * Evita que vuelvan fallos como el blanco sin fila o el tote con precios
 * de sudadera. No necesita conexión a Supabase.
 */

import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const checks = [];

function check(name, condition) {
  checks.push({ name, ok: Boolean(condition) });
}

const app = read("app.js");
const hardening = read("supabase/security-hardening.sql");
const pricing = read("supabase/migrations/20261115000100_precios_tote.sql");
const invoice = read("supabase/migrations/20261115000200_facturacion_verificacion.sql");
const invoicePage = read("factura.html");
const indexPage = read("index.html");
const invoiceJs = read("factura.js");
const invoiceFn = read("supabase/functions/invoice-request/index.ts");
const adminStats = read("supabase/migrations/20261115000300_admin_stats_pagados.sql");
const couponSql = read("supabase/migrations/20261115000400_cupones_unicos.sql");
const noticeSql = read("supabase/migrations/20261115000500_aviso_factura.sql");
const volumeSql = read("supabase/migrations/20261117000200_precios_volumen.sql");
const approvalSql = read("supabase/migrations/20261117000100_aprobacion_diseno.sql");
const teamSql = read("supabase/migrations/20261117001000_nombre_numero.sql");
const store = read("store-supabase.js");
const confirmJs = read("confirmar.js");
const styles = read("styles.css");

const has = (sql, product, kind, key, amount) =>
  new RegExp(
    `'${product}'\\s*,\\s*'${kind}'\\s*,\\s*'${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}'\\s*,\\s*${amount}`
  ).test(sql);

check("precios: blanco de sudadera", has(hardening, "hoodie", "color", "#ffffff", 949));
check("precios: blanco en migración", has(pricing, "hoodie", "color", "#ffffff", 949));

for (const [key, amount] of [
  ["#efe6d6", 349],
  ["#ffffff", 379],
  ["#1c1c1f", 379],
  ["#cdf25a", 379],
  ["#f2603c", 379],
  ["#26324f", 379],
  ["#efb7c4", 379],
]) {
  check(`precios: tote color ${key}`, has(hardening, "tote", "color", key, amount));
  check(`precios: migración tote ${key}`, has(pricing, "tote", "color", key, amount));
}

for (const [key, amount] of [
  ["loneta12", 0],
  ["loneta10", -40],
  ["reciclada", 30],
]) {
  check(`precios: tote material ${key}`, has(hardening, "tote", "material", key, amount));
}

for (const [key, amount] of [
  ["dtf", 0],
  ["serigrafia", 129],
  ["vinilo", 49],
  ["bordado", 99],
]) {
  check(`precios: tote técnica ${key}`, has(hardening, "tote", "technique", key, amount));
}

check("precios: función por producto", /v_product/.test(hardening) && /product\s*=\s*v_product/.test(hardening));
check(
  "precios: place_order usa item_unit_price",
  /v_unit\s*:=\s*public\.item_unit_price/.test(hardening)
);
check("factura: forma SAT en formulario", invoicePage.includes('name="satPaymentForm"'));
check("factura: token de confirmación", invoiceJs.includes("confirm") && invoiceJs.includes("token"));
check("factura: migración verifica correo", invoice.includes("verify_token") && invoice.includes("confirm_invoice_request"));
check("factura: migración guarda forma SAT", invoice.includes("sat_payment_form"));
check("factura: admin puede reenviar", invoice.includes("resend_invoice_verification"));
check("factura: edge confirma token", invoiceFn.includes("confirm_invoice_request") && invoiceFn.includes("action"));
check(
  "admin: métricas solo pagadas",
  (adminStats.match(/payment_status = 'paid'/g) || []).length >= 7
);
check(
  "newsletter: cupón único",
  couponSql.includes("coupon_code") &&
    couponSql.includes("max_uses") &&
    !app.includes("BIENVENIDA10") &&
    !confirmJs.includes("BIENVENIDA10")
);
check(
  "factura: admin avisado al confirmar",
  noticeSql.includes("send_invoice_admin_email") && noticeSql.includes("confirm_invoice_request")
);
check(
  "rendimiento: fuentes locales",
  styles.includes("assets/fonts/bricolage-grotesque-latin.woff2") &&
    styles.includes("assets/fonts/inter-latin.woff2")
);
check(
  "precios: tamaño de impresión",
  volumeSql.includes("print_carta_fee") &&
    volumeSql.includes("print_doble_carta_fee") &&
    volumeSql.includes("printSize")
);
check(
  "precios: descuentos por volumen",
  volumeSql.includes("tier_12_discount") &&
    volumeSql.includes("tier_24_discount") &&
    volumeSql.includes("tier_48_discount") &&
    volumeSql.includes("pricingGroup")
);
check(
  "cotizador: modal por tallas",
  indexPage.includes("data-quote-modal") &&
    app.includes("data-quote-sizes")
);
check(
  "aprobación: estado en pedidos",
  approvalSql.includes("design_approval_status") &&
    approvalSql.includes("design_approved_at")
);
check(
  "entrega: fecha estimada",
  indexPage.includes("data-delivery-estimate") &&
    app.includes("deliveryEstimateText")
);
check(
  "equipos: nombres y números",
  indexPage.includes("data-team-modal") &&
    app.includes("nameNumber") &&
    app.includes("NAME_NUMBER_FEE") &&
    teamSql.includes("name_number_fee")
);
check(
  "texto: efectos y tipografías",
  indexPage.includes("data-text-effect") &&
    app.includes("text-effect-outline") &&
    app.includes("bungee") &&
    app.includes("caveat") &&
    store.includes("textEffect")
);
check(
  "logo: clip art",
  indexPage.includes("data-clip-grid") && app.includes("CLIP_ART")
);
check(
  "colores: mismo diseño en varios colores",
  indexPage.includes("data-multi-modal") && app.includes("addMultiToCart")
);
check(
  "diseño: guardar y compartir",
  indexPage.includes("data-share-modal") &&
    app.includes("SAVED_DESIGNS_KEY") &&
    app.includes("buildShareLink")
);
check(
  "productos relacionados",
  indexPage.includes("data-product-jump") &&
    indexPage.includes("modelos/cocodrilo.html")
);

const failed = checks.filter((item) => !item.ok);
for (const item of checks) {
  if (!item.ok) console.log("FALLO", item.name);
}
if (failed.length) {
  console.error(`${failed.length} comprobaciones de precios/facturación fallaron.`);
  process.exit(1);
}
console.log(`${checks.length} comprobaciones de precios/facturación correctas.`);
