// like hoodie ♡ — estadísticas para el panel.
// Devuelve GA4 (Data API) y Meta (Ads Insights + último envío de CAPI).
// Solo responde a administradores con MFA verificado (is_admin()).
//
// Secretos de la función (Supabase → Edge Functions → Secrets):
//   GA_SERVICE_ACCOUNT   JSON completo de la cuenta de servicio de Google
//   GA_PROPERTY_ID       opcional; por defecto 344891849
//   META_ACCESS_TOKEN    token con ads_read
//   META_AD_ACCOUNT_ID   opcional; por defecto act_2084208475729036

import { createClient } from "npm:@supabase/supabase-js@2";

// Helpers locales (mismos que _shared/clip.ts) para que la función se pueda
// desplegar tal cual desde el editor del panel de Supabase.
const env = (name: string): string => (Deno.env.get(name) || "").trim();

function allowedOrigin(origin: string | null): string {
  if (origin && /^https:\/\/(www\.)?likehoodie\.com$/i.test(origin)) return origin;
  if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return origin;
  return "https://likehoodie.com";
}

function corsHeaders(origin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin(origin),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status = 200, origin: string | null = null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

const supabaseUrl = (): string => env("SUPABASE_URL");
const secretKey = (): string => {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
    return keys.default || env("SUPABASE_SERVICE_ROLE_KEY");
  } catch {
    return env("SUPABASE_SERVICE_ROLE_KEY");
  }
};
const publishableKey = (): string => {
  try {
    const keys = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}");
    return keys.default || env("SUPABASE_ANON_KEY");
  } catch {
    return env("SUPABASE_ANON_KEY");
  }
};

const GA_SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
const DEFAULT_PROPERTY = "344891849";
const DEFAULT_AD_ACCOUNT = "act_2254330422156099";

type ServiceAccount = {
  client_email?: string;
  private_key?: string;
};

function base64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function googleAccessToken(account: ServiceAccount): Promise<string> {
  if (!account.client_email || !account.private_key) {
    throw new Error("La cuenta de servicio no tiene client_email o private_key.");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: GA_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = `${header}.${claims}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(account.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(unsigned)
    )
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64url(signature)}`,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Google rechazó la cuenta de servicio (${response.status}). ${detail.slice(0, 200)}`);
  }

  const data = await response.json();
  if (!data.access_token) throw new Error("Google no devolvió un token.");
  return String(data.access_token);
}

type GaRow = { dimensionValues?: { value?: string }[]; metricValues?: { value?: string }[] };

async function gaReport(
  token: string,
  property: string,
  body: Record<string, unknown>
): Promise<GaRow[]> {
  const response = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(
      property
    )}:runReport`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`GA4 respondió ${response.status}. ${detail.slice(0, 240)}`);
  }

  const data = await response.json();
  return Array.isArray(data.rows) ? data.rows : [];
}

const number = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const metric = (row: GaRow, index: number): number =>
  number(row.metricValues?.[index]?.value);

async function loadAnalytics(days: number, property: string, country = "") {
  const raw = env("GA_SERVICE_ACCOUNT");
  if (!raw) {
    return {
      configured: false,
      missing: ["GA_SERVICE_ACCOUNT"],
      hint: "Crea una cuenta de servicio en Google Cloud, dale acceso de lectura a la propiedad de GA4 y guarda el JSON como secreto GA_SERVICE_ACCOUNT.",
    };
  }

  let account: ServiceAccount;
  try {
    account = JSON.parse(raw);
  } catch {
    return {
      configured: false,
      missing: ["GA_SERVICE_ACCOUNT"],
      hint: "El secreto GA_SERVICE_ACCOUNT no es un JSON válido.",
    };
  }

  try {
    const token = await googleAccessToken(account);
    const range = { startDate: `${days}daysAgo`, endDate: "today" };

    // El filtro de país se aplica a todo menos a la lista de países, para que
    // el selector siga ofreciendo el resto de opciones.
    const countryFilter = country
      ? {
          dimensionFilter: {
            filter: {
              fieldName: "country",
              stringFilter: {
                matchType: "EXACT",
                value: country,
                caseSensitive: false,
              },
            },
          },
        }
      : {};

    const [totalsRows, daily, channels, countries, pages, events] = await Promise.all([
      gaReport(token, property, {
        dateRanges: [range],
        ...countryFilter,
        metrics: [
          { name: "activeUsers" },
          { name: "sessions" },
          { name: "screenPageViews" },
          { name: "keyEvents" },
          { name: "totalRevenue" },
        ],
      }),
      gaReport(token, property, {
        dateRanges: [range],
        ...countryFilter,
        dimensions: [{ name: "date" }],
        metrics: [{ name: "activeUsers" }, { name: "sessions" }],
        orderBys: [{ dimension: { dimensionName: "date" } }],
        limit: 100,
      }),
      gaReport(token, property, {
        dateRanges: [range],
        ...countryFilter,
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 6,
      }),
      gaReport(token, property, {
        dateRanges: [range],
        dimensions: [{ name: "country" }],
        metrics: [{ name: "activeUsers" }, { name: "sessions" }],
        orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
        limit: 12,
      }),
      gaReport(token, property, {
        dateRanges: [range],
        ...countryFilter,
        dimensions: [{ name: "pageTitle" }],
        metrics: [{ name: "screenPageViews" }],
        orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
        limit: 8,
      }),
      gaReport(token, property, {
        dateRanges: [range],
        ...countryFilter,
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        orderBys: [{ metric: { metricName: "eventCount" }, desc: true }],
        limit: 10,
      }),
    ]);

    const total = totalsRows[0] || {};

    return {
      configured: true,
      error: null,
      totals: {
        users: metric(total, 0),
        sessions: metric(total, 1),
        views: metric(total, 2),
        keyEvents: metric(total, 3),
        revenue: metric(total, 4),
      },
      daily: daily.map((row) => {
        const raw = String(row.dimensionValues?.[0]?.value || "");
        const date =
          raw.length === 8
            ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
            : raw;
        return {
          date,
          users: metric(row, 0),
          sessions: metric(row, 1),
        };
      }),
      channels: channels.map((row) => ({
        label: String(row.dimensionValues?.[0]?.value || "Sin canal"),
        count: metric(row, 0),
      })),
      countries: countries.map((row) => ({
        label: String(row.dimensionValues?.[0]?.value || "Sin país"),
        count: metric(row, 0),
        sessions: metric(row, 1),
      })),
      pages: pages.map((row) => ({
        label: String(row.dimensionValues?.[0]?.value || "Sin título"),
        count: metric(row, 0),
      })),
      events: events.map((row) => ({
        label: String(row.dimensionValues?.[0]?.value || "evento"),
        count: metric(row, 0),
      })),
    };
  } catch (error) {
    console.error("stats: GA4", error);
    return {
      configured: true,
      error: error instanceof Error ? error.message : "No se pudo leer GA4.",
      totals: null,
      daily: [],
      channels: [],
      countries: [],
      pages: [],
      events: [],
    };
  }
}

const PRESETS: Record<number, string> = {
  7: "last_7d",
  28: "last_28d",
  90: "last_90d",
};

async function loadMeta(days: number, tokenOverride = "") {
  const token = env("META_ACCESS_TOKEN") || tokenOverride;
  const account = env("META_AD_ACCOUNT_ID") || DEFAULT_AD_ACCOUNT;

  const empty = {
    configured: false,
    error: null,
    missing: ["META_ACCESS_TOKEN"],
    hint: "No hay token de Meta. Se usa META_ACCESS_TOKEN o, si no existe, el token de CAPI guardado en Vault.",
    ads: { spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, purchases: 0, revenue: 0 },
  };

  if (!token) return empty;

  try {
    const url = new URL(`https://graph.facebook.com/v21.0/${account}/insights`);
    url.searchParams.set(
      "fields",
      "spend,impressions,clicks,ctr,cpc,actions,action_values"
    );
    url.searchParams.set("date_preset", PRESETS[days] || "last_28d");
    url.searchParams.set("level", "account");

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Meta respondió ${response.status}. ${detail.slice(0, 200)}`);
    }

    const payload = await response.json();
    const row = Array.isArray(payload.data) && payload.data[0] ? payload.data[0] : {};
    const actions: { action_type?: string; value?: string }[] = Array.isArray(row.actions)
      ? row.actions
      : [];
    const values: { action_type?: string; value?: string }[] = Array.isArray(
      row.action_values
    )
      ? row.action_values
      : [];

    const purchaseAction =
      actions.find((item) => item.action_type === "offsite_conversion.fb_pixel_purchase") ||
      actions.find((item) => item.action_type === "purchase");
    const purchaseValue =
      values.find((item) => item.action_type === "offsite_conversion.fb_pixel_purchase") ||
      values.find((item) => item.action_type === "purchase");

    return {
      configured: true,
      error: null,
      ads: {
        spend: number(row.spend),
        impressions: number(row.impressions),
        clicks: number(row.clicks),
        ctr: number(row.ctr),
        cpc: number(row.cpc),
        purchases: number(purchaseAction?.value),
        revenue: number(purchaseValue?.value),
      },
    };
  } catch (error) {
    console.error("stats: Meta", error);
    const message = error instanceof Error ? error.message : "No se pudo leer Meta.";
    const permission = message.includes("403") || message.includes("ads_read");
    return {
      ...empty,
      configured: true,
      error: permission
        ? "El token de Meta no tiene permiso ads_read sobre la cuenta publicitaria. Genera uno en Business Settings (System user → Generate token, ads_read) y guárdalo como META_ACCESS_TOKEN."
        : message,
    };
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(origin) });
  }
  if (request.method !== "POST") {
    return json({ error: "Método no permitido" }, 405, origin);
  }

  const token = (request.headers.get("authorization") || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return json({ error: "No autenticado" }, 401, origin);

  const url = supabaseUrl();
  const anon = publishableKey();
  const service = secretKey();
  if (!url || !anon || !service) {
    return json({ error: "Configuración incompleta" }, 503, origin);
  }

  const asUser = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: isAdmin, error: adminError } = await asUser.rpc("is_admin");
  if (adminError || !isAdmin) {
    return json({ error: "No autorizado" }, 403, origin);
  }

  let body: { days?: number; country?: string } = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const allowed = [7, 28, 90];
  const days = allowed.includes(Number(body.days)) ? Number(body.days) : 28;
  const country =
    typeof body.country === "string" ? body.country.trim().slice(0, 60) : "";
  const property = env("GA_PROPERTY_ID") || DEFAULT_PROPERTY;

  const admin = createClient(url, service, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Token de Meta: primero el secreto propio; si no existe, el de CAPI en Vault.
  let metaToken = env("META_ACCESS_TOKEN");
  if (!metaToken) {
    const { data: vaultToken } = await admin.rpc("stats_meta_token");
    if (vaultToken) metaToken = String(vaultToken);
  }

  const [ga, meta, capiResult] = await Promise.all([
    loadAnalytics(days, property, country),
    loadMeta(days, metaToken),
    admin.rpc("meta_last_response"),
  ]);
  const capi = capiResult.data;

  return json(
    {
      days,
      country,
      generatedAt: new Date().toISOString(),
      ga,
      meta: { ...meta, capi: capi || null },
    },
    200,
    origin
  );
});
