-- PASO 2 de 3 · confirmar, baja y diagnóstico
-- Pega SOLO este archivo y pulsa Run.

create or replace function public.confirm_newsletter(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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
$fn$;

revoke all on function public.confirm_newsletter(uuid) from public;
grant execute on function public.confirm_newsletter(uuid) to anon, authenticated;

create or replace function public.unsubscribe_newsletter(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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
$fn$;

revoke all on function public.unsubscribe_newsletter(uuid) from public;
grant execute on function public.unsubscribe_newsletter(uuid) to anon, authenticated;

create or replace function public.has_resend_key()
returns boolean
language sql
stable
security definer
set search_path = public, vault
as $fn$
  select exists (select 1 from vault.decrypted_secrets where name = 'resend_api_key');
$fn$;

revoke all on function public.has_resend_key() from public;
grant execute on function public.has_resend_key() to anon, authenticated;
