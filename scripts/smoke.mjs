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
const trackSql = read("supabase/fase3-seguimiento.sql");
const trackPage = read("pedido.html");
const trackJs = read("pedido.js");
const sitemap = read("sitemap.xml");

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
check("app: efectos de texto", app.includes("TEXT_EFFECTS") && app.includes("text-effect-shadow"));
check("app: clip art", app.includes("CLIP_ART") && index.includes("data-clip-grid"));
check("app: varios colores", app.includes("addMultiToCart") && index.includes("data-multi-modal"));
check("app: guardar y compartir", app.includes("buildShareLink") && index.includes("data-share-modal"));
check("index: productos relacionados", index.includes("data-product-jump"));
check("retención: función", read("supabase/functions/cleanup-storage/index.ts").includes("CLEANUP_SECRET"));
check("retención: workflow", read(".github/workflows/retencion.yml").includes("cleanup-storage?dryRun"));
check("privacidad: retención de logos", read("privacidad.html").includes("180 días"));
check("dns: comprobador", read("scripts/check-dns.mjs").includes('"DS"'));
check("uptime: TLS y recuperación", read(".github/workflows/uptime.yml").includes("Certificado TLS") && read(".github/workflows/uptime.yml").includes("Cerrar incidencia"));
check("admin: colores seguros", admin.includes("function safeHex"));
check("store: color de texto validado", store.includes("textColor"));

check("sql: precio de servidor", sql.includes("item_unit_price"));
check("sql: columnas de envío", sql.includes("address_ref") && sql.includes("state"));
check("sql: cupón en servidor", sql.includes("p_coupon"));
check("sql: revoca lectura de cupones", sql.includes("revoke select on public.coupons"));

for (const id of ["cocodrilo", "insignia", "panorama", "corazon"]) {
  const page = read(`modelos/${id}.html`);
  check(`producto ${id}: schema`, page.includes('"@type":"Product"'));
  check(`producto ${id}: canonical`, page.includes(`https://likehoodie.com/modelos/${id}.html`));
  check(`producto ${id}: compra`, page.includes(`comprar=${id}`));
  check(`producto ${id}: og`, page.includes(`og-${id}.jpg`));
}
check("seguimiento: formulario", trackPage.includes("data-track-form"));
check("seguimiento: endpoint", trackJs.includes("/functions/v1/order-status"));
check("seguimiento: columnas", trackSql.includes("tracking_number") && trackSql.includes("tracking_url"));

const invoicePage = read("factura.html");
const invoiceJs = read("factura.js");
const invoiceSql = read("supabase/fase10-facturacion-individual.sql") + read("supabase/migrations/20261115000200_facturacion_verificacion.sql");
const supabaseConfig = read("supabase/config.toml");
check("factura: formulario", invoicePage.includes("data-invoice-form"));
check("factura: endpoint", invoiceJs.includes("/functions/v1/invoice-request"));
check("factura: sin emisión CFDI", !invoiceJs.includes("timbrar"));
check("admin: solicitudes individuales", admin.includes("loadInvoiceRequests"));
check(
  "sql: factura individual",
  invoiceSql.includes("invoice_requests") && invoiceSql.includes("take_invoice_request")
);
check(
  "sql: factura verifica correo",
  invoiceSql.includes("verify_token") && invoiceSql.includes("confirm_invoice_request")
);
check("sql: factura forma SAT", invoiceSql.includes("sat_payment_form"));
check(
  "factura: función sin JWT",
  /\[functions\.invoice-request\][\s\S]*?verify_jwt\s*=\s*false/.test(supabaseConfig)
);
const modelJson = JSON.parse(read("modelos/modelos.json"));
const modelData = read("modelos/modelos-data.js");
const dataModelIds = [...modelData.matchAll(/"([a-z0-9]+)": \{/g)]
  .map((match) => match[1])
  .sort();
check(
  "modelos: data/json",
  dataModelIds.join(",") === modelJson.map((model) => model.id).sort().join(",")
);
check("modelos: app usa datos", app.includes("window.LIKEHOODIE_MODELS"));
const priceFormat = new Intl.NumberFormat("es-MX");
check(
  "index: precios de modelos",
  modelJson.every((model) =>
    index.includes(
      `data-model-price="${model.id}">$${priceFormat.format(model.price)}</span>`
    )
  )
);

check("sitemap: productos", sitemap.includes("modelos/cocodrilo.html"));

check("whatsapp: número", read("whatsapp-config.js").includes("5215552142692"));
check("whatsapp: botón", index.includes("whatsapp.js"));
check("monitor: cliente", index.includes("monitor.js"));
check("monitor: tabla", read("supabase/fase3-monitorizacion.sql").includes("log_client_error"));
check("seguimiento: edge function", read("supabase/functions/order-status/index.ts").includes('"take_order_lookup"'));
check("seguimiento: rate limit SQL", read("supabase/fase5-ratelimit.sql").includes("grant execute on function public.take_order_lookup"));
check("monitor: edge function", read("supabase/functions/client-error/index.ts").includes('"take_client_error"'));
check("monitor: contador SQL", read("supabase/fase6-limites.sql").includes("take_client_error"));
check("pagos: contador SQL", read("supabase/fase6-limites.sql").includes("take_clip_pay"));
check("sql: topes de items", read("supabase/fase6-limites.sql").includes("orders_items_size_chk"));
check("seguimiento: rpc cerrado", trackSql.includes("to service_role"));
check("webhook: cabecera secreta", read("supabase/functions/clip-webhook/index.ts").includes("x-clip-secret"));
check("seguridad: retención", read("supabase/fase4-seguridad.sql").includes("cleanup_monitoring"));
check("producto: monitor", read("modelos/cocodrilo.html").includes("monitor.js"));
check("eventos: CSV", read("eventos.csv").startsWith("name,start,venue,city,url"));
check(
  "eventos: sincronizador CSV",
  read("scripts/sync-events-csv.mjs").includes("EVENTS_CSV_URL")
);

const failed = checks.filter((entry) => !entry.ok);
for (const entry of checks) {
  console.log(`${entry.ok ? "ok" : "FALLO"}  ${entry.name}`);
}
if (failed.length) {
  console.error(`\n${failed.length} comprobación(es) fallida(s).`);
  process.exit(1);
}
console.log(`\n${checks.length} comprobaciones correctas.`);
