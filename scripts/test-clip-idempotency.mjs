#!/usr/bin/env node
/**
 * Harness de idempotencia de Clip (bloqueante SET-08).
 *
 * Levanta un mock de Clip dentro de la red de Docker, arranca
 * `supabase functions serve` y lanza dos peticiones realmente paralelas
 * contra clip-pay y clip-checkout.
 *
 * Espera:
 *   - dos cobros paralelos producen UNA sola llamada a Clip;
 *   - dos checkouts paralelos producen UN solo link;
 *   - la base guarda un único intento.
 *
 * Solo contra la base local. Nunca producción.
 *
 * Uso: node scripts/test-clip-idempotency.mjs
 */

import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const API = "http://127.0.0.1:54321";
const CONTAINER = process.env.LH_DB_CONTAINER || "supabase_db_like-hoodie";
const MOCK_NAME = "lh-clip-mock";
const MOCK_PORT = Number(process.env.LH_MOCK_PORT || 4599);
const MOCK_URL = `http://${MOCK_NAME}:${MOCK_PORT}`;

const EMAIL = "qa-clip@example.invalid";
const PASSWORD = "qa-clip-local-1234";

let useDocker = false;
let cli = null;
let serveProcess = null;
let anonKey = "";
let serviceKey = "";
let network = "";
let serveLog = "";

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

async function cliRun(args, options = {}) {
  if (process.platform === "win32" && cli.cmd === "npx") {
    return run(`npx supabase ${args.join(" ")}`, [], { cwd: ROOT, shell: true, ...options });
  }
  return run(cli.cmd, [...cli.prefix, ...args], { cwd: ROOT, ...options });
}

function psqlArgs(user) {
  const base = ["-d", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-f", "-"];
  if (useDocker) {
    return ["exec", "-i", CONTAINER, "psql", "-U", user, ...base];
  }
  return ["-h", "127.0.0.1", "-p", "54322", "-U", user, ...base];
}

async function sqlAs(user, query) {
  const result = await run(useDocker ? "docker" : "psql", psqlArgs(user), {
    cwd: ROOT,
    stdin: query,
    env: { ...process.env, PGPASSWORD: "postgres" },
  });
  if (result.code !== 0) {
    throw new Error(`SQL falló: ${(result.err || result.out).trim().split("\n").slice(-4).join(" ")}`);
  }
  return result.out.trim();
}

const sql = (query) => sqlAs("postgres", query);
const sqlAdmin = (query) => sqlAs("supabase_admin", query);

async function detect() {
  const psql = await run("psql", ["--version"]);
  if (psql.code !== 0) useDocker = true;
  const probe = await run("supabase", ["--version"]);
  cli = probe.code === 0 ? { cmd: "supabase", prefix: [] } : { cmd: "npx", prefix: ["supabase"] };
}

async function readKeys() {
  const status = await cliRun(["status", "-o", "env"]);
  const text = `${status.out}\n${status.err}`;
  const anon = text.match(/^ANON_KEY="?([^"\n]+)"?/m);
  const service = text.match(/^SERVICE_ROLE_KEY="?([^"\n]+)"?/m);
  if (!anon || !service) {
    throw new Error(`No se pudieron leer las claves locales:\n${text.slice(-400)}`);
  }
  anonKey = anon[1];
  serviceKey = service[1];
}

async function findNetwork() {
  const inspected = await run("docker", [
    "inspect",
    "-f",
    "{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}",
    CONTAINER,
  ]);
  network = inspected.out.trim().split(/\s+/).filter(Boolean)[0] || "";
  if (!network) throw new Error("No se pudo detectar la red de Supabase.");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pullMockImage() {
  for (let intento = 1; intento <= 3; intento += 1) {
    const pull = await run("docker", ["pull", "node:22-alpine"]);
    if (pull.code === 0) return;
    console.error(`docker pull node:22-alpine falló (intento ${intento}): ${pull.err.trim().slice(-200)}`);
    if (intento < 3) await sleep(5000);
  }
  throw new Error("No se pudo descargar node:22-alpine para el mock.");
}

async function startMock() {
  await pullMockImage();
  await run("docker", ["rm", "-f", MOCK_NAME]);
  const mockFile = join(ROOT, "scripts", "clip-mock-server.mjs");
  const started = await run("docker", [
    "run", "-d", "--rm",
    "--name", MOCK_NAME,
    "--network", network,
    "-p", `127.0.0.1:${MOCK_PORT}:${MOCK_PORT}`,
    "-e", `PORT=${MOCK_PORT}`,
    "-v", `${mockFile}:/app/mock.mjs:ro`,
    "node:22-alpine",
    "node", "/app/mock.mjs",
  ]);
  if (started.code !== 0) {
    throw new Error(`No se pudo arrancar el mock: ${started.err.trim().slice(-300)}`);
  }

  const deadline = Date.now() + 150_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${MOCK_PORT}/__hits`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return;
    } catch {
      // aún arrancando
    }
    await sleep(1500);
  }
  throw new Error("El mock de Clip no respondió a tiempo.");
}

async function hits() {
  const response = await fetch(`http://127.0.0.1:${MOCK_PORT}/__hits`, {
    signal: AbortSignal.timeout(5000),
  });
  return response.json();
}

function writeFunctionsEnv() {
  const dir = join(ROOT, "supabase", "functions");
  const file = join(dir, ".env");
  let backup = null;
  try {
    backup = readFileSync(file, "utf8");
  } catch {
    backup = null;
  }
  writeFileSync(
    file,
    [
      "CLIP_API_KEY=test_likehoodie",
      "CLIP_API_SECRET=test_likehoodie_secret",
      "CLIP_WEBHOOK_SECRET=test_likehoodie_webhook",
      `CLIP_API_BASE=${MOCK_URL}`,
      "SITE_URL=http://localhost:3000",
      "LOOKUP_IP_SALT=qa-lookup-salt",
    ].join("\n"),
    "utf8"
  );
  return { file, backup };
}

function restoreEnv(state) {
  if (!state) return;
  try {
    if (state.backup === null) {
      if (existsSync(state.file)) writeFileSync(state.file, "", "utf8");
    } else {
      writeFileSync(state.file, state.backup, "utf8");
    }
  } catch {
    // sin problema
  }
}

async function startFunctions() {
  // El contenedor de edge-runtime se reutiliza con el entorno de `supabase start`.
  // Se elimina para que `functions serve` lo recree leyendo supabase/functions/.env.
  await run("docker", ["rm", "-f", process.env.LH_EDGE_CONTAINER || "supabase_edge_runtime_like-hoodie"]);

  const command =
    process.platform === "win32" && cli.cmd === "npx"
      ? `npx supabase functions serve --no-verify-jwt`
      : null;
  serveProcess = command
    ? spawn(command, [], { cwd: ROOT, shell: true, stdio: ["ignore", "pipe", "pipe"] })
    : spawn(cli.cmd, [...cli.prefix, "functions", "serve", "--no-verify-jwt"], {
        cwd: ROOT,
        stdio: ["ignore", "pipe", "pipe"],
      });

  let log = "";
  serveProcess.stdout.on("data", (d) => { log += d; serveLog = log; });
  serveProcess.stderr.on("data", (d) => { log += d; serveLog = log; });

  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${API}/functions/v1/clip-pay`, {
        method: "OPTIONS",
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) return;
    } catch {
      // aún arrancando
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`El runtime de funciones no arrancó:\n${log.slice(-800)}`);
}

async function ensureSession() {
  await sqlAdmin(`
    alter table auth.users alter column confirmation_token set default '';
    alter table auth.users alter column recovery_token set default '';
    alter table auth.users alter column email_change set default '';
    alter table auth.users alter column email_change_token_new set default '';
    update auth.users set
      confirmation_token = coalesce(confirmation_token, ''),
      recovery_token = coalesce(recovery_token, ''),
      email_change = coalesce(email_change, ''),
      email_change_token_new = coalesce(email_change_token_new, '')
     where confirmation_token is null or recovery_token is null
        or email_change is null or email_change_token_new is null;
    delete from auth.users where email = '${EMAIL}';
  `);

  const created = await fetch(`${API}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, email_confirm: true }),
  });
  if (!created.ok) {
    const body = await created.text();
    throw new Error(`No se pudo crear el usuario QA (${created.status}): ${body.slice(0, 200)}`);
  }

  const login = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { "content-type": "application/json", apikey: anonKey },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) {
    const body = await login.text();
    throw new Error(`No se pudo iniciar sesión QA (${login.status}): ${body.slice(0, 200)}`);
  }
  const session = await login.json();
  if (!session.access_token || !session.user?.id) {
    throw new Error("La sesión local no devolvió token o usuario.");
  }
  return { token: session.access_token, userId: session.user.id };
}

async function createOrder(userId) {
  const orderId = await sql(`
    insert into public.orders (
      user_id, status, customer_name, email, phone, address, city, state, zip,
      items, item_count, subtotal, shipping, total, currency,
      payment_method, payment_status
    ) values (
      '${userId}', 'pending', 'Cliente QA', '${EMAIL}', '5512345678', 'Calle QA 1',
      'CDMX', 'CDMX', '01000',
      '[{"name":"Producto QA","qty":1,"size":"M","unitPrice":899}]'::jsonb,
      1, 800, 99, 899, 'MXN', 'demo', 'pending'
    ) returning id;
  `);
  return orderId.split("\n").filter(Boolean).pop().trim();
}

async function seed(userId) {
  await sql(`
    create table if not exists public.qa_concurrency_results (
      case_id text primary key,
      pass boolean not null,
      detail jsonb,
      created_at timestamptz not null default now()
    );
    delete from public.orders
     where user_id = '${userId}'
        or lower(email) = '${EMAIL}';
    insert into public.profiles (id, email, role)
    values ('${userId}', '${EMAIL}', 'customer')
    on conflict (id) do update set role = 'customer';
    update public.store_settings
       set value = 'true', updated_at = now()
     where key = 'clip_enabled';
  `);

  const payOrder = await createOrder(userId);
  const checkoutOrder = await createOrder(userId);
  return { payOrder, checkoutOrder };
}

async function post(path, body, token) {
  const response = await fetch(`${API}/functions/v1/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

async function storageUpload(path, body, contentType, token) {
  const response = await fetch(`${API}/storage/v1/object/order-logos/${path}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": contentType,
      "x-upsert": "true",
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  return response.status;
}

async function storageSign(path, token) {
  const response = await fetch(`${API}/storage/v1/object/sign/order-logos/${path}`, {
    method: "POST",
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 60 }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) return { status: response.status, fetchStatus: null };
  const data = await response.json();
  const signed = await fetch(`${API}/storage/v1${data.signedURL}`, {
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, fetchStatus: signed.status };
}

async function storageDelete(path, token) {
  await fetch(`${API}/storage/v1/object/order-logos/${path}`, {
    method: "DELETE",
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
}

async function runQ10(token, userId) {
  const foreign = "10000000-0000-4000-8000-0000000000ff";
  const control = `${userId}/q10-ok.png`;

  const codes = {};
  codes.clipPaySinSesion = (await post("clip-pay", { orderId: foreign }, null)).status;
  codes.clipCheckoutSinSesion = (await post("clip-checkout", { orderId: foreign }, null)).status;
  codes.processLogoSinSesion = (await post("process-logo", { assetId: foreign }, null)).status;
  codes.invoiceInvalida = (await post("invoice-request", { orderNumber: 1, email: "nadie@example.invalid" }, null)).status;

  codes.uploadOk = await storageUpload(control, PNG_1PX, "image/png", token);
  codes.mimeFalso = await storageUpload(`${userId}/q10-mime.txt`, PNG_1PX, "text/plain", token);
  codes.excedido = await storageUpload(`${userId}/q10-big.png`, Buffer.alloc(6 * 1024 * 1024), "image/png", token);
  codes.rutaPuntoPunto = await storageUpload(`${userId}/../${foreign}/q10-evil.png`, PNG_1PX, "image/png", token);
  codes.dobleBarra = await storageUpload(`${userId}//q10-doble.png`, PNG_1PX, "image/png", token);

  const signed = await storageSign(control, token);
  codes.firma = signed.status;
  codes.firmaGet = signed.fetchStatus;
  const publico = await fetch(`${API}/storage/v1/object/public/order-logos/${control}`, {
    signal: AbortSignal.timeout(20_000),
  });
  codes.urlPublica = publico.status;

  // Storage normaliza "//" antes de guardar. Se comprueba que no escape.
  const evil = Number(
    (await sqlAdmin(`select count(*) from storage.objects where name like '%q10-evil%'`)).trim()
  );
  const doble = Number(
    (await sqlAdmin(
      `select count(*) from storage.objects where name = '${userId}/q10-doble.png'`
    )).trim()
  );
  codes.objetosMaliciosos = evil;
  codes.dobleNormalizado = doble;

  await storageDelete(control, token);
  await storageDelete(`${userId}/q10-doble.png`, token);

  const sto09 = codes.mimeFalso === 400 && codes.excedido === 400;
  const sto10 = codes.urlPublica === 400 && codes.firma === 200 && codes.firmaGet === 200;
  const funciones =
    codes.clipPaySinSesion === 401 &&
    codes.clipCheckoutSinSesion === 401 &&
    codes.processLogoSinSesion === 401 &&
    codes.invoiceInvalida === 400;
  const rutas = codes.rutaPuntoPunto === 400 && evil === 0;
  const dobleBarra = codes.dobleBarra === 200 ? doble === 1 : [400, 403].includes(codes.dobleBarra);
  const pass = sto09 && sto10 && funciones && rutas && dobleBarra && codes.uploadOk === 200;

  return { pass, sto09, sto10, detail: { ...codes } };
}

function stopServe() {
  if (!serveProcess || serveProcess.killed) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(serveProcess.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    serveProcess.kill("SIGTERM");
  }
}

async function runSto07(token, userId) {
  const foreign = "10000000-0000-4000-8000-0000000000ff";
  const ownPath = `${userId}/st07-a.png`;
  const foreignPath = `${foreign}/st07-b.png`;

  const svcHeaders = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    "content-type": "image/png",
  };

  const uploaded = await fetch(`${API}/storage/v1/object/order-logos/${foreignPath}`, {
    method: "POST",
    headers: { ...svcHeaders, "x-upsert": "true" },
    body: PNG_1PX,
    signal: AbortSignal.timeout(20_000),
  });
  const own = await storageUpload(ownPath, PNG_1PX, "image/png", token);

  const cross = await fetch(`${API}/storage/v1/object/order-logos/${foreignPath}`, {
    method: "DELETE",
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const ownDelete = await fetch(`${API}/storage/v1/object/order-logos/${ownPath}`, {
    method: "DELETE",
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const foreignStill = await fetch(`${API}/storage/v1/object/sign/order-logos/${foreignPath}`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ expiresIn: 60 }),
    signal: AbortSignal.timeout(20_000),
  });

  await fetch(`${API}/storage/v1/object/order-logos/${foreignPath}`, {
    method: "DELETE",
    headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}` },
    signal: AbortSignal.timeout(20_000),
  });

  const pass =
    uploaded.status === 200 &&
    own === 200 &&
    [400, 403, 404].includes(cross.status) &&
    [200, 204].includes(ownDelete.status) &&
    foreignStill.status === 200;

  await sql(`
    insert into public.qa_concurrency_results (case_id, pass, detail)
    values ('STO-07', ${pass}, '{"upload":${uploaded.status},"own":${own},"cross":${cross.status},"ownDelete":${ownDelete.status},"foreignStill":${foreignStill.status}}'::jsonb)
    on conflict (case_id) do update
      set pass = excluded.pass, detail = excluded.detail, created_at = now();
  `);

  console.log(
    `::notice::STO07 {"upload":${uploaded.status},"own":${own},"cross":${cross.status},"ownDelete":${ownDelete.status},"foreignStill":${foreignStill.status}}`
  );

  return pass;
}

async function main() {
  await detect();
  await readKeys();
  await findNetwork();
  await startMock();
  console.log(`Mock de Clip en ${MOCK_URL} (red ${network})`);

  const envState = writeFunctionsEnv();
  let pass = false;

  try {
    const { token, userId } = await ensureSession();
    const { payOrder, checkoutOrder } = await seed(userId);
    console.log(`Pedidos de prueba: pago ${payOrder} · checkout ${checkoutOrder}`);
    await startFunctions();

    const payBody = { orderId: payOrder, token: "tok_test_1234567890", customer: { email: EMAIL } };
    const payResults = await Promise.all([post("clip-pay", payBody, token), post("clip-pay", payBody, token)]);
    const afterPay = await hits();
    console.log(`clip-pay respuestas: ${JSON.stringify(payResults.map((r) => ({ status: r.status, data: r.data })))}`);

    const checkoutResults = await Promise.all([
      post("clip-checkout", { orderId: checkoutOrder }, token),
      post("clip-checkout", { orderId: checkoutOrder }, token),
    ]);
    const afterCheckout = await hits();
    console.log(`clip-checkout respuestas: ${JSON.stringify(checkoutResults.map((r) => ({ status: r.status, data: r.data })))}`);

    const payOk =
      afterPay.payments === 1 &&
      payResults.some((r) => r.status === 200) &&
      payResults.every((r) => r.status < 500);
    const checkoutOk =
      afterCheckout.checkout === 1 &&
      checkoutResults.some((r) => r.status === 200) &&
      checkoutResults.every((r) => r.status < 500);

    const state = await sql(`
      select (select count(*) from public.orders where id = '${payOrder}' and payment_attempt_id is not null)
           + (select count(*) from public.orders where id = '${checkoutOrder}' and clip_checkout_id is not null);
    `);
    const singleState = Number(state.trim()) >= 2;

    pass = payOk && checkoutOk && singleState;
    const detail = {
      payments: afterPay.payments,
      checkouts: afterCheckout.checkout,
      payStatuses: payResults.map((r) => r.status),
      checkoutStatuses: checkoutResults.map((r) => r.status),
    };

    await sql(`
      insert into public.qa_concurrency_results (case_id, pass, detail)
      values ('SET-08', ${pass}, '${JSON.stringify(detail).replace(/'/g, "''")}'::jsonb)
      on conflict (case_id) do update
        set pass = excluded.pass, detail = excluded.detail, created_at = now();
    `);

    console.log(`Cobros a Clip: ${detail.payments} (esperado 1)`);
    console.log(`Links creados: ${detail.checkouts} (esperado 1)`);
    console.log(pass ? "SET-08 OK" : "SET-08 FALLO");

    const q10 = await runQ10(token, userId);
    const q10Json = JSON.stringify(q10.detail).replace(/'/g, "''");
    await sql(`
      insert into public.qa_concurrency_results (case_id, pass, detail)
      values ('STO-09', ${q10.sto09}, '${q10Json}'::jsonb),
             ('STO-10', ${q10.sto10}, '${q10Json}'::jsonb),
             ('Q-10', ${q10.pass}, '${q10Json}'::jsonb)
      on conflict (case_id) do update
        set pass = excluded.pass, detail = excluded.detail, created_at = now();
    `);
    console.log(`Q-10 codigos: ${q10Json}`);
    console.log(`::notice::Q10 ${q10Json}`);
    if (!q10.pass) {
      console.log(`::error::Q10 FALLO ${q10Json}`);
    }

    const sto07 = await runSto07(token, userId);
    console.log(sto07 ? "STO-07 OK" : "STO-07 FALLO");
    if (!sto07) {
      console.log(`::error::STO-07 FALLO`);
    }

    pass = pass && q10.pass && sto07;
    if (!pass) console.log(`--- runtime ---\n${serveLog.slice(-2500)}`);
  } finally {
    stopServe();
    await run("docker", ["rm", "-f", MOCK_NAME]);
    await sql(`update public.store_settings set value = 'false', updated_at = now() where key = 'clip_enabled';`).catch(() => {});
    restoreEnv(envState);
  }

  return pass;
}

main()
  .then((pass) => process.exit(pass ? 0 : 1))
  .catch((error) => {
    console.error(`Harness falló: ${error.message}`);
    stopServe();
    run("docker", ["rm", "-f", MOCK_NAME]);
    process.exit(1);
  });
