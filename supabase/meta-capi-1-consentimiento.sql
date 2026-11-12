-- Meta Conversions API · PASO 1 de 2
-- Consentimiento publicitario por persona + diagnóstico.
--
-- Ejecuta esto en Supabase → SQL Editor → Run.
-- Es idempotente: puedes volver a ejecutarlo sin miedo.

create extension if not exists pg_net;

-- ---------------------------------------------------------------------------
-- Tabla: quién ha aceptado publicidad (se escribe desde la web)
-- ---------------------------------------------------------------------------

create table if not exists public.ad_consent (
  user_id uuid primary key references auth.users(id) on delete cascade,
  granted boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.ad_consent enable row level security;

-- Nadie lee ni escribe la tabla directamente: solo la función de abajo.
revoke all on public.ad_consent from public;
revoke all on public.ad_consent from anon;
revoke all on public.ad_consent from authenticated;

-- ---------------------------------------------------------------------------
-- Función: la web guarda aquí la decisión de la persona
-- ---------------------------------------------------------------------------

create or replace function public.set_ad_consent(p_granted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if auth.uid() is null then
    return;
  end if;

  insert into public.ad_consent (user_id, granted, updated_at)
  values (auth.uid(), coalesce(p_granted, false), now())
  on conflict (user_id) do update
    set granted = excluded.granted,
        updated_at = now();
end;
$fn$;

revoke all on function public.set_ad_consent(boolean) from public;
revoke all on function public.set_ad_consent(boolean) from anon;
grant execute on function public.set_ad_consent(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Diagnóstico: última respuesta de Meta (solo administradores)
-- ---------------------------------------------------------------------------

create or replace function public.meta_last_response()
returns jsonb
language sql
stable
security definer
set search_path = public, net
as $fn$
  select jsonb_build_object(
    'status', r.status_code,
    'body', left(r.content, 800),
    'cuando', r.created
  )
  from net._http_response r
  order by r.id desc
  limit 1;
$fn$;

revoke all on function public.meta_last_response() from public;
revoke all on function public.meta_last_response() from anon;
grant execute on function public.meta_last_response() to authenticated;
