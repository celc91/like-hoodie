-- Doble opt-in del Club like hoodie (usa la clave de Resend que ya está en Vault)
-- Ejecuta esto en Supabase → SQL Editor → Run, después de antispam.sql

-- 1) Estado de confirmación en la lista
alter table public.newsletter_subscribers
  add column if not exists confirmed boolean not null default false;
alter table public.newsletter_subscribers
  add column if not exists token uuid not null default gen_random_uuid();
alter table public.newsletter_subscribers
  add column if not exists confirmed_at timestamptz;
alter table public.newsletter_subscribers
  add column if not exists unsubscribed_at timestamptz;

create unique index if not exists newsletter_subscribers_token_key
  on public.newsletter_subscribers (token);

-- los correos que ya tenías se dan por confirmados
update public.newsletter_subscribers
   set confirmed = true, confirmed_at = coalesce(confirmed_at, created_at)
 where confirmed = false;

-- 2) Alta: guarda el correo (sin confirmar) y envía el enlace
create or replace function public.subscribe_newsletter(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ip text;
  v_recent integer;
  v_token uuid;
  v_existing public.newsletter_subscribers;
  v_key text;
  v_sent boolean := false;
  v_link text;
  v_html text;
begin
  if length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  v_ip := coalesce(
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

  delete from public.newsletter_attempts where created_at < now() - interval '7 days';

  select count(*) into v_recent
  from public.newsletter_attempts
  where ip = v_ip and created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;

  insert into public.newsletter_attempts (ip) values (v_ip);

  select * into v_existing
  from public.newsletter_subscribers
  where lower(email) = v_email
  limit 1;

  if found and v_existing.confirmed then
    return jsonb_build_object('ok', true, 'duplicate', true, 'sent', false);
  end if;

  if found then
    update public.newsletter_subscribers
       set token = gen_random_uuid(),
           unsubscribed_at = null
     where id = v_existing.id
     returning token into v_token;
  else
    insert into public.newsletter_subscribers (email, source, confirmed)
    values (v_email, 'web', false)
    returning token into v_token;
  end if;

  -- enlace de confirmación
  v_link := 'https://likehoodie.com/confirmar.html?token=' || v_token::text;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'resend_api_key'
   limit 1;

  if v_key is not null then
    v_html :=
      '<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:0 auto;color:#161618;line-height:1.55">' ||
      '<h2 style="font-size:24px;margin:0 0 8px">Confirma tu correo</h2>' ||
      '<p>Estás a un clic de entrar al <strong>Club like hoodie</strong> y llevarte un <strong>10 %</strong> en tu primer pedido.</p>' ||
      '<p style="margin:24px 0">' ||
      '<a href="' || v_link || '" style="background:#f0451a;color:#fff;text-decoration:none;padding:14px 22px;border-radius:999px;font-weight:700;display:inline-block">Confirmar mi correo</a>' ||
      '</p>' ||
      '<p style="font-size:13px;color:#7b756c">Si no fuiste tú, ignora este mensaje y no guardaremos nada.</p>' ||
      '<p style="font-size:12px;color:#9c9488">like hoodie ♡ · likehoodie.com</p>' ||
      '</div>';

    perform net.http_post(
      'https://api.resend.com/emails',
      jsonb_build_object(
        'from', 'like hoodie ♡ <hola@likehoodie.com>',
        'to', jsonb_build_array(v_email),
        'reply_to', 'hola@likehoodie.com',
        'subject', 'Confirma tu correo · like hoodie ♡',
        'html', v_html
      ),
      '{}'::jsonb,
      jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json'),
      10000
    );
    v_sent := true;
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'sent', v_sent);
end;
$$;

revoke all on function public.subscribe_newsletter(text) from public;
revoke all on function public.subscribe_newsletter(text) from anon;
grant execute on function public.subscribe_newsletter(text) to anon, authenticated;

-- 3) Confirmación desde el enlace del correo
create or replace function public.confirm_newsletter(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.newsletter_subscribers;
begin
  select * into v_row
  from public.newsletter_subscribers
  where token = p_token
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;

  if v_row.unsubscribed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'unsubscribed');
  end if;

  if not v_row.confirmed then
    update public.newsletter_subscribers
       set confirmed = true, confirmed_at = now()
     where id = v_row.id;
  end if;

  return jsonb_build_object('ok', true, 'code', 'BIENVENIDA10', 'percent', 10);
end;
$$;

revoke all on function public.confirm_newsletter(uuid) from public;
revoke all on function public.confirm_newsletter(uuid) from anon;
grant execute on function public.confirm_newsletter(uuid) to anon, authenticated;

-- 4) Baja (obligatoria por ley de datos)
create or replace function public.unsubscribe_newsletter(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  update public.newsletter_subscribers
     set unsubscribed_at = now(), confirmed = false
   where token = p_token
   returning id into v_id;

  if v_id is null then
    return jsonb_build_object('ok', false, 'reason', 'notfound');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.unsubscribe_newsletter(uuid) from public;
revoke all on function public.unsubscribe_newsletter(uuid) from anon;
grant execute on function public.unsubscribe_newsletter(uuid) to anon, authenticated;

-- Diagnóstico: ¿está la clave de Resend en Vault?
create or replace function public.has_resend_key()
returns boolean
language sql
stable
security definer
set search_path = public, vault
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'resend_api_key');
$$;

revoke all on function public.has_resend_key() from public;
grant execute on function public.has_resend_key() to anon, authenticated;
