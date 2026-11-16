-- Cierra LH-04 y LH-05: topes globales y contadores que se podian superar
-- con peticiones concurrentes.
--
-- Se toma un advisory lock por finalidad antes de contar. El orden es siempre
-- el mismo (usuario o IP, luego global) para no introducir deadlocks.
--
-- Idempotente.

-- LH-04: validacion de cupones
create or replace function public.check_coupon(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_row public.coupons;
  v_ip text;
  v_recent integer;
begin
  if v_code = '' or length(v_code) > 32 then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;

  v_ip := coalesce(
    nullif(
      current_setting('request.headers', true)::json ->> 'cf-connecting-ip',
      ''
    ),
    nullif(
      current_setting('request.headers', true)::json ->> 'x-real-ip',
      ''
    ),
    nullif(
      split_part(
        coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
        ',', 1
      ),
      ''
    ),
    'unknown'
  );
  v_ip := left(trim(v_ip), 64);

  perform pg_advisory_xact_lock(hashtext('coupon:ip:' || v_ip));

  delete from public.coupon_attempts
  where created_at < now() - interval '2 days';

  select count(*) into v_recent
  from public.coupon_attempts
  where ip = v_ip and created_at > now() - interval '1 hour';

  -- 30 intentos por hora: margen de sobra para una persona, inviable para escanear
  if v_recent >= 30 then
    return jsonb_build_object('valid', false, 'reason', 'rate');
  end if;

  insert into public.coupon_attempts (ip) values (v_ip);

  select * into v_row from public.coupons where code = v_code;

  if not found or not v_row.active then
    return jsonb_build_object('valid', false, 'reason', 'notfound');
  end if;

  if v_row.expires_at is not null and v_row.expires_at <= now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  if v_row.max_uses is not null and v_row.used_count >= v_row.max_uses then
    return jsonb_build_object('valid', false, 'reason', 'exhausted');
  end if;

  return jsonb_build_object('valid', true, 'code', v_row.code, 'percent', v_row.percent);
end;
$$;

revoke all on function public.check_coupon(text) from public;
grant execute on function public.check_coupon(text) to anon, authenticated;

-- LH-05: seguimiento de pedidos
create or replace function public.take_order_lookup(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
  v_global integer;
begin
  if p_ip_hash is null or length(p_ip_hash) <> 64 then
    return false;
  end if;

  -- Serializa las peticiones de la misma IP para que el límite sea atómico.
  perform pg_advisory_xact_lock(hashtext(p_ip_hash));

  select count(*) into v_count
    from public.order_lookup_attempts
   where ip_hash = p_ip_hash
     and created_at > now() - interval '10 minutes';

  if v_count >= 12 then
    return false;
  end if;

  -- Tope global de seguridad, aunque roten IPs (LH-05).
  perform pg_advisory_xact_lock(hashtext('order_lookup:global'));

  select count(*) into v_global
    from public.order_lookup_attempts
   where created_at > now() - interval '1 minute';

  if v_global >= 300 then
    return false;
  end if;

  insert into public.order_lookup_attempts (ip_hash)
  values (p_ip_hash);

  delete from public.order_lookup_attempts
   where created_at < now() - interval '2 days';

  return true;
end;
$$;

revoke all on function public.take_order_lookup(text) from public, anon, authenticated;
grant execute on function public.take_order_lookup(text) to service_role;

-- LH-05: errores de cliente
create or replace function public.take_client_error(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip integer;
  v_global integer;
begin
  if p_ip_hash is null or length(p_ip_hash) <> 64 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_ip_hash));

  select count(*) into v_ip
    from public.client_error_attempts
   where ip_hash = p_ip_hash
     and created_at > now() - interval '1 hour';

  if v_ip >= 20 then
    return false;
  end if;

  -- El tope global se cuenta sobre los intentos, no sobre los errores ya
  -- insertados en otra llamada (LH-05).
  perform pg_advisory_xact_lock(hashtext('client_error:global'));

  select count(*) into v_global
    from public.client_error_attempts
   where created_at > now() - interval '1 hour';

  if v_global >= 2000 then
    return false;
  end if;

  insert into public.client_error_attempts (ip_hash)
  values (p_ip_hash);

  delete from public.client_error_attempts
   where created_at < now() - interval '2 days';

  return true;
end;
$$;

revoke all on function public.take_client_error(text) from public, anon, authenticated;
grant execute on function public.take_client_error(text) to service_role;

-- LH-05: intentos de cobro
create or replace function public.take_clip_pay(
  p_ip_hash text,
  p_user_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip integer;
  v_user integer;
begin
  if p_ip_hash is null or length(p_ip_hash) <> 64 or p_user_id is null then
    return false;
  end if;

  -- El limite por usuario tambien debe serializarse (LH-05).
  perform pg_advisory_xact_lock(hashtext('clip_pay:user:' || p_user_id::text));
  perform pg_advisory_xact_lock(hashtext(p_ip_hash));

  select count(*) into v_ip
    from public.clip_pay_attempts
   where ip_hash = p_ip_hash
     and created_at > now() - interval '10 minutes';

  if v_ip >= 12 then
    return false;
  end if;

  select count(*) into v_user
    from public.clip_pay_attempts
   where user_id = p_user_id
     and created_at > now() - interval '10 minutes';

  if v_user >= 6 then
    return false;
  end if;

  insert into public.clip_pay_attempts (ip_hash, user_id)
  values (p_ip_hash, p_user_id);

  delete from public.clip_pay_attempts
   where created_at < now() - interval '2 days';

  return true;
end;
$$;

revoke all on function public.take_clip_pay(text, uuid) from public, anon, authenticated;
grant execute on function public.take_clip_pay(text, uuid) to service_role;

-- LH-05: solicitudes de factura
create or replace function public.take_invoice_request(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip integer;
  v_global integer;
begin
  if p_ip_hash is null or length(p_ip_hash) <> 64 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_ip_hash));

  select count(*) into v_ip
    from public.invoice_request_attempts
   where ip_hash = p_ip_hash
     and created_at > now() - interval '1 hour';

  if v_ip >= 10 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('invoice_request:global'));

  select count(*) into v_global
    from public.invoice_request_attempts
   where created_at > now() - interval '1 hour';

  if v_global >= 100 then
    return false;
  end if;

  insert into public.invoice_request_attempts (ip_hash)
  values (p_ip_hash);

  delete from public.invoice_request_attempts
   where created_at < now() - interval '2 days';

  return true;
end;
$$;

revoke all on function public.take_invoice_request(text) from public, anon, authenticated;
grant execute on function public.take_invoice_request(text) to service_role;

-- LH-05: procesado de logos
create or replace function public.take_logo_process(
  p_user_id uuid,
  p_ip_hash text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user integer;
  v_ip integer;
  v_global integer;
begin
  if p_user_id is null
     or p_ip_hash is null
     or length(p_ip_hash) <> 64 then
    return false;
  end if;

  -- Mismo orden de bloqueo en todas las llamadas para evitar deadlocks.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));
  perform pg_advisory_xact_lock(hashtext(p_ip_hash));

  select count(*) into v_user
    from public.logo_process_attempts
   where user_id = p_user_id
     and created_at > now() - interval '1 hour';

  if v_user >= 20 then
    return false;
  end if;

  select count(*) into v_ip
    from public.logo_process_attempts
   where ip_hash = p_ip_hash
     and created_at > now() - interval '1 hour';

  if v_ip >= 30 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('logo_process:global'));

  select count(*) into v_global
    from public.logo_process_attempts
   where created_at > now() - interval '1 hour';

  if v_global >= 300 then
    return false;
  end if;

  insert into public.logo_process_attempts (user_id, ip_hash)
  values (p_user_id, p_ip_hash);

  delete from public.logo_process_attempts
   where created_at < now() - interval '2 days';

  return true;
end;
$$;

revoke all on function public.take_logo_process(uuid, text) from public, anon, authenticated;
grant execute on function public.take_logo_process(uuid, text) to service_role;

-- LH-05: log de errores del navegador
create or replace function public.log_client_error(
  p_message text,
  p_source text default '',
  p_stack text default '',
  p_path text default '',
  p_user_agent text default ''
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_count integer;
  v_global integer;
begin
  if v_uid is null then
    return false;
  end if;

  if length(trim(coalesce(p_message, ''))) = 0 then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext('client_error:user:' || v_uid::text));
  perform pg_advisory_xact_lock(hashtext('client_error:global'));

  select count(*) into v_count
    from public.client_errors
   where user_id = v_uid
     and created_at > now() - interval '1 hour';

  if v_count >= 30 then
    return false;
  end if;

  select count(*) into v_global
    from public.client_errors
   where created_at > now() - interval '1 hour';

  if v_global >= 2000 then
    return false;
  end if;

  insert into public.client_errors (
    user_id, message, source, stack, path, user_agent
  ) values (
    v_uid,
    left(coalesce(p_message, ''), 500),
    left(coalesce(p_source, ''), 200),
    left(coalesce(p_stack, ''), 2000),
    left(coalesce(p_path, ''), 180),
    left(coalesce(p_user_agent, ''), 200)
  );

  return true;
end;
$$;

revoke all on function public.log_client_error(text, text, text, text, text) from public, anon;
grant execute on function public.log_client_error(text, text, text, text, text) to authenticated;

-- LH-05: triggers de frecuencia
create or replace function public.enforce_event_rate_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  -- Los inserts internos con service_role no tienen auth.uid().
  if auth.uid() is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext('events:user:' || auth.uid()::text));

  for r in
    select e.user_id, count(*) as n
      from public.events e
     where e.user_id in (select distinct user_id from new_events)
       and e.created_at > now() - interval '1 hour'
     group by e.user_id
  loop
    if r.n > 300 then
      raise exception 'Demasiados eventos en poco tiempo' using errcode = 'P0001';
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.enforce_cart_rate_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if auth.uid() is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext('carts:user:' || auth.uid()::text));

  for r in
    select c.user_id, count(*) as n
      from public.carts c
     where c.user_id in (select distinct user_id from new_carts)
       and c.status in ('open', 'empty')
     group by c.user_id
  loop
    if r.n > 10 then
      raise exception 'Demasiados carritos abiertos' using errcode = 'P0001';
    end if;
  end loop;

  return null;
end;
$$;

create or replace function public.enforce_logo_assets_count_stmt()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if auth.uid() is null then
    return null;
  end if;

  perform pg_advisory_xact_lock(hashtext('logo:user:' || auth.uid()::text));

  for r in
    select a.user_id, count(*) as n
      from public.logo_assets a
     where a.user_id in (select distinct user_id from new_assets)
       and a.created_at > now() - interval '24 hours'
     group by a.user_id
  loop
    if r.n > 50 then
      raise exception 'Demasiados logos en poco tiempo' using errcode = 'P0001';
    end if;
  end loop;

  return null;
end;
$$;
