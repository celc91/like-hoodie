-- PASO 3 de 3 · alta en el club con correo de confirmación
-- Pega SOLO este archivo y pulsa Run.

create or replace function public.subscribe_newsletter(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, net, vault
as $fn$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ip text;
  v_recent integer;
  v_token uuid;
  v_row public.newsletter_subscribers;
  v_key text;
  v_link text;
begin
  if length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  v_ip := left(trim(split_part(
    coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
    ',', 1)), 64);
  if v_ip = '' then
    v_ip := 'unknown';
  end if;

  delete from public.newsletter_attempts
   where created_at < now() - interval '7 days';

  select count(*) into v_recent
    from public.newsletter_attempts
   where ip = v_ip and created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;

  insert into public.newsletter_attempts (ip) values (v_ip);

  select * into v_row
    from public.newsletter_subscribers
   where lower(email) = v_email
   limit 1;

  if found and v_row.confirmed then
    return jsonb_build_object('ok', true, 'duplicate', true, 'sent', false);
  elsif found then
    update public.newsletter_subscribers
       set token = gen_random_uuid(), unsubscribed_at = null
     where id = v_row.id
     returning token into v_token;
  else
    insert into public.newsletter_subscribers (email, source, confirmed)
    values (v_email, 'web', false)
    returning token into v_token;
  end if;

  v_link := 'https://likehoodie.com/confirmar.html?token=' || v_token::text;

  select decrypted_secret into v_key
    from vault.decrypted_secrets
   where name = 'resend_api_key'
   limit 1;

  if v_key is not null then
    perform net.http_post(
      'https://api.resend.com/emails',
      jsonb_build_object(
        'from', 'like hoodie <hola@likehoodie.com>',
        'to', jsonb_build_array(v_email),
        'reply_to', 'hola@likehoodie.com',
        'subject', 'Confirma tu correo - like hoodie',
        'html', format(
          '<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#161618;line-height:1.5">' ||
          '<h2>Confirma tu correo</h2>' ||
          '<p>Estás a un clic del Club like hoodie y de tu 10 %% en el primer pedido.</p>' ||
          '<p style="margin:24px 0"><a href="%s" style="background:#f0451a;color:#fff;padding:14px 22px;border-radius:999px;text-decoration:none;font-weight:700">Confirmar mi correo</a></p>' ||
          '<p style="font-size:13px;color:#7b756c">Si no fuiste tú, ignora este mensaje.</p></div>',
          v_link
        )
      ),
      '{}'::jsonb,
      jsonb_build_object(
        'Authorization', 'Bearer ' || v_key,
        'Content-Type', 'application/json'
      ),
      10000
    );
    return jsonb_build_object('ok', true, 'duplicate', false, 'sent', true);
  end if;

  return jsonb_build_object('ok', true, 'duplicate', false, 'sent', false);
end;
$fn$;

revoke all on function public.subscribe_newsletter(text) from public;
grant execute on function public.subscribe_newsletter(text) to anon, authenticated;
