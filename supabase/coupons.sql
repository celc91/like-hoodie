-- AVISO: la versión de place_order definida más abajo es antigua y confiaba
-- en el unitPrice del navegador. No la ejecutes en producción sin aplicar
-- después supabase/fase1-pedidos-seguros.sql, que instala la versión segura.

-- Cupones de descuento + aplicación segura en el servidor
-- Ejecuta esto en Supabase → SQL Editor → Run

-- 1) Tabla de cupones
create table if not exists public.coupons (
  code text primary key,
  percent integer not null check (percent between 1 and 100),
  active boolean not null default true,
  max_uses integer,
  used_count integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.coupons enable row level security;

drop policy if exists "coupons_read_active" on public.coupons;
create policy "coupons_read_active"
  on public.coupons
  for select
  to anon, authenticated
  using (active = true);

grant select on public.coupons to anon, authenticated;

insert into public.coupons (code, percent)
values ('BIENVENIDA10', 10)
on conflict (code) do nothing;

-- 2) Columnas nuevas en los pedidos
alter table public.orders add column if not exists discount integer not null default 0;
alter table public.orders add column if not exists coupon text;

-- 3) place_order con cupón (el servidor recalcula todo; el cliente no decide precios)
drop function if exists public.place_order(jsonb, jsonb, uuid, text);

create or replace function public.place_order(
  p_customer jsonb,
  p_items jsonb,
  p_cart_id uuid default null,
  p_notes text default '',
  p_coupon text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer := 0;
  v_subtotal integer := 0;
  v_shipping integer := 0;
  v_discount integer := 0;
  v_total integer := 0;
  v_order public.orders;
  v_name text;
  v_email text;
  v_coupon_code text;
  v_percent integer;
  v_coupon record;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene artículos';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'Demasiados artículos';
  end if;

  if p_cart_id is not null and not exists (
    select 1 from public.carts where id = p_cart_id and user_id = v_uid
  ) then
    raise exception 'Carrito no válido';
  end if;

  v_name := left(coalesce(p_customer->>'name', ''), 120);
  v_email := left(coalesce(p_customer->>'email', ''), 160);

  if length(trim(v_name)) = 0 or length(trim(v_email)) = 0 then
    raise exception 'Faltan datos del cliente';
  end if;

  select
    coalesce(sum(
      greatest(1, least(99, coalesce((item->>'qty')::int, 1))) *
      greatest(0, coalesce((item->>'unitPrice')::int, 0))
    ), 0)::integer,
    coalesce(sum(greatest(1, least(99, coalesce((item->>'qty')::int, 1)))), 0)::integer
  into v_subtotal, v_count
  from jsonb_array_elements(p_items) as item;

  v_shipping := case when v_subtotal >= 1200 or v_subtotal = 0 then 0 else 99 end;

  -- cupón: se valida aquí, no en el navegador
  if p_coupon is not null and length(trim(p_coupon)) > 0 then
    v_coupon_code := upper(trim(p_coupon));

    select * into v_coupon
    from public.coupons
    where code = v_coupon_code
      and active = true
      and (expires_at is null or expires_at > now())
      and (max_uses is null or used_count < max_uses)
    for update;

    if found then
      v_percent := v_coupon.percent;
      v_discount := round(v_subtotal * v_percent / 100.0)::integer;
      if v_discount > v_subtotal then
        v_discount := v_subtotal;
      end if;

      update public.coupons
        set used_count = used_count + 1
        where code = v_coupon_code;
    else
      v_coupon_code := null;
    end if;
  end if;

  v_total := greatest(0, v_subtotal - v_discount + v_shipping);

  insert into public.orders (
    user_id, cart_id, status, customer_name, email, phone, address, city, zip,
    notes, items, item_count, subtotal, shipping, total, discount, coupon,
    payment_method, payment_status
  ) values (
    v_uid, p_cart_id, 'pending', v_name, v_email,
    left(coalesce(p_customer->>'phone', ''), 40),
    left(coalesce(p_customer->>'address', ''), 240),
    left(coalesce(p_customer->>'city', ''), 120),
    left(coalesce(p_customer->>'zip', ''), 20),
    left(coalesce(p_notes, ''), 500),
    p_items, v_count, v_subtotal, v_shipping, v_total, v_discount, v_coupon_code,
    'demo', 'demo'
  )
  returning * into v_order;

  if p_cart_id is not null then
    update public.carts
      set status = 'converted'
      where id = p_cart_id and user_id = v_uid;
  end if;

  return jsonb_build_object(
    'id', v_order.id,
    'number', v_order.number,
    'subtotal', v_subtotal,
    'discount', v_discount,
    'shipping', v_shipping,
    'total', v_total,
    'coupon', v_coupon_code
  );
end;
$$;

grant execute on function public.place_order(jsonb, jsonb, uuid, text, text) to authenticated;

-- Para desactivar el código:
-- update public.coupons set active = false where code = 'BIENVENIDA10';
