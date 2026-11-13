// like hoodie ♡ — cobro con Checkout Transparente de Clip (flujo SDK).
// El token de tarjeta lo genera el SDK en el navegador; aquí solo se cobra.
// Seguridad: la función rechaza credenciales que no sean de sandbox (test_)
// salvo que se habilite CLIP_ALLOW_LIVE=1 de forma explícita.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  env,
  isUuid,
  json,
  publishableKey,
  readJson,
  secretKey,
  supabaseUrl,
} from "../_shared/clip.ts";

const CLIP_API_BASE = env("CLIP_API_BASE") || "https://api.payclip.com";

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return json({ error: "Método no permitido" }, 405, origin);
  }

  const url = supabaseUrl();
  const anonKey = publishableKey();
  const serviceKey = secretKey();
  if (!url || !anonKey || !serviceKey) {
    console.error("clip-pay: faltan variables de Supabase.");
    return json({ error: "Configuración incompleta" }, 503, origin);
  }

  const apiKey = env("CLIP_API_KEY");
  if (!apiKey) {
    console.error("clip-pay: falta CLIP_API_KEY.");
    return json({ error: "Pagos no configurados" }, 503, origin);
  }

  // Solo sandbox por defecto: evita cobros reales accidentales.
  const isTestKey = /^test_/i.test(apiKey);
  if (!isTestKey && env("CLIP_ALLOW_LIVE") !== "1") {
    console.error("clip-pay: se intentó usar una clave de producción sin permiso.");
    return json(
      { error: "Este endpoint solo acepta credenciales de prueba (test_)" },
      403,
      origin
    );
  }

  const authorization = request.headers.get("authorization") || "";
  const authToken = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!authToken) {
    return json({ error: "No autenticado" }, 401, origin);
  }

  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${authToken}` } },
  });

  const { data: userData, error: userError } =
    await userClient.auth.getUser(authToken);
  if (userError || !userData?.user) {
    return json({ error: "Sesión no válida" }, 401, origin);
  }

  const body = await readJson(request);
  const orderId = String(body?.orderId || body?.order_id || "");
  const cardToken = String(body?.token || "").trim();
  const customer = {
    email: String((body?.customer as Record<string, unknown>)?.email || "").trim(),
    phone: String((body?.customer as Record<string, unknown>)?.phone || "").trim(),
  };

  if (!isUuid(orderId)) {
    return json({ error: "Pedido no válido" }, 400, origin);
  }
  if (cardToken.length < 10 || cardToken.length > 200) {
    return json({ error: "Token de tarjeta no válido" }, 400, origin);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(customer.email)) {
    return json({ error: "Correo no válido" }, 400, origin);
  }

  const { data: order, error: orderError } = await userClient
    .from("orders")
    .select(
      "id, number, total, currency, status, payment_status, payment_method"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    console.error("clip-pay: no se pudo leer el pedido.", orderError);
    return json({ error: "No se pudo leer el pedido" }, 500, origin);
  }
  if (!order) {
    return json({ error: "Pedido no encontrado" }, 404, origin);
  }

  if (order.payment_status === "paid" || order.payment_status === "refunded") {
    return json({ status: "approved", alreadyPaid: true }, 200, origin);
  }
  if (order.payment_status !== "pending") {
    return json(
      { error: "El pedido no está pendiente de pago" },
      409,
      origin
    );
  }

  const total = Number(order.total);
  if (!Number.isFinite(total) || total < 1 || total > 200_000) {
    return json({ error: "Monto no válido" }, 422, origin);
  }
  if (String(order.currency || "MXN").toUpperCase() !== "MXN") {
    return json({ error: "Moneda no válida" }, 422, origin);
  }

  let response: Response;
  try {
    response = await fetch(`${CLIP_API_BASE}/payments`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        amount: total,
        currency: "MXN",
        description: `Pedido LH-${order.number} - like hoodie`,
        payment_method: { token: cardToken },
        customer: {
          email: customer.email,
          ...(customer.phone ? { phone: customer.phone } : {}),
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    console.error("clip-pay: error de red con Clip.", error);
    return json({ error: "No se pudo conectar con Clip" }, 502, origin);
  }

  const raw = await response.text();
  let data: Record<string, unknown> | null = null;
  try {
    data = JSON.parse(raw);
  } catch {
    data = null;
  }

  if (!response.ok || !data) {
    console.error(
      `clip-pay: Clip respondió ${response.status}.`,
      raw.slice(0, 500)
    );
    return json({ error: "No se pudo procesar el pago" }, 502, origin);
  }

  const status = String(data.status || "");
  const statusDetail =
    data.status_detail && typeof data.status_detail === "object"
      ? (data.status_detail as Record<string, unknown>)
      : {};
  const paymentId = String(data.id || "");
  const receiptNo = String(data.receipt_no || "");
  const pendingAction =
    data.pending_action && typeof data.pending_action === "object"
      ? data.pending_action
      : null;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (status === "approved") {
    const { error: updateError } = await admin
      .from("orders")
      .update({
        payment_method: "clip",
        payment_status: "paid",
        paid_at: new Date().toISOString(),
        payment_reference: String(receiptNo || paymentId).slice(0, 120),
        ...(order.status === "pending" ? { status: "confirmed" } : {}),
      })
      .eq("id", order.id);

    if (updateError) {
      console.error("clip-pay: no se pudo marcar el pedido como pagado.", updateError);
      return json(
        { status: "approved", paymentId, receiptNo, warning: "No se pudo actualizar el pedido" },
        200,
        origin
      );
    }
  }

  // Un pago rechazado deja el pedido pendiente para poder reintentar con otra tarjeta.
  // Solo se marca como pagado cuando Clip responde "approved".

  return json(
    {
      status,
      statusDetail,
      paymentId,
      receiptNo,
      pendingAction,
      test: isTestKey,
    },
    200,
    origin
  );
});
