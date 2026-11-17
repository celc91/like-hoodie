-- Script heredado (LH-08). Si la base ya tiene el esquema actual, no se
-- reejecuta: reabriria permisos que las migraciones posteriores cierran.
do $do$
begin
  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'orders'
       and column_name = 'currency'
  ) then
    raise exception 'Script heredado: la base ya esta migrada. Usa scripts/bootstrap-local.mjs o supabase db push.';
  end if;
end;
$do$;

-- ---------------------------------------------------------------------------
-- Fase 10: solicitud pública de factura individual
--
-- El visitante solicita factura desde la web. La Edge Function valida el
-- pedido con service_role y guarda los datos fiscales en una tabla privada.
-- La emisión del CFDI sigue siendo manual.
-- ---------------------------------------------------------------------------

begin;

create table if not exists public.invoice_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  order_number bigint not null,
  purchase_email text not null,
  rfc text not null,
  legal_name text not null,
  tax_regime text not null,
  zip text not null,
  cfdi_use text not null,
  invoice_email text not null,
  notes text,
  status text not null default 'pending'
    check (status in ('pending', 'review', 'issued', 'cancelled')),
  uuid text,
  issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(rfc) between 12 and 13),
  check (tax_regime ~ '^[0-9]{3}$'),
  check (zip ~ '^[0-9]{5}$'),
  check (cfdi_use ~ '^[A-Z][0-9]{2}$'),
  check (uuid is null or length(uuid) = 36)
);

create index if not exists invoice_requests_status_idx
  on public.invoice_requests (status, created_at desc);

drop trigger if exists invoice_requests_touch_updated_at on public.invoice_requests;
create trigger invoice_requests_touch_updated_at
  before update on public.invoice_requests
  for each row execute function public.touch_updated_at();

alter table public.invoice_requests enable row level security;

revoke all on public.invoice_requests from public, anon, authenticated;
grant select, update on public.invoice_requests to authenticated;
grant all on public.invoice_requests to service_role;

drop policy if exists "invoice_requests_admin_select" on public.invoice_requests;
create policy "invoice_requests_admin_select"
  on public.invoice_requests
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "invoice_requests_admin_update" on public.invoice_requests;
create policy "invoice_requests_admin_update"
  on public.invoice_requests
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create table if not exists public.invoice_request_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists invoice_request_attempts_ip_idx
  on public.invoice_request_attempts (ip_hash, created_at desc);

create index if not exists invoice_request_attempts_created_idx
  on public.invoice_request_attempts (created_at);

alter table public.invoice_request_attempts enable row level security;

revoke all on public.invoice_request_attempts from public, anon, authenticated;
grant all on public.invoice_request_attempts to service_role;

create or replace function public.take_invoice_request(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip integer;
  v_global integer;
begin
  if p_ip_hash is null or length(p_ip_hash) <> 64 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_ip_hash));

  select count(*) into v_ip
    from public.invoice_request_attempts
   where ip_hash = p_ip_hash
     and created_at > now() - interval '1 hour';

  if v_ip >= 10 then
    return false;
  end if;

  select count(*) into v_global
    from public.invoice_request_attempts
   where created_at > now() - interval '1 hour';

  if v_global >= 100 then
    return false;
  end if;

  insert into public.invoice_request_attempts (ip_hash)
  values (p_ip_hash);

  delete from public.invoice_request_attempts
   where created_at < now() - interval '2 days';

  return true;
end;
$$;

revoke all on function public.take_invoice_request(text) from public;
revoke all on function public.take_invoice_request(text) from anon;
revoke all on function public.take_invoice_request(text) from authenticated;
grant execute on function public.take_invoice_request(text) to service_role;

create or replace function public.submit_invoice_request(
  p_number bigint,
  p_email text,
  p_rfc text,
  p_legal_name text,
  p_tax_regime text,
  p_zip text,
  p_cfdi_use text,
  p_invoice_email text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_request public.invoice_requests;
  v_status text;
begin
  if p_number is null
     or p_number < 1
     or p_email is null
     or length(trim(p_email)) < 5
     or p_rfc is null
     or length(trim(p_rfc)) not between 12 and 13
     or p_legal_name is null
     or length(trim(p_legal_name)) < 2
     or p_tax_regime is null
     or p_tax_regime !~ '^[0-9]{3}$'
     or p_zip is null
     or p_zip !~ '^[0-9]{5}$'
     or p_cfdi_use is null
     or upper(trim(p_cfdi_use)) not in ('G01', 'G03', 'P01', 'S01')
     or p_invoice_email is null
     or length(trim(p_invoice_email)) < 5 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_order
    from public.orders
   where number = p_number
     and lower(email) = lower(trim(p_email))
   limit 1
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'cancelled');
  end if;

  if v_order.payment_status <> 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'unpaid');
  end if;

  select * into v_request
    from public.invoice_requests
   where order_id = v_order.id
   for update;

  if found and v_request.status = 'issued' then
    return jsonb_build_object('ok', false, 'reason', 'issued');
  end if;

  if v_order.billing_status = 'global' then
    v_status := 'review';
  else
    v_status := 'pending';

    if v_order.billing_status = 'pending' then
      update public.orders
         set billing_status = 'individual'
       where id = v_order.id;
    end if;
  end if;

  if v_request.id is not null then
    update public.invoice_requests
       set order_number = v_order.number,
           purchase_email = lower(trim(p_email)),
           rfc = upper(trim(p_rfc)),
           legal_name = left(trim(p_legal_name), 160),
           tax_regime = trim(p_tax_regime),
           zip = trim(p_zip),
           cfdi_use = upper(trim(p_cfdi_use)),
           invoice_email = lower(trim(p_invoice_email)),
           notes = left(coalesce(p_notes, ''), 500),
           status = v_status,
           updated_at = now()
     where id = v_request.id;
  else
    insert into public.invoice_requests (
      order_id, order_number, purchase_email, rfc, legal_name, tax_regime,
      zip, cfdi_use, invoice_email, notes, status
    ) values (
      v_order.id, v_order.number, lower(trim(p_email)), upper(trim(p_rfc)),
      left(trim(p_legal_name), 160), trim(p_tax_regime), trim(p_zip),
      upper(trim(p_cfdi_use)), lower(trim(p_invoice_email)),
      left(coalesce(p_notes, ''), 500), v_status
    );
  end if;

  return jsonb_build_object('ok', true, 'status', v_status);
end;
$$;

revoke all on function public.submit_invoice_request(bigint, text, text, text, text, text, text, text, text) from public;
revoke all on function public.submit_invoice_request(bigint, text, text, text, text, text, text, text, text) from anon;
revoke all on function public.submit_invoice_request(bigint, text, text, text, text, text, text, text, text) from authenticated;
grant execute on function public.submit_invoice_request(bigint, text, text, text, text, text, text, text, text) to service_role;

create or replace function public.mark_invoice_request_issued(
  p_request_id uuid,
  p_uuid text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.invoice_requests;
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_uuid is null
     or p_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'UUID no válido' using errcode = '22023';
  end if;

  select * into v_request
    from public.invoice_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'Solicitud no encontrada' using errcode = 'P0001';
  end if;

  if v_request.status = 'issued' then
    return jsonb_build_object('ok', true, 'alreadyIssued', true);
  end if;

  if v_request.status = 'cancelled' then
    raise exception 'La solicitud está cancelada' using errcode = 'P0001';
  end if;

  select * into v_order
    from public.orders
   where id = v_request.order_id
   for update;

  if v_order.status = 'cancelled' then
    raise exception 'El pedido está cancelado' using errcode = 'P0001';
  end if;

  if v_order.billing_status = 'global' then
    raise exception 'El pedido ya está en una factura global; ajusta la global antes de emitir la individual'
      using errcode = 'P0001';
  end if;

  update public.invoice_requests
     set status = 'issued',
         uuid = p_uuid,
         issued_at = now()
   where id = p_request_id;

  update public.orders
     set billing_status = 'individual',
         billing_uuid = p_uuid,
         billed_at = now()
   where id = v_request.order_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mark_invoice_request_issued(uuid, text) from public;
revoke all on function public.mark_invoice_request_issued(uuid, text) from anon;
grant execute on function public.mark_invoice_request_issued(uuid, text) to authenticated;

create or replace function public.cancel_invoice_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.invoice_requests;
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_request
    from public.invoice_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'Solicitud no encontrada' using errcode = 'P0001';
  end if;

  if v_request.status = 'issued' then
    raise exception 'La factura ya fue emitida' using errcode = 'P0001';
  end if;

  select * into v_order
    from public.orders
   where id = v_request.order_id
   for update;

  update public.invoice_requests
     set status = 'cancelled'
   where id = p_request_id;

  if v_order.billing_status = 'individual' then
    update public.orders
       set billing_status = 'pending'
     where id = v_request.order_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.cancel_invoice_request(uuid) from public;
revoke all on function public.cancel_invoice_request(uuid) from anon;
grant execute on function public.cancel_invoice_request(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
