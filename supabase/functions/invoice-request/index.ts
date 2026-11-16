// like hoodie ♡ — solicitud pública de factura individual.
// Valida el pedido con service_role y guarda los datos fiscales en una tabla
// privada. La emisión del CFDI sigue siendo manual.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  clientIpHash,
  corsHeaders,
  json,
  readJson,
  secretKey,
  supabaseUrl,
} from "../_shared/clip.ts";

const CFDI_USES = new Set(["G01", "G03", "P01", "S01"]);
const SAT_PAYMENT_FORMS = new Set(["04", "28"]);
const RFC_RE = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return json({ error: "Método no permitido" }, 405, origin);
  }

  const url = supabaseUrl();
  const serviceKey = secretKey();
  if (!url || !serviceKey) {
    console.error("invoice-request: faltan variables de Supabase.");
    return json({ error: "Configuración incompleta" }, 503, origin);
  }

  const body = await readJson(request);
  if (!body) return json({ error: "Solicitud no válida" }, 400, origin);

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (String(body.action || "").trim() === "confirm") {
    const token = String(body.token || "").trim();
    if (!UUID_RE.test(token)) {
      return json({ error: "El enlace no es válido" }, 400, origin);
    }

    const { data, error } = await supabase.rpc("confirm_invoice_request", {
      p_token: token,
    });

    if (error) {
      console.error("invoice-request: error al confirmar.", error.message);
      return json({ error: "No se pudo confirmar la solicitud" }, 502, origin);
    }

    if (!data || data.ok !== true) {
      const reasons = {
        notfound: "El enlace no es válido o ya se usó",
        expired: "El enlace expiró. Vuelve a enviar la solicitud",
        cancelled: "La solicitud está cancelada",
        unpaid: "El pago del pedido aún no está aprobado",
      };
      return json(
        { error: reasons[data?.reason] || "No se pudo confirmar la solicitud" },
        409,
        origin
      );
    }

    const message =
      data.status === "issued"
        ? "La factura de este pedido ya fue emitida."
        : data.status === "review"
          ? "Correo confirmado. Revisaremos tu solicitud y te enviaremos el XML y PDF."
          : "Solicitud confirmada.";

    return json({ ok: true, status: data.status, message }, 200, origin);
  }

  const number = Number(body.number);
  const purchaseEmail = String(body.email || "").trim().toLowerCase();
  const rfc = String(body.rfc || "").trim().toUpperCase();
  const legalName = String(body.legalName || "").replace(/\s+/g, " ").trim();
  const taxRegime = String(body.taxRegime || "").trim();
  const zip = String(body.zip || "").trim();
  const cfdiUse = String(body.cfdiUse || "").trim().toUpperCase();
  const invoiceEmail = String(body.invoiceEmail || purchaseEmail)
    .trim()
    .toLowerCase();
  const satPaymentForm = String(body.satPaymentForm || "").trim();
  const notes = String(body.notes || "").trim().slice(0, 500);

  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 999999999 ||
    !EMAIL_RE.test(purchaseEmail) ||
    purchaseEmail.length > 160 ||
    !RFC_RE.test(rfc) ||
    legalName.length < 2 ||
    legalName.length > 160 ||
    !/^[0-9]{3}$/.test(taxRegime) ||
    !/^[0-9]{5}$/.test(zip) ||
    !CFDI_USES.has(cfdiUse) ||
    !EMAIL_RE.test(invoiceEmail) ||
    invoiceEmail.length > 160 ||
    !SAT_PAYMENT_FORMS.has(satPaymentForm)
  ) {
    return json({ error: "Datos fiscales no válidos" }, 400, origin);
  }

  const ipHash = await clientIpHash(request);
  const { data: allowed, error: limitError } = await supabase.rpc(
    "take_invoice_request",
    { p_ip_hash: ipHash }
  );

  if (limitError) {
    console.error(
      "invoice-request: no se pudo aplicar el rate limit.",
      limitError.message
    );
    return json({ error: "Servicio no disponible" }, 503, origin);
  }
  if (allowed !== true) {
    return json(
      { error: "Demasiadas solicitudes. Espera unos minutos." },
      429,
      origin
    );
  }

  const { data, error } = await supabase.rpc("submit_invoice_request", {
    p_number: number,
    p_email: purchaseEmail,
    p_rfc: rfc,
    p_legal_name: legalName,
    p_tax_regime: taxRegime,
    p_zip: zip,
    p_cfdi_use: cfdiUse,
    p_invoice_email: invoiceEmail,
    p_notes: notes,
    p_sat_payment_form: satPaymentForm,
  });

  if (error) {
    console.error("invoice-request: error del RPC.", error.message);
    return json({ error: "No se pudo registrar la solicitud" }, 502, origin);
  }

  if (!data || data.ok !== true) {
    const reasons = {
      invalid: [400, "Datos fiscales no válidos"],
      notfound: [404, "No encontramos un pedido con ese número y correo"],
      unpaid: [409, "La factura se solicita después de que el pago esté aprobado"],
      cancelled: [409, "El pedido está cancelado"],
      issued: [409, "La factura de este pedido ya fue emitida"],
      locked: [409, "La solicitud ya fue revisada o cancelada; contacta con soporte"],
    };
    const [status, message] = reasons[data?.reason] || [
      409,
      "No se pudo registrar la solicitud",
    ];
    return json({ error: message }, status, origin);
  }

  const emailSent = data.email_sent === true;
  const message = emailSent
    ? "Solicitud recibida. Revisa el correo de compra y confirma el enlace para continuar."
    : "Solicitud recibida, pero no pudimos enviar el correo de confirmación. Escríbenos a hola@likehoodie.com.";

  return json(
    { ok: true, status: data.status, email_sent: emailSent, message },
    200,
    origin
  );
});
