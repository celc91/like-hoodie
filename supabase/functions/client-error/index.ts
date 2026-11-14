// like hoodie ♡ — registro público de errores de cliente con rate limit por IP.
// No guarda cookies, correo, dirección ni datos de tarjeta.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  corsHeaders,
  json,
  readJson,
  secretKey,
  supabaseUrl,
} from "../_shared/clip.ts";

const MAX_ERRORS_PER_HOUR = 20;
const GLOBAL_MAX_PER_HOUR = 2000;

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

function clean(value: unknown, max: number): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
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
    console.error("client-error: faltan variables de Supabase.");
    return json({ error: "Configuración incompleta" }, 503, origin);
  }

  const body = await readJson(request);
  if (!body) return new Response(null, { status: 204, headers: corsHeaders(origin) });

  const message = clean(body.message, 500);
  if (!message) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ipHash = await hashIp(request);
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  const { count, error: countError } = await supabase
    .from("client_error_attempts")
    .select("*", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", since);

  if (countError) {
    console.error("client-error: no se pudo leer el rate limit.", countError.message);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if ((count || 0) >= MAX_ERRORS_PER_HOUR) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  const { count: globalCount } = await supabase
    .from("client_errors")
    .select("*", { count: "exact", head: true })
    .gte("created_at", since);

  if ((globalCount || 0) >= GLOBAL_MAX_PER_HOUR) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  await supabase.from("client_error_attempts").insert({ ip_hash: ipHash });
  await supabase.from("client_errors").insert({
    user_id: null,
    message,
    source: clean(body.source, 200),
    stack: clean(body.stack, 2000),
    path: clean(body.path, 180),
    user_agent: clean(body.userAgent, 200),
  });

  await supabase
    .from("client_error_attempts")
    .delete()
    .lt("created_at", new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString());

  return new Response(null, { status: 204, headers: corsHeaders(origin) });
});
