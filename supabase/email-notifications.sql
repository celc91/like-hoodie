-- like hoodie ♡ — correos automáticos de pedidos con Resend
-- Requisitos:
--   1. Extensión pg_net habilitada.
--   2. Secreto 'resend_api_key' creado en Supabase Vault.
--   3. Dominio likehoodie.com verificado en Resend.
--
-- Crear el secreto (una sola vez):
--   select vault.create_secret('re_...', 'resend_api_key', 'Resend API key');

create extension if not exists pg_net;

create or replace function public.notify_order_email()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault
as $function$
declare
  v_key text;
  v_items text := '';
  v_total text;
  v_customer text;
  v_email text;
  v_phone text;
  v_address text;
  v_city text;
  v_zip text;
  v_html text;
  v_admin_html text;
  v_demo boolean;
  v_pending boolean;
begin
  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where name = 'resend_api_key'
   limit 1;

  if v_key is null then
    return new;
  end if;

  if jsonb_typeof(new.items) = 'array' then
    select coalesce(
             string_agg(
               coalesce(item->>'name', 'Sudadera') || ' · ' ||
               coalesce(item->>'colorName', '') || ' · Talla ' ||
               coalesce(item->>'size', '—') || ' · x' ||
               coalesce(item->>'qty', '1'),
               E'\n'
             ),
             ''
           )
      into v_items
      from jsonb_array_elements(new.items) as item;
  end if;

  v_items := replace(replace(replace(v_items, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_items := replace(v_items, E'\n', '<br>');
  v_total := '$' || to_char(new.total, 'FM999,999,999') || ' MXN';
  v_demo := coalesce(new.payment_status, '') = 'demo';
  v_pending := coalesce(new.payment_status, '') = 'pending';

  v_customer := replace(replace(replace(coalesce(new.customer_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_email := replace(replace(replace(coalesce(new.email, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_phone := replace(replace(replace(coalesce(new.phone, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_address := replace(replace(replace(coalesce(new.address, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_city := replace(replace(replace(coalesce(new.city, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_zip := replace(replace(replace(coalesce(new.zip, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

  v_html := '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#161618;line-height:1.5">' ||
    '<h2 style="font-size:24px;margin:0 0 10px">Pedido LH-' || new.number || '</h2>' ||
    '<p>Hola ' || v_customer || ',</p>' ||
    '<p>Recibimos tu pedido. Esto es lo que elegiste:</p>' ||
    '<div style="background:#f4efe6;border-radius:12px;padding:14px 16px;margin:16px 0">' || v_items || '</div>' ||
    '<p style="font-size:18px"><strong>Total: ' || v_total || '</strong></p>' ||
    case
      when v_demo then '<p style="color:#6d685f;font-size:13px">Este pedido es una demostración: no se realizó ningún cargo. Te contactaremos cuando el pago real esté activo.</p>'
      when v_pending then '<p style="color:#6d685f;font-size:13px">Tu pedido está pendiente de pago. Si ya pagaste en Clip, lo confirmaremos en cuanto recibamos la notificación.</p>'
      else ''
    end ||
    '<p>Te avisaremos cuando cambie el estado de tu pedido.</p>' ||
    '<p>Gracias por confiar en like hoodie ♡.</p>' ||
    '<p style="font-size:12px;color:#6d685f">https://likehoodie.com</p>' ||
    '</div>';

  if coalesce(new.email, '') <> '' then
    perform net.http_post(
      'https://api.resend.com/emails',
      jsonb_build_object(
        'from', 'like hoodie ♡ <hola@likehoodie.com>',
        'to', jsonb_build_array(new.email),
        'reply_to', 'hola@likehoodie.com',
        'subject', 'Pedido LH-' || new.number || ' recibido — like hoodie ♡',
        'html', v_html
      ),
      '{}'::jsonb,
      jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      10000
    );
  end if;

  v_admin_html := '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#161618;line-height:1.5">' ||
    '<h2 style="font-size:24px;margin:0 0 10px">Nuevo pedido LH-' || new.number || '</h2>' ||
    '<p><strong>' || v_customer || '</strong><br>' ||
    v_email || '<br>' || v_phone || '</p>' ||
    '<p>' || v_address || '<br>' || v_city || ' · ' || v_zip || '</p>' ||
    '<div style="background:#f4efe6;border-radius:12px;padding:14px 16px;margin:16px 0">' || v_items || '</div>' ||
    '<p style="font-size:18px"><strong>Total: ' || v_total || '</strong></p>' ||
    '<p><a href="https://likehoodie.com/admin.html">Abrir panel de administración</a></p>' ||
    '</div>';

  perform net.http_post(
    'https://api.resend.com/emails',
    jsonb_build_object(
      'from', 'like hoodie ♡ <hola@likehoodie.com>',
      'to', jsonb_build_array('hola@likehoodie.com'),
      'reply_to', coalesce(nullif(new.email, ''), 'hola@likehoodie.com'),
      'subject', 'Nuevo pedido LH-' || new.number || ' — like hoodie ♡',
      'html', v_admin_html
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    10000
  );

  return new;
end;
$function$;

revoke all on function public.notify_order_email() from public;
revoke all on function public.notify_order_email() from anon;
revoke all on function public.notify_order_email() from authenticated;

drop trigger if exists orders_notify_email on public.orders;
create trigger orders_notify_email
  after insert on public.orders
  for each row execute function public.notify_order_email();

-- ---------------------------------------------------------------------------
-- Correo de pago confirmado (Clip)
-- ---------------------------------------------------------------------------

create or replace function public.notify_payment_email()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault
as $function$
declare
  v_key text;
  v_total text;
  v_customer text;
  v_email text;
  v_reference text;
  v_html text;
  v_admin_html text;
begin
  if new.payment_status <> 'paid'
     or coalesce(old.payment_status, '') = 'paid' then
    return new;
  end if;

  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where name = 'resend_api_key'
   limit 1;

  if v_key is null then
    return new;
  end if;

  v_total := '$' || to_char(new.total, 'FM999,999,999') || ' MXN';
  v_customer := replace(replace(replace(coalesce(new.customer_name, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_email := replace(replace(replace(coalesce(new.email, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_reference := replace(replace(replace(coalesce(new.payment_reference, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;');

  v_html := '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#161618;line-height:1.5">' ||
    '<h2 style="font-size:24px;margin:0 0 10px">Pago confirmado · Pedido LH-' || new.number || '</h2>' ||
    '<p>Hola ' || v_customer || ',</p>' ||
    '<p>Recibimos tu pago de <strong>' || v_total || '</strong>. Tu pedido quedó confirmado y empezaremos a prepararlo.</p>' ||
    case when v_reference <> '' then '<p style="font-size:13px;color:#6d685f">Referencia de pago: ' || v_reference || '</p>' else '' end ||
    '<p>Te avisaremos cuando cambie el estado de tu pedido.</p>' ||
    '<p>Gracias por confiar en like hoodie ♡.</p>' ||
    '<p style="font-size:12px;color:#6d685f">https://likehoodie.com</p>' ||
    '</div>';

  if coalesce(new.email, '') <> '' then
    perform net.http_post(
      'https://api.resend.com/emails',
      jsonb_build_object(
        'from', 'like hoodie ♡ <hola@likehoodie.com>',
        'to', jsonb_build_array(new.email),
        'reply_to', 'hola@likehoodie.com',
        'subject', 'Pago confirmado · Pedido LH-' || new.number || ' — like hoodie ♡',
        'html', v_html
      ),
      '{}'::jsonb,
      jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      10000
    );
  end if;

  v_admin_html := '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#161618;line-height:1.5">' ||
    '<h2 style="font-size:24px;margin:0 0 10px">Pago recibido · LH-' || new.number || '</h2>' ||
    '<p><strong>' || v_customer || '</strong><br>' || v_email || '</p>' ||
    '<p>Total: <strong>' || v_total || '</strong></p>' ||
    case when v_reference <> '' then '<p style="font-size:13px;color:#6d685f">Referencia: ' || v_reference || '</p>' else '' end ||
    '<p><a href="https://likehoodie.com/admin.html">Abrir panel de administración</a></p>' ||
    '</div>';

  perform net.http_post(
    'https://api.resend.com/emails',
    jsonb_build_object(
      'from', 'like hoodie ♡ <hola@likehoodie.com>',
      'to', jsonb_build_array('hola@likehoodie.com'),
      'reply_to', 'hola@likehoodie.com',
      'subject', 'Pago recibido · LH-' || new.number || ' — like hoodie ♡',
      'html', v_admin_html
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    10000
  );

  return new;
end;
$function$;

revoke all on function public.notify_payment_email() from public;
revoke all on function public.notify_payment_email() from anon;
revoke all on function public.notify_payment_email() from authenticated;

drop trigger if exists orders_notify_payment on public.orders;
create trigger orders_notify_payment
  after update of payment_status on public.orders
  for each row execute function public.notify_payment_email();
