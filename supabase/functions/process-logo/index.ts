/* like hoodie ♡ — procesado de logos para DTG en dos etapas.
   Etapa 1 (cutout): quita el fondo y deja un PNG con alfa.
   Etapa 2 (resize): amplía al tamaño de impresión y guarda el archivo final.
   Cada etapa se ejecuta en una invocación distinta para respetar
   los 256 MB y 2 s de CPU de Supabase Edge Functions. */

import { createClient } from "npm:@supabase/supabase-js@2";
import { cutoutStage, resizeStage } from "./processor.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_PX = 2800;
const MAX_UPSCALE = 2;
const BUCKET_SOURCE = "order-logos";
const BUCKET_PRINT = "order-prints";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

/* deno-lint-ignore no-explicit-any */
type Asset = any;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS });
  }
  if (req.method !== "POST") {
    return json({ error: "método no permitido" }, 405);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return json({ error: "faltan variables de entorno" }, 500);
  }

  let body: { assetId?: string; stage?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const assetId = String(body.assetId || "");
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) {
    return json({ error: "assetId inválido" }, 400);
  }
  const stage = body.stage === "resize" ? "resize" : "cutout";
  const token = (req.headers.get("Authorization") || "").replace(
    /^Bearer\s+/i,
    ""
  );
  const isService = token === serviceKey;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  let asset: Asset = null;
  if (isService) {
    const { data } = await admin
      .from("logo_assets")
      .select("*")
      .eq("id", assetId)
      .maybeSingle();
    asset = data;
  } else {
    if (!token) return json({ error: "falta la sesión" }, 401);
    const userClient = createClient(url, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: auth } = await userClient.auth.getUser();
    if (!auth?.user) return json({ error: "sesión inválida" }, 401);
    const { data } = await userClient
      .from("logo_assets")
      .select("*")
      .eq("id", assetId)
      .maybeSingle();
    asset = data;
  }

  if (!asset) return json({ error: "asset no encontrado" }, 404);
  if (asset.status === "ready" || asset.status === "review") {
    return json({ status: asset.status, printPath: asset.print_path });
  }

  const fail = async (error: unknown) => {
    const message = String(
      (error as Error)?.message || error || "error desconocido"
    ).slice(0, 500);
    await admin
      .from("logo_assets")
      .update({
        status: "failed",
        last_error: message,
        attempts: Number(asset.attempts || 0) + 1,
      })
      .eq("id", assetId);
    return json({ error: message }, 500);
  };

  try {
    if (stage === "cutout") {
      await admin
        .from("logo_assets")
        .update({
          status: "cutout",
          attempts: Number(asset.attempts || 0) + 1,
        })
        .eq("id", assetId);

      const { data: file, error: downloadError } = await admin.storage
        .from(BUCKET_SOURCE)
        .download(asset.source_path);
      if (downloadError || !file) {
        throw new Error("No se pudo descargar el logo original.");
      }

      const result = await cutoutStage(new Uint8Array(await file.arrayBuffer()));
      const cutoutPath = `${asset.user_id || "anon"}/${asset.id}-cutout.png`;
      const { error: uploadError } = await admin.storage
        .from(BUCKET_PRINT)
        .upload(
          cutoutPath,
          new Blob([result.png as unknown as BlobPart], {
            type: "image/png",
          }),
          { contentType: "image/png", upsert: true }
        );
      if (uploadError) throw uploadError;

      await admin
        .from("logo_assets")
        .update({
          status: "cutout_ready",
          cutout_path: cutoutPath,
          cutout: result.cutout,
          output_width: result.width,
          output_height: result.height,
          warnings: result.warnings,
          last_error: null,
        })
        .eq("id", assetId);

      // Segunda etapa en segundo plano (invocación nueva = memoria nueva).
      const task = fetch(`${url}/functions/v1/process-logo`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ assetId, stage: "resize" }),
      }).catch(() => undefined);
      const runtime = (
        globalThis as {
          EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
        }
      ).EdgeRuntime;
      if (runtime?.waitUntil) runtime.waitUntil(task);
      else task.catch(() => undefined);

      return json({ status: "cutout_ready", cutoutPath });
    }

    if (!asset.cutout_path) {
      throw new Error("Falta el recorte; ejecuta primero la etapa cutout.");
    }

    await admin
      .from("logo_assets")
      .update({ status: "resizing" })
      .eq("id", assetId);

    const { data: file, error: downloadError } = await admin.storage
      .from(BUCKET_PRINT)
      .download(asset.cutout_path);
    if (downloadError || !file) {
      throw new Error("No se pudo descargar el recorte.");
    }

    const result = await resizeStage(
      new Uint8Array(await file.arrayBuffer()),
      {
        widthCm: Number(asset.width_cm) || 28,
        targetDpi: Number(asset.target_dpi) || 300,
        maxPx: MAX_PX,
        maxUpscale: MAX_UPSCALE,
      }
    );

    const printPath = `${asset.user_id || "anon"}/${asset.id}-print.png`;
    const { error: uploadError } = await admin.storage
      .from(BUCKET_PRINT)
      .upload(
        printPath,
        new Blob([result.png as unknown as BlobPart], { type: "image/png" }),
        { contentType: "image/png", upsert: true }
      );
    if (uploadError) throw uploadError;

    const warnings = [
      ...(Array.isArray(asset.warnings) ? asset.warnings : []),
      ...result.warnings,
    ];
    const needsReview =
      result.outputDpi < 200 ||
      warnings.some((warning: string) => /Fondo no uniforme/i.test(warning));

    await admin
      .from("logo_assets")
      .update({
        status: needsReview ? "review" : "ready",
        print_path: printPath,
        output_width: result.width,
        output_height: result.height,
        output_dpi: result.outputDpi,
        upscale: Number(result.upscale.toFixed(2)),
        warnings,
        last_error: null,
      })
      .eq("id", assetId);

    return json({
      status: needsReview ? "review" : "ready",
      printPath,
      dpi: result.outputDpi,
      width: result.width,
      height: result.height,
    });
  } catch (error) {
    return await fail(error);
  }
});
