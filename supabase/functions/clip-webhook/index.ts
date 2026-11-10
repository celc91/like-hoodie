// like hoodie ♡ — webhook de Clip.
// Clip solo avisa que algo cambió. La verdad se consulta en GET /v2/checkout/{id}.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  amountMatches,
  clipRequest,
  corsHeaders,
  env,
  hasClipConfig,
  isUuid,
  json,
  readJson,
  secretKey,
  supabaseUrl,
  timingSafeEqual,
} from "../_shared/clip.ts";
import type { ClipCheckout } from "../_shared/clip.ts";

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return json({ error: "Método no permitido" }, 405, origin);
  }

  const expectedSecret = env("CLIP_WEBHOOK_SECRET");
  const providedSecret = new URL(request.url).searchParams.get("secret") || "";
  if (
    !expectedSecret ||
    !timingSafeEqual(providedSecret, expectedSecret)
  ) {
    return json({ error: "No autorizado" }, 401, origin);
  }

  if (!hasClipConfig()) {
    console.error("clip-webhook: falta configurar las credenciales de Clip.");
    return json({ error: "Pagos no configurados" }, 503, origin);
  }

  const body = await readJson(request);
  const checkoutId = String(
    body?.id || body?.payment_request_id || body?.paymentRequestId || ""
  );
  if (!isUuid(checkoutId)) {
    return json({ error: "Notificación no válida" }, 400, origin);
  }

  const url = supabaseUrl();
  const serviceKey = secretKey();
  if (!url || !serviceKey) {
    console.error("clip-webhook: faltan variables de Supabase.");
    return json({ error: "Configuración incompleta" }, 503, origin);
  }

  let response: Response;
  try {
    response = await clipRequest(
      `/v2/checkout/${encodeURIComponent(checkoutId)}`
    );
  } catch (error) {
    console.error("clip-webhook: error de red con Clip.", error);
    return json({ error: "No se pudo verificar el pago" }, 502, origin);
  }

  const raw = await response.text();
  let checkout: ClipCheckout | null = null;
  try {
    checkout = JSON.parse(raw) as ClipCheckout;
  } catch {
    checkout = null;
  }

  if (!response.ok || !checkout) {
    console.error(
      `clip-webhook: Clip respondió ${response.status}.`,
      raw.slice(0, 300)
    );
    // 502 para que Clip reintente si fue un fallo temporal.
    return json({ error: "No se pudo verificar el pago" }, 502, origin);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let { data: order } = await admin
    .from("orders")
    .select("*")
    .eq("clip_checkout_id", checkoutId)
    .maybeSingle();

  if (!order) {
    const reference = String(checkout.metadata?.me_reference_id || "");
    if (isUuid(reference)) {
      const { data: byReference } = await admin
        .from("orders")
        .select("*")
        .eq("id", reference)
        .maybeSingle();
      order = byReference;
    }
  }

  if (!order) {
    console.warn(`clip-webhook: checkout ${checkoutId} sin pedido asociado.`);
    return json({ ok: true, ignored: true }, 200, origin);
  }

  const total = Number(order.total);
  const currency = String(checkout.currency || "MXN").toUpperCase();
  if (!amountMatches(checkout.amount, total) || currency !== "MXN") {
    console.error(
      `clip-webhook: monto/moneda no coincide para LH-${order.number}.`
    );
    return json({ ok: true, mismatch: true }, 200, origin);
  }

  const status = String(checkout.status || "").toUpperCase();
  const now = new Date().toISOString();

  if (status === "CHECKOUT_COMPLETED") {
    if (order.payment_status === "paid") {
      return json({ ok: true, duplicate: true }, 200, origin);
    }

    const update: Record<string, unknown> = {
      payment_method: "clip",
      payment_status: "paid",
      paid_at: now,
      payment_reference: String(
        checkout.receipt_no || checkout.payment_request_id || checkoutId
      ).slice(0, 120),
      clip_checkout_id: checkoutId,
    };
    if (order.status === "pending") update.status = "confirmed";

    const { error } = await admin
      .from("orders")
      .update(update)
      .eq("id", order.id);

    if (error) {
      console.error(`clip-webhook: no se pudo marcar LH-${order.number}.`);
      return json({ error: "No se pudo actualizar el pedido" }, 500, origin);
    }

    return json({ ok: true, status: "paid" }, 200, origin);
  }

  if (status === "CHECKOUT_CANCELLED" || status === "CHECKOUT_EXPIRED") {
    if (order.payment_status === "pending") {
      const { error } = await admin
        .from("orders")
        .update({ payment_status: "failed" })
        .eq("id", order.id)
        .eq("payment_status", "pending");

      if (error) {
        console.error(
          `clip-webhook: no se pudo marcar como fallido LH-${order.number}.`
        );
        return json(
          { error: "No se pudo actualizar el pedido" },
          500,
          origin
        );
      }
    }
    return json({ ok: true, status: "failed" }, 200, origin);
  }

  return json({ ok: true, status: "pending" }, 200, origin);
});
