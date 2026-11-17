/* like hoodie — retención de logos y archivos de impresión.
   Borra archivos antiguos de Storage y sus filas en logo_assets.

   Reglas:
   - Pedido activo: se conserva mientras no esté entregado ni cancelado.
   - Pedido entregado/cancelado: se conserva 180 días desde su última
     actualización.
   - Logo sin ningún pedido: se elimina a los 30 días.
   - Archivo huérfano (sin fila en logo_assets): se elimina a los 30 días.

   Se ejecuta semanalmente desde GitHub Actions con el secreto
   x-cleanup-secret. No acepta peticiones del navegador. */

import { createClient } from "npm:@supabase/supabase-js@2";

const BUCKET_LOGOS = "order-logos";
const BUCKET_PRINTS = "order-prints";
const CLOSED_STATUSES = new Set(["delivered", "cancelled"]);
const PAGE = 1000;

function days(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(3650, Math.round(parsed));
}

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function secretMatches(received: string, expected: string): Promise<boolean> {
  if (!received || !expected) return false;
  const [a, b] = await Promise.all([digest(received), digest(expected)]);
  return a === b;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type StorageObject = { path: string; createdAt: number };

/* deno-lint-ignore no-explicit-any */
type AdminClient = any;

async function listPrefix(
  admin: AdminClient,
  bucket: string,
  prefix = ""
): Promise<StorageObject[]> {
  const objects: StorageObject[] = [];
  let offset = 0;

  while (true) {
    const { data, error } = await admin.storage.from(bucket).list(prefix, {
      limit: PAGE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw error;
    const entries = data || [];

    for (const entry of entries) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id) {
        const stamp = Date.parse(entry.created_at || entry.updated_at || "");
        objects.push({ path, createdAt: Number.isFinite(stamp) ? stamp : 0 });
      } else {
        const children = await listPrefix(admin, bucket, path);
        objects.push(...children);
      }
    }

    if (entries.length < PAGE) break;
    offset += PAGE;
  }

  return objects;
}

async function selectAll(
  admin: AdminClient,
  table: string,
  columns: string
  /* deno-lint-ignore no-explicit-any */
): Promise<any[]> {
  const rows: any[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    from += PAGE;
  }

  return rows;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return json({ error: "Método no permitido" }, 405);
  }

  const expected = Deno.env.get("CLEANUP_SECRET") || "";
  const received = request.headers.get("x-cleanup-secret") || "";
  if (!(await secretMatches(received, expected))) {
    return json({ error: "No autorizado" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SUPABASE_SECRET_KEY") ||
    "";
  if (!supabaseUrl || !serviceKey) {
    return json({ error: "Configuración incompleta" }, 503);
  }

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const orphanDays = days(Deno.env.get("LOGO_ORPHAN_DAYS"), 30);
  const closedDays = days(Deno.env.get("LOGO_CLOSED_DAYS"), 180);
  const now = Date.now();
  const orphanMs = orphanDays * 86_400_000;
  const closedMs = closedDays * 86_400_000;

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  try {
    const [assets, orders, logoObjects, printObjects] = await Promise.all([
      selectAll(admin, "logo_assets", "id,source_path,print_path,created_at"),
      selectAll(admin, "orders", "items,status,updated_at"),
      listPrefix(admin, BUCKET_LOGOS),
      listPrefix(admin, BUCKET_PRINTS),
    ]);

    type Ref = { active: boolean; lastClosed: number };
    const assetRefs = new Map<string, Ref>();
    const activePrintPaths = new Set<string>();
    const closedPrintPaths = new Map<string, number>();

    for (const order of orders) {
      const stamp = Date.parse(order.updated_at || "") || 0;
      const closed = CLOSED_STATUSES.has(order.status);
      const items = Array.isArray(order.items) ? order.items : [];
      for (const item of items) {
        for (const side of ["front", "back"]) {
          const design = item && item[side];
          if (!design || typeof design !== "object") continue;
          const assetId = String(design.logoAssetId || "");
          if (/^[0-9a-f-]{36}$/i.test(assetId)) {
            const ref = assetRefs.get(assetId) || {
              active: false,
              lastClosed: 0,
            };
            if (closed) ref.lastClosed = Math.max(ref.lastClosed, stamp);
            else ref.active = true;
            assetRefs.set(assetId, ref);
          }
          const printPath = String(design.printPath || "");
          if (printPath) {
            if (closed) {
              closedPrintPaths.set(
                printPath,
                Math.max(closedPrintPaths.get(printPath) || 0, stamp)
              );
            } else {
              activePrintPaths.add(printPath);
            }
          }
        }
      }
    }

    const assetsBySource = new Map<string, (typeof assets)[number]>();
    const assetsByPrint = new Map<string, (typeof assets)[number]>();
    for (const asset of assets) {
      if (asset.source_path) assetsBySource.set(asset.source_path, asset);
      if (asset.print_path) assetsByPrint.set(asset.print_path, asset);
    }

    const existingLogos = new Set(logoObjects.map((object) => object.path));
    const existingPrints = new Set(printObjects.map((object) => object.path));

    const assetDecision = (
      asset: (typeof assets)[number]
    ): { remove: boolean; reason: string } => {
      const ref = assetRefs.get(asset.id);
      if (ref && ref.active) return { remove: false, reason: "pedido activo" };
      if (ref && (!ref.lastClosed || now - ref.lastClosed <= closedMs)) {
        return { remove: false, reason: "pedido reciente" };
      }
      if (ref) return { remove: true, reason: `pedido cerrado +${closedDays}d` };
      const created = Date.parse(asset.created_at || "") || 0;
      if (!created || now - created <= orphanMs) {
        return { remove: false, reason: "sin pedido reciente" };
      }
      return { remove: true, reason: `sin pedido +${orphanDays}d` };
    };

    const decisions = new Map<
      string,
      { asset: (typeof assets)[number]; remove: boolean; reason: string }
    >();
    for (const asset of assets) {
      decisions.set(asset.id, { asset, ...assetDecision(asset) });
    }

    const candidates = {
      logos: [] as string[],
      prints: [] as string[],
    };
    const reasons: Record<string, number> = {};
    const addCandidate = (
      bucket: string,
      path: string,
      decision: { remove: boolean; reason: string }
    ) => {
      if (!decision.remove) return;
      if (bucket === BUCKET_LOGOS) candidates.logos.push(path);
      else candidates.prints.push(path);
      reasons[decision.reason] = (reasons[decision.reason] || 0) + 1;
    };

    for (const object of logoObjects) {
      const asset = assetsBySource.get(object.path);
      if (asset) {
        addCandidate(BUCKET_LOGOS, object.path, decisions.get(asset.id)!);
      } else if (object.createdAt && now - object.createdAt > orphanMs) {
        addCandidate(BUCKET_LOGOS, object.path, {
          remove: true,
          reason: `huérfano +${orphanDays}d`,
        });
      }
    }

    for (const object of printObjects) {
      const asset = assetsByPrint.get(object.path);
      if (asset) {
        addCandidate(BUCKET_PRINTS, object.path, decisions.get(asset.id)!);
        continue;
      }
      if (activePrintPaths.has(object.path)) continue;
      if (closedPrintPaths.has(object.path)) {
        const closedAt = closedPrintPaths.get(object.path) || 0;
        if (!closedAt || now - closedAt <= closedMs) continue;
      }
      if (object.createdAt && now - object.createdAt > orphanMs) {
        addCandidate(BUCKET_PRINTS, object.path, {
          remove: true,
          reason: `huérfano +${orphanDays}d`,
        });
      }
    }

    // Filas cuyo contenido ya no existe o cuyos archivos se van a eliminar.
    const candidateLogos = new Set(candidates.logos);
    const candidatePrints = new Set(candidates.prints);
    const deletableAssets = new Set<string>();
    for (const asset of assets) {
      const decision = decisions.get(asset.id)!;
      if (!decision.remove) continue;
      const sourceGone =
        !asset.source_path ||
        !existingLogos.has(asset.source_path) ||
        candidateLogos.has(asset.source_path);
      const printGone =
        !asset.print_path ||
        !existingPrints.has(asset.print_path) ||
        candidatePrints.has(asset.print_path);
      if (sourceGone && printGone) deletableAssets.add(asset.id);
    }

    const removed = { logos: 0, prints: 0, assets: 0 };
    if (!dryRun) {
      for (const [bucket, paths] of [
        [BUCKET_LOGOS, candidates.logos],
        [BUCKET_PRINTS, candidates.prints],
      ] as const) {
        for (let index = 0; index < paths.length; index += 100) {
          const chunk = paths.slice(index, index + 100);
          if (!chunk.length) continue;
          const { data, error } = await admin.storage.from(bucket).remove(chunk);
          if (error) throw error;
          const count = Array.isArray(data) ? data.length : chunk.length;
          if (bucket === BUCKET_LOGOS) removed.logos += count;
          else removed.prints += count;
        }
      }

      const assetIds = [...deletableAssets];
      for (let index = 0; index < assetIds.length; index += 100) {
        const chunk = assetIds.slice(index, index + 100);
        if (!chunk.length) continue;
        const { error } = await admin
          .from("logo_assets")
          .delete()
          .in("id", chunk);
        if (error) throw error;
        removed.assets += chunk.length;
      }
    }

    return json({
      ok: true,
      dryRun,
      retention: { orphanDays, closedDays },
      scanned: {
        logos: logoObjects.length,
        prints: printObjects.length,
        assets: assets.length,
        orders: orders.length,
      },
      candidates: {
        logos: candidates.logos.length,
        prints: candidates.prints.length,
        assets: deletableAssets.size,
      },
      removed,
      reasons,
    });
  } catch (error) {
    console.error("cleanup-storage", error instanceof Error ? error.name : "error");
    return json({ error: "Error interno" }, 500);
  }
});
