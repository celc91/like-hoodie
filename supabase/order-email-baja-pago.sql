-- Baja del club en el correo de pago confirmado
-- Pega SOLO este archivo y pulsa Run (después de order-email-baja.sql).

create or replace function public.notify_payment_email()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault
as $fn$
declare
  v_key text;
  v_total text;
  v_customer text;
  v_email text;
  v_reference text;
  v_html text;
  v_admin_html text;
  v_token uuid;
  v_footer text := '';
begin
  if new.payment_status <> 'paid'
     or coalesce(old.payment_status, '') = 'paid' then
    return new;
  end if;

  select decrypted_secret into v_key
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

  select token into v_token
    from public.newsletter_subscribers
   where lower(email) = lower(coalesce(new.email, ''))
     and confirmed
     and unsubscribed_at is null
   limit 1;

  if v_token is not null then
    v_footer := '<p style="font-size:12px;color:#6d685f;margin-top:20px">Estás en el Club like hoodie. Si quieres darte de baja, <a href="https://likehoodie.com/confirmar.html?baja=' || v_token::text || '" style="color:#6d685f">haz clic aquí</a>.</p>';
  end if;

  v_html := '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#161618;line-height:1.5">' ||
    '<h2 style="font-size:24px;margin:0 0 10px">Pago confirmado · Pedido LH-' || new.number || '</h2>' ||
    '<p>Hola ' || v_customer || ',</p>' ||
    '<p>Recibimos tu pago de <strong>' || v_total || '</strong>. Tu pedido quedó confirmado y empezaremos a prepararlo.</p>' ||
    case when v_reference <> '' then '<p style="font-size:13px;color:#6d685f">Referencia de pago: ' || v_reference || '</p>' else '' end ||
    '<p>Te avisaremos cuando cambie el estado de tu pedido.</p>' ||
    '<p>Gracias por confiar en like hoodie ♡.</p>' ||
    '<p style="font-size:12px;color:#6d685f">https://likehoodie.com</p>' ||
    v_footer ||
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
      jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
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
    jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
    10000
  );

  return new;
end;
$fn$;

revoke all on function public.notify_payment_email() from public;
revoke all on function public.notify_payment_email() from anon;
revoke all on function public.notify_payment_email() from authenticated;
