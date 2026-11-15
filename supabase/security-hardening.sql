-- like hoodie ♡ — endurecimiento de seguridad
-- Aplica precios autoritativos, límites de pedidos y permisos mínimos.
-- Ejecutar en Supabase → SQL Editor después de schema.sql.

-- ---------------------------------------------------------------------------
-- Precios autoritativos (solo los lee el servidor)
-- ---------------------------------------------------------------------------

create table if not exists public.product_prices (
  product text not null default 'hoodie' check (product in ('hoodie', 'tote')),
  kind text not null check (kind in ('color', 'material', 'technique', 'setting')),
  key text not null,
  amount integer not null,
  primary key (product, kind, key)
);

-- Compatibilidad con instalaciones anteriores que no tenían `product`.
alter table public.product_prices
  add column if not exists product text not null default 'hoodie';

do $$
declare
  v_cols text;
begin
  select string_agg(a.attname, ',' order by a.attname)
    into v_cols
    from pg_constraint c
    join unnest(c.conkey) k(attnum) on true
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = k.attnum
   where c.conrelid = 'public.product_prices'::regclass
     and c.contype = 'p';

  if v_cols is null or position('product' in v_cols) = 0 then
    alter table public.product_prices
      drop constraint if exists product_prices_pkey;
    alter table public.product_prices
      add constraint product_prices_pkey primary key (product, kind, key);
  end if;
end
$$;

insert into public.product_prices (product, kind, key, amount) values
  -- Sudadera
  ('hoodie', 'color', '#1c1c1f', 899),
  ('hoodie', 'color', '#ffffff', 949),
  ('hoodie', 'color', '#efe6d6', 949),
  ('hoodie', 'color', '#cdf25a', 969),
  ('hoodie', 'color', '#f2603c', 949),
  ('hoodie', 'color', '#26324f', 899),
  ('hoodie', 'color', '#efb7c4', 899),
  ('hoodie', 'material', 'cotton400', 0),
  ('hoodie', 'material', 'cotton320', -50),
  ('hoodie', 'material', 'french300', -30),
  ('hoodie', 'material', 'blend350', -20),
  ('hoodie', 'material', 'polyester280', 20),
  ('hoodie', 'technique', 'dtg', 0),
  ('hoodie', 'technique', 'dtf', 39),
  ('hoodie', 'technique', 'bordado', 149),
  ('hoodie', 'technique', 'serigrafia', 129),
  ('hoodie', 'technique', 'vinilo', 49),
  ('hoodie', 'technique', 'sublimacion', 49),
  -- Tote
  ('tote', 'color', '#efe6d6', 349),
  ('tote', 'color', '#ffffff', 379),
  ('tote', 'color', '#1c1c1f', 379),
  ('tote', 'color', '#cdf25a', 379),
  ('tote', 'color', '#f2603c', 379),
  ('tote', 'color', '#26324f', 379),
  ('tote', 'color', '#efb7c4', 379),
  ('tote', 'material', 'loneta12', 0),
  ('tote', 'material', 'loneta10', -40),
  ('tote', 'material', 'reciclada', 30),
  ('tote', 'technique', 'dtf', 0),
  ('tote', 'technique', 'serigrafia', 129),
  ('tote', 'technique', 'vinilo', 49),
  ('tote', 'technique', 'bordado', 99),
  -- Ajustes globales
  ('hoodie', 'setting', 'logo_price', 99),
  ('hoodie', 'setting', 'xxl_price', 49),
  ('hoodie', 'setting', 'free_shipping', 1200),
  ('hoodie', 'setting', 'shipping', 99)
on conflict (product, kind, key) do update set amount = excluded.amount;

alter table public.product_prices enable row level security;
revoke all on table public.product_prices from anon, authenticated;

-- Configuración de la tienda (pago demo o Clip). Solo la lee el servidor.
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

create or replace function public.item_unit_price(p_item jsonb)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_product text := lower(coalesce(nullif(p_item->>'product', ''), 'hoodie'));
  v_color text := lower(coalesce(p_item->>'colorHex', ''));
  v_material text := nullif(p_item->>'materialId', '');
  v_technique text := nullif(p_item->>'techniqueId', '');
  v_base integer;
  v_material_delta integer;
  v_technique_fee integer;
  v_logo_price integer;
  v_xxl_price integer;
  v_logos integer := 0;
begin
  if v_product not in ('hoodie', 'tote') then
    raise exception 'Producto no válido' using errcode = '22023';
  end if;

  if v_material is null then
    v_material := case p_item->>'materialName'
      when 'Algodón 400 g' then 'cotton400'
      when 'Algodón 320 g' then 'cotton320'
      when 'French terry 300 g' then 'french300'
      when 'French terry' then 'french300'
      when 'Mezcla 50/50' then 'blend350'
      when 'Poliéster técnico' then 'polyester280'
      when 'Loneta 12 oz' then 'loneta12'
      when 'Loneta 10 oz' then 'loneta10'
      when 'Lona reciclada' then 'reciclada'
      else null
    end;
  end if;

  if v_technique is null then
    v_technique := case p_item->>'techniqueName'
      when 'DTG' then 'dtg'
      when 'DTF' then 'dtf'
      when 'Bordado' then 'bordado'
      when 'Serigrafía' then 'serigrafia'
      when 'Vinilo textil' then 'vinilo'
      when 'Sublimación' then 'sublimacion'
      else null
    end;
  end if;

  select amount into v_base
    from public.product_prices
   where product = v_product
     and kind = 'color'
     and key = v_color;

  if v_base is null then
    raise exception 'Color no válido' using errcode = '22023';
  end if;

  select amount into v_material_delta
    from public.product_prices
   where product = v_product
     and kind = 'material'
     and key = v_material;

  if v_material_delta is null then
    raise exception 'Material no válido' using errcode = '22023';
  end if;

  select amount into v_technique_fee
    from public.product_prices
   where product = v_product
     and kind = 'technique'
     and key = v_technique;

  if v_technique_fee is null then
    raise exception 'Técnica no válida' using errcode = '22023';
  end if;

  select amount into v_logo_price
    from public.product_prices
   where kind = 'setting' and key = 'logo_price'
   limit 1;

  select amount into v_xxl_price
    from public.product_prices
   where kind = 'setting' and key = 'xxl_price'
   limit 1;

  if coalesce(p_item->'front'->>'logoName', '') <> ''
     or coalesce(p_item->'front'->>'logoPath', '') <> ''
     or coalesce(p_item->'front'->>'logoData', '') <> '' then
    v_logos := v_logos + 1;
  end if;

  if coalesce(p_item->'back'->>'logoName', '') <> ''
     or coalesce(p_item->'back'->>'logoPath', '') <> ''
     or coalesce(p_item->'back'->>'logoData', '') <> '' then
    v_logos := v_logos + 1;
  end if;

  return v_base
    + v_material_delta
    + v_technique_fee
    + (v_logos * coalesce(v_logo_price, 99))
    + case when p_item->>'size' = 'XXL' then coalesce(v_xxl_price, 49) else 0 end;
end;
$function$;

revoke all on function public.item_unit_price(jsonb) from public;
revoke all on function public.item_unit_price(jsonb) from anon;
revoke all on function public.item_unit_price(jsonb) from authenticated;

-- ---------------------------------------------------------------------------
-- place_order: precio autoritativo, email válido y límites antiabuso
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
-- Permisos mínimos de funciones administrativas
-- ---------------------------------------------------------------------------

revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

revoke all on function public.admin_stats(integer) from public;
revoke all on function public.admin_stats(integer) from anon;
grant execute on function public.admin_stats(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: permitir borrar solo los logos propios o desde administración
-- ---------------------------------------------------------------------------

drop policy if exists "order_logos_delete_own" on storage.objects;
create policy "order_logos_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'order-logos'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- Seguridad: elimina la version antigua de place_order (4 argumentos).
-- La unica version valida es la de fase1-pedidos-seguros.sql (5 argumentos,
-- precio de servidor). Asi, reejecutar este archivo no reabre el agujero.
drop function if exists public.place_order(jsonb, jsonb, uuid, text);
