-- ---------------------------------------------------------------------------
-- Fase 4: límites y retención de las funciones públicas
--
-- 1. El seguimiento deja de ser RPC público y pasa por una Edge Function con
--    rate limit por IP.
-- 2. Se limita globalmente el volumen de client_errors.
-- 3. Se programa una limpieza diaria de errores, eventos y attempts.
-- ---------------------------------------------------------------------------

begin;

create table if not exists public.order_lookup_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists order_lookup_attempts_ip_idx
  on public.order_lookup_attempts (ip_hash, created_at desc);

create table if not exists public.client_error_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists client_error_attempts_ip_idx
  on public.client_error_attempts (ip_hash, created_at desc);

alter table public.order_lookup_attempts enable row level security;
alter table public.client_error_attempts enable row level security;

-- Solo service_role (Edge Functions) puede usarlas.
revoke all on public.order_lookup_attempts from anon, authenticated;
revoke all on public.client_error_attempts from anon, authenticated;
grant all on public.order_lookup_attempts to service_role;
grant all on public.client_error_attempts to service_role;

-- El RPC deja de ser público: la Edge Function usa service_role.
create or replace function public.get_order_status(
  p_number bigint,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_items jsonb;
begin
  if p_number is null
     or p_number < 1
     or length(v_email) < 5
     or length(v_email) > 160 then
    return jsonb_build_object('found', false);
  end if;

  select * into v_order
    from public.orders
   where number = p_number
     and lower(email) = v_email
   limit 1;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', left(coalesce(item->>'name', 'Sudadera'), 120),
        'qty', greatest(1, least(99, coalesce((item->>'qty')::int, 1))),
        'size', left(coalesce(item->>'size', ''), 10),
        'color', left(coalesce(item->>'colorName', ''), 40)
      )
    ),
    '[]'::jsonb
  )
  into v_items
  from jsonb_array_elements(v_order.items) as item;

  return jsonb_build_object(
    'found', true,
    'number', v_order.number,
    'status', v_order.status,
    'payment_status', v_order.payment_status,
    'created_at', v_order.created_at,
    'updated_at', v_order.updated_at,
    'item_count', v_order.item_count,
    'total', v_order.total,
    'carrier', v_order.carrier,
    'tracking_number', v_order.tracking_number,
    'tracking_url', v_order.tracking_url,
    'items', v_items
  );
end;
$$;

revoke all on function public.get_order_status(bigint, text) from public;
revoke all on function public.get_order_status(bigint, text) from anon;
revoke all on function public.get_order_status(bigint, text) from authenticated;
grant execute on function public.get_order_status(bigint, text) to service_role;

-- Límite global adicional para la vía autenticada de client_errors.
create or replace function public.log_client_error(
  p_message text,
  p_source text default '',
  p_stack text default '',
  p_path text default '',
  p_user_agent text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
  v_global integer;
begin
  if v_uid is null then
    return false;
  end if;

  if length(trim(coalesce(p_message, ''))) = 0 then
    return false;
  end if;

  select count(*) into v_count
    from public.client_errors
   where user_id = v_uid
     and created_at > now() - interval '1 hour';

  if v_count >= 30 then
    return false;
  end if;

  select count(*) into v_global
    from public.client_errors
   where created_at > now() - interval '1 hour';

  if v_global >= 2000 then
    return false;
  end if;

  insert into public.client_errors (
    user_id, message, source, stack, path, user_agent
  ) values (
    v_uid,
    left(coalesce(p_message, ''), 500),
    left(coalesce(p_source, ''), 200),
    left(coalesce(p_stack, ''), 2000),
    left(coalesce(p_path, ''), 180),
    left(coalesce(p_user_agent, ''), 200)
  );

  return true;
end;
$$;

revoke all on function public.log_client_error(text, text, text, text, text) from public;
grant execute on function public.log_client_error(text, text, text, text, text)
  to authenticated;

create or replace function public.cleanup_monitoring()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.client_errors
   where created_at < now() - interval '90 days';

  delete from public.events
   where created_at < now() - interval '365 days';

  delete from public.order_lookup_attempts
   where created_at < now() - interval '2 days';

  delete from public.client_error_attempts
   where created_at < now() - interval '2 days';

  delete from public.carts
   where status in ('open', 'empty')
     and updated_at < now() - interval '180 days';
end;
$$;

revoke all on function public.cleanup_monitoring() from public;
grant execute on function public.cleanup_monitoring() to service_role;

-- Limpieza diaria a las 04:15 UTC.
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'likehoodie-cleanup') then
    perform cron.unschedule('likehoodie-cleanup');
  end if;
end
$$;

select cron.schedule(
  'likehoodie-cleanup',
  '15 4 * * *',
  $$select public.cleanup_monitoring();$$
);

commit;
