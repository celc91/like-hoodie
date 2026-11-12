-- Meta Conversions API · PASO 2 de 2
-- Compra enviada desde el servidor, solo si la persona aceptó publicidad.
--
-- Antes de ejecutar:
--   1. Haber ejecutado meta-capi-1-consentimiento.sql
--   2. Guardar el token del píxel en Vault, una sola vez:
--        select vault.create_secret('EAAG...', 'meta_capi_token', 'Meta CAPI');
--      El token se genera en Events Manager → Configuración → Conversions API.
--
-- Si falta el token, el disparador no hace nada: no rompe ningún pedido.

create extension if not exists pgcrypto;

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
begin
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

  -- 3. Datos de coincidencia (correo y teléfono siempre cifrados)
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

  -- 4. Purchase con el mismo event_id que el navegador → Meta deduplica
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
              'num_items', new.item_count
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
  after insert on public.orders
  for each row execute function public.notify_meta_purchase();
