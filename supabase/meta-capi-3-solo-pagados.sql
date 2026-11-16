-- Meta Conversions API · PASO 3
-- Solo se envía Purchase cuando el pedido está realmente cobrado.
--
-- Por qué:
--   · place_order crea el pedido con payment_status 'demo' (sin Clip) o
--     'pending' (con Clip). El disparador anterior enviaba Purchase al
--     insertar, así que cada pedido de demostración contaba como venta en
--     Meta y contaminaba la optimización de anuncios.
--   · Ahora el disparador escucha INSERT y UPDATE de payment_status, y solo
--     envía cuando el valor es 'paid'. Un pedido demo nunca llega a 'paid'.
--
-- Requiere haber ejecutado meta-capi-2-compra.sql antes (token en Vault).
--
-- Nota: si algún día se activan las llaves de prueba de Clip (test_), esos
-- cobros también quedarían como 'paid'. Antes de probar pagos reales, usa un
-- pedido demo o desactiva temporalmente el token de Vault.

create or replace function public.notify_meta_purchase()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault, extensions
as $fn$
declare
  v_token text;
  v_granted boolean;
  v_ip text;
  v_ua text;
  v_email text;
  v_phone text;
  v_user jsonb;
  v_contents jsonb := '[]'::jsonb;
  v_line jsonb;
  v_sku text;
  v_qty integer;
  v_price numeric;
begin
  -- 0. Solo compras cobradas, y solo la primera vez que pasan a 'paid'.
  if new.payment_status is distinct from 'paid' then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.payment_status is not distinct from 'paid' then
    return new;
  end if;

  -- 1. ¿Hay token configurado?
  select decrypted_secret into v_token
    from vault.decrypted_secrets
   where name = 'meta_capi_token'
   limit 1;

  if v_token is null then
    return new;
  end if;

  -- 2. ¿Esta persona aceptó publicidad? Si no, no se envía nada.
  if new.user_id is null then
    return new;
  end if;

  select granted into v_granted
    from public.ad_consent
   where user_id = new.user_id;

  if not coalesce(v_granted, false) then
    return new;
  end if;

  -- 3. Contenido del pedido: mismo id que usa el navegador (sku).
  for v_line in
    select value from jsonb_array_elements(coalesce(new.items, '[]'::jsonb))
  loop
    v_sku := nullif(trim(coalesce(v_line->>'sku', '')), '');
    if v_sku is null then
      v_sku := case
        when coalesce(v_line->>'key', '') like 'modelo:%'
          then 'LH-MOD-' || upper(split_part(v_line->>'key', ':', 2))
        else 'LH-CUSTOM'
      end;
    end if;
    v_qty := greatest(1, least(99, coalesce((v_line->>'qty')::int, 1)));
    v_price := coalesce((v_line->>'unitPrice')::numeric, 0);
    v_contents := v_contents || jsonb_build_array(
      jsonb_build_object('id', v_sku, 'quantity', v_qty, 'item_price', v_price)
    );
  end loop;

  -- 4. Datos de coincidencia (correo y teléfono siempre cifrados)
  v_ip := nullif(trim(split_part(
    coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
    ',', 1
  )), '');
  v_ua := nullif(current_setting('request.headers', true)::json ->> 'user-agent', '');

  v_email := lower(trim(coalesce(new.email, '')));
  v_phone := regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g');

  v_user := '{}'::jsonb;
  if v_email <> '' then
    v_user := v_user || jsonb_build_object(
      'em', jsonb_build_array(encode(digest(v_email, 'sha256'), 'hex'))
    );
  end if;
  if length(v_phone) >= 8 then
    v_user := v_user || jsonb_build_object(
      'ph', jsonb_build_array(encode(digest(v_phone, 'sha256'), 'hex'))
    );
  end if;
  if v_ip is not null then
    v_user := v_user || jsonb_build_object('client_ip_address', v_ip);
  end if;
  if v_ua is not null then
    v_user := v_user || jsonb_build_object('client_user_agent', v_ua);
  end if;
  v_user := v_user || jsonb_build_object('country', 'mx');

  -- 5. Purchase con el mismo event_id que el navegador → Meta deduplica
  --    Cualquier fallo de medición se ignora: el pedido nunca se rompe por esto.
  begin
    perform net.http_post(
      'https://graph.facebook.com/v21.0/1848760170029669/events?access_token=' || v_token,
      jsonb_build_object(
        'data', jsonb_build_array(
          jsonb_build_object(
            'event_name', 'Purchase',
            'event_time', extract(epoch from now())::bigint,
            'event_id', 'lh-' || new.number,
            'action_source', 'website',
            'event_source_url', 'https://likehoodie.com/',
            'user_data', v_user,
            'custom_data', jsonb_build_object(
              'value', new.total,
              'currency', 'MXN',
              'order_id', new.number,
              'num_items', new.item_count,
              'content_type', 'product',
              'contents', v_contents,
              'content_ids', coalesce(
                (select jsonb_agg(distinct c->>'id')
                   from jsonb_array_elements(v_contents) c),
                '[]'::jsonb
              )
            )
          )
        )
      ),
      '{}'::jsonb,
      jsonb_build_object('Content-Type', 'application/json'),
      10000
    );
  exception when others then
    null;
  end;

  return new;
end;
$fn$;

revoke all on function public.notify_meta_purchase() from public;
revoke all on function public.notify_meta_purchase() from anon;
revoke all on function public.notify_meta_purchase() from authenticated;

drop trigger if exists orders_meta_purchase on public.orders;
create trigger orders_meta_purchase
  after insert or update of payment_status on public.orders
  for each row execute function public.notify_meta_purchase();
