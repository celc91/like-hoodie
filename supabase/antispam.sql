-- Antispam para la lista del club: límite por IP + validación en servidor
-- Ejecuta esto en Supabase → SQL Editor → Run (después de security-fixes.sql)

-- 1) Registro de intentos por IP (no accesible desde el navegador)
create table if not exists public.newsletter_attempts (
  id bigint generated always as identity primary key,
  ip text not null,
  created_at timestamptz not null default now()
);

create index if not exists newsletter_attempts_ip_time
  on public.newsletter_attempts (ip, created_at desc);

alter table public.newsletter_attempts enable row level security;
revoke all on public.newsletter_attempts from anon, authenticated;

-- 2) Alta controlada: máximo 5 intentos por IP y hora
create or replace function public.subscribe_newsletter(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_ip text;
  v_recent integer;
  v_inserted integer := 0;
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

  -- limpieza barata de intentos viejos
  delete from public.newsletter_attempts
  where created_at < now() - interval '7 days';

  select count(*) into v_recent
  from public.newsletter_attempts
  where ip = v_ip and created_at > now() - interval '1 hour';

  if v_recent >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'rate');
  end if;

  insert into public.newsletter_attempts (ip) values (v_ip);

  insert into public.newsletter_subscribers (email, source)
  values (v_email, 'web')
  on conflict do nothing;
  get diagnostics v_inserted = row_count;

  return jsonb_build_object('ok', true, 'duplicate', v_inserted = 0);
end;
$$;

revoke all on function public.subscribe_newsletter(text) from public;
revoke all on function public.subscribe_newsletter(text) from anon;
grant execute on function public.subscribe_newsletter(text) to anon, authenticated;

-- 3) El navegador ya no puede insertar directamente en la lista
revoke insert on public.newsletter_subscribers from anon, authenticated;

-- Ver los intentos recientes:
-- select ip, count(*), max(created_at) from public.newsletter_attempts
-- group by ip order by count(*) desc limit 20;
