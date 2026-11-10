// like hoodie ♡ — utilidades compartidas para la integración con Clip.
// Este archivo corre en Deno (Supabase Edge Functions), nunca en el navegador.

export const CLIP_API_BASE = "https://api.payclip.com";
export const SITE_URL = (Deno.env.get("SITE_URL") || "https://likehoodie.com").replace(
  /\/+$/,
  ""
);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): boolean {
  return UUID_RE.test(String(value || ""));
}

export function env(name: string): string {
  return (Deno.env.get(name) || "").trim();
}

export function parseKeys(name: string): Record<string, string> {
  try {
    const value = JSON.parse(Deno.env.get(name) || "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function supabaseUrl(): string {
  return env("SUPABASE_URL");
}

export function publishableKey(): string {
  return parseKeys("SUPABASE_PUBLISHABLE_KEYS").default || env("SUPABASE_ANON_KEY");
}

export function secretKey(): string {
  return parseKeys("SUPABASE_SECRET_KEYS").default || env("SUPABASE_SERVICE_ROLE_KEY");
}

export function hasClipConfig(): boolean {
  return Boolean(
    env("CLIP_API_KEY") && env("CLIP_API_SECRET") && env("CLIP_WEBHOOK_SECRET")
  );
}

function allowedOrigin(origin: string | null): string {
  if (origin && /^https:\/\/(www\.)?likehoodie\.com$/i.test(origin)) {
    return origin;
  }
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) {
    return origin;
  }
  return "https://likehoodie.com";
}

export function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(origin),
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function json(
  body: unknown,
  status = 200,
  origin: string | null = null
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function readJson(
  request: Request
): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (!text || text.length > 12_000) return null;
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function clipAuthHeader(): string {
  return `Basic ${btoa(`${env("CLIP_API_KEY")}:${env("CLIP_API_SECRET")}`)}`;
}

export async function clipRequest(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", clipAuthHeader());
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  return await fetch(`${CLIP_API_BASE}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(12_000),
  });
}

export function safeCheckoutUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (
      host === "clip.mx" ||
      host.endsWith(".clip.mx") ||
      host === "payclip.com" ||
      host.endsWith(".payclip.com")
    ) {
      return url.href;
    }
    return null;
  } catch {
    return null;
  }
}

export function amountMatches(amount: unknown, total: number): boolean {
  const value = Number(amount);
  if (!Number.isFinite(value)) return false;
  return Math.round(value * 100) === Math.round(Number(total) * 100);
}

export type ClipCheckout = {
  payment_request_id?: string;
  payment_request_url?: string;
  status?: string;
  amount?: number;
  currency?: string;
  receipt_no?: string;
  metadata?: { me_reference_id?: string };
};

export async function getClipCheckout(
  checkoutId: string
): Promise<ClipCheckout | null> {
  const response = await clipRequest(
    `/v2/checkout/${encodeURIComponent(checkoutId)}`
  );
  if (!response.ok) return null;
  try {
    return (await response.json()) as ClipCheckout;
  } catch {
    return null;
  }
}
