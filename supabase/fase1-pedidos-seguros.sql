-- ---------------------------------------------------------------------------
-- Fase 1: pedidos con precio de servidor y datos de envío completos
--
-- 1. Una sola version de place_order (5 argumentos, con cupon).
-- 2. El precio se recalcula con item_unit_price(); nunca se confia en el
--    unitPrice del navegador.
-- 3. Se validan correo, telefono, direccion, estado y codigo postal.
-- 4. Se guardan state y address_ref para poder generar la guia de envio.
-- 5. Se cierra la lectura publica de la tabla coupons: solo check_coupon().
--
-- Ejecutar con:
--   npx supabase db query --remote --file supabase/fase1-pedidos-seguros.sql --yes
-- ---------------------------------------------------------------------------

begin;

-- Datos que faltaban para enviar un pedido en Mexico.
alter table public.orders
  add column if not exists state text,
  add column if not exists address_ref text;

-- Eliminar cualquier sobrecarga antigua (incluida la que confiaba en unitPrice).
drop function if exists public.place_order(jsonb, jsonb, uuid, text);
drop function if exists public.place_order(jsonb, jsonb, uuid, text, text);

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
    v_qty := greatest(1, least(99, coalesce((v_item.value->>'qty')::int, 1)));
    v_unit := public.item_unit_price(v_item.value);

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

revoke all on function public.place_order(jsonb, jsonb, uuid, text, text) from public;
revoke all on function public.place_order(jsonb, jsonb, uuid, text, text) from anon;
grant execute on function public.place_order(jsonb, jsonb, uuid, text, text)
  to authenticated, service_role;

-- La tabla de cupones deja de ser legible desde el navegador.
drop policy if exists "coupons_read_active" on public.coupons;
revoke select on public.coupons from anon, authenticated;

commit;
