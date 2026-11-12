-- Meta Conversions API · PASO 1 de 2
-- Consentimiento publicitario por persona.
--
-- Ejecuta esto en Supabase → SQL Editor → Run.
-- Es idempotente: puedes volver a ejecutarlo sin miedo.

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

  insert into public.ad_consent as c (user_id, granted, updated_at)
  values (auth.uid(), coalesce(p_granted, false), now())
  on conflict (user_id) do update
    set granted = excluded.granted,
        updated_at = now();
end;
$fn$;

revoke all on function public.set_ad_consent(boolean) from public;
revoke all on function public.set_ad_consent(boolean) from anon;
grant execute on function public.set_ad_consent(boolean) to authenticated;
