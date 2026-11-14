-- ---------------------------------------------------------------------------
-- Fase 7: límites contra escrituras y procesamiento abusivos
--
-- 1. Tope de tamaño para events.metadata y límites de frecuencia.
-- 2. Límite de carritos abiertos por usuario.
-- 3. Validación de source_path y tope de logo_assets por usuario.
-- 4. Rate limit atómico para process-logo.
--
-- Ejecutar después de fase6-limites.sql.
-- ---------------------------------------------------------------------------

begin;

-- ---------------------------------------------------------------------------
-- 1. Eventos: tamaño y frecuencia
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.events'::regclass
       and conname = 'events_metadata_size_chk'
  ) then
    alter table public.events
      add constraint events_metadata_size_chk
      check (octet_length(metadata::text) <= 16384);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.events'::regclass
       and conname = 'events_name_len_chk'
  ) then
    alter table public.events
      add constraint events_name_len_chk
      check (octet_length(name) <= 80);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.events'::regclass
       and conname = 'events_path_len_chk'
  ) then
    alter table public.events
      add constraint events_path_len_chk
      check (path is null or octet_length(path) <= 300);
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.logo_assets'::regclass
       and conname = 'logo_assets_source_path_len_chk'
  ) then
    alter table public.logo_assets
      add constraint logo_assets_source_path_len_chk
      check (octet_length(source_path) <= 300);
  end if;
end
$$;

create index if not exists events_user_created_idx
  on public.events (user_id, created_at desc);

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

drop trigger if exists events_rate_limit on public.events;
drop trigger if exists events_rate_limit_stmt on public.events;
drop function if exists public.enforce_event_rate();
create trigger events_rate_limit_stmt
  after insert on public.events
  referencing new table as new_events
  for each statement execute function public.enforce_event_rate_stmt();

-- ---------------------------------------------------------------------------
-- 2. Carritos: máximo de carritos abiertos por usuario
-- ---------------------------------------------------------------------------

create index if not exists carts_user_created_idx
  on public.carts (user_id, created_at desc);

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

drop trigger if exists carts_rate_limit on public.carts;
drop trigger if exists carts_rate_limit_stmt on public.carts;
drop function if exists public.enforce_cart_rate();
create trigger carts_rate_limit_stmt
  after insert on public.carts
  referencing new table as new_carts
  for each statement execute function public.enforce_cart_rate_stmt();

-- ---------------------------------------------------------------------------
-- 3. Logo assets: ruta propia y máximo diario
-- ---------------------------------------------------------------------------

create or replace function public.enforce_logo_asset_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Los inserts internos con service_role no tienen auth.uid().
  if new.user_id is null or auth.uid() is null then
    return new;
  end if;

  if new.source_path is null
     or new.source_path not like (new.user_id::text || '/%') then
    raise exception 'Ruta de logo no válida' using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists logo_assets_limits on public.logo_assets;
drop trigger if exists logo_assets_path on public.logo_assets;
drop function if exists public.enforce_logo_asset_limits();
create trigger logo_assets_path
  before insert on public.logo_assets
  for each row execute function public.enforce_logo_asset_path();

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

drop trigger if exists logo_assets_count_stmt on public.logo_assets;
create trigger logo_assets_count_stmt
  after insert on public.logo_assets
  referencing new table as new_assets
  for each statement execute function public.enforce_logo_assets_count_stmt();

-- ---------------------------------------------------------------------------
-- 4. process-logo: contador atómico por usuario e IP
-- ---------------------------------------------------------------------------

create table if not exists public.logo_process_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  ip_hash text not null,
  created_at timestamptz not null default now()
);

create index if not exists logo_process_attempts_user_idx
  on public.logo_process_attempts (user_id, created_at desc);

create index if not exists logo_process_attempts_ip_idx
  on public.logo_process_attempts (ip_hash, created_at desc);

create index if not exists logo_process_attempts_created_idx
  on public.logo_process_attempts (created_at);

alter table public.logo_process_attempts enable row level security;

revoke all on public.logo_process_attempts from public, anon, authenticated;
grant all on public.logo_process_attempts to service_role;

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

revoke all on function public.take_logo_process(uuid, text) from public;
revoke all on function public.take_logo_process(uuid, text) from anon;
revoke all on function public.take_logo_process(uuid, text) from authenticated;
grant execute on function public.take_logo_process(uuid, text) to service_role;

commit;
