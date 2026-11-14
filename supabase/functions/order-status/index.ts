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

const WINDOW_MINUTES = 10;
const MAX_LOOKUPS = 12;

async function hashIp(request: Request): Promise<string> {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  const chain = forwarded
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const ip =
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
  const since = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const { count, error: countError } = await supabase
    .from("order_lookup_attempts")
    .select("*", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  if (countError) {
    console.error("order-status: no se pudo leer el rate limit.", countError.message);
    return json({ error: "Servicio no disponible" }, 503, origin);
  }
  if ((count || 0) >= MAX_LOOKUPS) {
    return json(
      { error: "rate_limited", message: "Demasiadas consultas. Espera unos minutos." },
      429,
      origin
    );
  }

  await supabase.from("order_lookup_attempts").insert({ ip_hash: ipHash });
  await supabase
    .from("order_lookup_attempts")
    .delete()
    .lt("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

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
