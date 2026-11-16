// like hoodie ♡ — registro público de errores de cliente con rate limit por IP.
// Redacta correos y teléfonos antes de guardar. No guarda cookies, dirección ni
// datos de tarjeta.

import { createClient } from "npm:@supabase/supabase-js@2";
import {
  clientIpHash,
  corsHeaders,
  json,
  readJson,
  secretKey,
  supabaseUrl,
} from "../_shared/clip.ts";

function redact(value: string): string {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[correo]")
    .replace(/\+?\d[\d\s().-]{7,18}\d/g, (match) =>
      match.replace(/\D/g, "").length >= 10 ? "[telefono]" : match
    );
}

function clean(value: unknown, max: number): string {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return redact(text).slice(0, max);
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
  const ipHash = await clientIpHash(request);

  const { data: allowed, error: limitError } = await supabase.rpc(
    "take_client_error",
    { p_ip_hash: ipHash }
  );

  if (limitError) {
    console.error("client-error: no se pudo aplicar el rate limit.", limitError.message);
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (allowed !== true) {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  await supabase.from("client_errors").insert({
    user_id: null,
    message,
    source: clean(body.source, 200),
    stack: clean(body.stack, 2000),
    path: clean(body.path, 180),
    user_agent: clean(body.userAgent, 200),
  });

  return new Response(null, { status: 204, headers: corsHeaders(origin) });
});
