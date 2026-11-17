-- ---------------------------------------------------------------------------
-- Fase 17: precio por tamaño de impresión y descuentos por volumen
--
-- - printSize: logo (incluido), carta (+$30), doble_carta (+$60)
-- - 12+ piezas: 5%, 24+: 10%, 48+: 15%
-- - pricingGroup permite que una cotización por tallas sume el volumen total.
-- ---------------------------------------------------------------------------

begin;

insert into public.product_prices (product, kind, key, amount) values
  ('hoodie', 'setting', 'print_logo_fee', 0),
  ('hoodie', 'setting', 'print_carta_fee', 30),
  ('hoodie', 'setting', 'print_doble_carta_fee', 60),
  ('hoodie', 'setting', 'tier_1_discount', 0),
  ('hoodie', 'setting', 'tier_12_discount', 5),
  ('hoodie', 'setting', 'tier_24_discount', 10),
  ('hoodie', 'setting', 'tier_48_discount', 15)
on conflict (product, kind, key) do update set amount = excluded.amount;

create or replace function public.item_unit_price(
  p_item jsonb,
  p_qty integer default null
)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_product text := lower(coalesce(nullif(p_item->>'product', ''), 'hoodie'));
  v_qty integer := greatest(1, least(999, coalesce(p_qty, (p_item->>'qty')::int, 1)));
  v_color text := lower(coalesce(p_item->>'colorHex', ''));
  v_material text := nullif(p_item->>'materialId', '');
  v_technique text := nullif(p_item->>'techniqueId', '');
  v_print_size text := lower(coalesce(nullif(p_item->>'printSize', ''), 'logo'));
  v_base integer;
  v_material_delta integer;
  v_technique_fee integer;
  v_print_fee integer := 0;
  v_logo_price integer;
  v_xxl_price integer;
  v_discount_pct integer := 0;
  v_logos integer := 0;
  v_unit integer;
begin
  if v_product not in ('hoodie', 'tote') then
    raise exception 'Producto no válido' using errcode = '22023';
  end if;

  if v_print_size not in ('logo', 'carta', 'doble_carta') then
    raise exception 'Tamaño de impresión no válido' using errcode = '22023';
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
   where product = v_product and kind = 'color' and key = v_color;

  if v_base is null then
    raise exception 'Color no válido' using errcode = '22023';
  end if;

  select amount into v_material_delta
    from public.product_prices
   where product = v_product and kind = 'material' and key = v_material;

  if v_material_delta is null then
    raise exception 'Material no válido' using errcode = '22023';
  end if;

  select amount into v_technique_fee
    from public.product_prices
   where product = v_product and kind = 'technique' and key = v_technique;

  if v_technique_fee is null then
    raise exception 'Técnica no válida' using errcode = '22023';
  end if;

  select amount into v_print_fee
    from public.product_prices
   where kind = 'setting' and key = 'print_' || v_print_size || '_fee'
   limit 1;
  v_print_fee := coalesce(v_print_fee, 0);

  select amount into v_logo_price
    from public.product_prices
   where kind = 'setting' and key = 'logo_price'
   limit 1;

  select amount into v_xxl_price
    from public.product_prices
   where kind = 'setting' and key = 'xxl_price'
   limit 1;

  select amount into v_discount_pct
    from public.product_prices
   where kind = 'setting'
     and key = case
       when v_qty >= 48 then 'tier_48_discount'
       when v_qty >= 24 then 'tier_24_discount'
       when v_qty >= 12 then 'tier_12_discount'
       else 'tier_1_discount'
     end
   limit 1;
  v_discount_pct := coalesce(v_discount_pct, 0);

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

  v_unit := v_base
    + v_material_delta
    + v_technique_fee
    + v_print_fee
    + (v_logos * coalesce(v_logo_price, 99))
    + case when p_item->>'size' = 'XXL' then coalesce(v_xxl_price, 49) else 0 end;

  return greatest(0, round(v_unit * (100 - v_discount_pct) / 100.0)::integer);
end;
$function$;

revoke all on function public.item_unit_price(jsonb, integer) from public;
revoke all on function public.item_unit_price(jsonb, integer) from anon;
revoke all on function public.item_unit_price(jsonb, integer) from authenticated;

-- Elimina la firma antigua de un argumento para evitar ambigüedad.
drop function if exists public.item_unit_price(jsonb);

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
  v_free_shipping integer := 1200;
  v_shipping_cost integer := 99;
  v_payment_method text := 'demo';
  v_payment_status text := 'demo';
  v_order public.orders;
  v_name text;
  v_email text;
  v_phone text;
  v_address text;
  v_address_ref text;
  v_city text;
  v_state text;
  v_zip text;
  v_coupon_code text;
  v_percent integer;
  v_coupon record;
  v_item record;
  v_qty integer;
  v_unit integer;
  v_text_color text;
  v_color_hex text;
  v_group_totals jsonb := '{}'::jsonb;
  v_group text;
  v_group_qty integer;
begin
  if v_uid is null then
    raise exception 'No autenticado' using errcode = '42501';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'El pedido no tiene articulos';
  end if;

  if jsonb_array_length(p_items) = 0 then
    raise exception 'El pedido no tiene articulos';
  end if;

  if jsonb_array_length(p_items) > 50 then
    raise exception 'Demasiados articulos';
  end if;

  if octet_length(p_items::text) > 8388608 then
    raise exception 'El pedido es demasiado grande';
  end if;

  if p_cart_id is not null and not exists (
    select 1 from public.carts where id = p_cart_id and user_id = v_uid
  ) then
    raise exception 'Carrito no valido';
  end if;

  v_name := left(trim(coalesce(p_customer->>'name', '')), 120);
  v_email := lower(left(trim(coalesce(p_customer->>'email', '')), 160));
  v_phone := regexp_replace(coalesce(p_customer->>'phone', ''), '[^0-9]', '', 'g');
  v_address := left(trim(coalesce(p_customer->>'address', '')), 240);
  v_address_ref := left(
    trim(coalesce(p_customer->>'addressRef', p_customer->>'address_ref', '')),
    160
  );
  v_city := left(trim(coalesce(p_customer->>'city', '')), 120);
  v_state := left(trim(coalesce(p_customer->>'state', '')), 80);
  v_zip := regexp_replace(coalesce(p_customer->>'zip', ''), '[^0-9]', '', 'g');

  if length(v_name) = 0 then
    raise exception 'Falta el nombre del cliente';
  end if;

  if v_email !~* '^[A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,}$' then
    raise exception 'Correo electronico no valido';
  end if;

  if length(v_phone) < 10 or length(v_phone) > 15 then
    raise exception 'Telefono no valido: escribe al menos 10 digitos';
  end if;

  if length(v_address) = 0 or length(v_city) = 0 or length(v_state) < 2 then
    raise exception 'Direccion de envio incompleta';
  end if;

  if v_zip !~ '^[0-9]{5}$' then
    raise exception 'Codigo postal no valido: deben ser 5 digitos';
  end if;

  if (
    select count(*) from public.orders
     where user_id = v_uid
       and created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'Demasiados pedidos en poco tiempo. Intentalo mas tarde.'
      using errcode = 'P0001';
  end if;

  if (
    select count(*) from public.orders
     where lower(email) = v_email
       and created_at > now() - interval '1 hour'
  ) >= 3 then
    raise exception 'Demasiados pedidos con este correo. Intentalo mas tarde.'
      using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_group := nullif(v_item.value->>'pricingGroup', '');
    if v_group is not null then
      v_qty := greatest(1, least(99, coalesce((v_item.value->>'qty')::int, 1)));
      v_group_totals := jsonb_set(
        v_group_totals,
        array[v_group],
        to_jsonb(coalesce((v_group_totals->>v_group)::int, 0) + v_qty),
        true
      );
    end if;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if octet_length(v_item.value::text) > 4194304 then
      raise exception 'Un articulo del pedido es demasiado grande';
    end if;

    v_qty := greatest(1, least(99, coalesce((v_item.value->>'qty')::int, 1)));
    v_group := nullif(v_item.value->>'pricingGroup', '');
    v_group_qty := case
      when v_group is null then v_qty
      else coalesce((v_group_totals->>v_group)::int, v_qty)
    end;
    v_unit := public.item_unit_price(v_item.value, v_group_qty);

    if coalesce((v_item.value->>'unitPrice')::int, -1) <> v_unit then
      raise exception 'El precio del pedido no coincide. Recarga la pagina e intentalo de nuevo.'
        using errcode = '22023';
    end if;

    -- Defensa en profundidad: el admin pinta estos valores en atributos style.
    v_color_hex := coalesce(v_item.value->>'colorHex', '');
    if v_color_hex <> '' and v_color_hex !~* '^#[0-9a-f]{6}$' then
      raise exception 'Color de prenda no valido' using errcode = '22023';
    end if;

    v_text_color := coalesce(v_item.value->'front'->>'textColor', '');
    if v_text_color <> '' and v_text_color !~* '^#[0-9a-f]{6}$' then
      raise exception 'Color de texto no valido' using errcode = '22023';
    end if;

    v_text_color := coalesce(v_item.value->'back'->>'textColor', '');
    if v_text_color <> '' and v_text_color !~* '^#[0-9a-f]{6}$' then
      raise exception 'Color de texto no valido' using errcode = '22023';
    end if;

    v_subtotal := v_subtotal + (v_unit * v_qty);
    v_count := v_count + v_qty;
  end loop;

  if v_subtotal <= 0 then
    raise exception 'El pedido no tiene un total valido';
  end if;

  -- Cupon validado en servidor.
  if nullif(trim(coalesce(p_coupon, '')), '') is not null then
    v_coupon_code := upper(left(trim(p_coupon), 32));

    select * into v_coupon
      from public.coupons
     where code = v_coupon_code
       and active = true
       and (expires_at is null or expires_at > now())
       and (max_uses is null or used_count < max_uses)
     for update;

    if found then
      v_percent := greatest(0, least(100, v_coupon.percent));
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

  v_total := greatest(0, v_subtotal - v_discount + v_shipping);

  if exists (
    select 1 from public.store_settings
     where key = 'clip_enabled' and value = 'true'
  ) then
    v_payment_method := 'clip';
    v_payment_status := 'pending';
  end if;

  insert into public.orders (
    user_id, cart_id, status, customer_name, email, phone, address, address_ref,
    city, state, zip, notes, items, item_count, subtotal, shipping, discount,
    coupon, total, payment_method, payment_status
  ) values (
    v_uid, p_cart_id, 'pending', v_name, v_email, v_phone, v_address,
    nullif(v_address_ref, ''), v_city, v_state, v_zip,
    left(coalesce(p_notes, ''), 500), p_items, v_count, v_subtotal, v_shipping,
    v_discount, v_coupon_code, v_total, v_payment_method, v_payment_status
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
    'coupon', v_coupon_code,
    'payment_method', v_payment_method,
    'payment_status', v_payment_status
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
