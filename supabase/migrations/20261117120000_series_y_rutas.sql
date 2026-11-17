-- Q-09: la serie de 14 días contaba pedidos demo y pendientes, mientras los
-- KPIs solo cuentan pagados. Se alinea con el resto del panel.
--
-- Q-06: las políticas de order-logos aceptaban nombres con ".." o barras
-- iniciales siempre que el primer componente fuera el UID. Ahora rechazan
-- cualquier ruta que pueda escapar de la carpeta del usuario.
--
-- Idempotente.

create or replace function public.admin_stats(p_days integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(1, least(coalesce(p_days, 30), 365));
  v_start timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)));
  v_today timestamptz := date_trunc('day', now() at time zone 'America/Mexico_City') at time zone 'America/Mexico_City';
  v_orders_today bigint;
  v_revenue_today bigint;
  v_orders_range bigint;
  v_revenue_range bigint;
  v_orders_7 bigint;
  v_revenue_7 bigint;
  v_orders_30 bigint;
  v_revenue_30 bigint;
  v_aov numeric;
  v_carts_open bigint;
  v_carts_abandoned bigint;
  v_carts_range bigint;
  v_carts_converted bigint;
  v_conversion numeric;
  v_series jsonb;
  v_colors jsonb;
  v_materials jsonb;
  v_techniques jsonb;
  v_sizes jsonb;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select count(*), coalesce(sum(total), 0)::bigint
    into v_orders_today, v_revenue_today
    from public.orders
    where status <> 'cancelled' and payment_status = 'paid' and created_at >= v_today;

  select count(*), coalesce(sum(total), 0)::bigint
    into v_orders_range, v_revenue_range
    from public.orders
    where status <> 'cancelled' and payment_status = 'paid' and created_at >= v_start;

  select count(*), coalesce(sum(total), 0)::bigint
    into v_orders_7, v_revenue_7
    from public.orders
    where status <> 'cancelled' and payment_status = 'paid' and created_at >= now() - interval '7 days';

  select count(*), coalesce(sum(total), 0)::bigint
    into v_orders_30, v_revenue_30
    from public.orders
    where status <> 'cancelled' and payment_status = 'paid' and created_at >= now() - interval '30 days';

  v_aov := case when v_orders_30 > 0 then round(v_revenue_30::numeric / v_orders_30, 0) else 0 end;

  select count(*) into v_carts_open
    from public.carts
    where status = 'open' and item_count > 0 and updated_at >= now() - interval '60 minutes';

  select count(*) into v_carts_abandoned
    from public.carts
    where status = 'open' and item_count > 0 and updated_at < now() - interval '60 minutes';

  select count(*) into v_carts_range
    from public.carts
    where created_at >= v_start and item_count > 0;

  select count(*) into v_carts_converted
    from public.carts
    where status = 'converted' and updated_at >= v_start;

  v_conversion := case when v_carts_range > 0 then round((v_orders_range::numeric / v_carts_range) * 100, 1) else 0 end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'day', to_char(day, 'YYYY-MM-DD'),
    'orders', orders_count,
    'revenue', revenue
  ) order by day), '[]'::jsonb)
  into v_series
  from (
    select d.day,
           count(o.id) as orders_count,
           coalesce(sum(o.total), 0)::bigint as revenue
    from generate_series(v_today - interval '13 days', v_today, interval '1 day') as d(day)
    left join public.orders o
      on o.created_at >= d.day
     and o.created_at < d.day + interval '1 day'
     and o.status <> 'cancelled'
     and o.payment_status = 'paid'
    group by d.day
  ) s;

  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc), '[]'::jsonb)
  into v_colors
  from (
    select item->>'colorName' as label, count(*) as n
    from public.orders o, jsonb_array_elements(o.items) item
    where o.status <> 'cancelled' and o.payment_status = 'paid' and o.created_at >= v_start
      and coalesce(item->>'colorName', '') <> ''
    group by 1 order by n desc limit 5
  ) c;

  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc), '[]'::jsonb)
  into v_materials
  from (
    select item->>'materialName' as label, count(*) as n
    from public.orders o, jsonb_array_elements(o.items) item
    where o.status <> 'cancelled' and o.payment_status = 'paid' and o.created_at >= v_start
      and coalesce(item->>'materialName', '') <> ''
    group by 1 order by n desc limit 5
  ) c;

  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc), '[]'::jsonb)
  into v_techniques
  from (
    select item->>'techniqueName' as label, count(*) as n
    from public.orders o, jsonb_array_elements(o.items) item
    where o.status <> 'cancelled' and o.payment_status = 'paid' and o.created_at >= v_start
      and coalesce(item->>'techniqueName', '') <> ''
    group by 1 order by n desc limit 5
  ) c;

  select coalesce(jsonb_agg(jsonb_build_object('label', label, 'count', n) order by n desc), '[]'::jsonb)
  into v_sizes
  from (
    select item->>'size' as label, count(*) as n
    from public.orders o, jsonb_array_elements(o.items) item
    where o.status <> 'cancelled' and o.payment_status = 'paid' and o.created_at >= v_start
      and coalesce(item->>'size', '') <> ''
    group by 1 order by n desc limit 5
  ) c;

  return jsonb_build_object(
    'range_days', v_days,
    'orders_today', v_orders_today,
    'revenue_today', v_revenue_today,
    'orders_range', v_orders_range,
    'revenue_range', v_revenue_range,
    'orders_7', v_orders_7,
    'revenue_7', v_revenue_7,
    'orders_30', v_orders_30,
    'revenue_30', v_revenue_30,
    'aov_30', v_aov,
    'carts_open', v_carts_open,
    'carts_abandoned', v_carts_abandoned,
    'carts_range', v_carts_range,
    'carts_converted', v_carts_converted,
    'conversion', v_conversion,
    'series', v_series,
    'top_colors', v_colors,
    'top_materials', v_materials,
    'top_techniques', v_techniques,
    'top_sizes', v_sizes
  );
end;
$$;

revoke all on function public.admin_stats(integer) from public;
grant execute on function public.admin_stats(integer) to authenticated;

drop policy if exists "order_logos_insert_own" on storage.objects;
create policy "order_logos_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'order-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name not like '%..%'
    and name not like '/%'
    and position('\' in name) = 0
    and position('//' in name) = 0
  );

drop policy if exists "order_logos_select_own" on storage.objects;
create policy "order_logos_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'order-logos'
    and (
      (
        (storage.foldername(name))[1] = auth.uid()::text
        and name not like '%..%'
        and name not like '/%'
        and position('\' in name) = 0
        and position('//' in name) = 0
      )
      or public.is_admin()
    )
  );

drop policy if exists "order_logos_delete_own" on storage.objects;
create policy "order_logos_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'order-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name not like '%..%'
    and name not like '/%'
    and position('\' in name) = 0
    and position('//' in name) = 0
  );
