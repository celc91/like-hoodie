-- Parches de seguridad derivados de la auditoria B.4 (fase B.5).
-- Idempotente. Aplicar despues de 20261115000500_aviso_factura.sql.
--
-- LH-03: el alta de newsletter solo ocurre por subscribe_newsletter().
-- LH-07: una solicitud review o cancelled no se puede reiniciar.
-- LH-09: retencion real de todas las tablas de intentos.
-- LH-10: has_resend_key() no debe ser ejecutable desde el navegador.

do $do$
begin
  if to_regclass('public.newsletter_subscribers') is not null then
    execute 'drop policy if exists "newsletter_insert_public" on public.newsletter_subscribers';
    execute 'revoke insert on public.newsletter_subscribers from anon, authenticated';
  end if;
end;
$do$;

do $do$
begin
  if to_regprocedure('public.has_resend_key()') is not null then
    execute 'revoke all on function public.has_resend_key() from public, anon, authenticated';
  end if;
end;
$do$;

-- LH-09
create or replace function public.cleanup_monitoring()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.client_errors
   where created_at < now() - interval '90 days';

  delete from public.events
   where created_at < now() - interval '365 days';

  delete from public.order_lookup_attempts
   where created_at < now() - interval '2 days';

  delete from public.client_error_attempts
   where created_at < now() - interval '2 days';

  delete from public.carts
   where status in ('open', 'empty')
     and updated_at < now() - interval '180 days';

  delete from public.coupon_attempts
   where created_at < now() - interval '2 days';

  delete from public.newsletter_attempts
   where created_at < now() - interval '7 days';

  delete from public.invoice_request_attempts
   where created_at < now() - interval '2 days';

  delete from public.clip_pay_attempts
   where created_at < now() - interval '2 days';

  delete from public.logo_process_attempts
   where created_at < now() - interval '2 days';
end;
$$;
revoke all on function public.cleanup_monitoring() from public;
grant execute on function public.cleanup_monitoring() to service_role;

-- LH-07
create or replace function public.submit_invoice_request(
  p_number bigint,
  p_email text,
  p_rfc text,
  p_legal_name text,
  p_tax_regime text,
  p_zip text,
  p_cfdi_use text,
  p_invoice_email text,
  p_notes text default '',
  p_sat_payment_form text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_request public.invoice_requests;
  v_token uuid;
  v_email_sent boolean := false;
  v_form text := trim(coalesce(p_sat_payment_form, ''));
begin
  if p_number is null
     or p_number < 1
     or p_email is null
     or length(trim(p_email)) < 5
     or p_rfc is null
     or length(trim(p_rfc)) not between 12 and 13
     or p_legal_name is null
     or length(trim(p_legal_name)) < 2
     or p_tax_regime is null
     or p_tax_regime !~ '^[0-9]{3}$'
     or p_zip is null
     or p_zip !~ '^[0-9]{5}$'
     or p_cfdi_use is null
     or upper(trim(p_cfdi_use)) not in ('G01', 'G03', 'P01', 'S01')
     or p_invoice_email is null
     or length(trim(p_invoice_email)) < 5
     or v_form not in ('04', '28') then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_order
    from public.orders
   where number = p_number
     and lower(email) = lower(trim(p_email))
   limit 1
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;

  if v_order.status = 'cancelled' then
    return jsonb_build_object('ok', false, 'reason', 'cancelled');
  end if;

  if v_order.payment_status <> 'paid' then
    return jsonb_build_object('ok', false, 'reason', 'unpaid');
  end if;

  select * into v_request
    from public.invoice_requests
   where order_id = v_order.id
   for update;

  if found and v_request.status = 'issued' then
    return jsonb_build_object('ok', false, 'reason', 'issued');
  end if;

  if found and v_request.status in ('review', 'cancelled') then
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  -- Si el cliente corrige datos, vuelve a verificar el correo y el pedido deja
  -- de estar excluido de la global hasta que confirme de nuevo.
  if v_order.billing_status = 'individual' then
    update public.orders
       set billing_status = 'pending'
     where id = v_order.id;
  end if;

  v_token := gen_random_uuid();

  if v_request.id is not null then
    update public.invoice_requests
       set order_number = v_order.number,
           purchase_email = lower(trim(p_email)),
           rfc = upper(trim(p_rfc)),
           legal_name = left(trim(p_legal_name), 160),
           tax_regime = trim(p_tax_regime),
           zip = trim(p_zip),
           cfdi_use = upper(trim(p_cfdi_use)),
           invoice_email = lower(trim(p_invoice_email)),
           notes = left(coalesce(p_notes, ''), 500),
           sat_payment_form = v_form,
           status = 'unverified',
           uuid = null,
           issued_at = null,
           verified_at = null,
           verify_token = v_token,
           verify_expires_at = now() + interval '24 hours',
           verification_sent_at = null,
           updated_at = now()
     where id = v_request.id;
  else
    insert into public.invoice_requests (
      order_id, order_number, purchase_email, rfc, legal_name, tax_regime,
      zip, cfdi_use, invoice_email, notes, sat_payment_form, status,
      verify_token, verify_expires_at
    ) values (
      v_order.id, v_order.number, lower(trim(p_email)), upper(trim(p_rfc)),
      left(trim(p_legal_name), 160), trim(p_tax_regime), trim(p_zip),
      upper(trim(p_cfdi_use)), lower(trim(p_invoice_email)),
      left(coalesce(p_notes, ''), 500), v_form, 'unverified',
      v_token, now() + interval '24 hours'
    );
  end if;

  v_email_sent := public.send_invoice_verification_email(
    lower(trim(p_email)),
    v_order.number,
    v_token
  );

  if v_email_sent then
    update public.invoice_requests
       set verification_sent_at = now(),
           updated_at = now()
     where order_id = v_order.id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', 'unverified',
    'email_sent', v_email_sent
  );
end;
$$;
revoke all on function public.submit_invoice_request(
  bigint, text, text, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.submit_invoice_request(
  bigint, text, text, text, text, text, text, text, text, text
) to service_role;