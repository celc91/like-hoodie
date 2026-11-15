-- ---------------------------------------------------------------------------
-- Fase 12: verificación de la solicitud de factura individual
--
-- Cambios:
--   - La solicitud nace como `unverified` y no saca el pedido de la global.
--   - Se envía un correo al correo de compra con un token de 24 h.
--   - Al confirmar, pasa a `review` y el pedido se marca `individual`.
--   - El admin solo puede emitir solicitudes verificadas.
--   - Se guarda la forma de pago SAT (04/28) desde el formulario.
--
-- Ejecutar en Supabase → SQL Editor o con `supabase db query --file`.
-- ---------------------------------------------------------------------------

begin;

alter table public.invoice_requests
  add column if not exists sat_payment_form text,
  add column if not exists verify_token uuid,
  add column if not exists verify_expires_at timestamptz,
  add column if not exists verification_sent_at timestamptz,
  add column if not exists verified_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.invoice_requests'::regclass
       and conname = 'invoice_requests_sat_payment_form_chk'
  ) then
    alter table public.invoice_requests
      add constraint invoice_requests_sat_payment_form_chk
      check (sat_payment_form is null or sat_payment_form in ('04', '28'));
  end if;
end
$$;

alter table public.invoice_requests
  drop constraint if exists invoice_requests_status_check;
alter table public.invoice_requests
  drop constraint if exists invoice_requests_status_chk;

alter table public.invoice_requests
  add constraint invoice_requests_status_chk
  check (status in ('unverified', 'pending', 'review', 'issued', 'cancelled'));

create unique index if not exists invoice_requests_verify_token_idx
  on public.invoice_requests (verify_token)
  where verify_token is not null;

create index if not exists invoice_requests_verified_idx
  on public.invoice_requests (verified_at, status);

create or replace function public.send_invoice_verification_email(
  p_email text,
  p_number bigint,
  p_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  v_key text;
  v_link text;
  v_html text;
begin
  if p_email is null or p_token is null then
    return false;
  end if;

  select decrypted_secret
    into v_key
    from vault.decrypted_secrets
   where name = 'resend_api_key'
   limit 1;

  if v_key is null then
    return false;
  end if;

  v_link := 'https://likehoodie.com/factura.html?token=' || p_token::text;
  v_html :=
    '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#161618;line-height:1.5">' ||
    '<h2 style="font-size:24px;margin:0 0 10px">Confirma tu solicitud de factura</h2>' ||
    '<p>Recibimos una solicitud de factura para el pedido <strong>LH-' || p_number::text || '</strong>.</p>' ||
    '<p>Confirma tu correo para que podamos revisarla:</p>' ||
    '<p style="margin:24px 0"><a href="' || v_link || '" style="background:#f0451a;color:#fff;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:700">Confirmar solicitud</a></p>' ||
    '<p style="font-size:13px;color:#7b756c">El enlace vence en 24 horas. Si no solicitaste la factura, ignora este mensaje.</p>' ||
    '</div>';

  perform net.http_post(
    'https://api.resend.com/emails',
    jsonb_build_object(
      'from', 'like hoodie ♡ <hola@likehoodie.com>',
      'to', jsonb_build_array(p_email),
      'reply_to', 'hola@likehoodie.com',
      'subject', 'Confirma tu solicitud de factura - LH-' || p_number::text,
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

revoke all on function public.send_invoice_verification_email(text, bigint, uuid) from public;
revoke all on function public.send_invoice_verification_email(text, bigint, uuid) from anon;
revoke all on function public.send_invoice_verification_email(text, bigint, uuid) from authenticated;
grant execute on function public.send_invoice_verification_email(text, bigint, uuid) to service_role;

-- La versión anterior tenía 9 argumentos. La reemplazamos por 10.
drop function if exists public.submit_invoice_request(
  bigint, text, text, text, text, text, text, text, text
);

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
) from public;
revoke all on function public.submit_invoice_request(
  bigint, text, text, text, text, text, text, text, text, text
) from anon;
revoke all on function public.submit_invoice_request(
  bigint, text, text, text, text, text, text, text, text, text
) from authenticated;
grant execute on function public.submit_invoice_request(
  bigint, text, text, text, text, text, text, text, text, text
) to service_role;

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

  return jsonb_build_object('ok', true, 'status', 'review');
end;
$$;

revoke all on function public.confirm_invoice_request(uuid) from public;
revoke all on function public.confirm_invoice_request(uuid) from anon;
revoke all on function public.confirm_invoice_request(uuid) from authenticated;
grant execute on function public.confirm_invoice_request(uuid) to service_role;

create or replace function public.resend_invoice_verification(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.invoice_requests;
  v_token uuid;
  v_email_sent boolean := false;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_request
    from public.invoice_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'Solicitud no encontrada' using errcode = 'P0001';
  end if;

  if v_request.status <> 'unverified' then
    raise exception 'Solo se puede reenviar una solicitud sin confirmar'
      using errcode = 'P0001';
  end if;

  v_token := gen_random_uuid();

  update public.invoice_requests
     set verify_token = v_token,
         verify_expires_at = now() + interval '24 hours',
         verification_sent_at = null,
         updated_at = now()
   where id = p_request_id;

  v_email_sent := public.send_invoice_verification_email(
    v_request.purchase_email,
    v_request.order_number,
    v_token
  );

  if v_email_sent then
    update public.invoice_requests
       set verification_sent_at = now(),
           updated_at = now()
     where id = p_request_id;
  end if;

  return jsonb_build_object('ok', true, 'email_sent', v_email_sent);
end;
$$;

revoke all on function public.resend_invoice_verification(uuid) from public;
revoke all on function public.resend_invoice_verification(uuid) from anon;
grant execute on function public.resend_invoice_verification(uuid) to authenticated;

create or replace function public.mark_invoice_request_issued(
  p_request_id uuid,
  p_uuid text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.invoice_requests;
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  if p_uuid is null
     or p_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'UUID no válido' using errcode = '22023';
  end if;

  select * into v_request
    from public.invoice_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'Solicitud no encontrada' using errcode = 'P0001';
  end if;

  if v_request.status = 'issued' then
    return jsonb_build_object('ok', true, 'alreadyIssued', true);
  end if;

  if v_request.status = 'cancelled' then
    raise exception 'La solicitud está cancelada' using errcode = 'P0001';
  end if;

  if v_request.status <> 'review' or v_request.verified_at is null then
    raise exception 'La solicitud aún no confirma el correo' using errcode = 'P0001';
  end if;

  if v_request.sat_payment_form is null then
    raise exception 'Falta la forma de pago SAT de la solicitud' using errcode = 'P0001';
  end if;

  select * into v_order
    from public.orders
   where id = v_request.order_id
   for update;

  if v_order.status = 'cancelled' then
    raise exception 'El pedido está cancelado' using errcode = 'P0001';
  end if;

  if v_order.billing_status = 'global' then
    raise exception 'El pedido ya está en una factura global; ajusta la global antes de emitir la individual'
      using errcode = 'P0001';
  end if;

  update public.invoice_requests
     set status = 'issued',
         uuid = p_uuid,
         issued_at = now(),
         updated_at = now()
   where id = p_request_id;

  update public.orders
     set billing_status = 'individual',
         billing_uuid = p_uuid,
         billed_at = now(),
         sat_payment_form = v_request.sat_payment_form
   where id = v_request.order_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mark_invoice_request_issued(uuid, text) from public;
revoke all on function public.mark_invoice_request_issued(uuid, text) from anon;
grant execute on function public.mark_invoice_request_issued(uuid, text) to authenticated;

create or replace function public.cancel_invoice_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request public.invoice_requests;
  v_order public.orders;
begin
  if not public.is_admin() then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  select * into v_request
    from public.invoice_requests
   where id = p_request_id
   for update;

  if not found then
    raise exception 'Solicitud no encontrada' using errcode = 'P0001';
  end if;

  if v_request.status = 'issued' then
    raise exception 'La factura ya fue emitida' using errcode = 'P0001';
  end if;

  select * into v_order
    from public.orders
   where id = v_request.order_id
   for update;

  update public.invoice_requests
     set status = 'cancelled',
         verify_token = null,
         verify_expires_at = null,
         updated_at = now()
   where id = p_request_id;

  if v_order.billing_status = 'individual' then
    update public.orders
       set billing_status = 'pending'
     where id = v_request.order_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.cancel_invoice_request(uuid) from public;
revoke all on function public.cancel_invoice_request(uuid) from anon;
grant execute on function public.cancel_invoice_request(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
