// like hoodie ♡ — seguimiento de pedidos con rate limit por IP.
// El RPC de Postgres ya no es público; esta función usa service_role.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  json,
  readJson,
  secretKey,
  supabaseUrl,
} from "../_shared/clip.ts";

async function hashIp(request: Request): Promise<string> {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const chain = forwarded
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const ip =
    (request.headers.get("cf-connecting-ip") || "").trim() ||
    (request.headers.get("x-real-ip") || "").trim() ||
    chain[chain.length - 1] ||
    "unknown";
  const salt = Deno.env.get("LOOKUP_IP_SALT") || "likehoodie";
  const bytes = new TextEncoder().encode(`${salt}|${ip}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
  const serviceKey = secretKey();
  if (!url || !serviceKey) {
    console.error("order-status: faltan variables de Supabase.");
    return json({ error: "Configuración incompleta" }, 503, origin);
  }

  const body = await readJson(request);
  if (!body) return json({ error: "Solicitud no válida" }, 400, origin);

  const number = Number(body.number);
  const email = String(body.email || "").trim().toLowerCase();
  if (
    !Number.isInteger(number) ||
    number < 1 ||
    number > 999999999 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 160
  ) {
    return json({ error: "Datos no válidos" }, 400, origin);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ipHash = await hashIp(request);

  const { data: allowed, error: limitError } = await supabase.rpc(
    "take_order_lookup",
    { p_ip_hash: ipHash }
  );

  if (limitError) {
    console.error("order-status: no se pudo aplicar el rate limit.", limitError.message);
    return json({ error: "Servicio no disponible" }, 503, origin);
  }
  if (allowed !== true) {
    return json(
      { error: "rate_limited", message: "Demasiadas consultas. Espera unos minutos." },
      429,
      origin
    );
  }

  const { data, error } = await supabase.rpc("get_order_status", {
    p_number: number,
    p_email: email,
  });

  if (error) {
    console.error("order-status: error del RPC.", error.message);
    return json({ error: "No se pudo consultar el pedido" }, 502, origin);
  }

  return json(data, 200, origin);
});
