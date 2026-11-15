-- ---------------------------------------------------------------------------
-- Fase 15: aviso al admin cuando una solicitud de factura queda verificada
-- y cierre del helper de Resend.
-- ---------------------------------------------------------------------------

begin;

create or replace function public.send_invoice_admin_email(
  p_number bigint,
  p_request_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  v_key text;
  v_html text;
begin
  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where name = 'resend_api_key'
   limit 1;

  if v_key is null then
    return false;
  end if;

  v_html :=
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#161618;line-height:1.5">' ||
    '<h2 style="font-size:22px;margin:0 0 10px">Factura individual verificada</h2>' ||
    '<p>El cliente confirmó el correo de la solicitud para el pedido <strong>LH-' || p_number::text || '</strong>.</p>' ||
    '<p>Revisa los datos fiscales y emite el CFDI desde el SAT.</p>' ||
    '<p style="margin:24px 0"><a href="https://likehoodie.com/admin.html" style="background:#a8320e;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:700">Abrir el panel</a></p>' ||
    '<p style="font-size:12px;color:#7b756c">Solicitud: ' || p_request_id::text || '</p>' ||
    '</div>';

  perform net.http_post(
    'https://api.resend.com/emails',
    jsonb_build_object(
      'from', 'like hoodie ♡ <hola@likehoodie.com>',
      'to', jsonb_build_array('hola@likehoodie.com'),
      'reply_to', 'hola@likehoodie.com',
      'subject', 'Factura individual verificada - LH-' || p_number::text,
      'html', v_html
    ),
    '{}'::jsonb,
    jsonb_build_object(
      'Authorization', 'Bearer ' || v_key,
      'Content-Type', 'application/json'
    ),
    10000
  );

  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.send_invoice_admin_email(bigint, uuid) from public;
revoke all on function public.send_invoice_admin_email(bigint, uuid) from anon;
revoke all on function public.send_invoice_admin_email(bigint, uuid) from authenticated;
grant execute on function public.send_invoice_admin_email(bigint, uuid) to service_role;

-- La confirmación ya está dentro de confirm_invoice_request; añadimos el aviso.
create or replace function public.confirm_invoice_request(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.invoice_requests;
  v_order public.orders;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;

  select * into v_request
    from public.invoice_requests
   where verify_token = p_token
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;

  if v_request.status = 'issued' then
    return jsonb_build_object('ok', true, 'status', 'issued', 'already', true);
  end if;

  if v_request.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'cancelled');
  end if;

  if v_request.verify_expires_at is null
     or v_request.verify_expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select * into v_order
    from public.orders
   where id = v_request.order_id
   for update;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'cancelled');
  end if;

  if v_order.payment_status <> 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'unpaid');
  end if;

  update public.invoice_requests
     set status = 'review',
         verified_at = now(),
         verify_token = null,
         verify_expires_at = null,
         updated_at = now()
   where id = v_request.id;

  if v_order.billing_status = 'pending' then
    update public.orders
       set billing_status = 'individual'
     where id = v_order.id;
  end if;

  perform public.send_invoice_admin_email(v_order.number, v_request.id);

  return jsonb_build_object('ok', true, 'status', 'review');
end;
$$;

revoke all on function public.confirm_invoice_request(uuid) from public;
revoke all on function public.confirm_invoice_request(uuid) from anon;
revoke all on function public.confirm_invoice_request(uuid) from authenticated;
grant execute on function public.confirm_invoice_request(uuid) to service_role;

-- Este helper solo lo necesita el backend; no debe ser ejecutable por anon.
revoke all on function public.has_resend_key() from anon;

notify pgrst, 'reload schema';

commit;
