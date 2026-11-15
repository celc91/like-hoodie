-- ---------------------------------------------------------------------------
-- Fase 9: facturación global semanal (público en general)
--
-- No emite CFDI: prepara el cierre semanal y registra el UUID de la factura
-- global emitida manualmente en el SAT.
-- ---------------------------------------------------------------------------

begin;

alter table public.orders
  add column if not exists billing_status text not null default 'pending',
  add column if not exists sat_payment_form text,
  add column if not exists billing_uuid text,
  add column if not exists billed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.orders'::regclass
       and conname = 'orders_billing_status_chk'
  ) then
    alter table public.orders
      add constraint orders_billing_status_chk
      check (billing_status in ('pending', 'individual', 'global'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.orders'::regclass
       and conname = 'orders_sat_payment_form_chk'
  ) then
    alter table public.orders
      add constraint orders_sat_payment_form_chk
      check (sat_payment_form is null or sat_payment_form in ('04', '28'));
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.orders'::regclass
       and conname = 'orders_billing_uuid_len_chk'
  ) then
    alter table public.orders
      add constraint orders_billing_uuid_len_chk
      check (billing_uuid is null or length(billing_uuid) = 36);
  end if;
end
$$;

create index if not exists orders_billing_idx
  on public.orders (billing_status, created_at desc);

create table if not exists public.global_invoices (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  payment_form text not null check (payment_form in ('04', '28')),
  total integer not null check (total >= 0),
  uuid text not null unique check (length(uuid) = 36),
  issued_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  check (period_end >= period_start)
);

create index if not exists global_invoices_period_idx
  on public.global_invoices (period_start, period_end);

create table if not exists public.global_invoice_orders (
  global_invoice_id uuid not null
    references public.global_invoices(id) on delete cascade,
  order_id uuid not null unique
    references public.orders(id) on delete restrict,
  primary key (global_invoice_id, order_id)
);

alter table public.global_invoices enable row level security;
alter table public.global_invoice_orders enable row level security;

revoke all on public.global_invoices from public, anon, authenticated;
revoke all on public.global_invoice_orders from public, anon, authenticated;
grant select on public.global_invoices to authenticated;
grant select on public.global_invoice_orders to authenticated;
grant all on public.global_invoices to service_role;
grant all on public.global_invoice_orders to service_role;

drop policy if exists "global_invoices_admin_select" on public.global_invoices;
create policy "global_invoices_admin_select"
  on public.global_invoices
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "global_invoice_orders_admin_select" on public.global_invoice_orders;
create policy "global_invoice_orders_admin_select"
  on public.global_invoice_orders
  for select
  to authenticated
  using (public.is_admin());

create or replace function public.global_invoice_preview(
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_orders jsonb;
  v_summary jsonb;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_start is null
     or p_end is null
     or p_end < p_start
     or (p_end - p_start) > 31 then
    raise exception 'Periodo no válido' using errcode = '22023';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'number', o.number,
        'created_at', o.created_at,
        'total', o.total,
        'item_count', o.item_count,
        'payment_method', o.payment_method,
        'payment_status', o.payment_status,
        'billing_status', o.billing_status,
        'sat_payment_form', o.sat_payment_form,
        'billing_uuid', o.billing_uuid,
        'billed_at', o.billed_at
      )
      order by o.created_at
    ),
    '[]'::jsonb
  )
  into v_orders
  from public.orders o
  where o.payment_status = 'paid'
    and o.status <> 'cancelled'
    and (o.created_at at time zone 'America/Mexico_City')::date
        between p_start and p_end;

  select jsonb_build_object(
    'orders', count(*),
    'pending_04', count(*) filter (
      where billing_status = 'pending' and sat_payment_form = '04'
    ),
    'total_04', coalesce(sum(total) filter (
      where billing_status = 'pending' and sat_payment_form = '04'
    ), 0),
    'pending_28', count(*) filter (
      where billing_status = 'pending' and sat_payment_form = '28'
    ),
    'total_28', coalesce(sum(total) filter (
      where billing_status = 'pending' and sat_payment_form = '28'
    ), 0),
    'pending_none', count(*) filter (
      where billing_status = 'pending' and sat_payment_form is null
    ),
    'individual', count(*) filter (where billing_status = 'individual'),
    'global', count(*) filter (where billing_status = 'global')
  )
  into v_summary
  from public.orders o
  where o.payment_status = 'paid'
    and o.status <> 'cancelled'
    and (o.created_at at time zone 'America/Mexico_City')::date
        between p_start and p_end;

  return jsonb_build_object(
    'period', jsonb_build_object('start', p_start, 'end', p_end),
    'orders', v_orders,
    'summary', v_summary
  );
end;
$$;

create or replace function public.set_order_billing(
  p_order_id uuid,
  p_status text,
  p_sat_form text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_status not in ('pending', 'individual') then
    raise exception 'Estado de facturación no válido' using errcode = '22023';
  end if;

  if p_sat_form is not null and p_sat_form not in ('04', '28') then
    raise exception 'Forma de pago no válida' using errcode = '22023';
  end if;

  update public.orders
     set billing_status = p_status,
         sat_payment_form = p_sat_form
   where id = p_order_id
     and billing_status <> 'global';

  if not found then
    raise exception 'Pedido no encontrado o ya facturado globalmente'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', p_status,
    'sat_payment_form', p_sat_form
  );
end;
$$;

create or replace function public.create_global_invoice(
  p_start date,
  p_end date,
  p_payment_form text,
  p_uuid text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_count integer;
  v_total integer;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_start is null
     or p_end is null
     or p_end < p_start
     or (p_end - p_start) > 31 then
    raise exception 'Periodo no válido' using errcode = '22023';
  end if;

  if p_payment_form not in ('04', '28') then
    raise exception 'Forma de pago no válida' using errcode = '22023';
  end if;

  if p_uuid is null
     or p_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'UUID no válido' using errcode = '22023';
  end if;

  perform 1
    from public.orders o
   where o.payment_status = 'paid'
     and o.status <> 'cancelled'
     and o.billing_status = 'pending'
     and o.sat_payment_form = p_payment_form
     and (o.created_at at time zone 'America/Mexico_City')::date
         between p_start and p_end
     for update;

  select count(*), coalesce(sum(total), 0)::integer
    into v_count, v_total
    from public.orders o
   where o.payment_status = 'paid'
     and o.status <> 'cancelled'
     and o.billing_status = 'pending'
     and o.sat_payment_form = p_payment_form
     and (o.created_at at time zone 'America/Mexico_City')::date
         between p_start and p_end;

  if v_count = 0 then
    raise exception 'No hay pedidos pendientes con esa forma de pago'
      using errcode = 'P0001';
  end if;

  insert into public.global_invoices (
    period_start, period_end, payment_form, total, uuid, notes
  ) values (
    p_start, p_end, p_payment_form, v_total, p_uuid, left(coalesce(p_notes, ''), 500)
  )
  returning id into v_id;

  insert into public.global_invoice_orders (global_invoice_id, order_id)
  select v_id, o.id
    from public.orders o
   where o.payment_status = 'paid'
     and o.status <> 'cancelled'
     and o.billing_status = 'pending'
     and o.sat_payment_form = p_payment_form
     and (o.created_at at time zone 'America/Mexico_City')::date
         between p_start and p_end;

  update public.orders o
     set billing_status = 'global',
         billing_uuid = p_uuid,
         billed_at = now()
   where o.payment_status = 'paid'
     and o.status <> 'cancelled'
     and o.billing_status = 'pending'
     and o.sat_payment_form = p_payment_form
     and (o.created_at at time zone 'America/Mexico_City')::date
         between p_start and p_end;

  return jsonb_build_object(
    'ok', true,
    'id', v_id,
    'orders', v_count,
    'total', v_total
  );
end;
$$;

revoke all on function public.global_invoice_preview(date, date) from public;
revoke all on function public.global_invoice_preview(date, date) from anon;
grant execute on function public.global_invoice_preview(date, date) to authenticated;

revoke all on function public.set_order_billing(uuid, text, text) from public;
revoke all on function public.set_order_billing(uuid, text, text) from anon;
grant execute on function public.set_order_billing(uuid, text, text) to authenticated;

revoke all on function public.create_global_invoice(date, date, text, text, text) from public;
revoke all on function public.create_global_invoice(date, date, text, text, text) from anon;
grant execute on function public.create_global_invoice(date, date, text, text, text) to authenticated;

commit;
