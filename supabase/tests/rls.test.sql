-- like hoodie — Fase B.5, esqueleto pgTAP de RLS y abuso.
-- Solo para una base Supabase local desechable. Nunca instalar en producción.
-- Los TODO no son evidencia de seguridad: indican casos pendientes de implementar.
-- Los diez tests BLOQUEANTE-* deben quedar en rojo hasta contener aserciones reales.
-- Ningún bloqueante puede sustituirse por pass(), skip() o un bucle serial.
-- service_role solo siembra fixtures y comprueba efectos; no prueba políticas.
-- Las pruebas paralelas requerirán conexiones independientes y commits reales.

\set ON_ERROR_STOP on

create extension if not exists pgtap;

begin;

select plan(121);

-- Los casos de concurrencia (PED-13, NEW-12) los mide scripts/test-concurrency.mjs
-- con conexiones independientes y commits reales. Si el runner no se ejecutó,
-- la tabla está vacía y ambos quedan en rojo, como debe ser.
create table if not exists public.qa_concurrency_results (
  case_id text primary key,
  pass boolean not null,
  detail jsonb,
  created_at timestamptz not null default now()
);

create schema lh_rls_test;

create table lh_rls_test.fixture (
  name text primary key,
  id uuid not null
);

grant select, insert, update, delete on lh_rls_test.fixture
  to anon, authenticated, service_role;

-- Resultados parciales por caso: cada caso emite una sola aserción pgTAP.
create table lh_rls_test.check (
  case_id text not null,
  step text not null,
  pass boolean not null,
  primary key (case_id, step)
);

grant select, insert, update, delete on lh_rls_test.check
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Identificadores sintéticos
-- ---------------------------------------------------------------------------

create or replace function lh_rls_test.uid_a()
returns uuid
language sql
immutable
as $$
  select '10000000-0000-4000-8000-000000000001'::uuid;
$$;

create or replace function lh_rls_test.uid_b()
returns uuid
language sql
immutable
as $$
  select '10000000-0000-4000-8000-000000000002'::uuid;
$$;

create or replace function lh_rls_test.uid_c()
returns uuid
language sql
immutable
as $$
  select '10000000-0000-4000-8000-000000000003'::uuid;
$$;

create or replace function lh_rls_test.uid_admin()
returns uuid
language sql
immutable
as $$
  select '10000000-0000-4000-8000-000000000004'::uuid;
$$;

create or replace function lh_rls_test.newsletter_token()
returns uuid
language sql
immutable
as $$
  select '20000000-0000-4000-8000-000000000001'::uuid;
$$;

create or replace function lh_rls_test.invoice_token()
returns uuid
language sql
immutable
as $$
  select '20000000-0000-4000-8000-000000000002'::uuid;
$$;

-- ---------------------------------------------------------------------------
-- Cambio de rol y claims
-- La sesión que ejecuta pgTAP debe ser postgres u otro superusuario local.
-- set_role no es SECURITY DEFINER: reset role vuelve al usuario de sesión y
-- después aplica el rol solicitado. No llamar a service_role en aserciones RLS.
-- ---------------------------------------------------------------------------

create or replace function lh_rls_test.set_role(p_role text)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  if p_role not in ('anon', 'authenticated', 'service_role') then
    raise exception 'Rol de prueba no permitido: %', p_role
      using errcode = '22023';
  end if;

  reset role;
  execute format('set local role %I', p_role);
end;
$$;

create or replace function lh_rls_test.set_claims(
  p_sub uuid,
  p_role text,
  p_aal text default null,
  p_ip text default '198.51.100.10'
)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_claims jsonb;
begin
  if p_role not in ('anon', 'authenticated', 'service_role') then
    raise exception 'Rol de claims no permitido: %', p_role
      using errcode = '22023';
  end if;

  if p_role = 'authenticated' and p_sub is null then
    raise exception 'authenticated requiere sub'
      using errcode = '22023';
  end if;

  if p_aal is not null and p_aal not in ('aal1', 'aal2') then
    raise exception 'AAL de prueba no permitido: %', p_aal
      using errcode = '22023';
  end if;

  v_claims := jsonb_build_object('role', p_role);

  if p_sub is not null then
    v_claims := v_claims || jsonb_build_object('sub', p_sub::text);
  end if;

  if p_aal is not null then
    v_claims := v_claims || jsonb_build_object('aal', p_aal);
  end if;

  perform set_config('request.jwt.claims', v_claims::text, true);
  perform set_config(
    'request.headers',
    jsonb_build_object(
      'cf-connecting-ip', p_ip,
      'user-agent', 'lh-rls-local-test'
    )::text,
    true
  );
end;
$$;

create or replace function lh_rls_test.use_actor(
  p_role text,
  p_sub uuid default null,
  p_aal text default null,
  p_ip text default '198.51.100.10'
)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  perform lh_rls_test.set_role(p_role);
  perform lh_rls_test.set_claims(p_sub, p_role, p_aal, p_ip);
end;
$$;

create or replace function lh_rls_test.as_anon()
returns void
language sql
as $$
  select lh_rls_test.use_actor('anon', null, null);
$$;

create or replace function lh_rls_test.as_cart()
returns void
language sql
as $$
  select lh_rls_test.use_actor(
    'authenticated', lh_rls_test.uid_c(), 'aal1'
  );
$$;

create or replace function lh_rls_test.as_a()
returns void
language sql
as $$
  select lh_rls_test.use_actor(
    'authenticated', lh_rls_test.uid_a(), 'aal1'
  );
$$;

create or replace function lh_rls_test.as_b()
returns void
language sql
as $$
  select lh_rls_test.use_actor(
    'authenticated', lh_rls_test.uid_b(), 'aal1'
  );
$$;

create or replace function lh_rls_test.as_admin_aal1()
returns void
language sql
as $$
  select lh_rls_test.use_actor(
    'authenticated', lh_rls_test.uid_admin(), 'aal1'
  );
$$;

create or replace function lh_rls_test.as_admin_aal2()
returns void
language sql
as $$
  select lh_rls_test.use_actor(
    'authenticated', lh_rls_test.uid_admin(), 'aal2'
  );
$$;

create or replace function lh_rls_test.as_service_role()
returns void
language sql
as $$
  select lh_rls_test.use_actor('service_role', null, null);
$$;

-- ---------------------------------------------------------------------------
-- Registro de fixtures
-- ---------------------------------------------------------------------------

create or replace function lh_rls_test.register_fixture(
  p_name text,
  p_id uuid
)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  insert into lh_rls_test.fixture(name, id)
  values (p_name, p_id)
  on conflict (name) do update set id = excluded.id;
end;
$$;

create or replace function lh_rls_test.fixture_id(p_name text)
returns uuid
language plpgsql
stable
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  select f.id into v_id
  from lh_rls_test.fixture f
  where f.name = p_name;

  if v_id is null then
    raise exception 'Fixture no sembrado: %', p_name
      using errcode = 'P0001';
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap Auth
-- service_role no tiene DML directo sobre auth.users en una instalación normal.
-- Esta función SECURITY DEFINER pertenece al superusuario que ejecuta pgTAP y
-- se invoca únicamente después de cambiar a service_role para sembrar Auth.
-- Es una excepción de bootstrap local, nunca una aserción de política.
-- No contiene contraseñas ni secretos.
-- ---------------------------------------------------------------------------

create or replace function lh_rls_test.create_auth_user(
  p_id uuid,
  p_email text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change,
    email_change_token_new,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin
  ) values (
    '00000000-0000-0000-0000-000000000000'::uuid,
    p_id,
    'authenticated',
    'authenticated',
    p_email,
    '',
    now(),
    now(),
    now(),
    '',
    '',
    '',
    '',
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"fixture":"lh-rls-local"}'::jsonb,
    false
  )
  on conflict (id) do nothing;
end;
$$;

create or replace function lh_rls_test.seed_users()
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  perform lh_rls_test.as_service_role();

  perform lh_rls_test.create_auth_user(
    lh_rls_test.uid_a(), 'qa-a@example.invalid'
  );
  perform lh_rls_test.create_auth_user(
    lh_rls_test.uid_b(), 'qa-b@example.invalid'
  );
  perform lh_rls_test.create_auth_user(
    lh_rls_test.uid_c(), 'qa-cart@example.invalid'
  );
  perform lh_rls_test.create_auth_user(
    lh_rls_test.uid_admin(), 'qa-admin@example.invalid'
  );

  insert into public.profiles(id, email, role)
  values
    (lh_rls_test.uid_a(), 'qa-a@example.invalid', 'customer'),
    (lh_rls_test.uid_b(), 'qa-b@example.invalid', 'customer'),
    (lh_rls_test.uid_c(), 'qa-cart@example.invalid', 'customer'),
    (lh_rls_test.uid_admin(), 'qa-admin@example.invalid', 'admin')
  on conflict (id) do update
    set email = excluded.email,
        role = excluded.role;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helpers de siembra; todos cambian a service_role antes de escribir
-- ---------------------------------------------------------------------------

create or replace function lh_rls_test.seed_cart(
  p_user_id uuid,
  p_status text default 'open',
  p_items jsonb default jsonb_build_array(
    jsonb_build_object(
      'name', 'Producto QA',
      'qty', 1,
      'unitPrice', 899,
      'colorHex', '#1c1c1f',
      'materialId', 'cotton400',
      'techniqueId', 'dtg',
      'size', 'M'
    )
  )
)
returns uuid
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  perform lh_rls_test.as_service_role();

  insert into public.carts (
    user_id,
    status,
    items,
    item_count,
    subtotal
  ) values (
    p_user_id,
    p_status,
    p_items,
    jsonb_array_length(p_items),
    case when jsonb_array_length(p_items) > 0 then 899 else 0 end
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function lh_rls_test.seed_order(
  p_user_id uuid,
  p_number bigint,
  p_email text,
  p_payment_status text default 'demo',
  p_order_status text default 'pending',
  p_total integer default 998,
  p_created_at timestamptz default now(),
  p_billing_status text default 'pending',
  p_sat_form text default '04',
  p_cart_id uuid default null
)
returns uuid
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  perform lh_rls_test.as_service_role();

  insert into public.orders (
    number,
    user_id,
    cart_id,
    status,
    customer_name,
    email,
    phone,
    address,
    city,
    state,
    zip,
    items,
    item_count,
    subtotal,
    shipping,
    total,
    payment_method,
    payment_status,
    billing_status,
    sat_payment_form,
    created_at
  ) values (
    p_number,
    p_user_id,
    p_cart_id,
    p_order_status,
    'Cliente QA',
    p_email,
    '0000000000',
    'Direccion QA 0',
    'Ciudad QA',
    'Estado QA',
    '00000',
    jsonb_build_array(
      jsonb_build_object(
        'name', 'Producto QA',
        'qty', 1,
        'size', 'M',
        'colorName', 'QA',
        'colorHex', '#1c1c1f',
        'materialId', 'cotton400',
        'techniqueId', 'dtg',
        'unitPrice', 899
      )
    ),
    1,
    greatest(p_total - 99, 0),
    99,
    p_total,
    case when p_payment_status = 'demo' then 'demo' else 'clip' end,
    p_payment_status,
    p_billing_status,
    p_sat_form,
    p_created_at
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function lh_rls_test.seed_logo(
  p_user_id uuid,
  p_source_path text default null,
  p_status text default 'queued',
  p_last_error text default null
)
returns uuid
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  perform lh_rls_test.as_service_role();

  insert into public.logo_assets (
    user_id,
    source_path,
    status,
    last_error,
    width_cm
  ) values (
    p_user_id,
    coalesce(p_source_path, p_user_id::text || '/original.png'),
    p_status,
    p_last_error,
    20
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function lh_rls_test.seed_coupon(
  p_code text,
  p_percent integer default 10,
  p_max_uses integer default 1,
  p_used_count integer default 0,
  p_active boolean default true,
  p_expires_at timestamptz default now() + interval '90 days'
)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  perform lh_rls_test.as_service_role();

  insert into public.coupons (
    code,
    percent,
    active,
    max_uses,
    used_count,
    expires_at
  ) values (
    p_code,
    p_percent,
    p_active,
    p_max_uses,
    p_used_count,
    p_expires_at
  )
  on conflict (code) do update
    set percent = excluded.percent,
        active = excluded.active,
        max_uses = excluded.max_uses,
        used_count = excluded.used_count,
        expires_at = excluded.expires_at;
end;
$$;

create or replace function lh_rls_test.seed_subscriber(
  p_email text,
  p_token uuid,
  p_confirmed boolean default false,
  p_unsubscribed_at timestamptz default null,
  p_coupon_code text default null
)
returns uuid
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  perform lh_rls_test.as_service_role();

  insert into public.newsletter_subscribers (
    email,
    source,
    confirmed,
    token,
    confirmed_at,
    unsubscribed_at,
    coupon_code
  ) values (
    p_email,
    'qa',
    p_confirmed,
    p_token,
    case when p_confirmed then now() else null end,
    p_unsubscribed_at,
    p_coupon_code
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function lh_rls_test.seed_invoice(
  p_order_id uuid,
  p_status text default 'unverified',
  p_token uuid default null,
  p_verified_at timestamptz default null,
  p_sat_form text default '04',
  p_issued_uuid text default null
)
returns uuid
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_number bigint;
  v_email text;
begin
  perform lh_rls_test.as_service_role();

  select o.number, o.email
    into v_number, v_email
  from public.orders o
  where o.id = p_order_id;

  if v_number is null then
    raise exception 'Pedido fixture inexistente: %', p_order_id
      using errcode = 'P0001';
  end if;

  insert into public.invoice_requests (
    order_id,
    order_number,
    purchase_email,
    rfc,
    legal_name,
    tax_regime,
    zip,
    cfdi_use,
    invoice_email,
    notes,
    sat_payment_form,
    status,
    verify_token,
    verify_expires_at,
    verified_at,
    uuid,
    issued_at
  ) values (
    p_order_id,
    v_number,
    v_email,
    'XAXX010101000',
    'Empresa QA',
    '601',
    '00000',
    'G03',
    'qa-invoice@example.invalid',
    'Fixture local',
    p_sat_form,
    p_status,
    p_token,
    case when p_token is not null then now() + interval '24 hours' end,
    p_verified_at,
    case
      when p_status = 'issued'
        then coalesce(p_issued_uuid, gen_random_uuid()::text)
      else null
    end,
    case when p_status = 'issued' then now() else null end
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function lh_rls_test.seed_global(
  p_order_id uuid
)
returns uuid
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
  v_total integer;
  v_uuid text := gen_random_uuid()::text;
begin
  perform lh_rls_test.as_service_role();

  select o.total into v_total
  from public.orders o
  where o.id = p_order_id;

  if v_total is null then
    raise exception 'Pedido global fixture inexistente: %', p_order_id
      using errcode = 'P0001';
  end if;

  insert into public.global_invoices (
    period_start,
    period_end,
    payment_form,
    total,
    uuid,
    notes,
    created_by
  ) values (
    current_date - 7,
    current_date,
    '04',
    v_total,
    v_uuid,
    'Fixture local',
    lh_rls_test.uid_admin()
  )
  returning id into v_id;

  insert into public.global_invoice_orders(global_invoice_id, order_id)
  values (v_id, p_order_id);

  update public.orders
     set billing_status = 'global',
         billing_uuid = v_uuid,
         billed_at = now()
   where id = p_order_id;

  return v_id;
end;
$$;

create or replace function lh_rls_test.seed_event(
  p_user_id uuid,
  p_name text default 'qa_event'
)
returns bigint
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_id bigint;
begin
  perform lh_rls_test.as_service_role();

  insert into public.events(user_id, name, path, metadata)
  values (p_user_id, p_name, '/qa', '{"fixture":true}'::jsonb)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function lh_rls_test.seed_client_error(
  p_user_id uuid,
  p_message text default 'Error tecnico QA'
)
returns bigint
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_id bigint;
begin
  perform lh_rls_test.as_service_role();

  insert into public.client_errors(
    user_id,
    message,
    source,
    stack,
    path,
    user_agent
  ) values (
    p_user_id,
    p_message,
    'qa',
    'Stack QA',
    '/qa',
    'lh-rls-local-test'
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function lh_rls_test.seed_ad_consent(
  p_user_id uuid,
  p_granted boolean
)
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  perform lh_rls_test.as_service_role();

  insert into public.ad_consent(user_id, granted)
  values (p_user_id, p_granted)
  on conflict (user_id) do update
    set granted = excluded.granted,
        updated_at = now();
end;
$$;

create or replace function lh_rls_test.seed_storage(
  p_bucket_id text,
  p_name text,
  p_owner uuid
)
returns uuid
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_id uuid;
begin
  perform lh_rls_test.as_service_role();

  if p_bucket_id not in ('order-logos', 'order-prints') then
    raise exception 'Bucket fixture no permitido: %', p_bucket_id
      using errcode = '22023';
  end if;

  insert into storage.objects(
    bucket_id,
    name,
    owner,
    metadata
  ) values (
    p_bucket_id,
    p_name,
    p_owner,
    jsonb_build_object(
      'mimetype', 'image/png',
      'size', 128
    )
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function lh_rls_test.seed_attempts()
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  perform lh_rls_test.as_service_role();

  insert into public.order_lookup_attempts(ip_hash)
  values (repeat('a', 64));

  insert into public.client_error_attempts(ip_hash)
  values (repeat('b', 64));

  insert into public.invoice_request_attempts(ip_hash)
  values (repeat('c', 64));

  insert into public.clip_pay_attempts(ip_hash, user_id)
  values (repeat('d', 64), lh_rls_test.uid_a());

  insert into public.logo_process_attempts(user_id, ip_hash)
  values (lh_rls_test.uid_a(), repeat('e', 64));

  insert into public.coupon_attempts(ip)
  values ('198.51.100.20');

  insert into public.newsletter_attempts(ip)
  values ('198.51.100.21');
end;
$$;

-- ---------------------------------------------------------------------------
-- Fixture común OA/OB/OC/OG, CA/CB/CC, LA/LB, SA/SB/PA, Q1, N0, F0 y G0
-- ---------------------------------------------------------------------------

create or replace function lh_rls_test.valid_customer(p_overrides jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'name', 'Cliente QA',
    'email', 'qa-a-order@example.invalid',
    'phone', '5512345678',
    'address', 'Calle QA 1',
    'addressRef', 'Ref QA',
    'city', 'CDMX',
    'state', 'CDMX',
    'zip', '01000'
  ) || coalesce(p_overrides, '{}'::jsonb);
$$;

create or replace function lh_rls_test.valid_items()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_array(jsonb_build_object(
    'product', 'hoodie',
    'colorHex', '#1c1c1f',
    'materialId', 'cotton400',
    'techniqueId', 'dtg',
    'qty', 1,
    'size', 'M',
    'unitPrice', public.item_unit_price(
      jsonb_build_object(
        'product', 'hoodie',
        'colorHex', '#1c1c1f',
        'materialId', 'cotton400',
        'techniqueId', 'dtg',
        'qty', 1
      ),
      1
    )
  ));
$$;

create or replace function lh_rls_test.seed_common()
returns void
language plpgsql
set search_path = public, extensions, pg_temp
as $$
declare
  v_ca uuid;
  v_cb uuid;
  v_cc uuid;
  v_oa uuid;
  v_ob uuid;
  v_oc uuid;
  v_og uuid;
  v_id uuid;
begin
  perform lh_rls_test.seed_users();

  v_ca := lh_rls_test.seed_cart(lh_rls_test.uid_a());
  v_cb := lh_rls_test.seed_cart(lh_rls_test.uid_b());
  v_cc := lh_rls_test.seed_cart(lh_rls_test.uid_c());

  perform lh_rls_test.register_fixture('CA', v_ca);
  perform lh_rls_test.register_fixture('CB', v_cb);
  perform lh_rls_test.register_fixture('CC', v_cc);

  v_oa := lh_rls_test.seed_order(
    lh_rls_test.uid_a(),
    990001,
    'qa-a-order@example.invalid',
    'paid',
    'pending',
    998,
    now(),
    'pending',
    '04',
    v_ca
  );
  v_ob := lh_rls_test.seed_order(
    lh_rls_test.uid_b(),
    990002,
    'qa-b-order@example.invalid',
    'demo',
    'pending',
    998,
    now(),
    'pending',
    '04',
    v_cb
  );
  v_oc := lh_rls_test.seed_order(
    lh_rls_test.uid_c(),
    990003,
    'qa-c-order@example.invalid',
    'demo',
    'pending',
    998,
    now(),
    'pending',
    '04',
    v_cc
  );
  v_og := lh_rls_test.seed_order(
    lh_rls_test.uid_b(),
    990004,
    'qa-global-order@example.invalid',
    'paid',
    'pending',
    998
  );

  perform lh_rls_test.register_fixture('OA', v_oa);
  perform lh_rls_test.register_fixture('OB', v_ob);
  perform lh_rls_test.register_fixture('OC', v_oc);
  perform lh_rls_test.register_fixture('OG', v_og);

  v_id := lh_rls_test.seed_logo(lh_rls_test.uid_a());
  perform lh_rls_test.register_fixture('LA', v_id);
  v_id := lh_rls_test.seed_logo(lh_rls_test.uid_b());
  perform lh_rls_test.register_fixture('LB', v_id);

  perform lh_rls_test.seed_coupon('QA_UNICO_10');

  v_id := lh_rls_test.seed_subscriber(
    'qa-newsletter@example.invalid',
    lh_rls_test.newsletter_token()
  );
  perform lh_rls_test.register_fixture('N0', v_id);

  v_id := lh_rls_test.seed_invoice(
    v_oa,
    'unverified',
    lh_rls_test.invoice_token()
  );
  perform lh_rls_test.register_fixture('F0', v_id);

  v_id := lh_rls_test.seed_global(v_og);
  perform lh_rls_test.register_fixture('G0', v_id);

  perform lh_rls_test.seed_event(lh_rls_test.uid_a(), 'qa_event_a');
  perform lh_rls_test.seed_event(lh_rls_test.uid_b(), 'qa_event_b');
  perform lh_rls_test.seed_client_error(lh_rls_test.uid_a(), 'Error QA A');
  perform lh_rls_test.seed_client_error(lh_rls_test.uid_b(), 'Error QA B');

  perform lh_rls_test.seed_ad_consent(lh_rls_test.uid_a(), true);
  perform lh_rls_test.seed_ad_consent(lh_rls_test.uid_b(), false);

  perform lh_rls_test.seed_attempts();

  v_id := lh_rls_test.seed_storage(
    'order-logos',
    lh_rls_test.uid_a()::text || '/original.png',
    lh_rls_test.uid_a()
  );
  perform lh_rls_test.register_fixture('SA', v_id);

  v_id := lh_rls_test.seed_storage(
    'order-logos',
    lh_rls_test.uid_b()::text || '/original.png',
    lh_rls_test.uid_b()
  );
  perform lh_rls_test.register_fixture('SB', v_id);

  v_id := lh_rls_test.seed_storage(
    'order-prints',
    lh_rls_test.uid_a()::text || '/print.png',
    lh_rls_test.uid_a()
  );
  perform lh_rls_test.register_fixture('PA', v_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Emisión de placeholders pgTAP
-- Un bloqueante produce not ok sin TODO y, por tanto, mantiene rojo el suite.
-- Un caso no bloqueante produce un único test marcado TODO.
-- ---------------------------------------------------------------------------

create or replace function lh_rls_test.pending(
  p_id text,
  p_expectation text,
  p_blocking boolean default false
)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_blocking then
    return ok(
      false,
      'BLOQUEANTE-' || p_id || ' — PENDIENTE — ' || p_expectation
    );
  else
    perform todo('Pendiente de implementar: ' || p_id, 1);
    return ok(
      false,
      p_id || ' — TODO — ' || p_expectation
    );
  end if;
end;
$$;

grant usage on schema lh_rls_test to anon, authenticated, service_role;
grant execute on all functions in schema lh_rls_test
  to anon, authenticated, service_role;

-- Ejecuta SQL como el rol actual y devuelve 'ok' o el SQLSTATE, sin abortar
-- la transacción. Se usa para comprobar denegaciones esperadas.
create or replace function lh_rls_test.try_sql(p_sql text)
returns text
language plpgsql
set search_path = public, extensions, pg_temp
as $$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return SQLSTATE;
end;
$$;

grant execute on function lh_rls_test.try_sql(text)
  to anon, authenticated, service_role;

-- La función privilegiada de Auth solo puede invocarse al sembrar como
-- service_role. Estos grants existen únicamente dentro de la transacción local.
revoke all on function lh_rls_test.create_auth_user(uuid, text)
  from public, anon, authenticated;
grant execute on function lh_rls_test.create_auth_user(uuid, text)
  to service_role;

select lh_rls_test.seed_common();

-- ---------------------------------------------------------------------------
-- Pedidos: 16
-- ---------------------------------------------------------------------------

-- Expectativa: ANON no obtiene OA aunque la fila exista.
select lh_rls_test.pending('PED-01', 'ANON SELECT orders devuelve conjunto vacio con canario OA existente', false);

-- Expectativa: CART obtiene exactamente OC y ningun pedido de A o B.
select lh_rls_test.pending('PED-02', 'CART SELECT orders devuelve solo OC', false);

-- BLOQUEANTE-PED-03: aislamiento real de PII entre clientes.
select lh_rls_test.as_a();
insert into lh_rls_test.check values ('PED-03', 'a_directo',
  (select count(*) = 1 from public.orders where id = lh_rls_test.fixture_id('OA')));

select lh_rls_test.as_b();
insert into lh_rls_test.check values ('PED-03', 'b_directo',
  (select count(*) = 0 from public.orders where id = lh_rls_test.fixture_id('OA')));
insert into lh_rls_test.check values ('PED-03', 'b_join',
  (select count(*) = 0
     from public.orders o
     join public.carts c on c.id = o.cart_id
    where o.id = lh_rls_test.fixture_id('OA')));

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('PED-03', 'canario',
  (select count(*) = 1 from public.orders where id = lh_rls_test.fixture_id('OA')));

select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'PED-03'),
  'BLOQUEANTE-PED-03 — A lee OA; B no lo lee directo ni por join; canario intacto'
);

-- Expectativa: ADM1 no activa orders_admin_select y no lee pedidos ajenos.
select lh_rls_test.pending('PED-04', 'ADM1 SELECT orders devuelve conjunto vacio', false);

-- Expectativa: ADM2 lee exactamente OA, OB y OC.
select lh_rls_test.pending('PED-05', 'ADM2 SELECT orders devuelve OA OB OC', false);

-- Expectativa: INSERT directo de pedidos se rechaza 42501 para ANON, CART y A.
select lh_rls_test.pending('PED-06', 'INSERT directo orders denegado 42501 y sin fila', false);

-- Expectativa: UPDATE/DELETE de A o B sobre OA afectan cero filas y no lo alteran.
select lh_rls_test.pending('PED-07', 'cliente no puede actualizar borrar pagar o revalorar OA', false);

-- BLOQUEANTE-PED-08: el precio del navegador no determina el cobro.
select lh_rls_test.as_a();
insert into lh_rls_test.check values ('PED-08', 'precio_manipulado',
  (lh_rls_test.try_sql(format(
    'select public.place_order(%L::jsonb, %L::jsonb, %L::uuid, %L, NULL)',
    jsonb_build_object(
      'name', 'Cliente QA',
      'email', 'qa-a-order@example.invalid',
      'phone', '5512345678',
      'address', 'Calle QA 1',
      'addressRef', 'Ref QA',
      'city', 'CDMX',
      'state', 'CDMX',
      'zip', '01000'
    )::text,
    jsonb_build_array(jsonb_build_object(
      'product', 'hoodie',
      'colorHex', '#1c1c1f',
      'materialId', 'cotton400',
      'techniqueId', 'dtg',
      'qty', 1,
      'size', 'M',
      'unitPrice', 1
    ))::text,
    lh_rls_test.fixture_id('CA')::text,
    ''
  )) = '22023'));

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('PED-08', 'sin_pedido',
  (select count(*) = 1 from public.orders where user_id = lh_rls_test.uid_a()));
insert into lh_rls_test.check values ('PED-08', 'sin_descuento',
  (select used_count = 0 from public.coupons where code = 'QA_UNICO_10'));

select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'PED-08'),
  'BLOQUEANTE-PED-08 — unitPrice manipulado da 22023 y no crea pedido ni consume cupon'
);

-- PED-09: un pedido válido ignora campos extra que intentan imponer total,
-- estado o pago, y recalcula todo en servidor.
select lh_rls_test.as_service_role();
select lh_rls_test.register_fixture('PED9C', lh_rls_test.seed_cart(lh_rls_test.uid_c()));

select lh_rls_test.as_cart();
select public.place_order(
  lh_rls_test.valid_customer('{"email":"qa-ped09@example.invalid"}'::jsonb),
  jsonb_set(
    jsonb_set(
      jsonb_set(lh_rls_test.valid_items(), '{0,total}', '1'::jsonb),
      '{0,status}', '"delivered"'::jsonb
    ),
    '{0,paymentStatus}', '"paid"'::jsonb
  ),
  lh_rls_test.fixture_id('PED9C'),
  '',
  null
);

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('PED-09', 'campos',
  (select status = 'pending'
      and payment_status = 'demo'
      and payment_method = 'demo'
      and user_id = lh_rls_test.uid_c()
      and subtotal = ((lh_rls_test.valid_items() -> 0) ->> 'unitPrice')::int
      and item_count = 1
      and shipping = case when subtotal >= 1200 then 0 else 99 end
      and total = subtotal + shipping
     from public.orders
    where cart_id = lh_rls_test.fixture_id('PED9C')));
insert into lh_rls_test.check values ('PED-09', 'carrito',
  (select status = 'converted' from public.carts
    where id = lh_rls_test.fixture_id('PED9C')));

select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'PED-09'),
  'PED-09 — el pedido válido recalcula precio, usuario, estado y pago; el carrito se convierte'
);

-- Q-02: cada validacion devuelve 22023 y no crea pedido.
select lh_rls_test.as_a();
insert into lh_rls_test.check values ('PED-10', 'email',
  (lh_rls_test.try_sql(format(
    'select public.place_order(%L::jsonb, %L::jsonb, null, %L, null)',
    lh_rls_test.valid_customer('{"email":"sin-arroba"}'::jsonb),
    lh_rls_test.valid_items(),
    ''
  )) = '22023'));
insert into lh_rls_test.check values ('PED-10', 'telefono',
  (lh_rls_test.try_sql(format(
    'select public.place_order(%L::jsonb, %L::jsonb, null, %L, null)',
    lh_rls_test.valid_customer('{"phone":"123"}'::jsonb),
    lh_rls_test.valid_items(),
    ''
  )) = '22023'));
insert into lh_rls_test.check values ('PED-10', 'direccion',
  (lh_rls_test.try_sql(format(
    'select public.place_order(%L::jsonb, %L::jsonb, null, %L, null)',
    lh_rls_test.valid_customer('{"address":""}'::jsonb),
    lh_rls_test.valid_items(),
    ''
  )) = '22023'));
insert into lh_rls_test.check values ('PED-10', 'cp',
  (lh_rls_test.try_sql(format(
    'select public.place_order(%L::jsonb, %L::jsonb, null, %L, null)',
    lh_rls_test.valid_customer('{"zip":"12"}'::jsonb),
    lh_rls_test.valid_items(),
    ''
  )) = '22023'));
insert into lh_rls_test.check values ('PED-10', 'cincuenta_y_uno',
  (lh_rls_test.try_sql(format(
    'select public.place_order(%L::jsonb, %L::jsonb, null, %L, null)',
    lh_rls_test.valid_customer(),
    (select jsonb_agg(jsonb_build_object('product', 'hoodie', 'qty', 1, 'unitPrice', 899))
       from generate_series(1, 51)),
    ''
  )) = '22023'));

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('PED-10', 'sin_pedido',
  (select count(*) = 1 from public.orders where user_id = lh_rls_test.uid_a()));

select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'PED-10'),
  'PED-10 — email, telefono, direccion, CP y 51 articulos dan 22023 sin crear pedido'
);

-- PED-11: un carrito ajeno se rechaza con 42501 y no se convierte.
select lh_rls_test.as_a();
insert into lh_rls_test.check values ('PED-11', 'carrito_ajeno',
  (lh_rls_test.try_sql(format(
    'select public.place_order(%L::jsonb, %L::jsonb, %L::uuid, %L, null)',
    lh_rls_test.valid_customer(),
    lh_rls_test.valid_items(),
    lh_rls_test.fixture_id('CB'),
    ''
  )) = '42501'));

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('PED-11', 'cb_abierto',
  (select status = 'open' from public.carts where id = lh_rls_test.fixture_id('CB')));

select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'PED-11'),
  'PED-11 — pedido con carrito ajeno da 42501 y el carrito sigue abierto'
);

-- Expectativa: solo existe la firma de cinco argumentos; cuatro argumentos 42883.
select lh_rls_test.pending('PED-12', 'una sola firma place_order segura y ANON sin EXECUTE', false);

-- BLOQUEANTE-PED-13: resultado medido por scripts/test-concurrency.mjs.
-- 20 conexiones paralelas, mismo usuario y correo, commits reales.
select ok(
  coalesce((select pass from public.qa_concurrency_results where case_id = 'PED-13'), false),
  'BLOQUEANTE-PED-13 — LH-01: 20 llamadas paralelas no superan 3 por correo ni 5 por usuario'
);

-- Expectativa: los limites secuenciales rechazan la cuarta por correo y sexta por usuario.
select lh_rls_test.pending('PED-14', 'LH-01 cuarta por correo y sexta por usuario devuelven P0001', false);

-- La serie de 14 días debe sumar lo mismo que los KPIs: solo pagados.
select lh_rls_test.as_admin_aal2();
insert into lh_rls_test.check values ('PED-15', 'serie_igual_a_rango',
  (with j as (select public.admin_stats(30) as v)
   select
     (select coalesce(sum((e.value ->> 'orders')::int), 0) from jsonb_array_elements(v -> 'series') as e(value))
       = (v ->> 'orders_range')::int
     and
     (select coalesce(sum((e.value ->> 'revenue')::numeric), 0) from jsonb_array_elements(v -> 'series') as e(value))
       = (v ->> 'revenue_range')::numeric
   from j));
select lh_rls_test.as_service_role();
select ok(
  coalesce((select pass from lh_rls_test.check where case_id = 'PED-15' and step = 'serie_igual_a_rango'), false),
  'PED-15 — la serie de admin_stats solo cuenta pagados, igual que los KPIs'
);

-- Expectativa: admin_stats devuelve 42501 para ANON, CART, A, B y ADM1.
select lh_rls_test.pending('PED-16', 'admin_stats denegado para todo rol no admin aal2', false);

-- ---------------------------------------------------------------------------
-- Carrito: 8
-- ---------------------------------------------------------------------------

-- Expectativa: ANON no lee CA, CB ni CC.
select lh_rls_test.pending('CAR-01', 'ANON SELECT carts devuelve conjunto vacio', false);

-- Expectativa: CART solo ve CC; B solo ve CB y no CA.
select lh_rls_test.pending('CAR-02', 'carritos limitados al propietario exacto', false);

-- Expectativa: ADM1 no lee carritos; ADM2 lee CA, CB y CC.
select lh_rls_test.pending('CAR-03', 'carritos admin requieren aal2', false);

-- Expectativa: INSERT propio permitido; user_id ajeno devuelve 42501.
select lh_rls_test.pending('CAR-04', 'INSERT cart propio permitido y ajeno 42501', false);

-- Expectativa: A edita items propios; transferir user_id devuelve 42501; B no altera CA.
select lh_rls_test.pending('CAR-05', 'UPDATE propio permitido sin transferencia ni modificacion cruzada', false);

-- Expectativa: diez carritos abiertos permitidos y undecimo P0001.
select lh_rls_test.pending('CAR-06', 'maximo diez carritos abiertos por usuario', false);

-- Expectativa: veinte INSERT paralelos dejan como maximo diez carritos abiertos.
select lh_rls_test.pending('CAR-07', 'LH-05 limite diez carritos tambien bajo concurrencia', false);

-- Expectativa: 51 articulos o mas de 8 MiB devuelven 23514 y conservan CA.
select lh_rls_test.pending('CAR-08', 'constraints de 50 articulos y 8 MiB en carts', false);

-- ---------------------------------------------------------------------------
-- Facturación: 18
-- ---------------------------------------------------------------------------

-- Expectativa: ANON recibe 42501 al leer F0 y ningun RFC.
select lh_rls_test.pending('FAC-01', 'ANON SELECT invoice_requests denegado 42501', false);

-- Expectativa: clientes y ADM1 reciben cero filas y no modifican F0.
select lh_rls_test.pending('FAC-02', 'invoice_requests invisible e inmutable para no admin y ADM1', false);

-- Expectativa: ADM2 lee y actualiza notas; INSERT/DELETE directos 42501.
select lh_rls_test.pending('FAC-03', 'ADM2 lectura y notas permitidas pero sin INSERT DELETE directos', false);

-- Expectativa: submit_invoice_request y confirm_invoice_request no son RPC de navegador.
select lh_rls_test.pending('FAC-04', 'RPC publicas de factura solo service_role 42501 en navegador', false);

-- BLOQUEANTE-FAC-05: una solicitud review o cancelled no se puede reiniciar.
select lh_rls_test.as_service_role();
select lh_rls_test.register_fixture('O_REVIEW',
  lh_rls_test.seed_order(lh_rls_test.uid_a(), 990010, 'qa-fac05-review@example.invalid', 'paid'));
select lh_rls_test.register_fixture('O_CANCEL',
  lh_rls_test.seed_order(lh_rls_test.uid_a(), 990011, 'qa-fac05-cancel@example.invalid', 'paid'));
select lh_rls_test.register_fixture('F_REVIEW',
  lh_rls_test.seed_invoice(lh_rls_test.fixture_id('O_REVIEW'), 'review', null, now(), '04'));
select lh_rls_test.register_fixture('F_CANCEL',
  lh_rls_test.seed_invoice(lh_rls_test.fixture_id('O_CANCEL'), 'cancelled', null, null, '04'));

insert into lh_rls_test.check values ('FAC-05', 'review_locked',
  ((select public.submit_invoice_request(
      990010, 'qa-fac05-review@example.invalid', 'XAXX010101000', 'OTRO NOMBRE',
      '601', '00000', 'G03', 'otro@example.invalid', 'ataque', '28'
    ) ->> 'reason') = 'locked'));
insert into lh_rls_test.check values ('FAC-05', 'cancelled_locked',
  ((select public.submit_invoice_request(
      990011, 'qa-fac05-cancel@example.invalid', 'XAXX010101000', 'OTRO NOMBRE',
      '601', '00000', 'G03', 'otro@example.invalid', 'ataque', '28'
    ) ->> 'reason') = 'locked'));
insert into lh_rls_test.check values ('FAC-05', 'review_intacta',
  (select status = 'review' and legal_name = 'Empresa QA' and verified_at is not null
     from public.invoice_requests where id = lh_rls_test.fixture_id('F_REVIEW')));
insert into lh_rls_test.check values ('FAC-05', 'cancelled_intacta',
  (select status = 'cancelled' and legal_name = 'Empresa QA'
     from public.invoice_requests where id = lh_rls_test.fixture_id('F_CANCEL')));
insert into lh_rls_test.check values ('FAC-05', 'pedidos_intactos',
  (select count(*) = 2 from public.orders
    where id in (lh_rls_test.fixture_id('O_REVIEW'), lh_rls_test.fixture_id('O_CANCEL'))
      and billing_status = 'pending'));

select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'FAC-05'),
  'BLOQUEANTE-FAC-05 — review y cancelled responden locked sin cambiar datos'
);

-- Expectativa: alta backend valida nace unverified, token 24 h y pedido pending.
select lh_rls_test.pending('FAC-06', 'submit valido crea unverified sin excluir pedido antes de verificar', false);

-- Expectativa: invalid/notfound/unpaid/cancelled no crean solicitud ni envian correo.
select lh_rls_test.pending('FAC-07', 'submit invalido no coincidente demo y cancelado falla sin efectos', false);

-- BLOQUEANTE-FAC-08: una solicitud unverified no puede emitirse.
select lh_rls_test.as_admin_aal2();
insert into lh_rls_test.check values ('FAC-08', 'emision',
  (lh_rls_test.try_sql(format(
    'select public.mark_invoice_request_issued(%L::uuid, %L)',
    lh_rls_test.fixture_id('F0'),
    '11111111-1111-4111-8111-111111111111'
  )) = 'P0001'));

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('FAC-08', 'estado',
  (select status = 'unverified' from public.invoice_requests
    where id = lh_rls_test.fixture_id('F0')));
insert into lh_rls_test.check values ('FAC-08', 'uuid',
  (select uuid is null from public.invoice_requests
    where id = lh_rls_test.fixture_id('F0')));
insert into lh_rls_test.check values ('FAC-08', 'pedido',
  (select billing_status = 'pending' and billing_uuid is null
     from public.orders where id = lh_rls_test.fixture_id('OA')));

select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'FAC-08'),
  'BLOQUEANTE-FAC-08 — unverified no se emite (P0001) y no toca UUID ni billing'
);

-- Expectativa: token backend lleva unverified a review, consume token y marca individual.
select lh_rls_test.pending('FAC-09', 'confirm token backend produce review individual y verified_at', false);

-- Expectativa: token inexistente/caducado/cancelado o pedido invalido no pasa a review.
select lh_rls_test.pending('FAC-10', 'confirm invalido caducado cancelado impago no cambia estado', false);

-- Expectativa: review sin verified_at o sin SAT devuelve P0001 al emitir.
select lh_rls_test.pending('FAC-11', 'LH-08 emision exige verified_at y sat_payment_form', false);

-- FAC-12: emitir una solicitud review verificada y repetir el UUID.
select lh_rls_test.as_admin_aal2();
insert into lh_rls_test.check values ('FAC-12', 'primera',
  ((select public.mark_invoice_request_issued(
      lh_rls_test.fixture_id('F_REVIEW'),
      '22222222-2222-4222-8222-222222222222'
    ) ->> 'ok') = 'true'));

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('FAC-12', 'estado',
  (select status = 'issued' and uuid = '22222222-2222-4222-8222-222222222222'
     from public.invoice_requests where id = lh_rls_test.fixture_id('F_REVIEW')));
insert into lh_rls_test.check values ('FAC-12', 'pedido',
  (select billing_status = 'individual'
      and billing_uuid = '22222222-2222-4222-8222-222222222222'
     from public.orders where id = lh_rls_test.fixture_id('O_REVIEW')));

select lh_rls_test.as_admin_aal2();
insert into lh_rls_test.check values ('FAC-12', 'segunda',
  ((select public.mark_invoice_request_issued(
      lh_rls_test.fixture_id('F_REVIEW'),
      '22222222-2222-4222-8222-222222222222'
    ) ->> 'alreadyIssued') = 'true'));

select lh_rls_test.as_service_role();
select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'FAC-12'),
  'FAC-12 — review verificada se emite una vez y la repetición es idempotente'
);

-- FAC-13: cancelar antes de emitir; una emitida no se cancela.
select lh_rls_test.as_service_role();
select lh_rls_test.register_fixture('O_C13',
  lh_rls_test.seed_order(lh_rls_test.uid_a(), 990020, 'qa-fac13@example.invalid', 'paid'));
select lh_rls_test.register_fixture('F_C13',
  lh_rls_test.seed_invoice(lh_rls_test.fixture_id('O_C13'), 'review', null, now(), '04'));
update public.orders set billing_status = 'individual'
 where id = lh_rls_test.fixture_id('O_C13');

select lh_rls_test.as_admin_aal2();
insert into lh_rls_test.check values ('FAC-13', 'cancelar',
  ((select public.cancel_invoice_request(lh_rls_test.fixture_id('F_C13')) ->> 'ok') = 'true'));

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('FAC-13', 'estado',
  (select status = 'cancelled' and verify_token is null
     from public.invoice_requests where id = lh_rls_test.fixture_id('F_C13')));
insert into lh_rls_test.check values ('FAC-13', 'pedido',
  (select billing_status = 'pending' from public.orders
    where id = lh_rls_test.fixture_id('O_C13')));

select lh_rls_test.as_admin_aal2();
insert into lh_rls_test.check values ('FAC-13', 'emitida',
  (lh_rls_test.try_sql(format(
    'select public.cancel_invoice_request(%L::uuid)',
    lh_rls_test.fixture_id('F_REVIEW')
  )) = 'P0001'));

select lh_rls_test.as_service_role();
select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'FAC-13'),
  'FAC-13 — cancelar review restaura billing; una factura emitida no se cancela'
);

-- Expectativa: todas las RPC administrativas de facturacion devuelven 42501 sin aal2.
select lh_rls_test.pending('FAC-14', 'RPC individuales y globales denegadas para no admin y ADM1', false);

-- Expectativa: resend rota token solo en unverified y invalida el anterior.
select lh_rls_test.pending('FAC-15', 'reenvio unverified rota token 24 h y review devuelve P0001', false);

-- Expectativa: globales solo visibles para ADM2; escrituras directas denegadas.
select lh_rls_test.pending('FAC-16', 'global_invoices y relaciones solo lectura ADM2', false);

-- Expectativa: preview filtra pagados del periodo y set_order_billing protege global.
select lh_rls_test.pending('FAC-17', 'preview y set_billing aplican filtros SAT periodo y global inmutable', false);

-- Expectativa: create_global_invoice enlaza solo pagados pendientes 04 y segunda llamada P0001.
select lh_rls_test.pending('FAC-18', 'global creada con seleccion exacta total UUID y sin duplicados', false);

-- ---------------------------------------------------------------------------
-- Logos: 10
-- ---------------------------------------------------------------------------

-- Expectativa: ANON no lee LA ni LB.
select lh_rls_test.pending('LOG-01', 'ANON SELECT logo_assets devuelve conjunto vacio', false);

-- Expectativa: cada cliente ve solo sus assets; B no puede leer LA.
select lh_rls_test.pending('LOG-02', 'logo_assets limitado al propietario exacto', false);

-- Expectativa: ADM1 no lee assets; ADM2 lee LA y LB.
select lh_rls_test.pending('LOG-03', 'logo_assets admin requiere aal2', false);

-- Expectativa: INSERT propio con ruta propia permitido y legible por el dueno.
select lh_rls_test.pending('LOG-04', 'INSERT logo propio y ruta propia permitido', false);

-- Expectativa: user_id ajeno 42501 y source_path ajeno 22023, sin filas.
select lh_rls_test.pending('LOG-05', 'logo con usuario o ruta ajena denegado', false);

-- Expectativa: UPDATE/DELETE directos afectan cero filas incluso para ADM2.
select lh_rls_test.pending('LOG-06', 'logo_assets sin UPDATE DELETE directo desde navegador', false);

-- LOG-07: 50 altas por día; la 51 devuelve P0001 y una vieja no cuenta.
select lh_rls_test.as_service_role();
insert into public.logo_assets (user_id, source_path, width_cm, created_at)
values (
  lh_rls_test.uid_c(),
  lh_rls_test.uid_c()::text || '/old.png',
  20,
  now() - interval '25 hours'
);

select lh_rls_test.as_cart();
insert into public.logo_assets (user_id, source_path, width_cm)
select
  lh_rls_test.uid_c(),
  lh_rls_test.uid_c()::text || '/l' || n || '.png',
  20
from generate_series(1, 50) as n;

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('LOG-07', 'cincuenta',
  (select count(*) = 50 from public.logo_assets
    where user_id = lh_rls_test.uid_c()
      and created_at > now() - interval '24 hours'));
insert into lh_rls_test.check values ('LOG-07', 'viejo',
  (select count(*) = 51 from public.logo_assets
    where user_id = lh_rls_test.uid_c()));

select lh_rls_test.as_cart();
insert into lh_rls_test.check values ('LOG-07', 'cincuenta_y_uno',
  (lh_rls_test.try_sql(format(
    'insert into public.logo_assets (user_id, source_path, width_cm) values (%L::uuid, %L, 20)',
    lh_rls_test.uid_c(),
    lh_rls_test.uid_c()::text || '/l51.png'
  )) = 'P0001'));

select lh_rls_test.as_service_role();
select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'LOG-07'),
  'LOG-07 — el tope de 50 logos por 24 h se aplica y un asset viejo no cuenta'
);

-- Expectativa: sesenta INSERT paralelos dejan como maximo cincuenta assets.
select lh_rls_test.pending('LOG-08', 'LH-05 limite cincuenta logos tambien bajo concurrencia', false);

-- Expectativa: tras fallo solo se expone PROCESSING_FAILED, nunca detalle interno.
select lh_rls_test.pending('LOG-09', 'LH-12 last_error contiene solo codigo generico', false);

-- Expectativa: process-logo sin sesion 401, asset ajeno 403 y cuarto intento 429.
select lh_rls_test.pending('LOG-10', 'process-logo exige sesion propiedad y maximo tres intentos', false);

-- ---------------------------------------------------------------------------
-- Cupones: 12
-- ---------------------------------------------------------------------------

-- Expectativa: ANON recibe 42501 al seleccionar Q1 directamente.
select lh_rls_test.pending('CUP-01', 'LH-08 ANON SELECT coupons denegado 42501', false);

-- Expectativa: ningun rol de navegador, incluido ADM2, lee coupons directamente.
select lh_rls_test.pending('CUP-02', 'SELECT coupons denegado para todo navegador', false);

-- Expectativa: coupon_attempts no permite SELECT ni escrituras directas.
select lh_rls_test.pending('CUP-03', 'coupon_attempts inaccesible para navegador y admin', false);

-- Expectativa: check_coupon valido solo devuelve valid/code/percent; invalid reason invalid.
select lh_rls_test.pending('CUP-04', 'check_coupon minimiza salida y valida longitud', false);

-- Expectativa: inexistente/inactivo/caducado/agotado devuelven motivos exactos sin validez.
select lh_rls_test.pending('CUP-05', 'check_coupon distingue notfound expired exhausted', false);

-- Expectativa: intentos se agrupan por cf-connecting-ip, no por cabeceras alternativas.
select lh_rls_test.pending('CUP-06', 'rate coupon usa IP garantizada y evita cubos alternativos', false);

-- Expectativa: treinta notfound y llamada 31 rate con exactamente treinta intentos.
select lh_rls_test.pending('CUP-07', 'LH-04 limite secuencial 30 validaciones por IP', false);

-- CUP-08: un cupón de un solo uso no descuenta dos veces.
select lh_rls_test.as_service_role();
select lh_rls_test.register_fixture('CUP8A', lh_rls_test.seed_cart(lh_rls_test.uid_c()));
select lh_rls_test.register_fixture('CUP8B', lh_rls_test.seed_cart(lh_rls_test.uid_c()));

select lh_rls_test.as_cart();
select public.place_order(
  lh_rls_test.valid_customer('{"email":"qa-cup08@example.invalid"}'::jsonb),
  lh_rls_test.valid_items(),
  lh_rls_test.fixture_id('CUP8A'),
  '',
  'QA_UNICO_10'
);
select public.place_order(
  lh_rls_test.valid_customer('{"email":"qa-cup08@example.invalid"}'::jsonb),
  lh_rls_test.valid_items(),
  lh_rls_test.fixture_id('CUP8B'),
  '',
  'QA_UNICO_10'
);

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('CUP-08', 'primero',
  (select coupon = 'QA_UNICO_10' and discount > 0 from public.orders
    where cart_id = lh_rls_test.fixture_id('CUP8A')));
insert into lh_rls_test.check values ('CUP-08', 'segundo',
  (select coupon is null and discount = 0 from public.orders
    where cart_id = lh_rls_test.fixture_id('CUP8B')));
insert into lh_rls_test.check values ('CUP-08', 'uso',
  (select used_count = 1 from public.coupons where code = 'QA_UNICO_10'));

select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'CUP-08'),
  'CUP-08 — el cupón único descuenta una vez y el segundo pedido va sin descuento'
);

-- Expectativa: cien validaciones paralelas producen como maximo treinta consultas e intentos.
select lh_rls_test.pending('CUP-09', 'LH-04 concurrencia no supera treinta validaciones por IP', false);

-- BLOQUEANTE? No: medido por scripts/test-concurrency.mjs con dos pedidos reales.
select ok(
  coalesce((select pass from public.qa_concurrency_results where case_id = 'CUP-10'), false),
  'CUP-10 — dos pedidos paralelos con el mismo cupón único dejan un solo descuento'
);

-- Expectativa: reejecutar coupons/setup-premios no reabre lectura ni recrea policy publica.
select lh_rls_test.pending('CUP-11', 'LH-08 scripts heredados no reabren coupons', false);

-- Expectativa: reejecutar scripts no elimina contador ni guardas review/verified ni firma segura.
select lh_rls_test.pending('CUP-12', 'LH-08 definiciones seguras sobreviven reejecucion', false);

-- ---------------------------------------------------------------------------
-- Newsletter: 13
-- ---------------------------------------------------------------------------

-- Expectativa: ningun rol de navegador obtiene email, token o coupon_code.
select lh_rls_test.pending('NEW-01', 'newsletter_subscribers no legible desde navegador', false);

-- Expectativa: UPDATE/DELETE directos devuelven 42501 y conservan N0.
select lh_rls_test.pending('NEW-02', 'newsletter_subscribers inmutable desde navegador', false);

-- BLOQUEANTE-NEW-03: ataque completo LH-03 desde ANON.
select lh_rls_test.as_anon();
insert into lh_rls_test.check values ('NEW-03', 'insert_directo',
  (lh_rls_test.try_sql(format(
    'insert into public.newsletter_subscribers(email, token, confirmed) values (%L, %L::uuid, false)',
    'qa-new-03@example.invalid',
    '30000000-0000-4000-8000-000000000003'
  )) = '42501'));
insert into lh_rls_test.check values ('NEW-03', 'confirmar_token_elegido',
  ((select public.confirm_newsletter('30000000-0000-4000-8000-000000000003'::uuid) ->> 'reason') = 'notfound'));

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('NEW-03', 'sin_cupon',
  (select count(*) = 0 from public.coupons where code like 'LH-%'));

select lh_rls_test.as_anon();
insert into lh_rls_test.check values ('NEW-03', 'alta_rpc',
  ((select public.subscribe_newsletter('qa-new-03-alt@example.invalid') ->> 'ok') = 'true'));

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('NEW-03', 'fila_rpc',
  (select count(*) = 1 from public.newsletter_subscribers
    where lower(email) = 'qa-new-03-alt@example.invalid'));

select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'NEW-03'),
  'BLOQUEANTE-NEW-03 — ANON no inserta ni confirma token elegido, sin cupon; la RPC sigue funcionando'
);

-- Expectativa: CART, A, B y ADM2 tampoco insertan suscriptores directamente.
select lh_rls_test.pending('NEW-04', 'LH-03 INSERT directo denegado para todo authenticated', false);

-- Expectativa: subscribe_newsletter crea pendiente, token backend y un correo mock.
select lh_rls_test.pending('NEW-05', 'alta valida solo RPC crea unconfirmed y token backend', false);

-- Expectativa: emails invalidos devuelven invalid sin suscriptor, intento ni correo.
select lh_rls_test.pending('NEW-06', 'subscribe_newsletter valida email antes de escribir o contar', false);

-- Expectativa: correo confirmado repetido devuelve duplicate true sent false sin rotar token.
select lh_rls_test.pending('NEW-07', 'duplicado confirmado no reenvia ni cambia token o cupon', false);

-- Expectativa: alta pendiente rota token; viejo notfound y nuevo confirma una vez.
select lh_rls_test.pending('NEW-08', 'realta pendiente invalida token anterior', false);

-- Expectativa: token inexistente notfound y dado de baja unsubscribed, sin cupon nuevo.
select lh_rls_test.pending('NEW-09', 'confirm_newsletter rechaza token inexistente o baja', false);

-- Expectativa: token backend confirma y emite un unico LH de 10%, max_uses 1 y 90 dias.
select lh_rls_test.pending('NEW-10', 'confirmacion backend genera cupon unico correcto', false);

-- NEW-11: confirmar dos veces no genera otro cupón; la baja lo impide.
select lh_rls_test.as_service_role();
select lh_rls_test.register_fixture('N11',
  lh_rls_test.seed_subscriber(
    'qa-new11@example.invalid',
    '40000000-0000-4000-8000-000000000011'::uuid,
    false
  ));

select lh_rls_test.as_anon();
select public.confirm_newsletter('40000000-0000-4000-8000-000000000011'::uuid);
select public.confirm_newsletter('40000000-0000-4000-8000-000000000011'::uuid);

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('NEW-11', 'codigo',
  (select coalesce(coupon_code like 'LH-%', false) from public.newsletter_subscribers
    where token = '40000000-0000-4000-8000-000000000011'::uuid));
insert into lh_rls_test.check values ('NEW-11', 'unico',
  (select count(*) = 1 from public.coupons
    where code = (select coupon_code from public.newsletter_subscribers
                   where token = '40000000-0000-4000-8000-000000000011'::uuid)));

select lh_rls_test.as_anon();
select public.unsubscribe_newsletter('40000000-0000-4000-8000-000000000011'::uuid);
insert into lh_rls_test.check values ('NEW-11', 'motivo',
  ((select public.confirm_newsletter('40000000-0000-4000-8000-000000000011'::uuid) ->> 'reason') = 'unsubscribed'));

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('NEW-11', 'baja',
  (select confirmed = false and unsubscribed_at is not null
     from public.newsletter_subscribers
    where token = '40000000-0000-4000-8000-000000000011'::uuid));
insert into lh_rls_test.check values ('NEW-11', 'sin_nuevo',
  (select count(*) = 1 from public.coupons
    where code = (select coupon_code from public.newsletter_subscribers
                   where token = '40000000-0000-4000-8000-000000000011'::uuid)));

select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'NEW-11'),
  'NEW-11 — confirmar dos veces no duplica el cupón y la baja queda registrada'
);

-- BLOQUEANTE-NEW-12: resultado medido por scripts/test-concurrency.mjs.
-- 50 altas paralelas desde una misma IP, commits reales.
select ok(
  coalesce((select pass from public.qa_concurrency_results where case_id = 'NEW-12'), false),
  'BLOQUEANTE-NEW-12 — LH-02: 50 altas paralelas no superan 5 intentos ni 5 envios por IP'
);

-- Expectativa: seiscientas altas distribuidas no superan tope global 500 por hora.
select lh_rls_test.pending('NEW-13', 'LH-02 tope global quinientos intentos por hora', false);

-- ---------------------------------------------------------------------------
-- Rate limit: 17
-- ---------------------------------------------------------------------------

-- Expectativa: get_order_status solo backend y respuesta sin PII.
select lh_rls_test.pending('RATE-01', 'get_order_status 42501 en navegador y backend sin PII', false);

-- Expectativa: take_order_lookup 42501 en navegador e invalid hash false sin fila.
select lh_rls_test.pending('RATE-02', 'take_order_lookup solo service_role y valida hash', false);

-- Expectativa: doce true y llamada 13 false con doce intentos por hash.
select lh_rls_test.pending('RATE-03', 'order lookup limita doce por IP en diez minutos', false);

-- Expectativa: cuatrocientas llamadas paralelas globales dejan como maximo 300 por minuto.
select lh_rls_test.pending('RATE-04', 'LH-05 order lookup global 300 bajo concurrencia', false);

-- Expectativa: take_client_error solo service_role e invalid hash false.
select lh_rls_test.pending('RATE-05', 'take_client_error solo service_role y valida hash', false);

-- Expectativa: veinte por IP y global 2000 calculado sobre client_error_attempts.
select lh_rls_test.pending('RATE-06', 'LH-05 client error limites 20 IP y 2000 global desde attempts', false);

-- Expectativa: 2050 llamadas paralelas no superan 2000 intentos globales.
select lh_rls_test.pending('RATE-07', 'LH-05 client error global 2000 bajo concurrencia', false);

-- Expectativa: take_invoice_request solo backend, diez por IP y cien globales.
select lh_rls_test.pending('RATE-08', 'invoice request limites hash 10 IP y 100 global', false);

-- Expectativa: 150 llamadas paralelas no superan cien intentos globales.
select lh_rls_test.pending('RATE-09', 'LH-05 invoice global 100 bajo concurrencia', false);

-- Expectativa: take_clip_pay solo backend, doce por IP y seis por usuario.
select lh_rls_test.pending('RATE-10', 'clip pay limites 12 IP 6 usuario y parametros validos', false);

-- Expectativa: veinte llamadas paralelas del mismo usuario dejan maximo seis.
select lh_rls_test.pending('RATE-11', 'LH-05 clip pay seis por usuario con IP rotadas', false);

-- Expectativa: take_logo_process solo backend, veinte por usuario y treinta por IP.
select lh_rls_test.pending('RATE-12', 'logo process limites 20 usuario 30 IP y hash valido', false);

-- Expectativa: 350 llamadas paralelas no superan 300 globales por hora.
select lh_rls_test.pending('RATE-13', 'LH-05 logo process global 300 bajo concurrencia', false);

-- Expectativa: las siete tablas de intentos rechazan SELECT/INSERT de navegador.
select lh_rls_test.pending('RATE-14', 'tablas de intentos inaccesibles para todo navegador', false);

-- Expectativa: cleanup elimina todas las filas fuera de plazo y conserva recientes.
select lh_rls_test.pending('RATE-15', 'LH-09 retencion completa sin requerir trafico posterior', false);

-- Expectativa: likehoodie-cleanup existe, activo, diario 04:15 UTC.
select lh_rls_test.pending('RATE-16', 'LH-09 cron likehoodie-cleanup activo 15 4 diario', false);

-- Expectativa: contador caido o sal ausente falla cerrado; hashes 64 separados por finalidad.
select lh_rls_test.pending('RATE-17', 'LH-05 LH-11 contador y sal fallan cerrados sin efectos', false);

-- ---------------------------------------------------------------------------
-- Settings: 8
-- ---------------------------------------------------------------------------

-- Expectativa: store_settings no se lee ni modifica desde ningun navegador.
select lh_rls_test.pending('SET-01', 'store_settings inaccesible e inmutable desde navegador', false);

-- Expectativa: product_prices e item_unit_price devuelven 42501 en navegador.
select lh_rls_test.pending('SET-02', 'precios y helper de precio solo servidor', false);

-- Expectativa: store_config con Clip false devuelve exactamente payment_provider demo.
select lh_rls_test.pending('SET-03', 'store_config demo sin claves adicionales', false);

-- Expectativa: instalacion nueva deja clip_enabled false y nunca lo activa sola.
select lh_rls_test.pending('SET-04', 'clip_enabled false por defecto tras instalacion', false);

-- Expectativa: al activar setting local, config clip y pedido clip/pending; nunca paid.
select lh_rls_test.pending('SET-05', 'Clip activo no permite que cliente marque pago pagado', false);

-- Expectativa: has_resend_key devuelve 42501 para ANON, nunca booleano.
select lh_rls_test.pending('SET-06', 'LH-10 has_resend_key denegado para ANON', false);

-- Expectativa: has_resend_key devuelve 42501 para todo authenticated y admin.
select lh_rls_test.pending('SET-07', 'LH-10 has_resend_key denegado para authenticated', false);

-- BLOQUEANTE-SET-08: resultado medido por scripts/test-clip-idempotency.mjs.
-- Dos cobros y dos checkouts paralelos contra el runtime real de funciones.
select ok(
  coalesce((select pass from public.qa_concurrency_results where case_id = 'SET-08'), false),
  'BLOQUEANTE-SET-08 — LH-06: dos peticiones paralelas no duplican cargo ni link'
);

-- ---------------------------------------------------------------------------
-- Storage: 10
-- ---------------------------------------------------------------------------

-- Expectativa: buckets privados con MIME y tamanos exactos documentados.
select lh_rls_test.pending('STO-01', 'buckets privados limites MIME 5 MiB logos 25 MiB prints', false);

-- Expectativa: ANON recibe 42501 al leer o insertar storage.objects.
select lh_rls_test.pending('STO-02', 'ANON sin lectura ni escritura Storage', false);

-- BLOQUEANTE-STO-03: aislamiento de objetos entre usuarios.
select lh_rls_test.as_b();
insert into lh_rls_test.check values ('STO-03', 'b_no_lee',
  (select count(*) = 0 from storage.objects
    where bucket_id = 'order-logos'
      and name = (lh_rls_test.uid_a()::text || '/original.png')));
insert into lh_rls_test.check values ('STO-03', 'b_no_lee_print',
  (select count(*) = 0 from storage.objects
    where bucket_id = 'order-prints'
      and name = (lh_rls_test.uid_a()::text || '/print.png')));

select lh_rls_test.as_a();
insert into lh_rls_test.check values ('STO-03', 'a_lee',
  (select count(*) = 1 from storage.objects
    where bucket_id = 'order-logos'
      and name = (lh_rls_test.uid_a()::text || '/original.png')));
insert into lh_rls_test.check values ('STO-03', 'a_no_ajeno',
  (select count(*) = 0 from storage.objects
    where bucket_id = 'order-logos'
      and name = (lh_rls_test.uid_b()::text || '/original.png')));

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('STO-03', 'bucket_privado',
  (select not public from storage.buckets where id = 'order-logos'));
insert into lh_rls_test.check values ('STO-03', 'canario',
  (select count(*) = 1 from storage.objects
    where bucket_id = 'order-logos'
      and name = (lh_rls_test.uid_a()::text || '/original.png')));

select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'STO-03'),
  'BLOQUEANTE-STO-03 — B no lee logo ni print ajenos; A lee solo lo suyo; bucket privado'
);

-- Expectativa: upload propio permitido y listado limitado al primer componente UID.
select lh_rls_test.pending('STO-04', 'upload logo propio permitido y listado solo propio', false);

-- Q-06: ninguna variante de ruta puede escapar de la carpeta del usuario.
select lh_rls_test.as_a();
insert into lh_rls_test.check values ('STO-05', 'punto_punto',
  (lh_rls_test.try_sql(format(
    'insert into storage.objects(bucket_id, name, owner) values (%L, %L, %L::uuid)',
    'order-logos',
    lh_rls_test.uid_a()::text || '/../' || lh_rls_test.uid_b()::text || '/x.png',
    lh_rls_test.uid_a()
  )) = '42501'));
insert into lh_rls_test.check values ('STO-05', 'barra_inicial',
  (lh_rls_test.try_sql(format(
    'insert into storage.objects(bucket_id, name, owner) values (%L, %L, %L::uuid)',
    'order-logos',
    '/' || lh_rls_test.uid_a()::text || '/x.png',
    lh_rls_test.uid_a()
  )) = '42501'));
insert into lh_rls_test.check values ('STO-05', 'doble_barra',
  (lh_rls_test.try_sql(format(
    'insert into storage.objects(bucket_id, name, owner) values (%L, %L, %L::uuid)',
    'order-logos',
    lh_rls_test.uid_a()::text || '//x.png',
    lh_rls_test.uid_a()
  )) = '42501'));
insert into lh_rls_test.check values ('STO-05', 'barra_inversa',
  (lh_rls_test.try_sql(format(
    'insert into storage.objects(bucket_id, name, owner) values (%L, %L, %L::uuid)',
    'order-logos',
    lh_rls_test.uid_a()::text || '/x\y.png',
    lh_rls_test.uid_a()
  )) = '42501'));
insert into lh_rls_test.check values ('STO-05', 'carpeta_ajena',
  (lh_rls_test.try_sql(format(
    'insert into storage.objects(bucket_id, name, owner) values (%L, %L, %L::uuid)',
    'order-logos',
    lh_rls_test.uid_b()::text || '/x.png',
    lh_rls_test.uid_a()
  )) = '42501'));
insert into lh_rls_test.check values ('STO-05', 'control',
  (lh_rls_test.try_sql(format(
    'insert into storage.objects(bucket_id, name, owner) values (%L, %L, %L::uuid)',
    'order-logos',
    lh_rls_test.uid_a()::text || '/ok.png',
    lh_rls_test.uid_a()
  )) = 'ok'));

select lh_rls_test.as_service_role();
insert into lh_rls_test.check values ('STO-05', 'canario',
  (select count(*) = 1 from storage.objects
    where bucket_id = 'order-logos'
      and name = (lh_rls_test.uid_a()::text || '/ok.png')));

select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'STO-05'),
  'STO-05 — rutas con .., barras o carpeta ajena se rechazan; la propia funciona'
);

-- Expectativa: ADM1 no lee logos/prints; ADM2 si.
select lh_rls_test.pending('STO-06', 'lectura admin de logos y prints requiere aal2', false);

-- Expectativa: A y ADM2 borran objetos permitidos; B no borra SA.
select lh_rls_test.pending('STO-07', 'delete logo propio o admin y nunca cruzado', false);

-- Expectativa: order-prints solo lectura ADM2 y escritura backend.
select lh_rls_test.pending('STO-08', 'prints inaccesibles a clientes y sin escritura directa admin', false);

-- BLOQUEANTE? No: medido por scripts/test-clip-idempotency.mjs contra Storage.
select ok(
  coalesce((select pass from public.qa_concurrency_results where case_id = 'STO-09'), false),
  'STO-09 — MIME falso y exceso de tamano se rechazan sin guardar objeto'
);

-- Medido por scripts/test-clip-idempotency.mjs contra Storage.
select ok(
  coalesce((select pass from public.qa_concurrency_results where case_id = 'STO-10'), false),
  'STO-10 — bucket privado y enlace firmado funciona; la URL publica no'
);

-- ---------------------------------------------------------------------------
-- Privilegios: 9
-- ---------------------------------------------------------------------------

-- Expectativa: perfiles limitados a propio; solo ADM2 lee todos.
select lh_rls_test.pending('PRIV-01', 'profiles lectura propia y admin solo aal2', false);

-- BLOQUEANTE-PRIV-02: un cliente no puede elevar su rol.
select lh_rls_test.as_a();
insert into lh_rls_test.check values ('PRIV-02', 'update_rol', false);
with u as (
  update public.profiles set role = 'admin' where id = auth.uid() returning 1
)
update lh_rls_test.check
   set pass = (select count(*) = 0 from u)
 where case_id = 'PRIV-02' and step = 'update_rol';
insert into lh_rls_test.check values ('PRIV-02', 'insert_admin',
  (lh_rls_test.try_sql(format(
    'insert into public.profiles(id, email, role) values (%L::uuid, %L, %L)',
    '10000000-0000-4000-8000-0000000000ff',
    'qa-intruso@example.invalid',
    'admin'
  )) = '42501'));
insert into lh_rls_test.check values ('PRIV-02', 'rol_intacto',
  (select role = 'customer' from public.profiles where id = auth.uid()));

select lh_rls_test.use_actor('authenticated', lh_rls_test.uid_a(), 'aal2');
insert into lh_rls_test.check values ('PRIV-02', 'aal2_sin_admin',
  ((select public.is_admin()) = false));

select lh_rls_test.as_service_role();
select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'PRIV-02'),
  'BLOQUEANTE-PRIV-02 — el cliente no se asigna admin ni con aal2'
);

-- BLOQUEANTE-PRIV-03: MFA obligatorio en todas las superficies.
select lh_rls_test.as_admin_aal1();
insert into lh_rls_test.check values ('PRIV-03', 'aal1_is_admin',
  ((select public.is_admin()) = false));
insert into lh_rls_test.check values ('PRIV-03', 'aal1_orders',
  (select count(*) = 0 from public.orders where id = lh_rls_test.fixture_id('OA')));
insert into lh_rls_test.check values ('PRIV-03', 'aal1_client_errors',
  (select count(*) = 0 from public.client_errors));
insert into lh_rls_test.check values ('PRIV-03', 'aal1_admin_stats',
  (lh_rls_test.try_sql('select public.admin_stats(30)') = '42501'));
insert into lh_rls_test.check values ('PRIV-03', 'aal1_storage',
  (select count(*) = 0 from storage.objects
    where bucket_id = 'order-prints'
      and name = (lh_rls_test.uid_a()::text || '/print.png')));

select lh_rls_test.as_admin_aal2();
insert into lh_rls_test.check values ('PRIV-03', 'aal2_is_admin',
  ((select public.is_admin()) = true));
insert into lh_rls_test.check values ('PRIV-03', 'aal2_orders',
  (select count(*) = 1 from public.orders where id = lh_rls_test.fixture_id('OA')));
insert into lh_rls_test.check values ('PRIV-03', 'aal2_client_errors',
  (select count(*) = 2 from public.client_errors));
insert into lh_rls_test.check values ('PRIV-03', 'aal2_admin_stats',
  (lh_rls_test.try_sql('select public.admin_stats(30)') = 'ok'));

select lh_rls_test.as_service_role();
select ok(
  (select coalesce(bool_and(pass), false) from lh_rls_test.check where case_id = 'PRIV-03'),
  'BLOQUEANTE-PRIV-03 — aal1 no es admin en tablas, Storage ni RPC; aal2 sí'
);

-- Expectativa: aal2 sin perfil admin y perfil customer previo no conceden admin.
select lh_rls_test.pending('PRIV-04', 'is_admin exige simultaneamente perfil admin y aal2', false);

-- Expectativa: events solo lectura ADM2; INSERT propio permitido y ajeno 42501.
select lh_rls_test.pending('PRIV-05', 'events lectura admin e INSERT limitado a auth.uid', false);

-- Expectativa: constraints de eventos y maximo 300 por hora serial y paralelo.
select lh_rls_test.pending('PRIV-06', 'LH-05 eventos limitan bytes y 300 por hora concurrente', false);

-- Expectativa: client_errors solo ADM2; RPC trunca, asigna UID y limita 30 por usuario.
select lh_rls_test.pending('PRIV-07', 'LH-05 client_errors admin y log_client_error truncado limitado', false);

-- Expectativa: ad_consent directo 42501; RPC autenticado solo escribe su UID.
select lh_rls_test.pending('PRIV-08', 'ad_consent privado y set_ad_consent limitado al propio UID', false);

-- Expectativa: RLS en 21 tablas, search_path fijado y grants minimos documentados.
select lh_rls_test.pending('PRIV-09', 'inventario RLS definer search_path y grants sin exposicion', false);

select * from finish();

rollback;
