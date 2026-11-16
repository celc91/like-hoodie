#!/usr/bin/env node
/**
 * Runner de concurrencia para los bloqueantes PED-13 y NEW-12 (fase B.5).
 *
 * Un archivo pgTAP no puede demostrar carreras entre transacciones que hacen
 * commit, así que este script lanza conexiones independientes contra la base
 * local, mide el resultado y lo guarda en public.qa_concurrency_results.
 * Los dos tests de rls.test.sql leen esa tabla: si este runner no se ejecutó,
 * siguen en rojo. Nunca apunta a producción.
 *
 * Uso: node scripts/test-concurrency.mjs
 */

import { spawn } from "node:child_process";

const DB_HOST = process.env.LH_DB_HOST || "127.0.0.1";
const DB_PORT = process.env.LH_DB_PORT || "54322";
const DB_USER = process.env.LH_DB_USER || "postgres";
const DB_PASS = process.env.LH_DB_PASS || "postgres";
const DB_NAME = process.env.LH_DB_NAME || "postgres";
const CONTAINER = process.env.LH_DB_CONTAINER || "supabase_db_like-hoodie";

const UID = "10000000-0000-4000-8000-0000000000c1";
const IP = "203.0.113.77";
const EMAIL_PED = "qa-conc-ped13@example.invalid";

let useDocker = false;

function spawnPsql(sql) {
  const mode = useDocker
    ? ["docker", ["exec", "-i", CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql]]
    : [
        "psql",
        ["-h", DB_HOST, "-p", DB_PORT, "-U", DB_USER, "-d", DB_NAME, "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", "-c", sql],
        { env: { ...process.env, PGPASSWORD: DB_PASS } },
      ];

  return new Promise((resolve) => {
    const child = mode.length === 3 ? spawn(mode[0], mode[1], mode[2]) : spawn(mode[0], mode[1]);
    let out = "";
    let err = "";
    const timer = setTimeout(() => child.kill(), 120000);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out: "", err: String(e) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out: out.trim(), err: err.trim() });
    });
  });
}

async function detectPsql() {
  const probe = await spawnPsql("select 1");
  if (probe.code === 0) return;
  if (!probe.err.includes("ENOENT") && probe.code !== -1) return;
  useDocker = true;
  const probe2 = await spawnPsql("select 1");
  if (probe2.code !== 0) {
    throw new Error(`No hay psql ni contenedor ${CONTAINER}: ${probe2.err}`);
  }
}

async function sql(query) {
  const r = await spawnPsql(query);
  if (r.code !== 0) throw new Error(`SQL falló: ${r.err || "sin detalle"}`);
  return r.out;
}

const customer = (email) =>
  JSON.stringify({
    name: "Cliente QA",
    email,
    phone: "5512345678",
    address: "Calle QA 1",
    addressRef: "Ref QA",
    city: "CDMX",
    state: "CDMX",
    zip: "01000",
  });

const item = (unitPrice) =>
  JSON.stringify([
    {
      product: "hoodie",
      colorHex: "#1c1c1f",
      materialId: "cotton400",
      techniqueId: "dtg",
      qty: 1,
      size: "M",
      unitPrice,
    },
  ]);

const claims = (aal = "aal1") =>
  JSON.stringify({ sub: UID, role: "authenticated", aal });

function placeOrderSql(email, unitPrice) {
  return [
    "begin;",
    `select set_config('request.jwt.claims','${claims()}',true);`,
    "set local role authenticated;",
    `select public.place_order('${customer(email)}'::jsonb,'${item(unitPrice)}'::jsonb,null,'',null);`,
    "commit;",
  ].join("\n");
}

function subscribeSql(email) {
  return [
    "begin;",
    `select set_config('request.jwt.claims','${claims()}',true);`,
    `select set_config('request.headers','{"cf-connecting-ip":"${IP}"}',true);`,
    "set local role authenticated;",
    `select public.subscribe_newsletter('${email}') ->> 'ok';`,
    "commit;",
  ].join("\n");
}

async function setup() {
  await sql(`
    create table if not exists public.qa_concurrency_results (
      case_id text primary key,
      pass boolean not null,
      detail jsonb,
      created_at timestamptz not null default now()
    );
    delete from public.orders
     where lower(email) like 'qa-conc-%@example.invalid';
    delete from public.newsletter_subscribers
     where lower(email) like 'qa-conc-%@example.invalid';
    delete from public.newsletter_attempts where ip = '${IP}';
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      raw_app_meta_data, raw_user_meta_data, is_super_admin
    ) values (
      '00000000-0000-0000-0000-000000000000', '${UID}', 'authenticated', 'authenticated',
      'qa-conc@example.invalid', '', now(), now(), now(),
      '', '', '', '',
      '{"provider":"email","providers":["email"]}', '{"fixture":"qa-concurrency"}', false
    ) on conflict (id) do nothing;
    insert into public.profiles (id, email, role)
    values ('${UID}', 'qa-conc@example.invalid', 'customer')
    on conflict (id) do update set role = 'customer';
  `);

  const price = Number(
    (await sql(
      "select public.item_unit_price('{\"product\":\"hoodie\",\"colorHex\":\"#1c1c1f\",\"materialId\":\"cotton400\",\"techniqueId\":\"dtg\",\"qty\":1}'::jsonb);"
    )).trim()
  );
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`item_unit_price devolvió un valor inválido: ${price}`);
  }
  return price;
}

async function scenarioPed13(unitPrice) {
  const N = 20;
  const results = await Promise.all(
    Array.from({ length: N }, () => spawnPsql(placeOrderSql(EMAIL_PED, unitPrice)))
  );
  const accepted = results.filter((r) => r.code === 0).length;

  const ordersEmail = Number(
    (await sql(`select count(*) from public.orders where lower(email) = '${EMAIL_PED}';`)).trim()
  );
  const ordersUser = Number(
    (await sql(`select count(*) from public.orders where user_id = '${UID}';`)).trim()
  );

  const pass =
    ordersEmail >= 1 &&
    ordersEmail <= 3 &&
    ordersUser <= 5 &&
    accepted === ordersEmail;

  await sql(`
    insert into public.qa_concurrency_results (case_id, pass, detail)
    values ('PED-13', ${pass}, '{"ordersEmail":${ordersEmail},"ordersUser":${ordersUser},"accepted":${accepted},"attempts":${N}}'::jsonb)
    on conflict (case_id) do update
      set pass = excluded.pass, detail = excluded.detail, created_at = now();
  `);

  return { pass, ordersEmail, ordersUser, accepted };
}

async function scenarioNew12() {
  const N = 50;
  const results = await Promise.all(
    Array.from({ length: N }, (_, i) => spawnPsql(subscribeSql(`qa-conc-new-${i}@example.invalid`)))
  );
  const accepted = results.filter((r) => {
    if (r.code !== 0) return false;
    const lines = r.out.split("\n").map((s) => s.trim()).filter(Boolean);
    return lines.includes("true");
  }).length;

  const attempts = Number(
    (await sql(`select count(*) from public.newsletter_attempts where ip = '${IP}';`)).trim()
  );
  const subscribers = Number(
    (await sql(
      "select count(*) from public.newsletter_subscribers where lower(email) like 'qa-conc-new-%@example.invalid';"
    )).trim()
  );

  const pass = attempts >= 1 && attempts <= 5 && subscribers === attempts && accepted === subscribers;

  await sql(`
    insert into public.qa_concurrency_results (case_id, pass, detail)
    values ('NEW-12', ${pass}, '{"attempts":${attempts},"subscribers":${subscribers},"accepted":${accepted},"launched":${N}}'::jsonb)
    on conflict (case_id) do update
      set pass = excluded.pass, detail = excluded.detail, created_at = now();
  `);

  return { pass, attempts, subscribers, accepted };
}

async function main() {
  console.log("Concurrencia B.5 — base local, nunca producción.");
  await detectPsql();
  const unitPrice = await setup();
  console.log(`Precio de servidor para el item de prueba: ${unitPrice}`);

  const ped = await scenarioPed13(unitPrice);
  console.log(
    `PED-13 ${ped.pass ? "OK" : "FALLO"} — pedidos=${ped.ordersEmail}, usuario=${ped.ordersUser}, aceptados=${ped.accepted}/20`
  );

  const nw = await scenarioNew12();
  console.log(
    `NEW-12 ${nw.pass ? "OK" : "FALLO"} — intentos=${nw.attempts}, suscriptores=${nw.subscribers}, aceptados=${nw.accepted}/50`
  );

  if (!ped.pass || !nw.pass) {
    console.error("Resultado: FALLO");
    process.exit(1);
  }
  console.log("Resultado: OK");
}

main().catch((error) => {
  console.error(`Error del runner: ${error.message}`);
  process.exit(1);
});
