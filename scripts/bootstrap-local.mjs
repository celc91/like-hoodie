#!/usr/bin/env node
/**
 * Bootstrap reproducible de la base local de like hoodie.
 *
 * `supabase start` aplica supabase/migrations/ al arrancar, pero esas
 * migraciones asumen el esquema base (schema.sql y fase*.sql), que no vive en
 * migrations/. Por eso este script:
 *
 *   1. aparta migrations/,
 *   2. arranca la base limpia,
 *   3. aplica los 28 scripts base en el orden canónico,
 *   4. devuelve migrations/ y las aplica con `supabase migration up`
 *      (que además las registra en el historial).
 *
 * Solo usa la base local. Nunca --linked ni --remote.
 *
 * Uso: node scripts/bootstrap-local.mjs
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUPABASE = join(ROOT, "supabase");
const MIGRATIONS = join(SUPABASE, "migrations");
const HOLD = join(SUPABASE, "migrations.hold");

const DB_HOST = process.env.LH_DB_HOST || "127.0.0.1";
const DB_PORT = process.env.LH_DB_PORT || "54322";
const DB_USER = process.env.LH_DB_USER || "postgres";
const DB_PASS = process.env.LH_DB_PASS || "postgres";
const DB_NAME = process.env.LH_DB_NAME || "postgres";
const CONTAINER = process.env.LH_DB_CONTAINER || "supabase_db_like-hoodie";

// Orden canónico (Q-01). No reordenar sin probar el bootstrap completo.
const BASE_FILES = [
  "schema.sql",
  "storage-logos.sql",
  "security-hardening.sql",
  "coupons.sql",
  "clip-payments.sql",
  "email-notifications.sql",
  "fase1-pedidos-seguros.sql",
  "fase3-seguimiento.sql",
  "fase3-monitorizacion.sql",
  "fase4-seguridad.sql",
  "fase5-ratelimit.sql",
  "fase6-limites.sql",
  "logo-assets.sql",
  "fase7-abuso.sql",
  "fase8-admin-mfa.sql",
  "fase9-facturacion-global.sql",
  "fase10-facturacion-individual.sql",
  "newsletter.sql",
  "optin-1-columnas.sql",
  "optin-2-funciones.sql",
  "security-fixes.sql",
  "antispam.sql",
  "optin-3-alta.sql",
  "antispam-cupones.sql",
  "meta-capi-1-consentimiento.sql",
  "meta-capi-2-compra.sql",
  "order-email-baja.sql",
  "order-email-baja-pago.sql",
];

let cliPrefix = null;
let useDocker = false;

function run(command, args, options = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, options);
    let out = "";
    let err = "";
    if (options.stdin) child.stdin.end(options.stdin);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (error) => resolveRun({ code: -1, out, err: String(error) }));
    child.on("close", (code) => resolveRun({ code, out, err }));
  });
}

async function detectCli() {
  const probe = await run("supabase", ["--version"]);
  cliPrefix = probe.code === 0 ? ["supabase", []] : ["npx", ["supabase"]];
}

async function cli(args, options = {}) {
  const [command, prefix] = cliPrefix;
  if (command === "npx" && process.platform === "win32") {
    return run(`npx supabase ${args.join(" ")}`, [], {
      cwd: ROOT,
      shell: true,
      ...options,
    });
  }
  return run(command, [...prefix, ...args], { cwd: ROOT, ...options });
}

async function detectPsql() {
  // Solo se comprueba el cliente. El contenedor puede no existir todavía:
  // la base arranca después de este paso.
  const probe = await run("psql", ["--version"]);
  useDocker = probe.code !== 0;
}

function psqlArgs() {
  if (useDocker) {
    return ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"];
  }
  return [
    "-h", DB_HOST,
    "-p", DB_PORT,
    "-U", DB_USER,
    "-d", DB_NAME,
    "-q",
    "-v", "ON_ERROR_STOP=1",
    "-f", "-",
  ];
}

async function applyFile(name) {
  const file = join(SUPABASE, name);
  if (!existsSync(file)) throw new Error(`No existe supabase/${name}`);
  const content = readFileSync(file);
  const args = psqlArgs();
  const command = useDocker ? "docker" : "psql";
  const result = await run(command, args, {
    cwd: ROOT,
    stdin: content,
    env: { ...process.env, PGPASSWORD: DB_PASS },
  });
  if (result.code !== 0) {
    const detail = (result.err || result.out || "").trim().split("\n").slice(-6).join("\n");
    throw new Error(`Falló ${name}:\n${detail}`);
  }
}

function restoreMigrationsIfNeeded() {
  if (existsSync(HOLD) && !existsSync(MIGRATIONS)) {
    renameSync(HOLD, MIGRATIONS);
    console.log("Restaurado migrations/ de una ejecución anterior interrumpida.");
  }
}

async function main() {
  await detectCli();
  await detectPsql();
  restoreMigrationsIfNeeded();

  if (!existsSync(MIGRATIONS)) {
    throw new Error("No existe supabase/migrations/");
  }

  console.log("1/6 Deteniendo la base local y borrando el volumen…");
  await cli(["stop", "--no-backup"]);

  console.log("2/6 Apartando supabase/migrations/…");
  renameSync(MIGRATIONS, HOLD);

  try {
    console.log("3/6 Arrancando Supabase local…");
    const started = await cli(["start"]);
    if (started.code !== 0) {
      throw new Error(`supabase start falló:\n${(started.err || started.out).trim()}`);
    }

    console.log(`4/6 Aplicando ${BASE_FILES.length} scripts base…`);
    let i = 0;
    for (const file of BASE_FILES) {
      i += 1;
      process.stdout.write(`    [${i}/${BASE_FILES.length}] ${file}\n`);
      await applyFile(file);
    }
  } finally {
    console.log("5/6 Devolviendo supabase/migrations/…");
    if (existsSync(HOLD)) renameSync(HOLD, MIGRATIONS);
  }

  console.log("6/6 Aplicando migraciones versionadas…");
  const migrated = await cli(["migration", "up"]);
  if (migrated.code !== 0) {
    throw new Error(`supabase migration up falló:\n${(migrated.err || migrated.out).trim()}`);
  }

  console.log("Bootstrap local completo.");
}

main().catch((error) => {
  console.error(`Bootstrap falló: ${error.message}`);
  restoreMigrationsIfNeeded();
  process.exit(1);
});
