-- like hoodie ♡ — pagos con Clip
-- Prepara pedidos, configuración y estados de pago.
-- Ejecutar en Supabase → SQL Editor después de security-hardening.sql.

begin;

-- ---------------------------------------------------------------------------
-- Configuración de la tienda (solo la lee el servidor)
-- ---------------------------------------------------------------------------

create table if not exists public.store_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);

alter table public.store_settings enable row level security;
revoke all on table public.store_settings from anon, authenticated;

insert into public.store_settings (key, value)
values ('clip_enabled', 'false')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Datos de pago en los pedidos
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists clip_checkout_id text,
  add column if not exists clip_checkout_url text,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_reference text;

create unique index if not exists orders_clip_checkout_id_key
  on public.orders (clip_checkout_id)
  where clip_checkout_id is not null;

create index if not exists orders_payment_status_idx
  on public.orders (payment_status, created_at desc);

-- ---------------------------------------------------------------------------
-- place_order: mismo cálculo autoritativo + método de pago definido en servidor
-- ---------------------------------------------------------------------------

create or replace function public.place_order(
  p_customer jsonb,
  p_items jsonb,
  p_cart_id uuid default null,
  p_notes text default ''
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
  v_total integer := 0;
  v_free_shipping integer := 1200;
  v_shipping_cost integer := 99;
  v_payment_method text := 'demo';
  v_payment_status text := 'demo';
  v_order public.orders;
  v_name text;
  v_email text;
  v_item record;
  v_qty integer;
  v_unit integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'El pedido no tiene artículos';
  end if;

  if jsonb_array_length(p_items) = 0 then
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

  if length(trim(v_name)) = 0 then
    raise exception 'Faltan datos del cliente';
  end if;

  if v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'Correo electrónico no válido';
  end if;

  if (
    select count(*) from public.orders
     where user_id = v_uid
       and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Demasiados pedidos en poco tiempo. Inténtalo más tarde.' using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.orders
     where lower(email) = lower(v_email)
       and created_at > now() - interval '1 hour'
  ) >= 3 then
    raise exception 'Demasiados pedidos con este correo. Inténtalo más tarde.' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, least(99, coalesce((v_item.value->>'qty')::int, 1)));
    v_unit := public.item_unit_price(v_item.value);

    if coalesce((v_item.value->>'unitPrice')::int, -1) <> v_unit then
      raise exception 'El precio del pedido no coincide. Recarga la página e inténtalo de nuevo.' using errcode = '22023';
    end if;

    v_subtotal := v_subtotal + (v_unit * v_qty);
    v_count := v_count + v_qty;
  end loop;

  if v_subtotal <= 0 then
    raise exception 'El pedido no tiene un total válido';
  end if;

  select amount into v_free_shipping
    from public.product_prices
   where kind = 'setting' and key = 'free_shipping';

  select amount into v_shipping_cost
    from public.product_prices
   where kind = 'setting' and key = 'shipping';

  v_shipping := case
    when v_subtotal >= coalesce(v_free_shipping, 1200) or v_subtotal = 0 then 0
    else coalesce(v_shipping_cost, 99)
  end;
  v_total := v_subtotal + v_shipping;

  if exists (
    select 1 from public.store_settings
     where key = 'clip_enabled' and value = 'true'
  ) then
    v_payment_method := 'clip';
    v_payment_status := 'pending';
  end if;

  insert into public.orders (
    user_id, cart_id, status, customer_name, email, phone, address, city, zip,
    notes, items, item_count, subtotal, shipping, total, payment_method, payment_status
  ) values (
    v_uid, p_cart_id, 'pending', v_name, v_email,
    left(coalesce(p_customer->>'phone', ''), 40),
    left(coalesce(p_customer->>'address', ''), 240),
    left(coalesce(p_customer->>'city', ''), 120),
    left(coalesce(p_customer->>'zip', ''), 20),
    left(coalesce(p_notes, ''), 500),
    p_items, v_count, v_subtotal, v_shipping, v_total, v_payment_method, v_payment_status
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
    'payment_method', v_payment_method,
    'payment_status', v_payment_status
  );
end;
$$;

revoke all on function public.place_order(jsonb, jsonb, uuid, text) from public;
revoke all on function public.place_order(jsonb, jsonb, uuid, text) from anon;
grant execute on function public.place_order(jsonb, jsonb, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Configuración pública mínima para la tienda (sin secretos)
-- ---------------------------------------------------------------------------

create or replace function public.store_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'payment_provider',
    case when exists (
      select 1 from public.store_settings
       where key = 'clip_enabled' and value = 'true'
    ) then 'clip' else 'demo' end
  );
$$;

revoke all on function public.store_config() from public;
grant execute on function public.store_config() to anon, authenticated;

commit;
