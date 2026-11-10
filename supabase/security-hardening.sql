-- like hoodie ♡ — endurecimiento de seguridad
-- Aplica precios autoritativos, límites de pedidos y permisos mínimos.
-- Ejecutar en Supabase → SQL Editor después de schema.sql.

-- ---------------------------------------------------------------------------
-- Precios autoritativos (solo los lee el servidor)
-- ---------------------------------------------------------------------------

create table if not exists public.product_prices (
  kind text not null check (kind in ('color', 'material', 'technique', 'setting')),
  key text not null,
  amount integer not null,
  primary key (kind, key)
);

insert into public.product_prices (kind, key, amount) values
  ('color', '#1c1c1f', 899),
  ('color', '#efe6d6', 949),
  ('color', '#cdf25a', 969),
  ('color', '#f2603c', 949),
  ('color', '#26324f', 899),
  ('color', '#efb7c4', 899),
  ('material', 'cotton400', 0),
  ('material', 'cotton320', -50),
  ('material', 'french300', -30),
  ('material', 'blend350', -20),
  ('material', 'polyester280', 20),
  ('technique', 'dtg', 0),
  ('technique', 'dtf', 39),
  ('technique', 'bordado', 149),
  ('technique', 'serigrafia', 129),
  ('technique', 'vinilo', 49),
  ('technique', 'sublimacion', 49),
  ('setting', 'logo_price', 99),
  ('setting', 'xxl_price', 49),
  ('setting', 'free_shipping', 1200),
  ('setting', 'shipping', 99)
on conflict (kind, key) do update set amount = excluded.amount;

alter table public.product_prices enable row level security;
revoke all on table public.product_prices from anon, authenticated;

create or replace function public.item_unit_price(p_item jsonb)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
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
  if v_material is null then
    v_material := case p_item->>'materialName'
      when 'Algodón 400 g' then 'cotton400'
      when 'Algodón 320 g' then 'cotton320'
      when 'French terry 300 g' then 'french300'
      when 'French terry' then 'french300'
      when 'Mezcla 50/50' then 'blend350'
      when 'Poliéster técnico' then 'polyester280'
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
   where kind = 'color' and key = v_color;

  if v_base is null then
    raise exception 'Color no válido' using errcode = '22023';
  end if;

  select amount into v_material_delta
    from public.product_prices
   where kind = 'material' and key = v_material;

  if v_material_delta is null then
    raise exception 'Material no válido' using errcode = '22023';
  end if;

  select amount into v_technique_fee
    from public.product_prices
   where kind = 'technique' and key = v_technique;

  if v_technique_fee is null then
    raise exception 'Técnica no válida' using errcode = '22023';
  end if;

  select amount into v_logo_price
    from public.product_prices
   where kind = 'setting' and key = 'logo_price';

  select amount into v_xxl_price
    from public.product_prices
   where kind = 'setting' and key = 'xxl_price';

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
    p_items, v_count, v_subtotal, v_shipping, v_total, 'demo', 'demo'
  )
  returning * into v_order;

  if p_cart_id is not null then
    update public.carts
      set status = 'converted'
      where id = p_cart_id and user_id = v_uid;
  end if;

  return jsonb_build_object('id', v_order.id, 'number', v_order.number);
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
