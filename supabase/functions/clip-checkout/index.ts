// like hoodie ♡ — crea un link de pago de Clip para un pedido pendiente.
// La clave secreta de Clip vive en los secrets de Supabase, nunca en el navegador.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  amountMatches,
  corsHeaders,
  env,
  getClipCheckout,
  hasClipConfig,
  isUuid,
  json,
  publishableKey,
  readJson,
  safeCheckoutUrl,
  secretKey,
  supabaseUrl,
} from "../_shared/clip.ts";

function clipDisabled(origin: string | null): Response {
  return json({ enabled: false }, 200, origin);
}

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
    console.error("clip-checkout: faltan variables de Supabase.");
    return json(
      { enabled: false, error: "Configuración incompleta" },
      503,
      origin
    );
  }

  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return json({ error: "No autenticado" }, 401, origin);
  }

  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } =
    await userClient.auth.getUser(token);
  if (userError || !userData?.user) {
    return json({ error: "Sesión no válida" }, 401, origin);
  }

  const body = await readJson(request);
  const orderId = String(body?.orderId || body?.order_id || "");
  if (!isUuid(orderId)) {
    return json({ error: "Pedido no válido" }, 400, origin);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // El pago con Clip solo se activa desde el servidor.
  const { data: setting, error: settingError } = await admin
    .from("store_settings")
    .select("value")
    .eq("key", "clip_enabled")
    .maybeSingle();

  if (settingError) {
    console.error("clip-checkout: no se pudo leer store_settings.");
    return json(
      { enabled: false, error: "Configuración no disponible" },
      503,
      origin
    );
  }
  if (setting?.value !== "true") {
    return clipDisabled(origin);
  }

  if (!hasClipConfig()) {
    console.error("clip-checkout: falta configurar las credenciales de Clip.");
    return json(
      { enabled: false, error: "Pagos no configurados" },
      503,
      origin
    );
  }

  const { data: order, error: orderError } = await userClient
    .from("orders")
    .select(
      "id, number, total, currency, status, payment_status, payment_method, clip_checkout_id, clip_checkout_url"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (orderError) {
    console.error("clip-checkout: no se pudo leer el pedido.");
    return json({ error: "No se pudo leer el pedido" }, 500, origin);
  }
  if (!order) {
    return json({ error: "Pedido no encontrado" }, 404, origin);
  }

  if (order.payment_status === "paid" || order.payment_status === "refunded") {
    return json(
      { enabled: true, alreadyPaid: true, status: order.payment_status },
      200,
      origin
    );
  }
  if (order.payment_status !== "pending") {
    return json(
      { enabled: true, error: "El pedido no está pendiente de pago" },
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

  // Reutiliza un link activo para no generar cobros duplicados.
  if (order.clip_checkout_id) {
    const current = await getClipCheckout(String(order.clip_checkout_id));

    if (!current) {
      console.error("clip-checkout: no se pudo verificar el checkout existente.");
      return json(
        { enabled: true, error: "No se pudo verificar el link de pago" },
        502,
        origin
      );
    }

    if (current.status === "CHECKOUT_COMPLETED") {
      if (!amountMatches(current.amount, total)) {
        console.error("clip-checkout: el monto del checkout no coincide.");
        return json(
          { enabled: true, error: "El monto del pago no coincide" },
          409,
          origin
        );
      }

      const { error: payError } = await admin
        .from("orders")
        .update({
          payment_method: "clip",
          payment_status: "paid",
          paid_at: new Date().toISOString(),
          payment_reference: String(
            current.receipt_no || current.payment_request_id || ""
          ).slice(0, 120),
          ...(order.status === "pending" ? { status: "confirmed" } : {}),
        })
        .eq("id", order.id);

      if (payError) {
        console.error("clip-checkout: no se pudo marcar como pagado.");
        return json(
          { enabled: true, error: "No se pudo actualizar el pedido" },
          500,
          origin
        );
      }
      return json({ enabled: true, alreadyPaid: true }, 200, origin);
    }

    if (
      current.status === "CHECKOUT_CREATED" ||
      current.status === "CHECKOUT_PENDING"
    ) {
      const safeUrl = safeCheckoutUrl(order.clip_checkout_url);
      if (!safeUrl) {
        return json(
          { enabled: true, error: "El link de pago guardado no es válido" },
          409,
          origin
        );
      }
      return json({ enabled: true, url: safeUrl, reused: true }, 200, origin);
    }

    if (
      current.status !== "CHECKOUT_CANCELLED" &&
      current.status !== "CHECKOUT_EXPIRED"
    ) {
      console.error(
        `clip-checkout: estado de Clip no reconocido (${current.status}).`
      );
      return json(
        { enabled: true, error: "Estado de pago no reconocido" },
        409,
        origin
      );
    }
  }

  const webhookSecret = env("CLIP_WEBHOOK_SECRET");
  const payload = {
    amount: total,
    currency: "MXN",
    purchase_description: `Pedido LH-${order.number} - like hoodie`,
    redirection_url: {
      success: `${env("SITE_URL") || "https://likehoodie.com"}/?pago=exito&pedido=LH-${order.number}`,
      error: `${env("SITE_URL") || "https://likehoodie.com"}/?pago=error&pedido=LH-${order.number}`,
      default: `${env("SITE_URL") || "https://likehoodie.com"}/?pago=pendiente&pedido=LH-${order.number}`,
    },
    webhook_url: `${url}/functions/v1/clip-webhook?secret=${encodeURIComponent(
      webhookSecret
    )}`,
    custom_payment_options: {
      payment_method_types: ["credit", "debit", "cash"],
    },
    metadata: { me_reference_id: order.id },
  };

  let response: Response;
  try {
    response = await fetch(`${env("CLIP_API_BASE") || "https://api.payclip.com"}/v2/checkout`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(
          `${env("CLIP_API_KEY")}:${env("CLIP_API_SECRET")}`
        )}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(12_000),
    });
  } catch (error) {
    console.error("clip-checkout: error de red con Clip.", error);
    return json(
      { enabled: true, error: "No se pudo conectar con Clip" },
      502,
      origin
    );
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
      `clip-checkout: Clip respondió ${response.status}.`,
      raw.slice(0, 500)
    );
    return json(
      { enabled: true, error: "No se pudo crear el link de pago" },
      502,
      origin
    );
  }

  const checkoutUrl = safeCheckoutUrl(data.payment_request_url);
  const checkoutId = String(data.payment_request_id || "");
  if (!checkoutUrl || !isUuid(checkoutId)) {
    console.error("clip-checkout: respuesta inesperada de Clip.");
    return json(
      { enabled: true, error: "Respuesta inválida de Clip" },
      502,
      origin
    );
  }

  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update({
      payment_method: "clip",
      payment_status: "pending",
      clip_checkout_id: checkoutId,
      clip_checkout_url: checkoutUrl,
    })
    .eq("id", order.id)
    .eq("payment_status", "pending")
    .select("id")
    .maybeSingle();

  if (updateError) {
    console.error("clip-checkout: no se pudo guardar el checkout.");
    return json(
      { enabled: true, url: checkoutUrl, warning: "No se pudo guardar el checkout" },
      200,
      origin
    );
  }

  if (!updated) {
    const { data: fresh } = await admin
      .from("orders")
      .select("payment_status")
      .eq("id", order.id)
      .maybeSingle();
    if (fresh?.payment_status === "paid") {
      return json({ enabled: true, alreadyPaid: true }, 200, origin);
    }
  }

  return json({ enabled: true, url: checkoutUrl, checkoutId }, 200, origin);
});
